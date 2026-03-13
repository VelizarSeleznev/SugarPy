export type CustomCellTemplateId = 'regression';

export type RegressionModel = 'linear' | 'quadratic' | 'exponential';

export type RegressionPoint = {
  x: string;
  y: string;
};

export type RegressionBindings = {
  prefix: string;
  names: Record<string, string>;
};

export type RegressionCellState = {
  model: RegressionModel;
  points: RegressionPoint[];
  bindingPrefix: string;
  exportBindings?: boolean;
};

export type RegressionCellOutput = {
  schema_version: number;
  template_id: 'regression';
  ok: boolean;
  model?: RegressionModel;
  point_count?: number;
  coefficients?: number[];
  coefficient_labels?: string[];
  equation_text?: string;
  equation_latex?: string;
  metrics?: {
    r2: number;
    rmse: number;
  };
  plotly_figure?: unknown;
  warnings?: string[];
  bindings?: RegressionBindings;
  error?: string;
};

export type CustomCellStateMap = {
  regression: RegressionCellState;
};

export type CustomCellOutputMap = {
  regression: RegressionCellOutput;
};

export type AnyCustomCellState = CustomCellStateMap[CustomCellTemplateId];
export type AnyCustomCellOutput = CustomCellOutputMap[CustomCellTemplateId];

export type CustomCellData = {
  templateId: CustomCellTemplateId;
  state: AnyCustomCellState;
  output?: AnyCustomCellOutput;
};

export const createRegressionState = (): RegressionCellState => ({
  model: 'linear',
  points: [
    { x: '0', y: '1' },
    { x: '1', y: '3' },
    { x: '2', y: '5' },
  ],
  bindingPrefix: 'regression',
  exportBindings: false,
});

export const createCustomCellData = (templateId: CustomCellTemplateId): CustomCellData => {
  if (templateId === 'regression') {
    return {
      templateId,
      state: createRegressionState(),
    };
  }
  return {
    templateId: 'regression',
    state: createRegressionState(),
  };
};
