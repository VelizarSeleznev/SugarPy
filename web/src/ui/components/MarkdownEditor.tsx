import React, { useMemo, useState } from 'react';
import MarkdownIt from 'markdown-it';
import { markdown } from '@codemirror/lang-markdown';
import { CodeEditor } from './CodeEditor';

const md = new MarkdownIt({ breaks: true });

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function MarkdownEditor({ value, onChange }: Props) {
  const [editing, setEditing] = useState(true);
  const rendered = useMemo(() => md.render(value || ''), [value]);

  if (!editing) {
    return (
      <div
        className="markdown"
        onClick={() => setEditing(true)}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  }

  return (
    <div className="markdown-editor">
      <div onBlur={() => setEditing(false)}>
        <CodeEditor
          value={value}
          onChange={onChange}
          onRun={(_value) => setEditing(false)}
          completions={[]}
          language={markdown()}
          placeholderText="Type text..."
          autoFocus
        />
      </div>
    </div>
  );
}
