import type { CellEditablePatch, CellEditableSnapshot, CellRecord, NotebookDefaults } from '../types';
import { type CellDefinition } from './code';

const createStoichState = (reaction = '') => ({
  reaction,
  inputs: {}
});

const clearRuntime = (cell: CellRecord): CellRecord => ({
  ...cell,
  isRunning: false,
  stoichOutput: undefined,
  output: undefined
});

export const stoichCellDefinition: CellDefinition<'stoich'> = {
  kind: 'stoich',
  create: (params) => ({
    id: params?.id ?? `cell-${Date.now()}`,
    type: 'stoich',
    source: params?.source ?? '',
    stoichState: createStoichState(params?.source ?? ''),
    ui: {
      outputCollapsed: false
    }
  }),
  normalize: (cell, _defaults: NotebookDefaults) => ({
    ...cell,
    type: 'stoich',
    stoichState: cell.stoichState ?? createStoichState(cell.source),
    ui: {
      outputCollapsed: cell.ui?.outputCollapsed ?? false
    }
  }),
  getEditableSnapshot: (cell): CellEditableSnapshot<'stoich'> => ({
    document: {
      reaction: cell.stoichState?.reaction ?? cell.source,
      inputs: cell.stoichState?.inputs ?? {}
    },
    config: {}
  }),
  applyEditablePatch: (cell, patch) =>
    clearRuntime({
      ...cell,
      source: '',
      stoichState: {
        reaction: patch.document?.reaction ?? cell.stoichState?.reaction ?? cell.source,
        inputs: patch.document?.inputs ?? cell.stoichState?.inputs ?? {}
      }
    }),
  clearRuntime,
  serialize: (cell) => cell,
  deserialize: (cell, defaults) => stoichCellDefinition.normalize(cell, defaults),
  summarizeForAssistant: (cell) => cell.stoichState?.reaction ?? '',
  validateAssistantPatch: (patch: CellEditablePatch<'stoich'>) => {
    const errors: string[] = [];
    if (patch.document?.reaction !== undefined && typeof patch.document.reaction !== 'string') {
      errors.push('Stoichiometry reaction patch must be a string.');
    }
    if (patch.document?.inputs !== undefined && typeof patch.document.inputs !== 'object') {
      errors.push('Stoichiometry inputs patch must be an object.');
    }
    return errors;
  }
};

