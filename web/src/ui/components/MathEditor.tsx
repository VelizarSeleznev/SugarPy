import React, { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { CodeEditor } from './CodeEditor';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  completions?: { label: string; detail?: string }[];
  output?: {
    render_cache?: {
      exact: { steps: string[]; value?: string | null };
      decimal: { steps: string[]; value?: string | null };
    } | null;
    kind: 'expression' | 'equation' | 'assignment';
    steps: string[];
    value?: string;
    error?: string;
    warnings?: string[];
    normalized_source?: string;
    equation_latex?: string | null;
    assigned?: string | null;
    mode: 'deg' | 'rad';
    trace?: Array<{
      line_start: number;
      source: string;
      kind: 'expression' | 'equation' | 'assignment';
      steps: string[];
      value?: string | null;
      plotly_figure?: unknown;
      render_cache?: {
        exact: { steps: string[]; value?: string | null };
        decimal: { steps: string[]; value?: string | null };
      } | null;
    }>;
  };
  isRunning?: boolean;
  trigMode: 'deg' | 'rad';
  renderMode: 'exact' | 'decimal';
  onToggleRenderMode: () => void;
  onToggleTrigMode: () => void;
};

const shortcutItems = [
  { label: 'x²', snippet: '^2' },
  { label: '√', snippet: 'sqrt(__CURSOR__)' },
  { label: '( )', snippet: '(__CURSOR__)' },
  { label: '=', snippet: ' = ' },
  { label: ':=', snippet: ' := ' },
  { label: 'solve', snippet: 'solve(__CURSOR__, x)' },
  { label: 'expand', snippet: 'expand(__CURSOR__)' },
  { label: 'factor', snippet: 'factor(__CURSOR__)' },
  { label: 'N', snippet: 'N(__CURSOR__)' },
  { label: 'plot', snippet: 'plot(__CURSOR__)' }
];

const withSourceBreakHints = (latex: string) =>
  latex
    .replace(/,/g, ",\\allowbreak ")
    .replace(/=/g, "=\\allowbreak ")
    .replace(/\\coloneqq/g, "\\coloneqq\\allowbreak ");

const sourceToLatex = (source: string) => {
  return source
    .replace(/\btheta_([A-Za-z0-9]+)/g, '\\theta_{$1}')
    .replace(/\b([A-Za-z]+)\[(\d+)\]/g, '$1_{$2}')
    .replace(/:=/g, '\\coloneqq ')
    .replace(/\*/g, ' \\cdot ')
    .replace(/!=/g, '\\ne ')
    .replace(/>=/g, '\\ge ')
    .replace(/<=/g, '\\le ');
};

const renderSourceMath = (source: string) => {
  try {
    return katex.renderToString(withSourceBreakHints(sourceToLatex(source)), {
      throwOnError: false,
      displayMode: true
    });
  } catch (_err) {
    return '';
  }
};

const normalizeLatexForCompare = (latex: string) =>
  latex
    .replace(/\s+/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\coloneqq/g, '=')
    .replace(/\\,/g, '')
    .trim();

const isTrivialAssignmentSource = (source: string, stepCount: number, kind?: string) => {
  if (kind !== 'assignment' || stepCount !== 1) return false;
  const parts = source.split(':=');
  if (parts.length !== 2) return false;
  const rhs = parts[1].trim();
  return /^[\[\]\w\s,.-]+$/.test(rhs);
};

const isDuplicateRenderedSource = (source: string, firstStep?: string | null) => {
  if (!source.trim() || !firstStep?.trim()) return false;
  return normalizeLatexForCompare(sourceToLatex(source)) === normalizeLatexForCompare(firstStep);
};

