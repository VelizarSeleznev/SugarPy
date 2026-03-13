import React, { useEffect, useRef } from 'react';
import katex from 'katex';
import { OutputArea } from './OutputArea';
import { RegressionCellOutput, RegressionCellState, RegressionModel } from '../utils/customCellTypes';

const DEBOUNCE_MS = 450;

type Props = {
  state: RegressionCellState;
  output?: RegressionCellOutput;
  isRunning?: boolean;
  kernelReady: boolean;
  showOutput?: boolean;
  onChange: (state: RegressionCellState) => void;
  onCompute: (state: RegressionCellState, options?: { exportBindings?: boolean }) => void;
};

const MODEL_OPTIONS: Array<{ value: RegressionModel; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
  { value: 'exponential', label: 'Exponential' },
];

const normalizePoints = (points: RegressionCellState['points']) => {
  const trimmed = points.map((point) => ({
    x: point.x.trim(),
    y: point.y.trim(),
  }));
  return trimmed.some((point) => point.x || point.y) ? trimmed : [{ x: '', y: '' }];
};

const formatMetric = (value?: number) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};

export function RegressionCell({
  state,
  output,
  isRunning,
  kernelReady,
  showOutput = true,
  onChange,
  onCompute,
}: Props) {
  const computeTimer = useRef<number | null>(null);
  const pendingState = useRef<RegressionCellState | null>(null);

  useEffect(() => {
    return () => {
      if (computeTimer.current) window.clearTimeout(computeTimer.current);
    };
  }, []);

  const scheduleCompute = (nextState: RegressionCellState) => {
    pendingState.current = nextState;
    if (!kernelReady) return;
    if (computeTimer.current) window.clearTimeout(computeTimer.current);
    computeTimer.current = window.setTimeout(() => {
      computeTimer.current = null;
      if (pendingState.current) onCompute(pendingState.current);
    }, DEBOUNCE_MS);
  };

  const updateState = (updater: (current: RegressionCellState) => RegressionCellState, autoRun = true) => {
    const nextState = updater(state);
    onChange(nextState);
    if (autoRun) scheduleCompute(nextState);
  };

  const updatePoint = (index: number, field: 'x' | 'y', value: string) => {
    updateState((current) => ({
      ...current,
      points: normalizePoints(
        current.points.map((point, pointIndex) => (pointIndex === index ? { ...point, [field]: value } : point))
      ),
    }));
  };

  const addPoint = () => {
    updateState((current) => ({
      ...current,
      points: [...current.points, { x: '', y: '' }],
    }), false);
  };

  const removePoint = (index: number) => {
    updateState((current) => ({
      ...current,
      points: normalizePoints(current.points.filter((_, pointIndex) => pointIndex !== index)),
    }));
  };

  const updateModel = (value: RegressionModel) => {
    updateState((current) => ({
      ...current,
      model: value,
    }));
  };

  const updateBindingPrefix = (value: string) => {
    updateState(
      (current) => ({
        ...current,
        bindingPrefix: value,
      }),
      false
    );
  };

  const renderEquation = () => {
    if (!output?.equation_latex) return null;
    const html = katex.renderToString(output.equation_latex, { throwOnError: false, displayMode: true });
    return <div className="regression-equation" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const plotOutput =
    output?.plotly_figure
      ? {
          type: 'mime' as const,
          data: { 'application/vnd.plotly.v1+json': output.plotly_figure },
        }
      : undefined;

  return (
    <div className="custom-cell custom-cell--regression">
      <div className="regression-toolbar">
        <label className="regression-field">
          <span>Model</span>
          <select
            className="regression-select"
            value={state.model}
            onChange={(event) => updateModel(event.target.value as RegressionModel)}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="regression-field regression-field--prefix">
          <span>Export prefix</span>
          <input
            className="regression-prefix-input"
            value={state.bindingPrefix}
            onChange={(event) => updateBindingPrefix(event.target.value)}
            placeholder="regression"
          />
        </label>
        <div className="regression-actions">
          {isRunning ? <span className="stoich-running">calculating…</span> : null}
          <button type="button" className="button secondary" onClick={() => onCompute(state)}>
            Recompute
          </button>
          <button type="button" className="button" onClick={() => onCompute(state, { exportBindings: true })}>
            Export bindings
          </button>
        </div>
      </div>

      <div className="regression-table-wrap">
        <table className="regression-table">
          <thead>
            <tr>
              <th>x</th>
              <th>y</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.points.map((point, index) => (
              <tr key={`point-${index}`}>
                <td>
                  <input
                    className="stoich-input"
                    value={point.x}
                    onChange={(event) => updatePoint(index, 'x', event.target.value)}
                    onBlur={() => onCompute(state)}
                    placeholder="x"
                  />
                </td>
                <td>
                  <input
                    className="stoich-input"
                    value={point.y}
                    onChange={(event) => updatePoint(index, 'y', event.target.value)}
                    onBlur={() => onCompute(state)}
                    placeholder="y"
                  />
                </td>
                <td className="regression-remove">
                  <button type="button" className="mini-button" onClick={() => removePoint(index)} aria-label={`Remove point ${index + 1}`}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="button secondary regression-add-point" onClick={addPoint}>
          Add point
        </button>
      </div>

      {!kernelReady ? (
        <div className="output">Kernel not connected. Connect kernel to compute.</div>
      ) : null}

      {showOutput ? (
        <>
          {output?.ok === false ? <div className="stoich-error">{output.error || 'Regression failed.'}</div> : null}
          {output?.ok ? (
            <div className="regression-summary">
              <div className="regression-summary-card">
                <div className="regression-summary-label">Equation</div>
                {renderEquation()}
                {!output.equation_latex && output.equation_text ? (
                  <div className="regression-equation-text">{output.equation_text}</div>
                ) : null}
              </div>
              <div className="regression-summary-card">
                <div className="regression-summary-label">Metrics</div>
                <div className="regression-metric">R²: {formatMetric(output.metrics?.r2)}</div>
                <div className="regression-metric">RMSE: {formatMetric(output.metrics?.rmse)}</div>
                <div className="regression-metric">Points: {output.point_count ?? state.points.length}</div>
              </div>
              {output.bindings ? (
                <div className="regression-summary-card">
                  <div className="regression-summary-label">Bindings exported</div>
                  <div className="regression-bindings">
                    {Object.values(output.bindings.names).join(', ')}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {plotOutput ? <OutputArea output={plotOutput} /> : null}
        </>
      ) : null}
    </div>
  );
}
