import type { FunctionEntry } from '../hooks/useFunctionLibrary';
import { runAssistantSandboxRequest } from './backendApi';

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
  contextSource?: 'notebook' | 'draft';
};

export type AssistantSandboxAttempt = {
  status: 'ok' | 'error' | 'timeout';
  contextPresetUsed: AssistantSandboxContextPreset;
  selectedCellIds: string[];
  replayedCellIds: string[];
  contextSourcesUsed: Array<'bootstrap' | 'notebook' | 'draft'>;
  executedBootstrap: boolean;
  durationMs: number;
  errorName?: string;
  errorValue?: string;
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
  selectedCellIds: string[];
  executedBootstrap: boolean;
  replayedCellIds: string[];
  contextSourcesUsed: Array<'bootstrap' | 'notebook' | 'draft'>;
  attempts?: AssistantSandboxAttempt[];
  mathValidation?: {
    kind?: 'expression' | 'equation' | 'assignment';
    error?: string;
    warnings: string[];
    stepsPreview: string[];
    hasPlot: boolean;
  };
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_VALIDATION_BUDGET_MS = 8000;
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

export const runAssistantSandbox = async (params: {
  request: AssistantSandboxRequest;
  notebookCells: AssistantSandboxNotebookCell[];
  bootstrapCode: string;
  onActivity?: (label: string, detail?: string) => void;
}): Promise<AssistantSandboxResult> => {
  const { request, notebookCells, bootstrapCode, onActivity } = params;
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
      contextPresetUsed: 'none',
      selectedCellIds: [],
      executedBootstrap: false,
      replayedCellIds: [],
      contextSourcesUsed: [],
      attempts: []
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
      contextPresetUsed: 'none',
      selectedCellIds: [],
      executedBootstrap: false,
      replayedCellIds: [],
      contextSourcesUsed: [],
      attempts: []
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
      contextPresetUsed: 'none',
      selectedCellIds: [],
      executedBootstrap: false,
      replayedCellIds: [],
      contextSourcesUsed: [],
      attempts: []
    };
  }

  const timeoutMs =
    typeof request.timeoutMs === 'number' && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
      ? Math.min(Math.max(Math.round(request.timeoutMs), 250), DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
  const replayableIds = notebookCells
    .filter((cell) => (cell.type === 'code' || cell.type === 'math') && cell.source.trim().length > 0)
    .map((cell) => cell.id);
  const importOnlyIds = notebookCells
    .filter((cell) => {
      if (cell.type !== 'code') return false;
      const lines = cell.source
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return lines.length > 0 && lines.every((line) => line.startsWith('import ') || line.startsWith('from '));
    })
    .map((cell) => cell.id);
  const requestedPreset = request.contextPreset ?? (target === 'math' ? 'none' : 'bootstrap-only');
  const requestedSelectedIds = Array.isArray(request.selectedCellIds) ? request.selectedCellIds : [];
  const elapsedStart = Date.now();
  const attempts: AssistantSandboxAttempt[] = [];

  const buildAttemptQueue = (): AssistantSandboxRequest[] => {
    const queue: AssistantSandboxRequest[] = [
      {
        ...request,
        contextPreset: requestedPreset,
        selectedCellIds: requestedSelectedIds,
        timeoutMs
      }
    ];
    const hasExplicitSelection = requestedSelectedIds.length > 0;
    if (requestedPreset === 'full-notebook-replay' || hasExplicitSelection) {
      return queue;
    }
    const addPreset = (contextPreset: AssistantSandboxContextPreset, selectedCellIds: string[] = []) => {
      const last = queue[queue.length - 1];
      if (last?.contextPreset === contextPreset && JSON.stringify(last.selectedCellIds ?? []) === JSON.stringify(selectedCellIds)) {
        return;
      }
      queue.push({
        ...request,
        contextPreset,
        selectedCellIds,
        timeoutMs
      });
    };
    if (requestedPreset === 'none') addPreset('bootstrap-only');
    if (requestedPreset === 'none' || requestedPreset === 'bootstrap-only') addPreset('imports-only', importOnlyIds);
    if (requestedPreset === 'none' || requestedPreset === 'bootstrap-only' || requestedPreset === 'imports-only') {
      addPreset('selected-cells', replayableIds);
    }
    if (requestedPreset !== 'full-notebook-replay') addPreset('full-notebook-replay', []);
    return queue;
  };

  const queue = buildAttemptQueue();
  let finalResult: AssistantSandboxResult | null = null;

  for (const attemptRequest of queue) {
    if (Date.now() - elapsedStart >= DEFAULT_VALIDATION_BUDGET_MS && attempts.length > 0) {
      break;
    }
    const label =
      attemptRequest.contextPreset === 'imports-only'
        ? 'Replaying imports'
        : attemptRequest.contextPreset === 'selected-cells'
          ? 'Replaying selected cells'
          : attemptRequest.contextPreset === 'full-notebook-replay'
            ? 'Replaying notebook context'
            : 'Running isolated check';
    onActivity?.(label, target === 'math' ? 'math' : 'code');
    const result = await runAssistantSandboxRequest({
      request: attemptRequest,
      notebookCells,
      bootstrapCode
    });
    attempts.push({
      status: result.status,
      contextPresetUsed: result.contextPresetUsed,
      selectedCellIds: result.selectedCellIds ?? [],
      replayedCellIds: result.replayedCellIds,
      contextSourcesUsed: result.contextSourcesUsed ?? [],
      executedBootstrap: result.executedBootstrap,
      durationMs: result.durationMs,
      errorName: result.errorName,
      errorValue: result.errorValue
    });
    finalResult = result;
    if (result.status === 'ok') break;
    if (result.status === 'timeout') onActivity?.('Timed out after 5s');
  }

  if (!finalResult) {
    return {
      target,
      status: 'timeout',
      stdout: '',
      stderr: '',
      mimeData: {},
      errorName: 'ValidationBudgetExceeded',
      errorValue: `Validation exhausted the ${DEFAULT_VALIDATION_BUDGET_MS}ms attempt budget.`,
      durationMs: Date.now() - elapsedStart,
      contextPresetUsed: requestedPreset,
      selectedCellIds: requestedSelectedIds,
      executedBootstrap: false,
      replayedCellIds: [],
      contextSourcesUsed: [],
      attempts
    };
  }

  return {
    ...finalResult,
    durationMs: Date.now() - elapsedStart,
    attempts
  };
};
