import React from 'react';
import { CellModel } from '../App';
import { CodeEditor } from './CodeEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MathEditor } from './MathEditor';
import { CellHeader } from './CellHeader';

type Props = {
  cell: CellModel;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  onRunMath: (value: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  suggestions: { label: string; detail?: string }[];
  mathSuggestions: { label: string; detail?: string }[];
  trigMode: 'deg' | 'rad';
};

export function NotebookCell({
  cell,
  onChange,
  onRun,
  onRunMath,
  onMoveUp,
  onMoveDown,
  onDelete,
  suggestions,
  mathSuggestions,
  trigMode
}: Props) {
  return (
    <div className="cell-row">
      <div className="cell-gutter">
        {cell.type !== 'markdown' ? (
          <CellHeader
            execCount={cell.execCount}
            isRunning={cell.isRunning}
            onRun={() => {
              if (cell.type === 'math') {
                onRunMath(cell.source);
              } else {
                onRun(cell.source);
              }
            }}
          />
        ) : (
          <div className="cell-placeholder">[ ]</div>
        )}
      </div>
      <div className="cell cell-main">
        <div className="cell-menu">
          <button className="cell-menu-btn" onClick={onMoveUp}>↑</button>
          <button className="cell-menu-btn" onClick={onMoveDown}>↓</button>
          <button className="cell-menu-btn" onClick={onDelete}>✕</button>
        </div>
        {cell.type === 'markdown' ? (
          <MarkdownEditor value={cell.source} onChange={onChange} />
        ) : cell.type === 'math' ? (
          <MathEditor
            value={cell.source}
            onChange={onChange}
            onRun={onRunMath}
            completions={mathSuggestions}
            output={cell.mathOutput}
            isRunning={cell.isRunning}
            trigMode={trigMode}
          />
        ) : (
          <>
            <CodeEditor
              value={cell.source}
              onChange={onChange}
              onRun={onRun}
              completions={suggestions}
              placeholderText="Type code..."
            />
            {cell.output ? <div className="output">{cell.output}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}
