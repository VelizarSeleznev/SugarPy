import type { StoichOutput, StoichState } from '../utils/stoichTypes';
import type { RegressionOutput, RegressionState } from '../utils/regressionTypes';

export type CellKind = 'code' | 'markdown' | 'math' | 'stoich' | 'regression';

export type CellOutput =
  | {
      type: 'mime';
      data: Record<string, unknown>;
    }
  | {
      type: 'error';
      ename: string;
      evalue: string;
    };

export type CellRecord = {
  id: string;
  source: string;
  output?: CellOutput;
  type?: CellKind;
  execCount?: number;
  isRunning?: boolean;
  mathOutput?: {
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
    plotly_figure?: unknown;
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
  mathRenderMode?: 'exact' | 'decimal';
  mathTrigMode?: 'deg' | 'rad';
  stoichState?: StoichState;
  stoichOutput?: StoichOutput;
  regressionState?: RegressionState;
  regressionOutput?: RegressionOutput;
  assistantMeta?: {
    runId: string;
    stepId: string;
    status: 'draft' | 'validating' | 'applied' | 'failed';
    isRunnable: boolean;
  };
  ui?: {
    outputCollapsed?: boolean;
    mathView?: 'source' | 'rendered';
  };
};

export type NotebookDefaults = {
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
};

export type CellEditableDocumentMap = {
  code: { source: string };
  markdown: { source: string };
  math: { source: string };
  stoich: { reaction: string; inputs: StoichState['inputs'] };
  regression: { points: RegressionState['points'] };
};

export type CellEditableConfigMap = {
  code: Record<string, never>;
  markdown: Record<string, never>;
  math: { trigMode?: 'deg' | 'rad'; renderMode?: 'exact' | 'decimal' };
  stoich: Record<string, never>;
  regression: {
    model?: RegressionState['model'];
    labels?: RegressionState['labels'];
    ui?: RegressionState['ui'];
  };
};

export type CellEditableSnapshot<K extends CellKind = CellKind> = {
  document: CellEditableDocumentMap[K];
  config: CellEditableConfigMap[K];
};

export type CellEditablePatch<K extends CellKind = CellKind> = {
  document?: Partial<CellEditableDocumentMap[K]>;
  config?: Partial<CellEditableConfigMap[K]>;
};

export type CellSummary = {
  id: string;
  kind: CellKind;
  editable: CellEditableSnapshot;
  hasRuntimeOutput: boolean;
  hasRuntimeError: boolean;
  outputPreview: string;
};

export const getCellKind = (cell: CellRecord): CellKind => cell.type ?? 'code';

export const cloneCellRecord = <T extends CellRecord>(cell: T): T => {
  const clone = typeof structuredClone === 'function' ? structuredClone(cell) : JSON.parse(JSON.stringify(cell));
  return clone as T;
};

