import { createRegressionState } from '../../utils/regressionTypes';
import type { CellEditablePatch, CellEditableSnapshot, CellRecord, NotebookDefaults } from '../types';
import { type CellDefinition } from './code';

const clearRuntime = (cell: CellRecord): CellRecord => ({
  ...cell,
  isRunning: false,
  regressionOutput: undefined,
  output: undefined
});

export const regressionCellDefinition: CellDefinition<'regression'> = {
  kind: 'regression',
  create: (params) => ({
    id: params?.id ?? `cell-${Date.now()}`,
    type: 'regression',
    source: params?.source ?? '',
    regressionState: createRegressionState(),
    ui: {
      outputCollapsed: false
    }
  }),
  normalize: (cell, _defaults: NotebookDefaults) => ({
    ...cell,
    type: 'regression',
    regressionState: cell.regressionState ?? createRegressionState(),
    ui: {
      outputCollapsed: cell.ui?.outputCollapsed ?? false
    }
  }),
  getEditableSnapshot: (cell): CellEditableSnapshot<'regression'> => ({
    document: {
      points: cell.regressionState?.points ?? []
    },
    config: {
      model: cell.regressionState?.model,
      labels: cell.regressionState?.labels,
      ui: cell.regressionState?.ui
    }
  }),
  applyEditablePatch: (cell, patch) => {
    const currentState = cell.regressionState ?? createRegressionState();
    return clearRuntime({
      ...cell,
      regressionState: {
        ...currentState,
        points: patch.document?.points ?? currentState.points,
        model: patch.config?.model ?? currentState.model,
        labels: patch.config?.labels ?? currentState.labels,
        ui: patch.config?.ui ?? currentState.ui
      }
    });
  },
  clearRuntime,
  serialize: (cell) => cell,
  deserialize: (cell, defaults) => regressionCellDefinition.normalize(cell, defaults),
  summarizeForAssistant: (cell) => cell.regressionOutput?.equation_text ?? `${cell.regressionState?.model ?? 'auto'} fit`,
  validateAssistantPatch: (patch: CellEditablePatch<'regression'>) => {
    const errors: string[] = [];
    if (patch.document?.points !== undefined && !Array.isArray(patch.document.points)) {
      errors.push('Regression points patch must be an array.');
    }
    return errors;
  }
};

