import React from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import katex from 'katex';
import { CellOutput } from '../App';

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

type Props = {
  output?: CellOutput;
};

export function OutputArea({ output }: Props) {
  if (!output) return null;

  if (output.type === 'error') {
    return (
      <div className="output output-plain cell-error" data-testid="cell-error" data-block-cell-swipe="true">
        {output.ename}: {output.evalue}
      </div>
    );
  }

  const data = output.data ?? {};
  const plotlyValue = data['application/vnd.plotly.v1+json'];
  if (plotlyValue && typeof plotlyValue === 'object') {
    const figure = plotlyValue as any;
    const layout = figure.layout ?? {};
    const hasLegend = layout.showlegend !== false;
    const aspectLocked = Boolean(layout.yaxis?.scaleanchor || layout.xaxis?.scaleanchor);
    const plotHeight = typeof layout.height === 'number' ? layout.height : undefined;
    return (
      <div className="output output-rich" data-testid="plotly-graph" data-block-cell-swipe="true">
        <Plot
          data={Array.isArray(figure.data) ? figure.data : []}
          layout={{
            dragmode: 'pan',
            autosize: true,
            hovermode: 'closest',
            margin: {
              l: 56,
              r: hasLegend ? 32 : 20,
              t: 56,
              b: 48,
              ...(layout.margin ?? {})
            },
            ...(layout ?? {}),
            xaxis: {
              fixedrange: false,
              constrain: 'none',
              automargin: true,
              ...(layout.xaxis ?? {})
            },
            yaxis: {
              fixedrange: false,
              automargin: true,
              ...(layout.yaxis ?? {})
            }
          }}
          config={{
            responsive: true,
            scrollZoom: true,
            doubleClick: 'reset',
            displaylogo: false,
            modeBarButtonsToRemove: ['autoScale2d', 'lasso2d', 'select2d']
          }}
          style={{
            width: '100%',
            height: plotHeight ?? (aspectLocked ? 'clamp(420px, 72vh, 760px)' : 'clamp(320px, 48vh, 460px)')
          }}
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
        data-block-cell-swipe="true"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const plain = asText(data['text/plain']).trim();
  if (!plain) return null;
  return (
    <div className="output output-plain" data-testid="cell-plain-output" data-block-cell-swipe="true">
      {plain}
    </div>
  );
}
