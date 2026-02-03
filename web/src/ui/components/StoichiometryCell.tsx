import React, { useEffect, useMemo, useRef } from 'react';
import katex from 'katex';
import { StoichOutput, StoichState } from '../utils/stoichTypes';

const DEBOUNCE_MS = 500;

type Props = {
  state: StoichState;
  output?: StoichOutput;
  isRunning?: boolean;
  onChange: (state: StoichState) => void;
  onCompute: (state: StoichState) => void;
  kernelReady: boolean;
};

const COEFF_RE = /^\s*\d+(?:\.\d+)?\s*/;
const STATE_RE = /\((aq|s|l|g)\)\s*$/i;

const parseSpecies = (reaction: string): string[] => {
  if (!reaction) return [];
  const arrow = reaction.includes('->') ? '->' : reaction.includes('=') ? '=' : null;
  if (!arrow) return [];
  const [left, right] = reaction.split(arrow, 2);
  const parts = [...left.split('+'), ...right.split('+')]
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(COEFF_RE, '').trim())
    .map((p) => p.replace(STATE_RE, '').trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
};

const formatSig = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (value === 0) return '0';
  const formatted = Number(value).toPrecision(4);
  return formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const formatCoeffLabel = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (Math.abs(value - 1) < 1e-9) return '';
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return formatSig(value);
};

export function StoichiometryCell({ state, output, isRunning, onChange, onCompute, kernelReady }: Props) {
  const reaction = state.reaction ?? '';
  const computeTimer = useRef<number | null>(null);
  const pendingState = useRef<StoichState | null>(null);

  useEffect(() => {
    return () => {
      if (computeTimer.current) {
        window.clearTimeout(computeTimer.current);
      }
    };
  }, []);

  const scheduleCompute = (nextState: StoichState) => {
    pendingState.current = nextState;
    if (!kernelReady || !nextState.reaction.trim()) {
      if (computeTimer.current) {
        window.clearTimeout(computeTimer.current);
        computeTimer.current = null;
      }
      return;
    }
    if (computeTimer.current) {
      window.clearTimeout(computeTimer.current);
    }
    computeTimer.current = window.setTimeout(() => {
      computeTimer.current = null;
      if (pendingState.current) {
        onCompute(pendingState.current);
      }
    }, DEBOUNCE_MS);
  };

  const flushCompute = () => {
    if (!computeTimer.current) return;
    window.clearTimeout(computeTimer.current);
    computeTimer.current = null;
    if (pendingState.current && kernelReady && pendingState.current.reaction.trim()) {
      onCompute(pendingState.current);
    }
  };

  const equationHtml = useMemo(() => {
    if (!output?.equation_latex) return null;
    try {
      return katex.renderToString(output.equation_latex, { throwOnError: false, displayMode: true });
    } catch (_err) {
      return null;
    }
  }, [output?.equation_latex]);

  const species = output?.species ?? [];
  const hasError = output && output.ok === false;

  const updateReaction = (nextReaction: string) => {
    const known = parseSpecies(nextReaction);
    let nextInputs = state.inputs;
    if (known.length > 0) {
      nextInputs = Object.fromEntries(
        Object.entries(state.inputs).filter(([name]) => known.includes(name))
      );
    }
    const nextState = {
      reaction: nextReaction,
      inputs: nextInputs
    };
    onChange(nextState);
    scheduleCompute(nextState);
  };

  const updateInput = (name: string, field: 'n' | 'm', value: string) => {
    const nextState = {
      ...state,
      inputs: {
        ...state.inputs,
        [name]: {
          ...state.inputs[name],
          [field]: value
        }
      }
    };
    onChange(nextState);
    scheduleCompute(nextState);
  };

  const getDisplayValue = (row: NonNullable<StoichOutput['species']>[number], field: 'm' | 'n') => {
    const raw = state.inputs[row.name]?.[field] ?? '';
    if (raw.trim() !== '') {
      return { value: raw, auto: false };
    }
    const calc = field === 'm' ? row.calc_m : row.calc_n;
    const formatted = formatSig(calc ?? null);
    return { value: formatted, auto: formatted !== '' };
  };

  return (
    <div className="stoich-cell">
      <div className="stoich-header">
        <div>
          <div className="stoich-title">Stoichiometry Table</div>
          <div className="subtitle">Введите реакцию и количества — всё пересчитается автоматически.</div>
        </div>
        {isRunning ? <span className="stoich-running">calculating…</span> : null}
      </div>

      <div className="stoich-reaction">
        <label className="stoich-label">Reaction</label>
        <input
          className="input"
          value={reaction}
          onChange={(e) => updateReaction(e.target.value)}
          onBlur={flushCompute}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          placeholder="H2 + O2 -> H2O"
        />
      </div>

      {!kernelReady ? (
        <div className="output">Kernel not connected. Connect kernel to compute.</div>
      ) : hasError ? (
        <div className="stoich-error">{output?.error || 'Failed to compute.'}</div>
      ) : null}

      {equationHtml ? (
        <div className="stoich-equation" dangerouslySetInnerHTML={{ __html: equationHtml }} />
      ) : output?.balanced ? (
        <div className="stoich-equation text">{output.balanced}</div>
      ) : null}

      {species.length > 0 ? (
        <div className="stoich-table-wrap">
          <table className="stoich-table">
            <thead>
              <tr>
                <th></th>
                {species.map((row) => {
                  const label = `${formatCoeffLabel(row.coeff)}${row.name}`;
                  const mismatch = row.status === 'mismatch';
                  return (
                    <th key={`head-${row.name}`} className={mismatch ? 'stoich-mismatch' : undefined}>
                      {label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="stoich-row-label">m (g)</td>
                {species.map((row) => {
                  const { value, auto } = getDisplayValue(row, 'm');
                  const mismatch = row.status === 'mismatch';
                  return (
                    <td key={`m-${row.name}`} className={mismatch ? 'stoich-mismatch' : undefined}>
                      <input
                        className={`stoich-input${auto ? ' auto' : ''}`}
                        value={value}
                        onChange={(e) => updateInput(row.name, 'm', e.target.value)}
                        onBlur={flushCompute}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        onFocus={(e) => {
                          if (auto) e.currentTarget.select();
                        }}
                        placeholder="g"
                      />
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="stoich-row-label">M (g/mol)</td>
                {species.map((row) => {
                  const mismatch = row.status === 'mismatch';
                  return (
                    <td key={`M-${row.name}`} className={mismatch ? 'stoich-mismatch' : undefined}>
                      {formatSig(row.molar_mass ?? null)}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="stoich-row-label">n (mol)</td>
                {species.map((row) => {
                  const { value, auto } = getDisplayValue(row, 'n');
                  const mismatch = row.status === 'mismatch';
                  return (
                    <td key={`n-${row.name}`} className={mismatch ? 'stoich-mismatch' : undefined}>
                      <input
                        className={`stoich-input${auto ? ' auto' : ''}`}
                        value={value}
                        onChange={(e) => updateInput(row.name, 'n', e.target.value)}
                        onBlur={flushCompute}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        onFocus={(e) => {
                          if (auto) e.currentTarget.select();
                        }}
                        placeholder="mol"
                      />
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          <div className="stoich-footnote">Auto-calculated using limiting reagent (min n/ν).</div>
        </div>
      ) : (
        <div className="stoich-empty">Введите реакцию, чтобы увидеть таблицу.</div>
      )}
    </div>
  );
}
