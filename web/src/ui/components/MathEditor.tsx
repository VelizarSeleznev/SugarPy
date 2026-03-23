import React, { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { CodeEditor } from './CodeEditor';
import type { EditorCompletionItem } from '../utils/editorSymbols';
import { extractMathSymbols } from '../utils/editorSymbols';
import { sugarPyMathLanguage } from '../utils/mathLanguage';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  completions?: EditorCompletionItem[];
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
  viewMode: 'source' | 'rendered';
  outputCollapsed: boolean;
  onSwitchToSource: () => void;
  onCommitSource: () => void;
  active?: boolean;
};

const shortcutItems = [
  { label: 'x^2', snippet: '^2' },
  { label: 'sqrt', snippet: 'sqrt(__CURSOR__)' },
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

const escapeLiteralLatex = (value: string) =>
  value
    .replace(/\\/g, '\\backslash{}')
    .replace(/([#$%&{}])/g, '\\$1')
    .replace(/_/g, '\\_');

const isIdentifierStart = (value: string) => /[A-Za-z_]/.test(value);

const isIdentifierBody = (value: string) => /[A-Za-z0-9_]/.test(value);

const isDigit = (value: string) => /[0-9]/.test(value);

const formatIdentifier = (identifier: string) => {
  if (!identifier) return '';
  const thetaMatch = identifier.match(/^theta_([A-Za-z0-9_]+)$/);
  if (thetaMatch) {
    return `\\theta_{${escapeLiteralLatex(thetaMatch[1])}}`;
  }
  const segments = identifier.split('_');
  if (segments.length > 1) {
    const base = segments.slice(0, -1).join('_');
    const suffix = segments[segments.length - 1];
    if (base && suffix) {
      return `${escapeLiteralLatex(base)}_{${escapeLiteralLatex(suffix)}}`;
    }
  }
  return escapeLiteralLatex(identifier);
};

const formatBracketIndex = (indexSource: string) => {
  const trimmed = indexSource.trim();
  if (!trimmed) return '{}';
  return `{${formatSourceLatex(trimmed)}}`;
};

type RenderCursor = {
  source: string;
  index: number;
};

const parseDelimitedExpression = (
  cursor: RenderCursor,
  closeChar: string
): string => {
  const start = cursor.index;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  while (cursor.index < cursor.source.length) {
    const ch = cursor.source[cursor.index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      cursor.index += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cursor.index += 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      cursor.index += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0 && ch === closeChar) {
        const inner = cursor.source.slice(start, cursor.index);
        cursor.index += 1;
        return inner;
      }
      if (depth > 0) {
        depth -= 1;
      }
      cursor.index += 1;
      continue;
    }
    cursor.index += 1;
  }
  return cursor.source.slice(start);
};

const parseIdentifierOrNumber = (cursor: RenderCursor) => {
  const start = cursor.index;
  const first = cursor.source[cursor.index];
  if (isIdentifierStart(first)) {
    cursor.index += 1;
    while (cursor.index < cursor.source.length && isIdentifierBody(cursor.source[cursor.index])) {
      cursor.index += 1;
    }
    return { kind: 'identifier' as const, value: cursor.source.slice(start, cursor.index) };
  }
  if (isDigit(first) || (first === '.' && isDigit(cursor.source[cursor.index + 1] || ''))) {
    cursor.index += 1;
    while (
      cursor.index < cursor.source.length &&
      /[0-9.]/.test(cursor.source[cursor.index])
    ) {
      cursor.index += 1;
    }
    return { kind: 'number' as const, value: cursor.source.slice(start, cursor.index) };
  }
  return null;
};

const formatGroup = (openChar: string, closeChar: string, innerSource: string) => {
  const open = openChar === '(' ? '\\left(' : openChar === '[' ? '\\left[' : '\\left\\{';
  const close = closeChar === ')' ? '\\right)' : closeChar === ']' ? '\\right]' : '\\right\\}';
  return `${open}${formatSourceLatex(innerSource)}${close}`;
};

const readPostfixBracketIndex = (cursor: RenderCursor) => {
  if (cursor.source[cursor.index] !== '[') return null;
  const bracketCursor: RenderCursor = { source: cursor.source, index: cursor.index + 1 };
  const innerSource = parseDelimitedExpression(bracketCursor, ']');
  cursor.index = bracketCursor.index;
  return formatBracketIndex(innerSource);
};

const readPrimary = (cursor: RenderCursor): string => {
  while (cursor.index < cursor.source.length && /\s/.test(cursor.source[cursor.index])) {
    cursor.index += 1;
  }

  if (cursor.index >= cursor.source.length) return '';

  const current = cursor.source[cursor.index];

  if (current === '(' || current === '[' || current === '{') {
    cursor.index += 1;
    const innerCursor: RenderCursor = { source: cursor.source, index: cursor.index };
    const innerSource = parseDelimitedExpression(innerCursor, current === '(' ? ')' : current === '[' ? ']' : '}');
    cursor.index = innerCursor.index;
    return formatGroup(current, current === '(' ? ')' : current === '[' ? ']' : '}', innerSource);
  }

  const token = parseIdentifierOrNumber(cursor);
  if (!token) {
    cursor.index += 1;
    return escapeLiteralLatex(current);
  }

  if (token.kind === 'identifier') {
    let latex = formatIdentifier(token.value);

    while (cursor.index < cursor.source.length) {
      const lookahead = cursor.source[cursor.index];
      if (/\s/.test(lookahead)) break;
      if (lookahead === '[') {
        const indexLatex = readPostfixBracketIndex(cursor);
        if (indexLatex) {
          latex = `${latex}_${indexLatex}`;
          continue;
        }
      }
      if (lookahead === '(' || lookahead === '{') {
        cursor.index += 1;
        const innerCursor: RenderCursor = { source: cursor.source, index: cursor.index };
        const innerSource = parseDelimitedExpression(innerCursor, lookahead === '(' ? ')' : '}');
        cursor.index = innerCursor.index;
        latex = `${latex}${formatGroup(lookahead, lookahead === '(' ? ')' : '}', innerSource)}`;
        continue;
      }
      break;
    }

    return latex;
  }

  return escapeLiteralLatex(token.value);
};

const formatExponent = (cursor: RenderCursor) => {
  while (cursor.index < cursor.source.length && /\s/.test(cursor.source[cursor.index])) {
    cursor.index += 1;
  }

  const next = readPrimary(cursor);
  if (next) return next;

  if (cursor.index < cursor.source.length) {
    const ch = cursor.source[cursor.index];
    cursor.index += 1;
    return escapeLiteralLatex(ch);
  }

  return '';
};

const formatSourceLatex = (source: string): string => {
  if (!source.trim()) return '';

  const cursor: RenderCursor = { source, index: 0 };
  const pieces: string[] = [];

  const append = (value: string) => {
    if (value) pieces.push(value);
  };

  while (cursor.index < cursor.source.length) {
    const ch = cursor.source[cursor.index];

    if (/\s/.test(ch)) {
      cursor.index += 1;
      continue;
    }

    const pair = ch + (cursor.source[cursor.index + 1] || '');
    if (pair === ':=') {
      append('\\coloneqq');
      cursor.index += 2;
      continue;
    }
    if (pair === '**') {
      cursor.index += 2;
      const exponent = formatExponent(cursor);
      const base = pieces.pop();
      if (base) {
        append(`${base}^{${exponent || '{}'}}`);
      } else {
        append(`^{${exponent || '{}'}}`);
      }
      continue;
    }
    if (pair === '!=') {
      append('\\ne');
      cursor.index += 2;
      continue;
    }
    if (pair === '>=') {
      append('\\ge');
      cursor.index += 2;
      continue;
    }
    if (pair === '<=') {
      append('\\le');
      cursor.index += 2;
      continue;
    }
    if (pair === '==') {
      append('=');
      cursor.index += 2;
      continue;
    }

    if (ch === '^') {
      cursor.index += 1;
      const exponent = formatExponent(cursor);
      const base = pieces.pop();
      if (base) {
        append(`${base}^{${exponent || '{}'}}`);
      } else {
        append(`^{${exponent || '{}'}}`);
      }
      continue;
    }

    if (ch === '*' || ch === '+' || ch === '-' || ch === '/' || ch === '=' || ch === ',' || ch === ';' || ch === ':') {
      append(ch === '*' ? '\\cdot' : ch);
      cursor.index += 1;
      continue;
    }

    const primary = readPrimary(cursor);
    if (primary) {
      append(primary);
      continue;
    }

    append(escapeLiteralLatex(ch));
    cursor.index += 1;
  }

  return pieces.join(' ');
};

const renderSourceMath = (source: string) => {
  try {
    return katex.renderToString(withSourceBreakHints(formatSourceLatex(source)), {
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
  return normalizeLatexForCompare(formatSourceLatex(source)) === normalizeLatexForCompare(firstStep);
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
  viewMode,
  outputCollapsed,
  onSwitchToSource,
  onCommitSource,
  active = false
}: Props) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [lastRendered, setLastRendered] = useState(value);

  useEffect(() => {
    setDraft(value);
    setLastRendered(value);
    setDirty(false);
  }, [value]);

  const renderLatexSteps = (steps: string[]) =>
    steps.map((step) => {
      const safeStep = String(step ?? '');
      try {
        return katex.renderToString(
          safeStep.replace(/,/g, ",\\allowbreak ").replace(/=/g, "=\\allowbreak "),
          { throwOnError: false, displayMode: true }
        );
      } catch (_err) {
        return `<span class="math-error">${safeStep}</span>`;
      }
    });

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

  const runNow = (nextValue: string) => {
    if (isRunning) return;
    onRun(nextValue);
    setLastRendered(nextValue);
    setDirty(false);
  };

  if (viewMode === 'rendered' && !outputCollapsed && (output || value.trim())) {
    return (
      <div className="math-card" onClick={onSwitchToSource} data-testid="math-output">
        {showCardSource && renderedSource ? (
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

  return (
    <div className={`math-editor${active ? ' active' : ''}`}>
      <div
        onBlur={() => {
          if (dirty) {
            runNow(draft);
          }
          if (draft.trim()) {
            onCommitSource();
          }
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
            runNow(val);
          }}
          completions={completions ?? []}
          extractSymbols={extractMathSymbols}
          language={sugarPyMathLanguage}
          placeholderText="Type math..."
          autoFocus={active}
          shortcutItems={shortcutItems}
        />
      </div>
      <div className="math-inline-meta" aria-label="Math settings">
        <span>{renderMode === 'decimal' ? '≈' : '='}</span>
        <span>{trigMode === 'deg' ? '°' : 'rad'}</span>
      </div>
    </div>
  );
}
