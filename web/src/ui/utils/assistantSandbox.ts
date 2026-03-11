import { KernelManager, ServerConnection } from '@jupyterlab/services';

import type { FunctionEntry } from '../hooks/useFunctionLibrary';

export type AssistantSandboxContextPreset =
  | 'none'
  | 'bootstrap-only'
  | 'imports-only'
  | 'selected-cells'
  | 'full-notebook-replay';

export type AssistantSandboxTarget = 'code' | 'math';

export type AssistantSandboxRequest = {
  target?: AssistantSandboxTarget;
  code?: string;
  source?: string;
  trigMode?: 'deg' | 'rad';
  renderMode?: 'exact' | 'decimal';
  contextPreset?: AssistantSandboxContextPreset;
  selectedCellIds?: string[];
  timeoutMs?: number;
};

export type AssistantSandboxNotebookCell = {
  id: string;
  type?: 'code' | 'markdown' | 'math' | 'stoich';
  source: string;
  mathTrigMode?: 'deg' | 'rad';
  mathRenderMode?: 'exact' | 'decimal';
};

export type AssistantSandboxResult = {
  target: AssistantSandboxTarget;
  status: 'ok' | 'error' | 'timeout';
  stdout: string;
  stderr: string;
  mimeData: Record<string, unknown>;
  errorName?: string;
  errorValue?: string;
  durationMs: number;
  contextPresetUsed: AssistantSandboxContextPreset;
  executedBootstrap: boolean;
  replayedCellIds: string[];
  mathValidation?: {
    kind?: 'expression' | 'equation' | 'assignment';
    error?: string;
    warnings: string[];
    stepsPreview: string[];
    hasPlot: boolean;
  };
};

const DEFAULT_TIMEOUT_MS = 5000;
const KERNEL_START_TIMEOUT_MS = 12000;
const KERNEL_SHUTDOWN_TIMEOUT_MS = 2500;
const MAX_CODE_LENGTH = 6000;
const MAX_TEXT_LENGTH = 4000;
const MAX_MIME_TEXT_LENGTH = 2000;

const asText = (value: unknown) => {
  if (Array.isArray(value)) return value.join('');
  if (value === null || value === undefined) return '';
  return String(value);
};

const truncateText = (value: string, limit = MAX_TEXT_LENGTH) => {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: number | null = null;
  try {
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
};

const extractFunctionBlock = (snippet: string) => {
  const lines = snippet.split('\n');
  const start = lines.findIndex((line) => line.startsWith('def '));
  if (start === -1) return '';
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > start && line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) break;
    block.push(line);
  }
  return block.join('\n').trim();
};

export const buildAssistantBootstrapCode = (allFunctions: FunctionEntry[]) => {
  const defs = allFunctions
    .map((fn) => extractFunctionBlock(fn.snippet))
    .filter((block) => block.startsWith('def '))
    .join('\n\n');
  return ['import math', defs].filter(Boolean).join('\n\n').trim();
};

const isImportOnlyCode = (source: string) => {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) return false;
  return lines.every((line) => line.startsWith('import ') || line.startsWith('from '));
};

const isRunnableCodeCell = (cell: AssistantSandboxNotebookCell) => cell.type === 'code' && cell.source.trim().length > 0;
const isRunnableMathCell = (cell: AssistantSandboxNotebookCell) => cell.type === 'math' && cell.source.trim().length > 0;
const isReplayableCell = (cell: AssistantSandboxNotebookCell) => isRunnableCodeCell(cell) || isRunnableMathCell(cell);

const selectReplayCells = (
  cells: AssistantSandboxNotebookCell[],
  contextPreset: AssistantSandboxContextPreset,
  selectedCellIds: string[],
  target: AssistantSandboxTarget
) => {
  switch (contextPreset) {
    case 'imports-only':
      return cells.filter((cell) => isRunnableCodeCell(cell) && isImportOnlyCode(cell.source));
    case 'selected-cells': {
      const selected = new Set(selectedCellIds);
      return cells.filter((cell) => selected.has(cell.id) && (target === 'math' ? isReplayableCell(cell) : isRunnableCodeCell(cell)));
    }
    case 'full-notebook-replay':
      return cells.filter(target === 'math' ? isReplayableCell : isRunnableCodeCell);
    default:
      return [];
  }
};

const truncateMimeValue = (value: unknown): unknown => {
  if (typeof value === 'string') return truncateText(value, MAX_MIME_TEXT_LENGTH);
  if (Array.isArray(value)) return truncateText(value.map((item) => asText(item)).join(''), MAX_MIME_TEXT_LENGTH);
  if (!value || typeof value !== 'object') return value;
  const limitedEntries = Object.entries(value as Record<string, unknown>).slice(0, 20);
  return Object.fromEntries(limitedEntries.map(([key, entry]) => [key, truncateMimeValue(entry)]));
};

