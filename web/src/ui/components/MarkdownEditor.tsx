import React, { useEffect, useMemo, useState } from 'react';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { markdown } from '@codemirror/lang-markdown';
import { CodeEditor } from './CodeEditor';

const md = new MarkdownIt({ breaks: true });
type DisplaySegment =
  | { kind: 'text'; value: string }
  | { kind: 'displayMath'; value: string };

const findUnescapedDollar = (source: string, from: number) => {
  let idx = from;
  while (idx < source.length) {
    const pos = source.indexOf('$', idx);
    if (pos < 0) return -1;
    const escaped = pos > 0 && source[pos - 1] === '\\';
    if (!escaped) return pos;
    idx = pos + 1;
  }
  return -1;
};

const splitDisplayMathSegments = (source: string): DisplaySegment[] => {
  const segments: DisplaySegment[] = [];
  let i = 0;
  let textStart = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      segments.push({ kind: 'text', value: source.slice(textStart, end) });
    }
  };

  while (i < source.length) {
    if (source.startsWith('$$', i)) {
      const end = source.indexOf('$$', i + 2);
      if (end >= 0) {
        pushText(i);
        segments.push({ kind: 'displayMath', value: source.slice(i + 2, end).trim() });
        i = end + 2;
        textStart = i;
        continue;
      }
    }
    if (source.startsWith('\\[', i)) {
      const end = source.indexOf('\\]', i + 2);
      if (end >= 0) {
        pushText(i);
        segments.push({ kind: 'displayMath', value: source.slice(i + 2, end).trim() });
        i = end + 2;
        textStart = i;
        continue;
      }
    }
    i += 1;
  }

  pushText(source.length);
  return segments;
};

const renderInlineMathInText = (text: string) => {
  if (!text) return '';

  let idx = 0;
  let transformed = '';
  let tokenIndex = 0;
  const replacements = new Map<string, string>();

  const addInline = (expr: string) => {
    const token = `SUGARPYMATHINLINETOKEN${tokenIndex++}END`;
    const rendered = katex.renderToString(expr, {
      throwOnError: false,
      displayMode: false,
    });
    replacements.set(token, `<span class="markdown-math-inline">${rendered}</span>`);
    transformed += token;
  };

  while (idx < text.length) {
    if (text.startsWith('\\(', idx)) {
      const end = text.indexOf('\\)', idx + 2);
      if (end >= 0) {
        transformed += text.slice(0, idx);
        text = text.slice(idx);
        // restart against sliced text to keep indexing simple
        idx = 0;
        const close = text.indexOf('\\)', 2);
        if (close >= 0) {
          addInline(text.slice(2, close).trim());
          text = text.slice(close + 2);
          continue;
        }
      }
    }
    if (text[idx] === '$' && text[idx + 1] !== '$') {
      const end = findUnescapedDollar(text, idx + 1);
      if (end >= 0) {
        const candidate = text.slice(idx + 1, end);
        if (!candidate.includes('\n')) {
          transformed += text.slice(0, idx);
          text = text.slice(idx);
          idx = 0;
          const close = findUnescapedDollar(text, 1);
          if (close >= 0) {
            addInline(text.slice(1, close).trim());
            text = text.slice(close + 1);
            continue;
          }
        }
      }
    }
    idx += 1;
  }

  transformed += text;
  let html = md.render(transformed);
  replacements.forEach((value, token) => {
    html = html.split(token).join(value);
  });
  return html;
};

const renderMarkdownWithMath = (source: string) => {
  if (!source.trim()) return '';

  const segments = splitDisplayMathSegments(source);
  return segments
    .map((segment) => {
      if (segment.kind === 'displayMath') {
        const rendered = katex.renderToString(segment.value, {
          throwOnError: false,
          displayMode: true,
        });
        return `<div class="markdown-math">${rendered}</div>`;
      }
      return renderInlineMathInText(segment.value);
    })
    .join('');
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  active?: boolean;
};

export function MarkdownEditor({ value, onChange, active = false }: Props) {
  const [editing, setEditing] = useState(active || !value.trim());
  const rendered = useMemo(() => renderMarkdownWithMath(value || ''), [value]);
  const isEmpty = !value.trim();

  useEffect(() => {
    if (!active && !isEmpty) {
      setEditing(false);
      return;
    }
    if (isEmpty) {
      setEditing(true);
    }
  }, [active, isEmpty]);

  if (!editing) {
    return (
      <div
        className="markdown"
        data-block-cell-swipe="true"
        onClick={() => setEditing(true)}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  }

  return (
    <div className="markdown-editor">
      <div className="editor-inline-actions">
        <button type="button" className="editor-inline-btn" onClick={() => setEditing(false)} disabled={isEmpty}>
          Done
        </button>
      </div>
      <div onBlur={() => setEditing(!isEmpty)}>
        <CodeEditor
          value={value}
          onChange={onChange}
          onRun={(_value) => setEditing(false)}
          completions={[]}
          language={markdown()}
          placeholderText="Write text..."
          autoFocus
        />
      </div>
    </div>
  );
}
