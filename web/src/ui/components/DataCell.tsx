import React, { useEffect, useMemo, useRef } from 'react';
import { DataPointDraft, DataState } from '../utils/dataTypes';

type Props = {
  state: DataState;
  onChange: (state: DataState) => void;
};

const MIN_ROWS = 3;

const ensureTrailingRows = (points: DataPointDraft[]) => {
  const next = points.map((point) => ({ ...point }));
  while (next.length < MIN_ROWS || next[next.length - 1].x.trim() || next[next.length - 1].y.trim()) {
    next.push({ x: '', y: '' });
  }
  return next;
};

const trimTrailingRows = (points: DataPointDraft[]) => {
  const next = points.map((point) => ({ ...point }));
  while (next.length > MIN_ROWS) {
    const last = next[next.length - 1];
    const penultimate = next[next.length - 2];
    if ((last.x.trim() || last.y.trim()) || (penultimate.x.trim() || penultimate.y.trim())) break;
    next.pop();
  }
  return ensureTrailingRows(next);
};

const parseClipboard = (raw: string) =>
  raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|;|,(?=\s*-?\d)/).map((part) => part.trim());
      return { x: parts[0] ?? '', y: parts[1] ?? '' };
    })
    .filter((row) => row.x || row.y);

const safeSymbol = (value: string) => {
  const cleaned = value
    .trim()
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!cleaned) return 'data';
  return /^\d/.test(cleaned) ? `data_${cleaned}` : cleaned;
};

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path
      d={expanded ? 'M2.5 4.25 6 7.75 9.5 4.25' : 'M4.25 2.5 7.75 6 4.25 9.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function DataCell({ state, onChange }: Props) {
  const normalizedState = useMemo(
    () => ({
      ...state,
      name: state.name || 'data',
      labels: {
        x: state.labels?.x ?? 'x',
        y: state.labels?.y ?? 'y'
      },
      points: ensureTrailingRows(state.points ?? []),
      ui: {
        editorExpanded: state.ui?.editorExpanded ?? true
      }
    }),
    [state]
  );
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const editorExpanded = normalizedState.ui.editorExpanded;
  const validPointCount = normalizedState.points.filter((point) => point.x.trim() && point.y.trim()).length;
  const symbolName = safeSymbol(normalizedState.name);

  useEffect(() => {
    if ((state.points ?? []).length === 0 || !state.labels || !state.name) {
      onChange(normalizedState);
    }
  }, [normalizedState, onChange, state.labels, state.name, state.points]);

  const setState = (next: DataState) => {
    onChange({
      ...next,
      points: trimTrailingRows(next.points)
    });
  };

  const updatePoint = (rowIndex: number, field: 'x' | 'y', value: string) => {
    const nextPoints = normalizedState.points.map((point, index) =>
      index === rowIndex ? { ...point, [field]: value } : point
    );
    setState({ ...normalizedState, points: nextPoints });
  };

  const updateLabel = (field: 'x' | 'y', value: string) => {
    setState({
      ...normalizedState,
      labels: {
        ...normalizedState.labels,
        [field]: value
      }
    });
  };

  const moveFocus = (rowIndex: number, fieldIndex: number) => {
    const flatIndex = rowIndex * 2 + fieldIndex;
    inputRefs.current[flatIndex]?.focus();
    inputRefs.current[flatIndex]?.select();
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, fieldIndex: number) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveFocus(Math.min(rowIndex + 1, normalizedState.points.length - 1), fieldIndex);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(Math.min(rowIndex + 1, normalizedState.points.length - 1), fieldIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(Math.max(rowIndex - 1, 0), fieldIndex);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>, rowIndex: number) => {
    const rows = parseClipboard(event.clipboardData.getData('text/plain'));
    if (rows.length <= 1) return;
    event.preventDefault();
    const nextPoints = [...normalizedState.points];
    rows.forEach((row, offset) => {
      nextPoints[rowIndex + offset] = row;
    });
    setState({ ...normalizedState, points: nextPoints });
  };

  return (
    <div className="data-cell">
      <div className="data-toolbar">
        <div className="data-toolbar-left">
          <button
            type="button"
            className="data-collapse-button"
            aria-label={editorExpanded ? 'Collapse data table' : 'Expand data table'}
            onClick={() =>
              setState({
                ...normalizedState,
                ui: { ...normalizedState.ui, editorExpanded: !editorExpanded }
              })
            }
          >
            <ChevronIcon expanded={editorExpanded} />
          </button>
          <label className="data-name-label">
            <span>Name</span>
            <input
              value={normalizedState.name}
              onChange={(event) => setState({ ...normalizedState, name: event.target.value })}
              placeholder="data"
            />
          </label>
        </div>
        <div className="data-summary">
          <span>{validPointCount} points</span>
          <span>Use as {symbolName}</span>
        </div>
      </div>

      <div className="data-labels">
        <label className="data-axis-label">
          <span>X label</span>
          <input value={normalizedState.labels.x} onChange={(event) => updateLabel('x', event.target.value)} placeholder="x" />
        </label>
        <label className="data-axis-label">
          <span>Y label</span>
          <input value={normalizedState.labels.y} onChange={(event) => updateLabel('y', event.target.value)} placeholder="y" />
        </label>
      </div>

      {editorExpanded ? (
        <div className="data-editor">
          <div className="data-sheet-wrap">
            <table className="data-sheet">
              <thead>
                <tr>
                  <th className="data-row-head">#</th>
                  <th>{normalizedState.labels.x || 'x'}</th>
                  <th>{normalizedState.labels.y || 'y'}</th>
                </tr>
              </thead>
              <tbody>
                {normalizedState.points.map((point, rowIndex) => (
                  <tr key={`data-row-${rowIndex}`}>
                    <td className="data-row-index">{rowIndex + 1}</td>
                    <td>
                      <input
                        ref={(node) => {
                          inputRefs.current[rowIndex * 2] = node;
                        }}
                        className="data-sheet-input"
                        value={point.x}
                        onChange={(event) => updatePoint(rowIndex, 'x', event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(event, rowIndex, 0)}
                        onPaste={(event) => handlePaste(event, rowIndex)}
                        placeholder={normalizedState.labels.x || 'x'}
                      />
                    </td>
                    <td>
                      <input
                        ref={(node) => {
                          inputRefs.current[rowIndex * 2 + 1] = node;
                        }}
                        className="data-sheet-input"
                        value={point.y}
                        onChange={(event) => updatePoint(rowIndex, 'y', event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(event, rowIndex, 1)}
                        onPaste={(event) => handlePaste(event, rowIndex)}
                        placeholder={normalizedState.labels.y || 'y'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