const executeCodeOnKernel = async (
  kernel: any,
  code: string,
  timeoutMs: number
): Promise<AssistantSandboxResult> => {
  const startedAt = Date.now();
  let future: any;
  let stdout = '';
  let stderr = '';
  let mimeData: Record<string, unknown> = {};
  let errorName: string | undefined;
  let errorValue: string | undefined;
  try {
    future = kernel.requestExecute({ code, stop_on_error: true });
  } catch (error) {
    return {
      target: 'code',
      status: 'error',
      stdout: '',
      stderr: '',
      mimeData: {},
      errorName: 'ExecutionError',
      errorValue: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      contextPresetUsed: 'none',
      executedBootstrap: false,
      replayedCellIds: []
    };
  }

  future.onIOPub = (msg: any) => {
    if (msg.header.msg_type === 'stream') {
      const name = (msg.content as any).name ?? 'stdout';
      const text = asText((msg.content as any).text);
      if (name === 'stderr') {
        stderr += text;
      } else {
        stdout += text;
      }
      return;
    }
    if (msg.header.msg_type === 'execute_result' || msg.header.msg_type === 'display_data') {
      const data = ((msg.content as any).data ?? {}) as Record<string, unknown>;
      const merged = { ...mimeData };
      Object.entries(data).forEach(([mime, value]) => {
        if (mime === 'text/plain') {
          const nextText = `${asText(merged['text/plain'])}${asText(value)}`;
          merged['text/plain'] = truncateText(nextText, MAX_MIME_TEXT_LENGTH);
        } else {
          merged[mime] = truncateMimeValue(value);
        }
      });
      mimeData = merged;
      return;
    }
    if (msg.header.msg_type === 'error') {
      errorName = (msg.content as any).ename ?? 'Error';
      errorValue = (msg.content as any).evalue ?? '';
      const traceback = Array.isArray((msg.content as any).traceback)
        ? (msg.content as any).traceback.join('\n')
        : '';
      stderr = stderr || traceback;
    }
  };

  try {
    await withTimeout(Promise.resolve(future.done), timeoutMs, 'Sandbox execution');
    return {
      target: 'code',
      status: errorName ? 'error' : 'ok',
      stdout: truncateText(stdout),
      stderr: truncateText(stderr),
      mimeData,
      errorName,
      errorValue,
      durationMs: Date.now() - startedAt,
      contextPresetUsed: 'none',
      executedBootstrap: false,
      replayedCellIds: []
    };
  } catch (error) {
    future.dispose?.();
    return {
      target: 'code',
      status: 'timeout',
      stdout: truncateText(stdout),
      stderr: truncateText(stderr),
      mimeData,
      errorName: 'TimeoutError',
      errorValue: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
      contextPresetUsed: 'none',
      executedBootstrap: false,
      replayedCellIds: []
    };
  }
};

const buildMathValidationCode = (source: string, trigMode: 'deg' | 'rad', renderMode: 'exact' | 'decimal') =>
  [
    'import json',
    'from sugarpy.math_cell import render_math_cell',
    `_result = render_math_cell(${JSON.stringify(source)}, mode=${JSON.stringify(trigMode)}, render_mode=${JSON.stringify(renderMode)})`,
    'print(json.dumps(_result))'
  ].join('\n');

const executeMathOnKernel = async (
  kernel: any,
  source: string,
  timeoutMs: number,
  trigMode: 'deg' | 'rad',
  renderMode: 'exact' | 'decimal'
): Promise<AssistantSandboxResult> => {
  const result = await executeCodeOnKernel(kernel, buildMathValidationCode(source, trigMode, renderMode), timeoutMs);
  const mathValidation = parseMathValidation(result.stdout);
  return {
    ...result,
    target: 'math',
    status: result.status === 'ok' && (!mathValidation || !!mathValidation.error) ? 'error' : result.status,
    mathValidation:
      mathValidation ?? {
        error: 'Math validation did not return structured output.',
        warnings: [],
        stepsPreview: [],
        hasPlot: false
      }
  };
};

const parseMathValidation = (stdout: string) => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
      return {
        kind: typeof parsed.kind === 'string' ? parsed.kind : undefined,
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((value) => String(value)) : [],
        stepsPreview: Array.isArray(parsed.steps) ? parsed.steps.map((value) => String(value)).slice(0, 6) : [],
        hasPlot: !!parsed.plotly_figure
      };
    } catch (_error) {
      continue;
    }
  }
  return null;
};

