import { CellModel } from '../App';

export function insertCellAbove(cells: CellModel[], id: string, newCell: CellModel) {
  const idx = cells.findIndex((c) => c.id === id);
  if (idx === -1) return [...cells, newCell];
  return [...cells.slice(0, idx), newCell, ...cells.slice(idx)];
}

export function insertCellBelow(cells: CellModel[], id: string, newCell: CellModel) {
  const idx = cells.findIndex((c) => c.id === id);
  if (idx === -1) return [...cells, newCell];
  return [...cells.slice(0, idx + 1), newCell, ...cells.slice(idx + 1)];
}

export function moveCellUp(cells: CellModel[], id: string) {
  const idx = cells.findIndex((c) => c.id === id);
  if (idx <= 0) return cells;
  const next = [...cells];
  const tmp = next[idx - 1];
  next[idx - 1] = next[idx];
  next[idx] = tmp;
  return next;
}

export function moveCellDown(cells: CellModel[], id: string) {
  const idx = cells.findIndex((c) => c.id === id);
  if (idx === -1 || idx >= cells.length - 1) return cells;
  const next = [...cells];
  const tmp = next[idx + 1];
  next[idx + 1] = next[idx];
  next[idx] = tmp;
  return next;
}

export function deleteCell(cells: CellModel[], id: string) {
  return cells.filter((c) => c.id !== id);
}
