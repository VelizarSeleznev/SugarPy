import React from 'react';
import { CellModel } from '../App';
import { CodeEditor } from './CodeEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MathEditor } from './MathEditor';
import { StoichiometryCell } from './StoichiometryCell';
import { StoichState } from '../utils/stoichTypes';
import { CellWrapper, CellMenuAction } from './CellWrapper';
import { OutputArea } from './OutputArea';

type Props = {
  cell: CellModel;
  isActive: boolean;
  isLastActive: boolean;
  onActivate: () => void;
  onAddAbove: () => void;
  onAddBelow: () => void;
  onChange: (value: string) => void;
  onRun: (value: string) => void;
  onRunMath: (value: string) => void;
  onRunStoich: (state: StoichState) => void;
  onChangeStoich: (state: StoichState) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onToggleOutput: () => void;
  onClearOutput: () => void;
  onToggleMathView: () => void;
  onShowMathRendered: () => void;
  suggestions: { label: string; detail?: string }[];
  slashCommands: { label: string; detail?: string }[];
  onSlashCommand: (command: string) => boolean;
  mathSuggestions: { label: string; detail?: string }[];
  trigMode: 'deg' | 'rad';
  kernelReady: boolean;
  onSetMathRenderMode: (mode: 'exact' | 'decimal') => void;
  onSetMathTrigMode: (mode: 'deg' | 'rad') => void;
};

const statusFromCell = (cell: CellModel) => {
  if (cell.isRunning) return '*';
  if (cell.type === 'markdown' || cell.type === 'stoich') return '';
  if (cell.execCount === null || cell.execCount === undefined) return '';
  return String(cell.execCount);
};

const hasOutput = (cell: CellModel) => !!(cell.output || cell.mathOutput || cell.stoichOutput);

const TrashIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    focusable="false"
    className="cell-svg-icon"
  >
    <path
      d="M5.25 2.75h5.5M6.25 2.75l.3-.75h2.9l.3.75M4.5 4.5h7l-.55 7.1a1 1 0 0 1-1 .9H6.05a1 1 0 0 1-1-.9L4.5 4.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6.75 6.25v3.75M9.25 6.25v3.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  </svg>
);

export function NotebookCell({
  cell,
  isActive,
  isLastActive,
  onActivate,
  onAddAbove,
  onAddBelow,
  onChange,
  onRun,
  onRunMath,
  onRunStoich,
  onChangeStoich,
  onMoveUp,
  onMoveDown,
  onDelete,
  onToggleOutput,
  onClearOutput,
  onToggleMathView,
  onShowMathRendered,
  suggestions,
  slashCommands,
  onSlashCommand,
  mathSuggestions,
  trigMode,
  kernelReady,
  onSetMathRenderMode,
  onSetMathTrigMode
}: Props) {
  const cellType = cell.type ?? 'code';
  const mathRenderMode = cell.mathRenderMode ?? 'exact';
  const mathTrigMode = cell.mathTrigMode ?? trigMode;
  const outputHidden = !!cell.ui?.outputCollapsed;
  const outputAvailable = hasOutput(cell);
  const runHandler =
    cellType === 'markdown' || cellType === 'stoich'
      ? undefined
      : () => {
          if (cellType === 'math') onRunMath(cell.source);
          else onRun(cell.source);
        };

  const menuActions: CellMenuAction[] = [
    { label: 'Add above', icon: '+', onSelect: onAddAbove },
    { label: 'Add below', icon: '+', onSelect: onAddBelow },
    ...(cellType === 'math'
      ? [
          {
            label: mathRenderMode === 'decimal' ? 'Show exact values' : 'Show decimal values',
            icon: mathRenderMode === 'decimal' ? '=' : '≈',
            onSelect: () => onSetMathRenderMode(mathRenderMode === 'exact' ? 'decimal' : 'exact')
          },
          {
            label: mathTrigMode === 'deg' ? 'Switch to radians' : 'Switch to degrees',
            icon: mathTrigMode === 'deg' ? 'rad' : '°',
            onSelect: () => onSetMathTrigMode(mathTrigMode === 'deg' ? 'rad' : 'deg')
          }
        ]
      : []),
    ...(outputAvailable
      ? [
          {
            label: outputHidden ? 'Show output' : 'Hide output',
            icon: outputHidden ? '+' : '-',
            onSelect: onToggleOutput
          },
          {
            label: 'Clear output',
            icon: '×',
            onSelect: onClearOutput
          }
        ]
      : []),
    { label: 'Move up', icon: '↑', onSelect: onMoveUp },
    { label: 'Move down', icon: '↓', onSelect: onMoveDown },
    { label: 'Delete cell', icon: '⌫', onSelect: onDelete, danger: true }
  ];

  return (
    <div className="notebook-item" data-testid={`cell-row-${cellType}`} data-cell-id={cell.id}>
      <CellWrapper
        cellType={cellType}
        isActive={isActive}
        isLastActive={isLastActive}
        status={statusFromCell(cell)}
        onRun={runHandler}
        onActivate={onActivate}
        quickActions={[
          ...(cellType === 'math'
            ? [
                {
                  label: cell.ui?.mathView === 'rendered' ? 'Show math source' : 'Show rendered math',
                  icon: cell.ui?.mathView === 'rendered' ? '</>' : '∑',
                  onClick: onToggleMathView
                }
              ]
            : []),
          ...(outputAvailable
            ? [
                {
                  label: outputHidden ? 'Show output' : 'Hide output',
                  icon: outputHidden ? '⊞' : '⊟',
                  onClick: onToggleOutput
                }
              ]
            : []),
          {
            label: 'Delete cell',
            icon: <TrashIcon />,
            onClick: onDelete
          }
        ]}
        menuActions={menuActions}
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
            {!outputHidden ? (
              <div data-testid="cell-output">
                <OutputArea output={cell.output} />
              </div>
            ) : null}
          </>
        ) : null}

        {cellType === 'markdown' ? (
          <MarkdownEditor value={cell.source} onChange={onChange} active={isActive} />
        ) : null}

        {cellType === 'math' ? (
          <>
            <MathEditor
              key={`${cell.id}-${cell.mathOutput ? 'with-output' : 'no-output'}`}
              value={cell.source}
              onChange={onChange}
              onRun={onRunMath}
              completions={mathSuggestions}
              output={cell.mathOutput}
              isRunning={cell.isRunning}
              trigMode={mathTrigMode}
              renderMode={mathRenderMode}
              viewMode={cell.ui?.mathView === 'rendered' ? 'rendered' : 'source'}
              outputCollapsed={outputHidden}
              onSwitchToSource={() => {
                if (cell.ui?.mathView === 'rendered') onToggleMathView();
              }}
              onCommitSource={onShowMathRendered}
              active={isActive}
            />
            {!outputHidden ? (
              <div data-testid="cell-output">
                <OutputArea output={cell.output} />
              </div>
            ) : null}
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
            showOutput={!outputHidden}
          />
        ) : null}
      </CellWrapper>
    </div>
  );
}
