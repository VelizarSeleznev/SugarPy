export type DataPointDraft = {
  x: string;
  y: string;
};

export type DataState = {
  name: string;
  points: DataPointDraft[];
  labels?: {
    x?: string;
    y?: string;
  };
  ui?: {
    editorExpanded?: boolean;
  };
};

export const DEFAULT_DATA_POINTS: DataPointDraft[] = [
  { x: '', y: '' },
  { x: '', y: '' },
  { x: '', y: '' }
];

export const createDataState = (): DataState => ({
  name: 'data',
  points: DEFAULT_DATA_POINTS.map((point) => ({ ...point })),
  labels: {
    x: 'x',
    y: 'y'
  },
  ui: {
    editorExpanded: true
  }
});