export const runAssistantSandbox = async (params: {
  request: AssistantSandboxRequest;
  serverSettings: ServerConnection.ISettings;
  notebookCells: AssistantSandboxNotebookCell[];
  bootstrapCode: string;
  onActivity?: (label: string, detail?: string) => void;
}): Promise<AssistantSandboxResult> => {
  const { request, serverSettings, notebookCells, bootstrapCode, onActivity } = params;
  const target: AssistantSandboxTarget = request.target === 'math' ? 'math' : 'code';
  const code = String(request.code ?? '').trim();
  const source = String(request.source ?? '').trim();
  if (target === 'code' && !code) {
    return {
      target,
      status: 'error',
      stdout: '',
      stderr: '',
      mimeData: {},
      errorName: 'ValidationError',
      errorValue: 'Sandbox code cannot be empty.',
      durationMs: 0,
      contextPresetUsed: request.contextPreset ?? 'bootstrap-only',
      executedBootstrap: false,
      replayedCellIds: []
    };
  }
  if (target === 'math' && !source) {
    return {
      target,
      status: 'error',
      stdout: '',
      stderr: '',
      mimeData: {},
      errorName: 'ValidationError',
      errorValue: 'Math sandbox source cannot be empty.',
      durationMs: 0,
      contextPresetUsed: request.contextPreset ?? 'bootstrap-only',
      executedBootstrap: false,
      replayedCellIds: []
    };
  }
  if (target === 'code' && code.length > MAX_CODE_LENGTH) {
    return {
      target,
      status: 'error',
      stdout: '',
      stderr: '',
      mimeData: {},
      errorName: 'ValidationError',
      errorValue: `Sandbox code exceeds the ${MAX_CODE_LENGTH} character limit.`,
      durationMs: 0,
      contextPresetUsed: request.contextPreset ?? 'bootstrap-only',
      executedBootstrap: false,
      replayedCellIds: []
    };
  }

  const contextPreset: AssistantSandboxContextPreset = request.contextPreset ?? (target === 'math' ? 'selected-cells' : 'bootstrap-only');
  const timeoutMs =
    typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
      ? Math.min(Math.max(Math.round(request.timeoutMs), 250), DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
  const selectedCellIds = Array.isArray(request.selectedCellIds)
    ? request.selectedCellIds.map((cellId) => String(cellId))
    : [];
  const manager = new KernelManager({ serverSettings });
  let kernel: any = null;
  let executedBootstrap = false;
  const replayedCells = selectReplayCells(notebookCells, contextPreset, selectedCellIds, target);
  const startedAt = Date.now();

  try {
    onActivity?.('Starting isolated kernel');
    kernel = await withTimeout(manager.startNew({ name: 'python3' }), KERNEL_START_TIMEOUT_MS, 'Sandbox kernel start');

    if (contextPreset !== 'none' && bootstrapCode.trim()) {
      onActivity?.('Loading sandbox bootstrap');
      const bootstrapResult = await executeCodeOnKernel(kernel, bootstrapCode, timeoutMs);
      if (bootstrapResult.status !== 'ok') {
        return {
          ...bootstrapResult,
          durationMs: Date.now() - startedAt,
          contextPresetUsed: contextPreset,
          executedBootstrap: false,
          replayedCellIds: []
        };
      }
      executedBootstrap = true;
    }

    if (replayedCells.length > 0) {
      const label =
        contextPreset === 'imports-only'
          ? 'Replaying imports'
          : contextPreset === 'selected-cells'
            ? 'Replaying selected code cells'
            : 'Replaying notebook code cells';
      onActivity?.(label, `${replayedCells.length} cell${replayedCells.length === 1 ? '' : 's'}`);
    }

    for (const cell of replayedCells) {
      const replayResult =
        cell.type === 'math'
          ? await executeMathOnKernel(
              kernel,
              cell.source,
              timeoutMs,
              cell.mathTrigMode === 'rad' ? 'rad' : 'deg',
              cell.mathRenderMode === 'decimal' ? 'decimal' : 'exact'
            )
          : await executeCodeOnKernel(kernel, cell.source, timeoutMs);
      if (replayResult.status !== 'ok') {
        return {
          ...replayResult,
          durationMs: Date.now() - startedAt,
          contextPresetUsed: contextPreset,
          executedBootstrap,
          replayedCellIds: replayedCells.map((entry) => entry.id)
        };
      }
    }

    onActivity?.('Running isolated check', target === 'math' ? 'math' : contextPreset);
    const result =
      target === 'math'
        ? await executeMathOnKernel(
            kernel,
            source,
            timeoutMs,
            request.trigMode === 'rad' ? 'rad' : 'deg',
            request.renderMode === 'decimal' ? 'decimal' : 'exact'
          )
        : await executeCodeOnKernel(kernel, code, timeoutMs);
    if (result.status === 'timeout') {
      onActivity?.('Timed out after 5s');
    }
    return {
      ...result,
      target,
      durationMs: Date.now() - startedAt,
      contextPresetUsed: contextPreset,
      executedBootstrap,
      replayedCellIds: replayedCells.map((entry) => entry.id)
    };
  } finally {
    if (kernel) {
      try {
        await withTimeout(kernel.shutdown(), KERNEL_SHUTDOWN_TIMEOUT_MS, 'Sandbox kernel shutdown');
      } catch (_error) {
        kernel.dispose?.();
      }
    }
    manager.dispose();
  }
};
