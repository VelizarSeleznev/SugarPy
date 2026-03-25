import type { AssistantActivity, AssistantCellKind, AssistantDraftStep, AssistantValidationSummary } from '../utils/assistant';
import type { AssistantOperation } from './types';
import type { AssistantSandboxNotebookCell, AssistantSandboxRequest, AssistantSandboxResult } from '../utils/assistantSandbox';

const asText = (value: unknown) => {
  if (Array.isArray(value)) return value.join('');
  if (value === null || value === undefined) return '';
  return String(value);
};

export const getAssistantOperationSource = (operation: AssistantOperation) => {
  if (operation.type === 'insert_cell' || operation.type === 'update_cell') return operation.source;
  if (operation.type === 'replace_cell_editable') {
    return typeof operation.document?.source === 'string' ? operation.document.source : '';
  }
  if (operation.type === 'patch_cell') {
    const document = operation.patch.document as Record<string, unknown> | undefined;
    return typeof document?.source === 'string' ? document.source : '';
  }
  return '';
};

export const isRunnableAssistantOperation = (operation: AssistantOperation) =>
  (operation.type === 'insert_cell' && operation.cellType !== 'markdown') ||
  operation.type === 'update_cell' ||
  operation.type === 'patch_cell' ||
  operation.type === 'replace_cell_editable';

export const isReplayableSandboxCell = (cell: AssistantSandboxNotebookCell) =>
  (cell.type === 'code' || cell.type === 'math') && cell.source.trim().length > 0;

export const cloneSandboxCells = (input: AssistantSandboxNotebookCell[]): AssistantSandboxNotebookCell[] =>
  input.map((cell) => ({ ...cell }));

export const describeAssistantOperationChange = (operation: AssistantOperation) => {
  switch (operation.type) {
    case 'insert_cell':
      return `Add ${operation.cellType} cell at ${operation.index + 1}`;
    case 'update_cell':
      return `Update cell ${operation.cellId}`;
    case 'patch_cell':
      return `Patch cell ${operation.cellId}`;
    case 'replace_cell_editable':
      return `Replace editable state for cell ${operation.cellId}`;
    case 'delete_cell':
      return `Delete cell ${operation.cellId}`;
    case 'move_cell':
      return `Move cell ${operation.cellId} to ${operation.index + 1}`;
    case 'set_notebook_defaults':
      return 'Update notebook defaults';
    case 'patch_user_preferences':
      return 'Update local preferences';
    default:
      return operation.type;
  }
};

const describeValidationOutputKind = (source: string, result: AssistantSandboxResult) => {
  if (result.status === 'timeout') return 'timeout';
  if (result.status === 'error') return 'error';
  if (result.target === 'math') {
    if (/\bplot\s*\(/.test(source) || result.mathValidation?.hasPlot) return 'plot';
    if (/\bsolve\s*\(/.test(source)) return 'symbolic solve';
    return result.mathValidation?.kind ?? 'math';
  }
  const mimeKeys = Object.keys(result.mimeData ?? {});
  if (mimeKeys.includes('application/vnd.plotly.v1+json')) return 'plot';
  if (mimeKeys.includes('text/latex')) return 'latex';
  if (mimeKeys.includes('text/plain')) return 'text';
  if (result.stdout.trim()) return 'stdout';
  return mimeKeys[0] ?? 'code';
};

const describeValidationPreview = (result: AssistantSandboxResult) => {
  if (result.target === 'math') {
    if (result.mathValidation?.error) return result.mathValidation.error;
    if (result.mathValidation?.stepsPreview?.length) {
      return result.mathValidation.stepsPreview.join(' | ');
    }
  }
  const plain = result.mimeData?.['text/plain'];
  if (plain) return asText(plain);
  if (result.stdout.trim()) return result.stdout.trim();
  if (result.stderr.trim()) return result.stderr.trim();
  return '';
};

export const buildValidationSummary = (source: string, result: AssistantSandboxResult): AssistantValidationSummary => {
  const rawPreview = describeValidationPreview(result).replace(/\s+/g, ' ').trim();
  const contextSummary =
    result.replayedCellIds.length > 0
      ? `${result.contextPresetUsed} using ${result.replayedCellIds.length} prior cell${result.replayedCellIds.length === 1 ? '' : 's'}`
      : result.executedBootstrap || result.contextPresetUsed === 'bootstrap-only'
        ? 'bootstrap only'
        : 'isolation only';
  const attemptSuffix = (result.attempts?.length ?? 0) > 1 ? ` after ${result.attempts?.length} attempts` : '';
  const errorSummary =
    result.status === 'error'
      ? result.mathValidation?.error || result.errorValue || result.errorName || 'Validation failed.'
      : result.status === 'timeout'
        ? result.errorValue || 'Validation timed out.'
        : undefined;
  return {
    status: result.status,
    outputKind: describeValidationOutputKind(source, result),
    preview: rawPreview,
    contextSummary,
    durationMs: result.durationMs,
    errorSummary,
    warningCount: result.mathValidation?.warnings?.length ?? 0,
    attemptSummary: `${contextSummary}${attemptSuffix}`
  };
};

export const createValidationRequest = (params: {
  operation: AssistantOperation;
  workingCells: AssistantSandboxNotebookCell[];
  steps: AssistantDraftStep[];
  workingTrigMode: 'deg' | 'rad';
  workingRenderMode: 'exact' | 'decimal';
}) => {
  const { operation, workingCells, steps, workingTrigMode, workingRenderMode } = params;
  const sandboxSource = getAssistantOperationSource(operation);
  const replayableCellIds = workingCells
    .filter((cell) => {
      if (!isReplayableSandboxCell(cell)) return false;
      return (
        (operation.type !== 'update_cell' &&
          operation.type !== 'patch_cell' &&
          operation.type !== 'replace_cell_editable') ||
        cell.id !== operation.cellId
      );
    })
    .map((cell) => cell.id);
  const usesReplayContext =
    replayableCellIds.length > 0 &&
    (
      operation.type === 'update_cell' ||
      operation.type === 'patch_cell' ||
      operation.type === 'replace_cell_editable' ||
      steps.some((entry) => entry.isRunnable)
    );
  const request: AssistantSandboxRequest =
    operation.type === 'insert_cell' && operation.cellType === 'math'
      ? {
          target: 'math',
          source: sandboxSource,
          trigMode: workingTrigMode,
          renderMode: workingRenderMode,
          contextPreset: usesReplayContext ? 'selected-cells' : 'none',
          selectedCellIds: usesReplayContext ? replayableCellIds : [],
          timeoutMs: 5000
        }
      : (operation.type === 'update_cell' ||
          operation.type === 'patch_cell' ||
          operation.type === 'replace_cell_editable') &&
        workingCells.find((cell) => cell.id === operation.cellId)?.type === 'math'
        ? {
            target: 'math',
            source: sandboxSource,
            trigMode: workingTrigMode,
            renderMode: workingRenderMode,
            contextPreset: usesReplayContext ? 'selected-cells' : 'none',
            selectedCellIds: usesReplayContext ? replayableCellIds : [],
            timeoutMs: 5000
          }
        : {
            target: 'code',
            code: sandboxSource,
            contextPreset: usesReplayContext ? 'selected-cells' : 'bootstrap-only',
            selectedCellIds: usesReplayContext ? replayableCellIds : [],
            timeoutMs: 5000
          };

  return { sandboxSource, request };
};
