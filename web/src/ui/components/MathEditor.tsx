import React, { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { CodeEditor } from './CodeEditor';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  completions?: { label: string; detail?: string }[];
  output?: {
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
    }>;
  };
  isRunning?: boolean;
  trigMode: 'deg' | 'rad';
};

export function MathEditor({ value, onChange, onRun, completions, output, isRunning, trigMode: _trigMode }: Props) {
  const [editing, setEditing] = useState(true);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [lastRendered, setLastRendered] = useState(value);
  useEffect(() => {
    setDraft(value);
    setLastRendered(value);
    setDirty(false);
  }, [value]);

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
    if (!output?.steps?.length) return [];
    return renderLatexSteps(output.steps);
  }, [output?.steps]);

  const renderedTrace = useMemo(() => {
    if (!output?.trace?.length) return null;
    return output.trace.map((item, idx) => {
      const steps = item.steps ?? [];
      const rendered = steps.length ? renderLatexSteps(steps) : [];
      return { idx, item, rendered };
    });
  }, [output?.trace]);

  if (!editing) {
    return (
      <div className="math-render" onClick={() => setEditing(true)} data-testid="math-output">
        {isRunning ? <span className="math-running">running…</span> : null}
        {output?.error ? (
          <div className="math-error" data-testid="math-error">{output.error}</div>
        ) : renderedTrace ? (
          <div className="math-trace">
            {renderedTrace.map(({ idx, item, rendered }) => (
              <div className="math-trace-item" key={`trace-${idx}`}>
                <pre className="math-trace-source">
                  <code>{item.source}</code>
                </pre>
                {rendered.length ? (
                  <div className="math-steps">
                    {rendered.map((html, stepIdx) => (
                      <div
                        className="math-step"
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
        />
      </div>
    </div>
  );
}
