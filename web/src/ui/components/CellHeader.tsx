import React from 'react';

type Props = {
  execCount?: number;
  isRunning?: boolean;
  onRun: () => void;
};

export function CellHeader({ execCount, isRunning, onRun }: Props) {
  const label = isRunning ? '*' : execCount ?? ' ';
  const display = `[${label}]`;
  return (
    <button
      className="button"
      onClick={onRun}
      style={{
        padding: '4px 8px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace'
      }}
      title="Run (Shift+Enter)"
    >
      {display}
    </button>
  );
}
