import React, { useEffect, useMemo, useRef, useState } from 'react';
import { OutputArea } from './OutputArea';
import { RegressionOutput, RegressionPointDraft, RegressionState } from '../utils/regressionTypes';

type Props = {
  state: RegressionState;
  output?: RegressionOutput;
  isRunning?: boolean;
  onChange: (state: RegressionState) => void;
  onCompute: (state: RegressionState) => void;
  kernelReady: boolean;
  showOutput?: boolean;
};

const MODELS: Array<{ value: RegressionState['model']; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
  { value: 'cubic', label: 'Cubic' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'logarithmic', label: 'Logarithmic' },
  { value: 'power', label: 'Power' },
  { value: 'logistic', label: 'Logistic' },
  { value: 'saturating_exponential', label: 'Saturating exp' }
];

const MIN_ROWS = 3;

const ensureTrailingRows = (points: RegressionPointDraft[]) => {
  const next = points.map((point) => ({ ...point }));
  while (next.length < MIN_ROWS || next[next.length - 1].x.trim() || next[next.length - 1].y.trim()) {
    next.push({ x: '', y: '' });
  }
  return next;
};

const trimTrailingRows = (points: RegressionPointDraft[]) => {
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
      const parts = line.split(/\t|,|;/).map((part) => part.trim());
      return { x: parts[0] ?? '', y: parts[1] ?? '' };
    })
    .filter((row) => row.x || row.y);

const formatR2 = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'R²: -';
  return `R²: ${value.toFixed(4)}`;
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

