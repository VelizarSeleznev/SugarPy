import type {
  CellEditablePatch,
  CellEditableSnapshot,
  CellKind,
  CellRecord,
  NotebookDefaults
} from '../types';

type CellDefinition<K extends CellKind = CellKind> = {
  kind: K;
  create: (params?: { id: string; defaults: NotebookDefaults; source?: string }) => CellRecord;
  normalize: (cell: CellRecord, defaults: NotebookDefaults) => CellRecord;
  getEditableSnapshot: (cell: CellRecord, defaults: NotebookDefaults) => CellEditableSnapshot<K>;
  applyEditablePatch: (cell: CellRecord, patch: CellEditablePatch<K>, defaults: NotebookDefaults) => CellRecord;
  clearRuntime: (cell: CellRecord) => CellRecord;
  serialize: (cell: CellRecord) => CellRecord;
  deserialize: (cell: CellRecord, defaults: NotebookDefaults) => CellRecord;
  summarizeForAssistant: (cell: CellRecord, defaults: NotebookDefaults) => string;
  validateAssistantPatch: (patch: CellEditablePatch<K>) => string[];
};

const clearRuntime = (cell: CellRecord): CellRecord => ({
  ...cell,
  isRunning: false,
  output: undefined,
  mathOutput: undefined,
  stoichOutput: undefined,
  regressionOutput: undefined
});

const makeCodeCell = (params?: { id: string; defaults: NotebookDefaults; source?: string }): CellRecord => ({
  id: params?.id ?? `cell-${Date.now()}`,
  type: 'code',
  source: params?.source ?? '',
  ui: {
    outputCollapsed: false
  }
});

export const codeCellDefinition: CellDefinition<'code'> = {
  kind: 'code',
  create: makeCodeCell,
  normalize: (cell) => ({
    ...cell,
    type: 'code',
    ui: {
      outputCollapsed: cell.ui?.outputCollapsed ?? false
    }
  }),
  getEditableSnapshot: (cell) => ({
    document: { source: cell.source },
    config: {}
  }),
  applyEditablePatch: (cell, patch) =>
    clearRuntime({
      ...cell,
      source: patch.document?.source ?? cell.source
    }),
  clearRuntime,
  serialize: (cell) => cell,
  deserialize: (cell, defaults) => codeCellDefinition.normalize(cell, defaults),
  summarizeForAssistant: (cell) => cell.source,
  validateAssistantPatch: (patch) => {
    const errors: string[] = [];
    if (patch.document && 'source' in patch.document && typeof patch.document.source !== 'string') {
      errors.push('Code cell source patch must be a string.');
    }
    return errors;
  }
};

export type { CellDefinition };

