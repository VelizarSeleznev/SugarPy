import type { CellEditablePatch, CellEditableSnapshot, CellRecord, NotebookDefaults } from '../types';
import { type CellDefinition } from './code';

const clearRuntime = (cell: CellRecord): CellRecord => ({
  ...cell,
  isRunning: false,
  output: undefined,
  mathOutput: undefined
});

export const mathCellDefinition: CellDefinition<'math'> = {
  kind: 'math',
  create: (params) => ({
    id: params?.id ?? `cell-${Date.now()}`,
    type: 'math',
    source: params?.source ?? '',
    mathRenderMode: params?.defaults.defaultMathRenderMode ?? 'exact',
    mathTrigMode: params?.defaults.trigMode ?? 'deg',
    ui: {
      outputCollapsed: false,
      mathView: 'source'
    }
  }),
  normalize: (cell, defaults) => ({
    ...cell,
    type: 'math',
    mathRenderMode: cell.mathRenderMode === 'decimal' ? 'decimal' : defaults.defaultMathRenderMode,
    mathTrigMode: cell.mathTrigMode === 'rad' ? 'rad' : defaults.trigMode,
    ui: {
      outputCollapsed: cell.ui?.outputCollapsed ?? false,
      mathView: cell.ui?.mathView === 'rendered' || cell.mathOutput ? 'rendered' : 'source'
    }
  }),
  getEditableSnapshot: (cell): CellEditableSnapshot<'math'> => ({
    document: { source: cell.source },
    config: {
      trigMode: cell.mathTrigMode,
      renderMode: cell.mathRenderMode
    }
  }),
  applyEditablePatch: (cell, patch, defaults) =>
    clearRuntime({
      ...cell,
      source: patch.document?.source ?? cell.source,
      mathTrigMode:
        patch.config?.trigMode === 'rad'
          ? 'rad'
          : patch.config?.trigMode === 'deg'
            ? 'deg'
            : cell.mathTrigMode ?? defaults.trigMode,
      mathRenderMode:
        patch.config?.renderMode === 'decimal'
          ? 'decimal'
          : patch.config?.renderMode === 'exact'
            ? 'exact'
            : cell.mathRenderMode ?? defaults.defaultMathRenderMode
    }),
  clearRuntime,
  serialize: (cell) => cell,
  deserialize: (cell, defaults) => mathCellDefinition.normalize(cell, defaults),
  summarizeForAssistant: (cell) => cell.source,
  validateAssistantPatch: (patch: CellEditablePatch<'math'>) => {
    const errors: string[] = [];
    if (patch.document && 'source' in patch.document && typeof patch.document.source !== 'string') {
      errors.push('Math cell source patch must be a string.');
    }
    if (patch.config?.trigMode && !['deg', 'rad'].includes(patch.config.trigMode)) {
      errors.push('Math cell trigMode must be deg or rad.');
    }
    if (patch.config?.renderMode && !['exact', 'decimal'].includes(patch.config.renderMode)) {
      errors.push('Math cell renderMode must be exact or decimal.');
    }
    return errors;
  }
};

