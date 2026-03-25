import type { AssistantSandboxNotebookCell } from '../utils/assistantSandbox';
import type { NotebookAssistantContext } from '../utils/assistant';
import { createCellRecord } from '../cells/registry';
import type { CellRecord, NotebookDefaults } from '../cells/types';
import type { StoichState } from '../utils/stoichTypes';
import type { RegressionState } from '../utils/regressionTypes';

export type AssistantSnapshot = {
  cells: CellRecord[];
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  activeCellId: string | null;
  lastActiveCellId: string | null;
};

export const createNotebookCell = (
  type: 'code' | 'markdown' | 'math' | 'stoich' | 'regression',
  defaults: NotebookDefaults,
  source = '',
  indexSeed?: number
): CellRecord =>
  createCellRecord(type, defaults, {
    id: `cell-${indexSeed ? `${indexSeed}-` : ''}${Date.now()}`,
    source
  });

export const toggleCellOutputCollapsedInDocument = (cells: CellRecord[], cellId: string) =>
  cells.map((cell) => {
    if (cell.id !== cellId) return cell;
    const nextCollapsed = !(cell.ui?.outputCollapsed ?? false);
    return {
      ...cell,
      ui: {
        ...cell.ui,
        outputCollapsed: nextCollapsed,
        ...(cell.type === 'math' && nextCollapsed ? { mathView: 'source' as const } : {})
      }
    };
  });

export const clearCellOutputInDocument = (cells: CellRecord[], cellId: string) =>
  cells.map((cell) =>
    cell.id === cellId
      ? {
          ...cell,
          output: undefined,
          mathOutput: undefined,
          stoichOutput: undefined,
          regressionOutput: undefined,
          ui: {
            ...cell.ui,
            outputCollapsed: false,
            ...(cell.type === 'math' ? { mathView: 'rendered' as const } : {})
          }
        }
      : cell
  );

export const updateCellSourceInDocument = (cells: CellRecord[], cellId: string, source: string) =>
  cells.map((cell) => (cell.id === cellId ? { ...cell, source } : cell));

export const updateStoichStateInDocument = (cells: CellRecord[], cellId: string, state: StoichState) =>
  cells.map((cell) => (cell.id === cellId ? { ...cell, stoichState: state } : cell));

export const updateRegressionStateInDocument = (cells: CellRecord[], cellId: string, state: RegressionState) =>
  cells.map((cell) => (cell.id === cellId ? { ...cell, regressionState: state } : cell));

export const getCellDisplayText = (cell: CellRecord) => {
  if (cell.type === 'stoich') {
    return cell.stoichState?.reaction ?? '';
  }
  if (cell.type === 'regression') {
    return cell.regressionOutput?.equation_text ?? cell.regressionOutput?.error ?? '';
  }
  if (cell.output?.type === 'error') {
    return `${cell.output.ename}: ${cell.output.evalue}`;
  }
  if (cell.mathOutput?.error) {
    return cell.mathOutput.error;
  }
  if (cell.mathOutput?.steps?.length) {
    return cell.mathOutput.steps.join('\n');
  }
  const plain = cell.output?.type === 'mime' ? cell.output.data['text/plain'] : '';
  if (Array.isArray(plain)) return plain.join('');
  if (plain === null || plain === undefined) return '';
  return String(plain);
};

export const buildNotebookAssistantContext = (params: {
  notebookName: string;
  defaults: NotebookDefaults;
  activeCellId: string | null;
  cells: CellRecord[];
}): NotebookAssistantContext => ({
  notebookName: params.notebookName,
  defaultTrigMode: params.defaults.trigMode,
  defaultMathRenderMode: params.defaults.defaultMathRenderMode,
  activeCellId: params.activeCellId,
  cells: params.cells.map((cell) => ({
    id: cell.id,
    type: (cell.type ?? 'code') as NotebookAssistantContext['cells'][number]['type'],
    source: cell.source,
    mathRenderMode: cell.mathRenderMode,
    mathTrigMode: cell.mathTrigMode,
    stoichReaction: cell.stoichState?.reaction ?? '',
    hasOutput: !!(cell.output || cell.mathOutput || cell.stoichOutput || cell.regressionOutput),
    outputPreview: getCellDisplayText(cell),
    hasError: !!(
      cell.output?.type === 'error' ||
      cell.mathOutput?.error ||
      (cell.stoichOutput && cell.stoichOutput.ok === false) ||
      (cell.regressionOutput && cell.regressionOutput.ok === false)
    )
  }))
});

export const buildAssistantSandboxCells = (cells: CellRecord[]): AssistantSandboxNotebookCell[] =>
  cells.map((cell) => ({
    id: cell.id,
    type: cell.type ?? 'code',
    source: cell.type === 'stoich' ? cell.stoichState?.reaction ?? '' : cell.source,
    mathTrigMode: cell.mathTrigMode,
    mathRenderMode: cell.mathRenderMode,
    contextSource: 'notebook'
  }));

export const captureAssistantSnapshot = (params: {
  cells: CellRecord[];
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  activeCellId: string | null;
  lastActiveCellId: string | null;
}): AssistantSnapshot => ({
  cells: params.cells.map((cell) =>
    typeof structuredClone === 'function'
      ? structuredClone(cell)
      : (JSON.parse(JSON.stringify(cell)) as CellRecord)
  ),
  trigMode: params.trigMode,
  defaultMathRenderMode: params.defaultMathRenderMode,
  activeCellId: params.activeCellId,
  lastActiveCellId: params.lastActiveCellId
});