export function RegressionCell({
  state,
  output,
  isRunning,
  onChange,
  onCompute,
  kernelReady,
  showOutput = true
}: Props) {
  const normalizedState = useMemo(
    () => ({
      ...state,
      labels: {
        x: state.labels?.x ?? 'x',
        y: state.labels?.y ?? 'y'
      },
      points: ensureTrailingRows(state.points ?? [])
    }),
    [state]
  );
  const editorExpanded = normalizedState.ui?.editorExpanded ?? false;
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if ((state.points ?? []).length === 0 || !state.labels) {
      onChange(normalizedState);
    }
  }, [normalizedState, onChange, state.labels, state.points]);

  const setState = (next: RegressionState) => {
    onChange({
      ...next,
      points: trimTrailingRows(next.points)
    });
  };

  const commitCompute = (next?: RegressionState) => onCompute(next ?? normalizedState);

  const updatePoint = (rowIndex: number, field: 'x' | 'y', value: string) => {
    const nextPoints = normalizedState.points.map((point, index) =>
      index === rowIndex ? { ...point, [field]: value } : point
    );
    setState({ ...normalizedState, points: nextPoints });
  };

  const updateLabel = (field: 'x' | 'y', value: string) => {
    const next = {
      ...normalizedState,
      labels: {
        ...normalizedState.labels,
        [field]: value
      }
    };
    setState(next);
  };

  const moveFocus = (rowIndex: number, fieldIndex: number) => {
    const flatIndex = rowIndex * 2 + fieldIndex;
    inputRefs.current[flatIndex]?.focus();
    inputRefs.current[flatIndex]?.select();
  };

  const handleGridKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    fieldIndex: number
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveFocus(rowIndex + 1, fieldIndex);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(rowIndex + 1, fieldIndex);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(Math.max(0, rowIndex - 1), fieldIndex);
      return;
    }
    if (event.key === 'ArrowRight' && fieldIndex === 0 && (event.currentTarget.selectionEnd ?? 0) === event.currentTarget.value.length) {
      moveFocus(rowIndex, 1);
      return;
    }
    if (event.key === 'ArrowLeft' && fieldIndex === 1 && (event.currentTarget.selectionStart ?? 0) === 0) {
      moveFocus(rowIndex, 0);
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectedRows.length > 0) {
      event.preventDefault();
      const next = normalizedState.points.map((point, index) =>
        selectedRows.includes(index) ? { x: '', y: '' } : point
      );
      setState({ ...normalizedState, points: next });
      setSelectedRows([]);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>, rowIndex: number) => {
    const rows = parseClipboard(event.clipboardData.getData('text/plain'));
    if (rows.length <= 1 && !event.clipboardData.getData('text/plain').includes('\t')) return;
    event.preventDefault();
    const nextPoints = normalizedState.points.map((point) => ({ ...point }));
    rows.forEach((row, offset) => {
      const targetRow = rowIndex + offset;
      while (nextPoints.length <= targetRow) nextPoints.push({ x: '', y: '' });
      nextPoints[targetRow] = { x: row.x, y: row.y };
    });
    const nextState = { ...normalizedState, points: nextPoints };
    setState(nextState);
    commitCompute(nextState);
  };

  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) return;
    const rows = parseClipboard(await navigator.clipboard.readText());
    if (!rows.length) return;
    const nextState = {
      ...normalizedState,
      points: [...rows, ...normalizedState.points.filter((point) => point.x.trim() || point.y.trim())]
    };
    setState(nextState);
    commitCompute(nextState);
  };

  const toggleRowSelection = (rowIndex: number, extend = false) => {
    setSelectedRows((prev) => {
      if (extend && prev.length > 0) {
        const start = prev[prev.length - 1];
        const [from, to] = rowIndex > start ? [start, rowIndex] : [rowIndex, start];
        return Array.from({ length: to - from + 1 }, (_value, index) => from + index);
      }
      return prev.includes(rowIndex) ? prev.filter((entry) => entry !== rowIndex) : [...prev, rowIndex].sort((a, b) => a - b);
    });
  };

  const copySelectedRows = async () => {
    if (!navigator.clipboard?.writeText || selectedRows.length === 0) return;
    const text = selectedRows
      .map((rowIndex) => normalizedState.points[rowIndex])
      .filter(Boolean)
      .map((point) => `${point.x}\t${point.y}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
  };

  const deleteSelectedRows = () => {
    if (selectedRows.length === 0) return;
    const nextPoints = normalizedState.points.map((point, index) =>
      selectedRows.includes(index) ? { x: '', y: '' } : point
    );
    setState({ ...normalizedState, points: nextPoints });
    setSelectedRows([]);
  };

  const validPointCount = output?.points?.length ?? normalizedState.points.filter((point) => point.x.trim() && point.y.trim()).length;
  const activeModelLabel =
    normalizedState.model === 'auto'
      ? output?.model_label ? `Best: ${output.model_label}` : 'Auto'
      : MODELS.find((entry) => entry.value === normalizedState.model)?.label ?? normalizedState.model;

  return (
    <div className="regression-cell">
      <div className="regression-toolbar">
        <div className="regression-toolbar-main">
          <button
            type="button"
            className="regression-collapse-btn"
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
          <span className="regression-toolbar-title">Data</span>
          <label className="regression-model-picker">
            <span>Model</span>
            <select
              value={normalizedState.model}
              onChange={(event) => {
                const next = { ...normalizedState, model: event.target.value as RegressionState['model'] };
                setState(next);
                commitCompute(next);
              }}
            >
              {MODELS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="regression-actions">
          <button type="button" className="button secondary slim" onClick={() => void pasteFromClipboard()}>
            Paste
          </button>
          <button type="button" className="button secondary slim" onClick={() => void copySelectedRows()} disabled={selectedRows.length === 0}>
            Copy rows
          </button>
          <button type="button" className="button secondary slim" onClick={deleteSelectedRows} disabled={selectedRows.length === 0}>
            Delete rows
          </button>
          <button type="button" className="button secondary slim" onClick={() => commitCompute()} disabled={!kernelReady}>
            Fit
          </button>
        </div>
      </div>

      <div className="regression-summary">
        <span>{validPointCount} points</span>
        <span>{activeModelLabel}</span>
        <span>{output?.equation_text ?? 'No fitted equation yet'}</span>
        <span>{formatR2(output?.r2)}</span>
        {output?.rmse !== null && output?.rmse !== undefined ? <span>RMSE: {output.rmse.toFixed(4)}</span> : null}
        {output?.aicc !== null && output?.aicc !== undefined ? <span>AICc: {output.aicc.toFixed(2)}</span> : null}
        {output?.confidence === 'low' ? <span>Low confidence</span> : null}
      </div>

      <div className="regression-labels">
        <label className="regression-axis-label">
          <span>X label</span>
          <input
            value={normalizedState.labels?.x ?? 'x'}
            onChange={(event) => updateLabel('x', event.target.value)}
            onBlur={() => commitCompute()}
            placeholder="x"
          />
        </label>
        <label className="regression-axis-label">
          <span>Y label</span>
          <input
            value={normalizedState.labels?.y ?? 'y'}
            onChange={(event) => updateLabel('y', event.target.value)}
            onBlur={() => commitCompute()}
            placeholder="y"
          />
        </label>
      </div>

      {editorExpanded ? (
        <div className="regression-editor">
          <div className="regression-sheet-wrap">
            <table className="regression-sheet">
              <thead>
                <tr>
                  <th className="regression-row-select-head">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={selectedRows.length > 0 && selectedRows.length === normalizedState.points.length}
                      onChange={(event) =>
                        setSelectedRows(event.target.checked ? normalizedState.points.map((_point, index) => index) : [])
                      }
                    />
                  </th>
                  <th>{normalizedState.labels?.x || 'x'}</th>
                  <th>{normalizedState.labels?.y || 'y'}</th>
                  <th className="regression-error-head">Row status</th>
                </tr>
              </thead>
              <tbody>
                {normalizedState.points.map((point, rowIndex) => {
                  const rowError = output?.invalid_rows?.find((entry) => entry.row === rowIndex + 1)?.error;
                  const rowSelected = selectedRows.includes(rowIndex);
                  return (
                    <tr key={`row-${rowIndex}`} className={rowSelected ? 'is-selected' : undefined}>
                      <td className="regression-row-select-cell">
                        <button
                          type="button"
                          className={`regression-row-select-btn${rowSelected ? ' is-selected' : ''}`}
                          onClick={(event) => toggleRowSelection(rowIndex, event.shiftKey)}
                        >
                          {rowIndex + 1}
                        </button>
                      </td>
                      <td>
                        <input
                          ref={(node) => {
                            inputRefs.current[rowIndex * 2] = node;
                          }}
                          className="regression-sheet-input"
                          value={point.x}
                          onChange={(event) => updatePoint(rowIndex, 'x', event.target.value)}
                          onBlur={() => commitCompute()}
                          onKeyDown={(event) => handleGridKeyDown(event, rowIndex, 0)}
                          onPaste={(event) => handlePaste(event, rowIndex)}
                          placeholder={normalizedState.labels?.x || 'x'}
                        />
                      </td>
                      <td>
                        <input
                          ref={(node) => {
                            inputRefs.current[rowIndex * 2 + 1] = node;
                          }}
                          className="regression-sheet-input"
                          value={point.y}
                          onChange={(event) => updatePoint(rowIndex, 'y', event.target.value)}
                          onBlur={() => commitCompute()}
                          onKeyDown={(event) => handleGridKeyDown(event, rowIndex, 1)}
                          onPaste={(event) => handlePaste(event, rowIndex)}
                          placeholder={normalizedState.labels?.y || 'y'}
                        />
                      </td>
                      <td className="regression-row-error-cell">{rowError ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!kernelReady ? (
        <div className="output">Kernel not connected. Connect kernel to compute.</div>
      ) : null}
      {isRunning ? <div className="regression-running">calculating…</div> : null}
      {output?.error ? <div className="regression-error">{output.error}</div> : null}
      {output?.warnings?.length ? (
        <div className="regression-warning">{output.warnings[0]}</div>
      ) : null}

      {showOutput && output?.plotly_figure ? (
        <div className="regression-plot" data-testid="regression-plot">
          <OutputArea output={{ type: 'mime', data: { 'application/vnd.plotly.v1+json': output.plotly_figure } }} />
        </div>
      ) : null}
      {output?.alternatives?.length && normalizedState.model === 'auto' ? (
        <details className="regression-alternatives">
          <summary>Alternatives</summary>
          <div className="regression-alternatives-list">
            {output.alternatives.map((alternative) => (
              <div key={alternative.model_name} className="regression-alternative-item">
                <strong>{alternative.model_label}</strong>
                <span>{alternative.formula}</span>
                <span>RMSE {alternative.rmse.toFixed(4)} · AICc {alternative.aicc.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