export function MathEditor({
  value,
  onChange,
  onRun,
  completions,
  output,
  isRunning,
  trigMode,
  renderMode,
  onToggleRenderMode,
  onToggleTrigMode
}: Props) {
  const [editing, setEditing] = useState(!output);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [lastRendered, setLastRendered] = useState(value);
  const previousIsRunning = useRef(Boolean(isRunning));
  const previousHasOutput = useRef(Boolean(output));
  useEffect(() => {
    setDraft(value);
    setLastRendered(value);
    setDirty(false);
  }, [value]);

  useEffect(() => {
    if (!output) {
      setEditing(true);
    }
  }, [output]);

  useEffect(() => {
    const wasRunning = previousIsRunning.current;
    const hasOutput = Boolean(output);
    const hadOutput = previousHasOutput.current;
    if ((isRunning && !wasRunning) || (hasOutput && !hadOutput)) {
      setEditing(false);
    }
    previousIsRunning.current = Boolean(isRunning);
    previousHasOutput.current = hasOutput;
  }, [isRunning, output]);

  const withBreakHints = (latex: string) => {
    // Help KaTeX break very long lines at readable separators.
    return latex
      .replace(/,/g, ",\\allowbreak ")
      .replace(/=/g, "=\\allowbreak ");
  };

  const renderLatexSteps = (steps: string[]) => {
    return steps.map((step) => {
      const safeStep = String(step ?? '');
      try {
        return katex.renderToString(withBreakHints(safeStep), { throwOnError: false, displayMode: true });
      } catch (_err) {
        return `<span class="math-error">${safeStep}</span>`;
      }
    });
  };

  const renderedSteps = useMemo(() => {
    const steps = output?.render_cache?.[renderMode]?.steps ?? output?.steps ?? [];
    if (!steps.length) return [];
    return renderLatexSteps(steps);
  }, [output?.render_cache, output?.steps, renderMode]);

  const renderedTrace = useMemo(() => {
    if (!output?.trace?.length || output.trace.length < 2) return null;
    return output.trace.map((item, idx) => {
      const steps = item.render_cache?.[renderMode]?.steps ?? item.steps ?? [];
      const rendered = steps.length ? renderLatexSteps(steps) : [];
      const hideDuplicatedSource =
        isTrivialAssignmentSource(item.source || '', rendered.length, item.kind) ||
        isDuplicateRenderedSource(item.source || '', steps[0] ?? null);
      return {
        idx,
        item,
        rendered,
        renderedSource: renderSourceMath(item.source || ''),
        showSource: !hideDuplicatedSource
      };
    });
  }, [output?.trace, renderMode]);

  const sourceText = useMemo(() => {
    return (output?.normalized_source || lastRendered || value || '').trim();
  }, [lastRendered, output?.normalized_source, value]);
  const renderedSource = useMemo(() => renderSourceMath(sourceText), [sourceText]);
  const showCardSource = useMemo(() => {
    const stepCount = output?.steps?.length ?? 0;
    if (renderedTrace) return false;
    if (isTrivialAssignmentSource(sourceText, stepCount, output?.kind)) return false;
    return !isDuplicateRenderedSource(
      sourceText,
      output?.render_cache?.[renderMode]?.steps?.[0] ?? output?.steps?.[0] ?? null
    );
  }, [output?.kind, output?.render_cache, output?.steps, renderMode, renderedTrace, sourceText]);

  if (!editing) {
    return (
      <div className="math-card" onClick={() => setEditing(true)} data-testid="math-output">
        <div className="math-card-topline">
          <div className="math-card-controls" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="math-card-pill-btn primary mobile-only"
              onClick={() => onRun(value)}
              disabled={isRunning}
              aria-label="Run math cell"
              title="Run math cell"
            >
              ▶
            </button>
            <button type="button" className="math-card-pill-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="math-card-pill-btn" onClick={onToggleRenderMode}>
              {renderMode === 'decimal' ? 'Decimal' : 'Exact'}
            </button>
            <button type="button" className="math-card-pill-btn" onClick={onToggleTrigMode}>
              {trigMode === 'deg' ? 'Deg' : 'Rad'}
            </button>
          </div>
        </div>
        {!renderedTrace && showCardSource && renderedSource ? (
          <div
            className="math-card-source"
            data-block-cell-swipe="true"
            dangerouslySetInnerHTML={{ __html: renderedSource }}
          />
        ) : null}
        {isRunning ? <span className="math-running">running…</span> : null}
        {output?.error ? (
          <div className="math-error" data-testid="math-error">{output.error}</div>
        ) : renderedTrace ? (
          <div className="math-trace math-trace-card">
            {renderedTrace.map(({ idx, item, rendered, renderedSource, showSource }) => (
              <div className="math-trace-item" key={`trace-${idx}`}>
                {showSource ? (
                  <div className="math-trace-line">
                    <span className="math-trace-index">{item.line_start}</span>
                    <div
                      className="math-trace-source math-trace-source-rendered"
                      data-block-cell-swipe="true"
                      dangerouslySetInnerHTML={{ __html: renderedSource }}
                    />
                  </div>
                ) : (
                  <div className="math-trace-line compact">
                    <span className="math-trace-index">{item.line_start}</span>
                  </div>
                )}
                {rendered.length ? (
                  <div className="math-steps">
                    {rendered.map((html, stepIdx) => (
                      <div
                        className="math-step"
                        data-block-cell-swipe="true"
                        key={`trace-${idx}-step-${stepIdx}`}
                        data-testid="math-latex"
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : renderedSteps.length > 0 ? (
          <div className="math-steps">
            {renderedSteps.map((html, idx) => (
              <div
                className="math-step"
                data-block-cell-swipe="true"
                key={`step-${idx}`}
                data-testid="math-latex"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ))}
          </div>
        ) : (
          <div className="math-empty">Click to edit.</div>
        )}
      </div>
    );
  }

  const runNow = () => {
    if (isRunning) return;
    if (!dirty && lastRendered === draft) {
      setEditing(false);
      return;
    }
    onRun(draft);
    setLastRendered(draft);
    setDirty(false);
    setEditing(false);
  };

  return (
    <div className="math-editor">
      <div className="math-editor-toolbar">
        <div className="math-card-controls">
          <button
            type="button"
            className="math-card-pill-btn primary mobile-only"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              runNow();
            }}
            disabled={isRunning}
            aria-label="Run math cell"
            title="Run math cell"
          >
            ▶
          </button>
          <button type="button" className="math-card-pill-btn" onClick={onToggleRenderMode}>
            {renderMode === 'decimal' ? 'Decimal' : 'Exact'}
          </button>
          <button type="button" className="math-card-pill-btn" onClick={onToggleTrigMode}>
            {trigMode === 'deg' ? 'Deg' : 'Rad'}
          </button>
        </div>
      </div>
      <div
        onBlur={() => {
          if (dirty) {
            runNow();
            return;
          }
          setEditing(false);
        }}
      >
        <CodeEditor
          value={draft}
          onChange={(val) => {
            setDraft(val);
            setDirty(true);
            onChange(val);
          }}
          onRun={(val) => {
            onRun(val);
            setLastRendered(val);
            setDirty(false);
            setEditing(false);
          }}
          completions={completions ?? []}
          placeholderText="Type math..."
          autoFocus
          shortcutItems={shortcutItems}
        />
      </div>
    </div>
  );
}
