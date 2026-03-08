import React from 'react';
import { cpp } from '@codemirror/lang-cpp';
import { go as goLanguage } from '@codemirror/lang-go';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { CellModel } from '../App';
import { CodeEditor } from './CodeEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MathEditor } from './MathEditor';
import { StoichiometryCell } from './StoichiometryCell';
import { StoichState } from '../utils/stoichTypes';
import { CellWrapper } from './CellWrapper';
import { OutputArea } from './OutputArea';
import {
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  CodeLanguage,
  normalizeCodeLanguage
} from '../utils/codeLanguage';

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
  onSetCodeLanguage: (language: CodeLanguage) => void;
  onToggleTrigMode: () => void;
};

const codeLanguageExtension = (language: CodeLanguage) => {
  if (language === 'c') return cpp();
  if (language === 'go') return goLanguage();
  if (language === 'php') return php();
  return python();
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
  onSetCodeLanguage,
  onToggleTrigMode
}: Props) {
  const cellType = cell.type ?? 'code';
  const mathRenderMode = cell.mathRenderMode ?? 'exact';
  const codeLanguage = normalizeCodeLanguage(cell.runtimeLanguage);
  const runHandler =
    cellType === 'markdown' || cellType === 'stoich'
      ? undefined
      : () => {
          if (cellType === 'math') onRunMath(cell.source);
          else onRun(cell.source);
        };
  const toolbarExtras =
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
    ) : cellType === 'code' ? (
      <label className="cell-language-select-wrap" aria-label="Code language">
        <span className="cell-language-label">Lang</span>
        <select
          className="cell-language-select"
          value={codeLanguage}
          data-testid="code-language-select"
          onChange={(event) => onSetCodeLanguage(normalizeCodeLanguage(event.target.value))}
        >
          {CODE_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {CODE_LANGUAGE_LABELS[language]}
            </option>
          ))}
        </select>
      </label>
    ) : null;

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
        toolbarExtras={toolbarExtras}
      >
        {cellType === 'code' ? (
          <>
            <CodeEditor
              value={cell.source}
              onChange={onChange}
              onRun={onRun}
              completions={codeLanguage === 'python' ? suggestions : []}
              slashCommands={codeLanguage === 'python' ? slashCommands : []}
              onSlashCommand={onSlashCommand}
              language={codeLanguageExtension(codeLanguage)}
              placeholderText={`Type ${CODE_LANGUAGE_LABELS[codeLanguage]} code...`}
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
