import React, { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { CodeEditor } from './CodeEditor';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  completions?: { label: string; detail?: string }[];
  output?: {
    steps: string[];
    value?: string;
    error?: string;
    mode: 'deg' | 'rad';
  };
  isRunning?: boolean;
  trigMode: 'deg' | 'rad';
};

export function MathEditor({ value, onChange, onRun, completions, output, isRunning, trigMode }: Props) {
  const [editing, setEditing] = useState(true);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [lastRendered, setLastRendered] = useState(value);
  const displayMode = output?.mode ?? trigMode;

  useEffect(() => {
    setDraft(value);
    setLastRendered(value);
    setDirty(false);
  }, [value]);

  const renderedSteps = useMemo(() => {
    if (!output?.steps?.length) return [];
    return output.steps.map((step) => {
      try {
        return katex.renderToString(step, { throwOnError: false, displayMode: true });
      } catch (err) {
        return `<span class="math-error">${step}</span>`;
      }
    });
  }, [output]);

  if (!editing) {
    return (
      <div className="math-render" onClick={() => setEditing(true)}>
        <div className="math-meta">
          <span className="math-badge">{displayMode === 'deg' ? 'Degrees' : 'Radians'}</span>
          {isRunning ? <span className="math-running">running…</span> : null}
        </div>
        {output?.error ? (
          <div className="math-error">{output.error}</div>
        ) : renderedSteps.length > 0 ? (
          <div className="math-steps">
            {renderedSteps.map((html, idx) => (
              <div
                className="math-step"
                key={`step-${idx}`}
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
