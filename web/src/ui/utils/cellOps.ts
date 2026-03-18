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

export function moveCellToIndex(cells: CellModel[], id: string, index: number) {
  const currentIndex = cells.findIndex((cell) => cell.id === id);
  if (currentIndex === -1) return cells;

  const next = [...cells];
  const [movedCell] = next.splice(currentIndex, 1);
  const targetIndex = currentIndex < index ? index - 1 : index;
  const boundedIndex = Math.max(0, Math.min(targetIndex, next.length));
  next.splice(boundedIndex, 0, movedCell);
  return next;
}

export function deleteCell(cells: CellModel[], id: string) {
  return cells.filter((c) => c.id !== id);
}
