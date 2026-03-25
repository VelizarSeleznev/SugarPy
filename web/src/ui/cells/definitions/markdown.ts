import type { NotebookDefaults } from '../types';
import { codeCellDefinition, type CellDefinition } from './code';

export const markdownCellDefinition: CellDefinition<'markdown'> = {
  ...codeCellDefinition,
  kind: 'markdown',
  create: (params) => ({
    id: params?.id ?? `cell-${Date.now()}`,
    type: 'markdown',
    source: params?.source ?? '',
    ui: {
      outputCollapsed: false
    }
  }),
  normalize: (cell, _defaults: NotebookDefaults) => ({
    ...cell,
    type: 'markdown',
    ui: {
      outputCollapsed: cell.ui?.outputCollapsed ?? false
    }
  }),
  clearRuntime: (cell) => ({
    ...cell,
    isRunning: false
  })
};

