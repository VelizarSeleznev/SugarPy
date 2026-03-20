export type RegressionModel =
  | 'auto'
  | 'linear'
  | 'quadratic'
  | 'cubic'
  | 'exponential'
  | 'logarithmic'
  | 'power'
  | 'logistic'
  | 'saturating_exponential';

export type RegressionPointDraft = {
  x: string;
  y: string;
};

export type RegressionInvalidRow = {
  row: number;
  error: string;
};

export type RegressionState = {
  points: RegressionPointDraft[];
  model: RegressionModel;
  labels?: {
    x?: string;
    y?: string;
  };
  ui?: {
    editorExpanded?: boolean;
  };
};

export type RegressionOutput = {
  ok: boolean;
  model: RegressionModel;
  requested_model?: RegressionModel;
  model_label?: string;
  confidence?: 'high' | 'low';
  error?: string | null;
  equation_text?: string | null;
  r2?: number | null;
  rmse?: number | null;
  aicc?: number | null;
  bic?: number | null;
  points: Array<{ x: number; y: number }>;
  invalid_rows: RegressionInvalidRow[];
  plotly_figure?: unknown;
  parameters?: Record<string, number>;
  warnings?: string[];
  alternatives?: Array<{
    model_name: string;
    model_label: string;
    rmse: number;
    r2: number;
    aicc: number;
    bic: number;
    formula: string;
  }>;
};

export const DEFAULT_REGRESSION_POINTS: RegressionPointDraft[] = [
  { x: '', y: '' },
  { x: '', y: '' },
  { x: '', y: '' }
];

export const createRegressionState = (): RegressionState => ({
  points: DEFAULT_REGRESSION_POINTS.map((point) => ({ ...point })),
  model: 'auto',
  labels: {
    x: 'x',
    y: 'y'
  },
  ui: {
    editorExpanded: false
  }
});
