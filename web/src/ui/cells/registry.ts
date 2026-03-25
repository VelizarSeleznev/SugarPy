import { codeCellDefinition, type CellDefinition } from './definitions/code';
import { markdownCellDefinition } from './definitions/markdown';
import { mathCellDefinition } from './definitions/math';
import { regressionCellDefinition } from './definitions/regression';
import { stoichCellDefinition } from './definitions/stoich';
import { getCellKind, type CellKind, type CellRecord, type NotebookDefaults } from './types';

export const cellRegistry: Record<CellKind, CellDefinition> = {
  code: codeCellDefinition,
  markdown: markdownCellDefinition,
  math: mathCellDefinition,
  stoich: stoichCellDefinition,
  regression: regressionCellDefinition
};

export const getCellDefinition = (kind: CellKind) => cellRegistry[kind];

export const normalizeCellRecord = (cell: CellRecord, defaults: NotebookDefaults) =>
  getCellDefinition(getCellKind(cell)).normalize(cell, defaults);

export const createCellRecord = (
  kind: CellKind,
  defaults: NotebookDefaults,
  params?: { id?: string; source?: string }
) => getCellDefinition(kind).create({ id: params?.id ?? `cell-${Date.now()}`, defaults, source: params?.source });

