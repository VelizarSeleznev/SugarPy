import React from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import katex from 'katex';
import { CellModel } from '../App';
import { CodeEditor } from './CodeEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { MathEditor } from './MathEditor';
import { CellHeader } from './CellHeader';
import { StoichiometryCell } from './StoichiometryCell';
import { StoichState } from '../utils/stoichTypes';

const Plot = createPlotlyComponent(Plotly as any);

const asText = (value: unknown) => {
  if (Array.isArray(value)) return value.join('');
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeLatex = (value: unknown) => {
  let latex = asText(value).trim();
  latex = latex.replace(/^\$+/, '').replace(/\$+$/, '').trim();
  latex = latex.replace(/^\\displaystyle\s*/, '').trim();
  return latex;
};

const renderOutput = (cell: CellModel) => {
  if (!cell.output) return null;

  if (cell.output.type === 'error') {
    return (
      <div className="output output-plain cell-error" data-testid="cell-error">
        {cell.output.ename}: {cell.output.evalue}
      </div>
    );
  }

  const data = cell.output.data ?? {};
  const plotlyValue = data['application/vnd.plotly.v1+json'];
  if (plotlyValue && typeof plotlyValue === 'object') {
    const figure = plotlyValue as any;
    return (
      <div className="output output-rich" data-testid="plotly-graph">
        <Plot
          data={Array.isArray(figure.data) ? figure.data : []}
          layout={{
            dragmode: 'pan',
            autosize: true,
            ...(figure.layout ?? {}),
            xaxis: {
              fixedrange: false,
              constrain: 'none',
              ...(figure.layout?.xaxis ?? {})
            },
            yaxis: {
              fixedrange: false,
              ...(figure.layout?.yaxis ?? {})
            }
          }}
          config={{
            responsive: true,
            scrollZoom: true,
            doubleClick: 'reset',
            modeBarButtonsToRemove: ['autoScale2d']
          }}
          style={{ width: '100%', height: 360 }}
          useResizeHandler
        />
      </div>
    );
  }

  const latexValue = data['text/latex'];
  if (latexValue) {
    const clean = normalizeLatex(latexValue);
    const html = katex.renderToString(clean, { throwOnError: false, displayMode: true });
    return (
      <div
        className="output output-rich"
        data-testid="katex-formula"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const plain = asText(data['text/plain']).trim();
  if (!plain) return null;
  return (
    <div className="output output-plain" data-testid="cell-plain-output">
      {plain}
    </div>
  );
};

type Props = {
  cell: CellModel;
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
};

export function NotebookCell({
  cell,
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
  kernelReady
}: Props) {
  const cellType = cell.type ?? 'code';
  return (
    <div className="cell-row" data-testid={`cell-row-${cellType}`}>
      <div className="cell-gutter">
        {cell.type !== 'markdown' && cell.type !== 'stoich' ? (
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
        ) : cell.type === 'stoich' ? (
          <StoichiometryCell
            state={cell.stoichState ?? { reaction: '', inputs: {} }}
            output={cell.stoichOutput}
            isRunning={cell.isRunning}
            onChange={onChangeStoich}
            onCompute={onRunStoich}
            kernelReady={kernelReady}
          />
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
              slashCommands={slashCommands}
              onSlashCommand={onSlashCommand}
              placeholderText="Type code..."
            />
            <div data-testid="cell-output">{renderOutput(cell)}</div>
          </>
        )}
      </div>
    </div>
  );
}
