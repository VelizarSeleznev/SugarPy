import { getCellDefinition, createCellRecord } from '../cells/registry';
import { getCellKind, type CellEditablePatch, type CellKind, type CellRecord, type NotebookDefaults } from '../cells/types';
import type { AssistantOperation, AssistantPatchUserPreferences } from './types';

export type AssistantApplyResult = {
  cells: CellRecord[];
  defaults: NotebookDefaults;
  preferencesPatch: AssistantPatchUserPreferences | null;
  activeCellId: string | null;
  lastActiveCellId: string | null;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const buildInsertPatch = (operation: Extract<AssistantOperation, { type: 'insert_cell' }>): CellEditablePatch => {
  if (operation.document || operation.config) {
    return {
      document: toRecord(operation.document),
      config: toRecord(operation.config)
    };
  }
  if (operation.cellType === 'stoich') {
    return {
      document: {
        reaction: operation.source,
        inputs: {}
      }
    };
  }
  if (operation.cellType === 'regression') {
    return {
      document: {
        points: []
      }
    };
  }
  if (operation.cellType === 'math') {
    return {
      document: { source: operation.source }
    };
  }
  return {
    document: { source: operation.source }
  };
};

export const applyAssistantOperations = (params: {
  cells: CellRecord[];
  operations: AssistantOperation[];
  defaults: NotebookDefaults;
  activeCellId: string | null;
  lastActiveCellId: string | null;
}): AssistantApplyResult => {
  let nextCells = [...params.cells];
  let nextDefaults = { ...params.defaults };
  let nextActiveCellId = params.activeCellId;
  let nextLastActiveCellId = params.lastActiveCellId;
  let preferencesPatch: AssistantPatchUserPreferences | null = null;

  for (const operation of params.operations) {
    if (operation.type === 'insert_cell') {
      const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
      const baseCell = createCellRecord(operation.cellType, nextDefaults, {
        id: `cell-${Date.now()}-${bounded}`,
        source: operation.source
      });
      const definition = getCellDefinition(operation.cellType);
      const nextCell = definition.applyEditablePatch(baseCell, buildInsertPatch(operation) as CellEditablePatch, nextDefaults);
      nextCells = [...nextCells.slice(0, bounded), nextCell, ...nextCells.slice(bounded)];
      nextActiveCellId = nextCell.id;
      nextLastActiveCellId = nextCell.id;
      continue;
    }
    if (operation.type === 'update_cell') {
      nextCells = nextCells.map((cell) => {
        if (cell.id !== operation.cellId) return cell;
        const kind = getCellKind(cell);
        const definition = getCellDefinition(kind);
        return definition.applyEditablePatch(
          cell,
          kind === 'stoich'
            ? ({ document: { reaction: operation.source, inputs: cell.stoichState?.inputs ?? {} } } as CellEditablePatch)
            : ({ document: { source: operation.source } } as CellEditablePatch),
          nextDefaults
        );
      });
      nextActiveCellId = operation.cellId;
      nextLastActiveCellId = operation.cellId;
      continue;
    }
    if (operation.type === 'patch_cell') {
      nextCells = nextCells.map((cell) => {
        if (cell.id !== operation.cellId) return cell;
        const definition = getCellDefinition(getCellKind(cell));
        return definition.applyEditablePatch(cell, operation.patch, nextDefaults);
      });
      nextActiveCellId = operation.cellId;
      nextLastActiveCellId = operation.cellId;
      continue;
    }
    if (operation.type === 'replace_cell_editable') {
      nextCells = nextCells.map((cell) => {
        if (cell.id !== operation.cellId) return cell;
        const definition = getCellDefinition(getCellKind(cell));
        return definition.applyEditablePatch(
          cell,
          {
            document: operation.document,
            config: operation.config ?? {}
          } as CellEditablePatch,
          nextDefaults
        );
      });
      nextActiveCellId = operation.cellId;
      nextLastActiveCellId = operation.cellId;
      continue;
    }
    if (operation.type === 'delete_cell') {
      nextCells = nextCells.filter((cell) => cell.id !== operation.cellId);
      if (nextActiveCellId === operation.cellId) {
        nextActiveCellId = nextCells[0]?.id ?? null;
      }
      if (nextLastActiveCellId === operation.cellId) {
        nextLastActiveCellId = nextActiveCellId ?? nextCells[0]?.id ?? null;
      }
      continue;
    }
    if (operation.type === 'move_cell') {
      const index = nextCells.findIndex((cell) => cell.id === operation.cellId);
      if (index === -1) continue;
      const [cell] = nextCells.splice(index, 1);
      const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
      nextCells.splice(bounded, 0, { ...cell, assistantMeta: undefined });
      nextCells = [...nextCells];
      nextActiveCellId = operation.cellId;
      nextLastActiveCellId = operation.cellId;
      continue;
    }
    if (operation.type === 'set_notebook_defaults') {
      if (operation.trigMode) nextDefaults.trigMode = operation.trigMode;
      if (operation.renderMode) nextDefaults.defaultMathRenderMode = operation.renderMode;
      continue;
    }
    if (operation.type === 'patch_user_preferences') {
      preferencesPatch = { ...(preferencesPatch ?? {}), ...operation.patch };
    }
  }

  return {
    cells: nextCells,
    defaults: nextDefaults,
    preferencesPatch,
    activeCellId: nextActiveCellId,
    lastActiveCellId: nextLastActiveCellId
  };
};
