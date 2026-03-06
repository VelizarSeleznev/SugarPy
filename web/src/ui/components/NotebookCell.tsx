import React from 'react';
import { CellModel } from '../App';
import { CodeEditor } from './CodeEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MathEditor } from './MathEditor';
import { StoichiometryCell } from './StoichiometryCell';
import { StoichState } from '../utils/stoichTypes';
import { CellWrapper } from './CellWrapper';
import { OutputArea } from './OutputArea';

type Props = {
  cell: CellModel;
  isActive: boolean;
  onActivate: () => void;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  onRunMath: (value: string) => void;
  onRunStoich: (state: StoichState) => void;
  onChangeStoich: (state: StoichState) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  suggestions: { label: string; detail?: string }[];
  slashCommands: { label: string; detail?: string }[];
  onSlashCommand: (command: string) => boolean;
  mathSuggestions: { label: string; detail?: string }[];
  trigMode: 'deg' | 'rad';
  kernelReady: boolean;
  onSetMathRenderMode: (mode: 'exact' | 'decimal') => void;
  onToggleTrigMode: () => void;
};

const statusFromCell = (cell: CellModel) => {
  if (cell.isRunning) return '*';
  if (cell.type === 'markdown' || cell.type === 'stoich') return ' ';
  if (cell.execCount === null || cell.execCount === undefined) return ' ';
  return String(cell.execCount);
};

export function NotebookCell({
  cell,
  isActive,
  onActivate,
  onChange,
  onRun,
  onRunMath,
  onRunStoich,
  onChangeStoich,
  onMoveUp,
  onMoveDown,
  onDelete,
  suggestions,
  slashCommands,
  onSlashCommand,
  mathSuggestions,
  trigMode,
  kernelReady,
  onSetMathRenderMode,
  onToggleTrigMode
}: Props) {
  const cellType = cell.type ?? 'code';
  const mathRenderMode = cell.mathRenderMode ?? 'exact';
  const runHandler =
    cellType === 'markdown' || cellType === 'stoich'
      ? undefined
      : () => {
          if (cellType === 'math') onRunMath(cell.source);
          else onRun(cell.source);
        };

  return (
    <div className="notebook-item" data-testid={`cell-row-${cellType}`} data-cell-id={cell.id}>
      <CellWrapper
        isActive={isActive}
        status={statusFromCell(cell)}
        onRun={runHandler}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
        onActivate={onActivate}
        toolbarExtras={
          cellType === 'math' ? (
            <div className="cell-toolbar-mode" role="group" aria-label="Math render mode">
              <button
                type="button"
                className="cell-toolbar-mode-btn active"
                onClick={() => onSetMathRenderMode(mathRenderMode === 'exact' ? 'decimal' : 'exact')}
                aria-label="Toggle math output mode"
              >
                {mathRenderMode === 'exact' ? 'Exact' : 'Decimal'}
              </button>
              <button
                type="button"
                className="cell-toolbar-mode-btn"
                onClick={onToggleTrigMode}
                aria-label="Toggle trig mode"
              >
                {trigMode === 'deg' ? 'Deg' : 'Rad'}
              </button>
            </div>
          ) : null
        }
      >
        {cellType === 'code' ? (
          <>
            <CodeEditor
              value={cell.source}
              onChange={onChange}
              onRun={onRun}
              completions={suggestions}
              slashCommands={slashCommands}
              onSlashCommand={onSlashCommand}
              placeholderText="Type code..."
            />
            <div data-testid="cell-output">
              <OutputArea output={cell.output} />
            </div>
          </>
        ) : null}

        {cellType === 'markdown' ? (
          <MarkdownEditor value={cell.source} onChange={onChange} />
        ) : null}

        {cellType === 'math' ? (
          <>
            <MathEditor
              value={cell.source}
              onChange={onChange}
              onRun={onRunMath}
              completions={mathSuggestions}
              output={cell.mathOutput}
              isRunning={cell.isRunning}
              trigMode={trigMode}
            />
            <div data-testid="cell-output">
              <OutputArea output={cell.output} />
            </div>
          </>
        ) : null}

        {cellType === 'stoich' ? (
          <StoichiometryCell
            state={cell.stoichState ?? { reaction: '', inputs: {} }}
            output={cell.stoichOutput}
            isRunning={cell.isRunning}
            onChange={onChangeStoich}
            onCompute={onRunStoich}
            kernelReady={kernelReady}
          />
        ) : null}
      </CellWrapper>
    </div>
  );
}
