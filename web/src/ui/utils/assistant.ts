import type {
  AssistantSandboxContextPreset,
  AssistantSandboxTarget,
  AssistantSandboxRequest,
  AssistantSandboxResult
} from './assistantSandbox.ts';
import { buildAssistantProxyBaseUrl } from './backendApi';

export type AssistantScope = 'notebook' | 'active';
export type AssistantPreference = 'auto' | 'cas' | 'python' | 'explain';

export type AssistantCellKind = 'code' | 'markdown' | 'math' | 'stoich' | 'regression';

export type NotebookCellSnapshot = {
  id: string;
  type: AssistantCellKind;
  source: string;
  mathRenderMode?: 'exact' | 'decimal';
  mathTrigMode?: 'deg' | 'rad';
  stoichReaction?: string;
  hasOutput?: boolean;
  outputPreview?: string;
  hasError?: boolean;
};

export type NotebookAssistantContext = {
  notebookName: string;
  defaultTrigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  cells: NotebookCellSnapshot[];
  activeCellId: string | null;
};

export type AssistantOperation =
  | {
      type: 'insert_cell';
      index: number;
      cellType: AssistantCellKind;
      source: string;
      reason?: string;
    }
  | {
      type: 'update_cell';
      cellId: string;
      source: string;
      reason?: string;
    }
  | {
      type: 'delete_cell';
      cellId: string;
      reason?: string;
    }
  | {
      type: 'move_cell';
      cellId: string;
      index: number;
      reason?: string;
    }
  | {
      type: 'set_notebook_defaults';
      trigMode?: 'deg' | 'rad';
      renderMode?: 'exact' | 'decimal';
      reason?: string;
    };

export type AssistantPlan = {
  summary: string;
  userMessage: string;
  warnings: string[];
  operations: AssistantOperation[];
  outline: {
    summary: string;
    steps: string[];
  };
  steps: Array<{
    id: string;
    title: string;
    summary: string;
    operations: AssistantOperation[];
    warnings: string[];
  }>;
};

export type AssistantValidationStatus = 'ok' | 'error' | 'timeout' | 'skipped';

export type AssistantValidationSummary = {
  status: AssistantValidationStatus;
  outputKind: string;
  outputPreview: string;
  errorSummary?: string;
  contextSummary: string;
  replayContextUsed: AssistantSandboxContextPreset;
  replayedCellIds: string[];
};

export type AssistantDraftValidation = {
  operationIndex: number;
  cellType: AssistantCellKind;
  source: string;
  summary: AssistantValidationSummary;
};

export type AssistantDraftStep = {
  id: string;
  title: string;
  summary: string;
  explanation: string;
  operations: AssistantOperation[];
  validations: AssistantDraftValidation[];
  warnings: string[];
  errors: string[];
  sourcePreview: string;
  changes: string[];
  isRunnable: boolean;
};

export type AssistantDraftRun = {
  summary: string;
  hasFailures: boolean;
  steps: AssistantDraftStep[];
};

export type AssistantPhotoImportCell = {
  type: 'markdown' | 'math';
  source: string;
};

export type AssistantPhotoImportResult = {
  summary: string;
  warnings: string[];
  cells: AssistantPhotoImportCell[];
};

type AssistantMathNormalizationDiagnostic = {
  operationIndex: number;
  originalSource: string;
  normalizedSource: string;
  reason: string;
};

export type AssistantPhotoImportInputItem = {
  imageDataUrl: string;
  fileName?: string;
  displayName?: string;
  mimeType?: string;
  pageNumber?: number;
};

export type AssistantPhotoImportInput = {
  items: AssistantPhotoImportInputItem[];
  instructions?: string;
};

export type AssistantActivity = {
  kind: 'phase' | 'tool' | 'reference';
  label: string;
  detail?: string;
};

export type AssistantConversationEntry = {
  role: 'user' | 'assistant';
  content: string;
};

export type AssistantThinkingLevel = 'dynamic' | 'minimal' | 'low' | 'medium' | 'high';
export type AssistantProvider = 'gemini' | 'groq' | 'openai';

const SERVER_PROXY_KEY_PREFIX = 'server-proxy:';
const ASSISTANT_PLAN_DIAGNOSTICS = Symbol('assistantPlanDiagnostics');

export type AssistantNetworkEvent = {
  phase: 'request_start' | 'response' | 'retry' | 'error' | 'aborted' | 'timeout' | 'stream';
  attempt: number;
  stage?: 'inspection' | 'planning' | 'validation' | 'extraction';
  status?: number;
  detail?: string;
};

export type AssistantResponseTrace = {
  attempt: number;
  provider?: AssistantProvider;
  stage: 'inspection' | 'planning' | 'validation' | 'extraction';
  text?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
};

export type AssistantSandboxExecutionTrace = {
  request: {
    target: AssistantSandboxTarget;
    contextPreset: AssistantSandboxContextPreset;
    timeoutMs: number;
    selectedCellIds: string[];
    sourcePreview: string;
  };
  result: {
    status: AssistantSandboxResult['status'];
    durationMs: number;
    errorName?: string;
    errorValue?: string;
    stdoutPreview: string;
    stderrPreview: string;
    selectedCellIds: string[];
    replayedCellIds: string[];
    contextSourcesUsed: Array<'bootstrap' | 'notebook' | 'draft'>;
    attemptCount: number;
    mathError?: string;
  };
};

export type AssistantSandboxRunner = (
  request: AssistantSandboxRequest,
  onActivity?: (item: AssistantActivity) => void
) => Promise<AssistantSandboxResult>;

export const DEFAULT_ASSISTANT_MODEL = 'gpt-5.4-mini';

export const ASSISTANT_MODEL_PRESETS = [
  {
    value: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini'
  },
  {
    value: 'gpt-5.4-nano',
    label: 'GPT-5.4 nano'
  },
  {
    value: DEFAULT_ASSISTANT_MODEL,
    label: 'GPT-5 mini'
  },
  {
    value: 'gpt-5.1-codex-mini',
    label: 'GPT-5.1 Codex mini'
  },
  {
    value: 'gpt-5.2',
    label: 'GPT-5.2'
  },
  {
    value: 'gpt-5-nano',
    label: 'GPT-5 nano'
  },
  {
    value: 'moonshotai/kimi-k2-instruct-0905',
    label: 'Kimi K2 Instruct 0905 (Groq)'
  },
  {
    value: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash-Lite Preview'
  },
  {
    value: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview'
  },
  {
    value: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview'
  }
] as const;

export const ASSISTANT_THINKING_LEVELS = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
] as const;

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: unknown } } };

type GeminiContent = {
  role: 'user' | 'model' | 'tool';
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role?: 'model';
    };
  }>;
};

type OpenAIResponsesResponse = {
  id?: string;
  output?: Array<{
    id?: string;
    type?: string;
    name?: string;
    arguments?: string;
    call_id?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
    code?: string | number;
    type?: string;
  };
};

const PHOTO_IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    },
    cells: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['markdown', 'math']
          },
          source: { type: 'string' }
        },
        required: ['type', 'source'],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'warnings', 'cells'],
  additionalProperties: false
} as const;

type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
};

type OpenAIStreamingEvent = {
  type?: string;
  response?: OpenAIResponsesResponse;
  output_index?: number;
  delta?: string;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  item_id?: string;
  call_id?: string;
  arguments?: string;
  error?: {
    message?: string;
  };
};

type OpenAICompatibleTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type OpenAICompatibleMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type OpenAICompatibleResponse = {
  id?: string;
  choices?: Array<{
    message?: OpenAICompatibleMessage;
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    code?: string | number;
    type?: string;
  };
};

type OpenAICompatibleStreamingEvent = {
  id?: string;
  choices?: Array<{
    delta?: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
};

type ToolLoopResult = {
  notes: string;
  transcript: string[];
  inspectedCells: Array<ReturnType<typeof renderCellDetail>>;
};

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_API_ROOT = 'https://api.groq.com/openai/v1';
const MAX_TOOL_ROUNDS = 5;
const DETAIL_SOURCE_LIMIT = 700;
const DETAIL_OUTPUT_LIMIT = 240;
const GEMINI_REQUEST_TIMEOUT_MS = 45000;
const COMPACT_REFERENCE = [
  'SugarPy compact reference:',
  '- Cell types: code, markdown, math, stoich, regression.',
  '- Math cells are CAS-style, not Python-style.',
  '- In Math cells: = means equation, := means assignment, ^ is exponent, implicit multiplication works.',
  '- name := expr assigns a value or symbolic expression to a name; it does not define a callable function.',
  '- name(arg) := expr defines a callable Math-cell function.',
  '- Supported Math-cell input kinds: expression, equation, assignment, unpack assignment, function assignment.',
  '- Multiple statements per Math cell are allowed and run top-to-bottom in the same namespace.',
  '- Math cells share namespace with Code cells.',
  '- Notebook defaults include trig mode (deg/rad) and render mode (exact/decimal).',
  '- Each Math cell may override trig/render mode.',
  '- Built-in Math helpers include Eq(...), solve(...), linsolve(...), simplify(...), expand(...), factor(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...), plot(...).',
  '- Inline equations are accepted directly inside CAS calls. Preferred system-solve form: solve((eq1, eq2), (x, y)) or solve(equation1, equation2, (x, y)).',
  '- Assigned equation forms such as eq1 := a = b and eq1 := Eq(a, b) are supported, but ordered tuple/direct-argument solve(...) forms are still preferred over set literals.',
  '- For assistant-generated multi-equation solves, prefer tuple/ordered equation arguments over set literals { ... }.',
  '- If solve(...) returns structured points, unpack them with documented forms such as (h1, k1), (h2, k2) := solutions.',
  '- Math container results such as solve(...) solution lists render as LaTeX; prefer showing them directly before extra manipulation.',
  '- render_decimal(expr, places?) rounds by decimal places; render_exact(expr) forces symbolic display.',
  '- In Math cells, prefer Maple-style plot ranges: x = a..b and y = c..d.',
  '- Supported plotting options include xmin, xmax, ymin, ymax, equal_axes, showlegend, and title.',
  '- Compatibility plot range forms such as plot(circle, (x, -8, 12), (y, 20, 40), equal_axes=True) are accepted.',
  '- In a single plot(...) call, choose exactly one range style: Maple-style x = a..b / y = c..d, compatibility tuples like (x, a, b), or xmin/xmax/ymin/ymax kwargs. Do not mix them.',
  '- Use only documented SugarPy Math syntax; avoid unsupported lambda or arrow-function notation.',
  '- For teaching notebooks, prefer explicit equations, unpack assignment, and direct symbolic expressions over helper-heavy transformations.',
  '- Safe plotting defaults for geometry: prefer implicit equations or directly plottable expressions.',
  '- For circles and geometry, prefer circle := equation and then plot(circle, ..., equal_axes=True).',
  '- Equation assignments used for plotting are stored internally in = 0 form for CAS work.',
  '- Do not rely on trig parameterizations unless the user explicitly asks for them.',
  '- Trig expressions in Math cells depend on Deg/Rad mode.',
  '- If a graph is requested, generate notebook content that actually renders the graph in SugarPy.',
  '- Stoich cells are for chemistry tables, not generic math.',
  '- Prefer CAS-first outputs when the task is naturally symbolic or equation-based.'
].join('\n');
const REFERENCE_SECTIONS = {
  overview: [
    'SugarPy product overview:',
    '- Notebook app with code, markdown, math, stoich, and regression cells.',
    '- Optional AI assistant edits notebook cells through structured operations.',
    '- Run All executes code, math, stoich, and regression cells top-to-bottom.',
    '- Header defaults include Degrees/Radians and Exact/Decimal for Math cells.'
  ].join('\n'),
  math_cells: [
    'Math cell reference:',
    '- CAS-style input over SymPy.',
    '- = means equation; := means assignment.',
    '- name := expr stores a value or symbolic expression under that name.',
    '- name(arg) := expr defines a callable function.',
    '- ^ is exponent; implicit multiplication works.',
    '- Supported input kinds: expression, equation, assignment, unpack assignment, function assignment.',
    '- Unpack assignment examples: a0, b0 := solO[1] and (h1, k1), (h2, k2) := solutions.',
    '- Multiple statements per cell are allowed.',
    '- Math cells share namespace with Code cells.',
    '- Trig mode is deg or rad and affects trig evaluation.',
    '- Built-in helpers: Eq(...), solve(...), linsolve(...), simplify(...), expand(...), factor(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...).',
    '- Inline equations are accepted directly inside CAS calls. Prefer solve((equation1, equation2), (x, y)) over undocumented variants.',
    '- Assistant-safe multi-equation solve pattern: write explicit equations inline and pass an ordered tuple or direct equation arguments to solve(...).',
    '- Assigned equation forms such as eq1 := a = b and eq1 := Eq(a, b) are both supported, but ordered tuple/direct-argument solve(...) forms are preferred over set literals.',
    '- Prefer plain = equations when they are enough; Eq(...) is supported for compatibility, not the default assistant notation.',
    '- Function definitions are lazy at declaration time: f(x) := expr should be treated as a declaration, not as something to immediately execute or expand.',
    '- If both exact and decimal views are needed in one cell, wrap each line explicitly with render_exact(...) or render_decimal(...).',
    '- render_decimal(...) rounds by decimal places, not significant digits.',
    '- Container results such as solve(...) solution lists/points render as LaTeX, so showing them directly is acceptable and often clearer.',
    '- Prefer Math cells for symbolic equations, solve, expand, factor, N, and plot workflows.',
    '- Prefer direct symbolic expressions and documented solve(...) results over helper-heavy transformations.',
    '- Out of scope in Math cells: Python def blocks, lambda syntax, arrow syntax, Python loops/comprehensions, and undocumented helper functions.'
  ].join('\n'),
  plotting: [
    'Plotting reference:',
    '- plot(...) works in Code and Math cells.',
    '- In Math cells, prefer Maple-style ranges: plot(expr, x = a..b, y = c..d, ...).',
    '- Also supported: xmin/xmax/ymin/ymax kwargs, and compatibility range tuples like (x, a, b).',
    '- Supported options include xmin, xmax, ymin, ymax, equal_axes, showlegend, title.',
    '- Use one range style per plot call; do not mix Maple-style ranges, compatibility tuples, and xmin/xmax/ymin/ymax kwargs in the same plot(...).',
    '- Geometry-safe pattern: store an implicit equation assignment, then call plot(name, ...).',
    '- Example: circle := (x-2)^2 + (y+10)^2 = 25; plot(circle, x = -5..9, y = 3..17, equal_axes=True).',
    '- Equation assignments used for implicit plots are stored internally in = 0 form for CAS work.',
    '- For 1-2 traces the legend is shown by default; showlegend=True|False can override this.',
    '- title="..." is supported but should be used only when it materially helps the notebook.',
    '- Double-clicking the graph resets to the initial requested range.',
    '- Do not assume parametric plotting support from plot(x(t), y(t), t=...).',
    '- Trig-based plotting in Math cells depends on the Deg/Rad mode.',
    '- If a non-trig form exists, prefer it.'
  ].join('\n'),
  cell_types: [
    'Cell type reference:',
    '- code: Python execution.',
    '- markdown: text/notes.',
    '- math: CAS symbolic input with rendered math card.',
    '- stoich: chemistry stoichiometry table over a reaction.',
    '- regression: compact x/y data table with fitted regression graph.'
  ].join('\n'),
  assistant: [
    'Assistant behavior reference:',
    '- Return structured notebook operations only.',
    '- Prefer minimal, directly runnable edits.',
    '- Respect user preference mode: auto, cas, python, explain.',
    '- Use CAS-first when the task is naturally equation-based or symbolic.',
    '- Avoid mathematically valid but SugarPy-incompatible representations.'
  ].join('\n')
} as const;

const requestLooksLikeDirectGeometrySolve = (request: string) => {
  const normalized = request.toLowerCase();
  return (
    (normalized.includes('circle') || normalized.includes('окруж')) &&
    (normalized.includes('point') ||
      normalized.includes('точк') ||
      /\ba\(/.test(normalized) ||
      /\bb\(/.test(normalized) ||
      normalized.includes('radius') ||
      normalized.includes('радиус') ||
      normalized.includes('solve'))
  );
};

const isServerProxyKey = (apiKey: string) => apiKey.trim().startsWith(SERVER_PROXY_KEY_PREFIX);

const getServerProxyProvider = (apiKey: string): AssistantProvider | null => {
  const provider = apiKey.trim().slice(SERVER_PROXY_KEY_PREFIX.length);
  return provider === 'openai' || provider === 'gemini' || provider === 'groq' ? provider : null;
};

const readCookie = (name: string) => {
  if (typeof document === 'undefined') return '';
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
};

const buildServerProxyHeaders = () => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const xsrfToken = readCookie('_xsrf');
  if (xsrfToken) {
    headers.set('X-XSRFToken', xsrfToken);
  }
  return headers;
};

const requestLooksMathLike = (request: string) => {
  const normalized = request.toLowerCase();
  return (
    /(math|equation|equations|solve|symbolic|algebra|geometry|circle|radius|plot|intersection)\b/.test(normalized) ||
    /(матем|уравн|реши|решить|решение|окруж|радиус|график|пересеч)/.test(normalized)
  );
};

const requestExplicitlyAsksForPython = (request: string) => {
  const normalized = request.toLowerCase();
  return (
    /\bpython\b/.test(normalized) ||
    /\bsympy\b/.test(normalized) ||
    /\bcode cell\b/.test(normalized) ||
    /\bscript\b/.test(normalized) ||
    /\bprogram\b/.test(normalized) ||
    /питон|python|sympy|через python|на python|python-скрипт/.test(normalized)
  );
};

const parseDirectCircleRequest = (request: string) => {
  const pointA = request.match(/A\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  const pointB = request.match(/B\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  const radius =
    request.match(/radius\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i) ??
    request.match(/r\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i) ??
    request.match(/радиус\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);
  if (!pointA || !pointB || !radius) return null;
  const ax = Number(pointA[1]);
  const ay = Number(pointA[2]);
  const bx = Number(pointB[1]);
  const by = Number(pointB[2]);
  const r = Number(radius[1]);
  if (![ax, ay, bx, by, r].every(Number.isFinite)) return null;
  return { ax, ay, bx, by, r };
};

const buildDirectCircleSolvePlan = (request: string): AssistantPlan | null => {
  const parsed = parseDirectCircleRequest(request);
  if (!parsed) return null;
  const { ax, ay, bx, by, r } = parsed;
  const xmin = Math.floor(Math.min(ax, bx) - Math.max(10, r * 0.4));
  const xmax = Math.ceil(Math.max(ax, bx) + Math.max(10, r * 0.4));
  const ymin = Math.floor(Math.min(ay, by) - Math.max(10, r * 0.4));
  const ymax = Math.ceil(Math.max(ay, by) + Math.max(10, r * 0.4));
  return normalizePlan({
    summary: 'Use Math cells to solve the two circle-center equations and build the circle equations.',
    userMessage: 'Prepared a CAS-first Math-cell solution that defines one equation per point, solves for the centers, and builds both circle equations.',
    warnings: [],
    operations: [
      {
        type: 'insert_cell',
        index: 0,
        cellType: 'math',
        source: [
          `A := (${ax}, ${ay})`,
          `B := (${bx}, ${by})`,
          `r := ${r}`,
          '',
          `eqA := (${ax} - h)^2 + (${ay} - k)^2 = r^2`,
          `eqB := (${bx} - h)^2 + (${by} - k)^2 = r^2`,
          'solutions := solve((eqA, eqB), (h, k))',
          'solutions'
        ].join('\n'),
        reason: 'Write one circle-center equation per point and solve them directly in CAS.'
      },
      {
        type: 'insert_cell',
        index: 1,
        cellType: 'math',
        source: [
          '(h1, k1), (h2, k2) := solutions',
          'circle1 := (x - h1)^2 + (y - k1)^2 = r^2',
          'circle2 := (x - h2)^2 + (y - k2)^2 = r^2',
          `plot(circle1, circle2, x = ${xmin}..${xmax}, y = ${ymin}..${ymax}, equal_axes=True)`
        ].join('\n'),
        reason: 'Build both circle equations from the solved centers and plot them.'
      }
    ]
  });
};

const toJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  const rawType = typeof schema.type === 'string' ? schema.type.toLowerCase() : schema.type;
  if (rawType === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, toJsonSchema(value)])
    );
    return {
      type: 'object',
      properties,
      required: Array.isArray(schema.required) ? schema.required : [],
      additionalProperties: false
    };
  }
  if (rawType === 'array') {
    return {
      type: 'array',
      items: toJsonSchema(schema.items ?? {})
    };
  }
  return {
    ...schema,
    type: rawType
  };
};

const TOOL_DECLARATIONS = [
  {
    name: 'get_notebook_summary',
    description: 'Return a concise summary of the current notebook, defaults, and cell ordering.',
    parameters: {
      type: 'OBJECT',
      properties: {
        scope: {
          type: 'STRING',
          enum: ['notebook', 'active']
        }
      },
      required: ['scope']
    }
  },
  {
    name: 'list_cells',
    description: 'List notebook cells with ids, types, short previews, and error flags.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_active_cell',
    description: 'Return the currently active cell, if any.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'get_cell',
    description: 'Return the full content of a cell by id.',
    parameters: {
      type: 'OBJECT',
      properties: {
        cellId: { type: 'STRING' }
      },
      required: ['cellId']
    }
  },
  {
    name: 'get_recent_errors',
    description: 'Return cells with visible error output.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'search_cells',
    description:
      'Search notebook cells by source text or useful category. Use this instead of requesting the full notebook when you need targeted context.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' },
        category: {
          type: 'STRING',
          enum: ['all', 'errors', 'solve-plot', 'helpers', 'markdown']
        }
      },
      required: ['query', 'category']
    }
  },
  {
    name: 'get_reference',
    description: 'Return built-in SugarPy documentation for a specific topic.',
    parameters: {
      type: 'OBJECT',
      properties: {
        section: {
          type: 'STRING',
          enum: ['overview', 'math_cells', 'plotting', 'cell_types', 'assistant']
        }
      },
      required: ['section']
    }
  }
] as const;

const OPENAI_TOOL_DECLARATIONS = TOOL_DECLARATIONS.map((tool) => ({
  type: 'function' as const,
  name: tool.name,
  description: tool.description,
  parameters: toJsonSchema(tool.parameters),
  strict: true
}));

const SANDBOX_TOOL_DECLARATION = {
  name: 'run_code_in_sandbox',
  description:
    'Run code or Math-cell content in an isolated temporary kernel for self-checking. This never mutates the live notebook.',
  parameters: {
    type: 'OBJECT',
    properties: {
      target: {
        type: 'STRING',
        enum: ['code', 'math']
      },
      code: { type: 'STRING' },
      source: { type: 'STRING' },
      trigMode: {
        type: 'STRING',
        enum: ['deg', 'rad']
      },
      renderMode: {
        type: 'STRING',
        enum: ['exact', 'decimal']
      },
      contextPreset: {
        type: 'STRING',
        enum: ['none', 'bootstrap-only', 'imports-only', 'selected-cells', 'full-notebook-replay']
      },
      selectedCellIds: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      timeoutMs: { type: 'NUMBER' }
    },
    required: ['target', 'code', 'source', 'trigMode', 'renderMode', 'contextPreset', 'selectedCellIds', 'timeoutMs']
  }
} as const;

const OPENAI_SANDBOX_TOOL_DECLARATION = {
  type: 'function' as const,
  name: SANDBOX_TOOL_DECLARATION.name,
  description: SANDBOX_TOOL_DECLARATION.description,
  parameters: toJsonSchema(SANDBOX_TOOL_DECLARATION.parameters),
  strict: true
};

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    userMessage: { type: 'STRING' },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    operations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: {
            type: 'STRING',
            enum: ['insert_cell', 'update_cell', 'delete_cell', 'move_cell', 'set_notebook_defaults']
          },
          index: { type: 'NUMBER' },
          cellType: {
            type: 'STRING',
            enum: ['code', 'markdown', 'math', 'stoich', 'regression']
          },
          source: { type: 'STRING' },
          cellId: { type: 'STRING' },
          trigMode: {
            type: 'STRING',
            enum: ['deg', 'rad']
          },
          renderMode: {
            type: 'STRING',
            enum: ['exact', 'decimal']
          },
          reason: { type: 'STRING' }
        },
        required: ['type']
      }
    }
  },
  required: ['summary', 'userMessage', 'warnings', 'operations']
} as const;

const OPENAI_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    userMessage: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['insert_cell', 'update_cell', 'delete_cell', 'move_cell', 'set_notebook_defaults']
          },
          index: {
            type: ['number', 'null']
          },
          cellType: {
            type: ['string', 'null'],
            enum: ['code', 'markdown', 'math', 'stoich', 'regression', null]
          },
          source: {
            type: ['string', 'null']
          },
          cellId: {
            type: ['string', 'null']
          },
          trigMode: {
            type: ['string', 'null'],
            enum: ['deg', 'rad', null]
          },
          renderMode: {
            type: ['string', 'null'],
            enum: ['exact', 'decimal', null]
          },
          reason: {
            type: ['string', 'null']
          }
        },
        required: ['type', 'index', 'cellType', 'source', 'cellId', 'trigMode', 'renderMode', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'userMessage', 'warnings', 'operations'],
  additionalProperties: false
} as const;

const SUBMIT_PLAN_TOOL_DECLARATION = {
  name: 'submit_plan',
  description: 'Submit the final SugarPy notebook change set.',
  parameters: OPENAI_PLAN_SCHEMA
} as const;

const OPENAI_SUBMIT_PLAN_TOOL_DECLARATION = {
  type: 'function' as const,
  name: SUBMIT_PLAN_TOOL_DECLARATION.name,
  description: SUBMIT_PLAN_TOOL_DECLARATION.description,
  parameters: SUBMIT_PLAN_TOOL_DECLARATION.parameters,
  strict: true
};

const PLAN_METADATA_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    userMessage: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary', 'userMessage', 'warnings'],
  additionalProperties: false
} as const;

const PLAN_OPERATION_SCHEMA = OPENAI_PLAN_SCHEMA.properties.operations.items;

const PLAN_METADATA_TOOL_DECLARATION = {
  name: 'set_plan_metadata',
  description: 'Set the plan summary, user-facing message, and warning list before adding operations.',
  parameters: PLAN_METADATA_SCHEMA
} as const;

const OPENAI_PLAN_METADATA_TOOL_DECLARATION = {
  type: 'function' as const,
  name: PLAN_METADATA_TOOL_DECLARATION.name,
  description: PLAN_METADATA_TOOL_DECLARATION.description,
  parameters: PLAN_METADATA_TOOL_DECLARATION.parameters,
  strict: true
};

const PLAN_OPERATION_TOOL_DECLARATION = {
  name: 'add_plan_operation',
  description: 'Append one notebook operation to the plan. Call this once per operation.',
  parameters: PLAN_OPERATION_SCHEMA
} as const;

const OPENAI_PLAN_OPERATION_TOOL_DECLARATION = {
  type: 'function' as const,
  name: PLAN_OPERATION_TOOL_DECLARATION.name,
  description: PLAN_OPERATION_TOOL_DECLARATION.description,
  parameters: PLAN_OPERATION_TOOL_DECLARATION.parameters,
  strict: true
};

const FINALIZE_PLAN_TOOL_DECLARATION = {
  name: 'finalize_plan',
  description: 'Finish plan generation after metadata and operations have been sent.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  }
} as const;

const OPENAI_FINALIZE_PLAN_TOOL_DECLARATION = {
  type: 'function' as const,
  name: FINALIZE_PLAN_TOOL_DECLARATION.name,
  description: FINALIZE_PLAN_TOOL_DECLARATION.description,
  parameters: FINALIZE_PLAN_TOOL_DECLARATION.parameters,
  strict: true
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const MAX_VALIDATION_ROUNDS = 4;
const MAX_PLANNING_ROUNDS = 16;
const SANDBOX_PREVIEW_LIMIT = 240;
const OPENAI_DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const OPENAI_PLANNING_REQUEST_TIMEOUT_MS = 90000;

const createInactivityTimeout = (timeoutMs: number, onTimeout: () => void) => {
  let timeoutId: number | null = null;
  const clear = () => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  const touch = () => {
    clear();
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      onTimeout();
    }, timeoutMs);
  };
  return { touch, clear };
};

const stripCodeFence = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

const tryParsePlanText = (raw: string): AssistantPlan | null => {
  const cleaned = stripCodeFence(raw || '');
  if (!cleaned) return null;
  try {
    return normalizePlan(JSON.parse(cleaned));
  } catch (_error) {
    return null;
  }
};

const previewText = (value: string, limit = 160) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1)}…`;
};

const truncateText = (value: string, limit: number) => {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
};

const planHasPythonCodeOperations = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) =>
      (operation.type === 'insert_cell' && operation.cellType === 'code' && operation.source.trim()) ||
      (operation.type === 'update_cell' && operation.source.trim())
  );

const planHasRunnableValidationOperations = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) =>
      (operation.type === 'insert_cell' &&
        (operation.cellType === 'code' || operation.cellType === 'math') &&
        operation.source.trim()) ||
      (operation.type === 'update_cell' && operation.source.trim())
  );

const planUsesSolveInMathCells = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) =>
      operation.type === 'insert_cell' &&
      operation.cellType === 'math' &&
      /\bsolve\s*\(/.test(operation.source)
  );

const getUnsupportedMathPatterns = (source: string) => {
  const patterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /->/g, label: 'arrow syntax (->)' },
    { pattern: /\bmap\s*\(/g, label: 'map(...) helper' },
    { pattern: /\blambda\b/g, label: 'lambda syntax' },
    { pattern: /\bfor\b.+\bin\b/g, label: 'Python-style loop syntax' },
    { pattern: /\bdef\b/g, label: 'Python def block' }
  ];
  return patterns.filter(({ pattern }) => pattern.test(source)).map(({ label }) => label);
};

const MATH_ASSISTANT_SPEC = [
  'Math-cell assistant spec:',
  '- Use only documented SugarPy Math syntax.',
  '- Supported statement types: expression, equation, assignment, unpack assignment, function assignment.',
  '- Use = for equations and := for assignment.',
  '- Preferred helpers: Eq(...), solve(...), linsolve(...), simplify(...), expand(...), factor(...), subs(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...), plot(...).',
  '- Multiple statements per Math cell are allowed and run top-to-bottom.',
  '- For teaching notebooks, prefer explicit equations, unpack assignment, direct arithmetic, and direct symbolic expressions.',
  '- Inline equations are accepted inside CAS calls; for systems, prefer solve((equation1, equation2), (x, y)) or another documented ordered form.',
  '- Assigned equation forms such as eq1 := a = b and eq1 := Eq(a, b) are supported, but ordered tuple/direct-argument solve(...) forms are preferred over set literals.',
  '- If solve(...) returns structured points, unpack them with documented assignment forms such as (h1, k1), (h2, k2) := solutions.',
  '- For one-variable solve(...) results, avoid guessing container indexes; instead show the solve result directly and verify with explicit symbolic expressions.',
  '- Prefer plain = equation syntax over Eq(...) unless Eq(...) is specifically needed for a documented helper pattern.',
  '- If both exact and decimal displays are needed in one cell, wrap lines explicitly with render_exact(...) or render_decimal(...).',
  '- render_decimal(...) rounds by decimal places, not significant digits.',
  '- Math container results render readably; it is fine to show solutions directly before unpacking or plotting.',
  '- subs(...) is supported for post-processing symbolic results, but prefer simpler direct symbolic expressions or direct solve(...) output when they are clearer.',
  '- Forbidden: ->, lambda, map(...), Python comprehensions, Python loops, def blocks, and undocumented helper functions.',
  '- If plotting is needed, prefer implicit equations or directly plottable expressions with Maple-style ranges x = a..b and y = c..d.',
  '- Supported plot options include equal_axes, showlegend, title, xmin/xmax/ymin/ymax, and compatibility range tuple forms.',
  '- In one plot(...) call, use one range convention only; do not combine tuple ranges with xmin/xmax/ymin/ymax kwargs.',
].join('\n');

const planHasUnsupportedMathSyntax = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) =>
      operation.type === 'insert_cell' &&
      operation.cellType === 'math' &&
      getUnsupportedMathPatterns(operation.source).length > 0
  );

const collectUnsupportedMathWarnings = (plan: AssistantPlan) =>
  plan.operations.flatMap((operation) => {
    if (operation.type !== 'insert_cell' || operation.cellType !== 'math') return [];
    const unsupported = getUnsupportedMathPatterns(operation.source);
    if (unsupported.length === 0) return [];
    return [`Unsupported Math-cell syntax detected: ${unsupported.join(', ')}.`];
  });

const planHasRiskySolveIndexing = (plan: AssistantPlan) => {
  const hasSingleVariableSolve = plan.operations.some(
    (operation) =>
      operation.type === 'insert_cell' &&
      operation.cellType === 'math' &&
      /\bsolve\s*\([^,\n]+,\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(operation.source)
  );
  if (!hasSingleVariableSolve) return false;
  return plan.operations.some(
    (operation) =>
      operation.type === 'insert_cell' &&
      operation.cellType === 'math' &&
      /\bsolutions\s*\[\s*\d+\s*\]/.test(operation.source)
  );
};

export const normalizeSandboxRequest = (args: Record<string, unknown>): AssistantSandboxRequest => {
  const target = args.target === 'math' ? 'math' : 'code';
  const code = String(args.code ?? '');
  const source =
    target === 'math'
      ? String(args.code ?? args.source ?? '')
      : String(args.source ?? '');
  return {
    target,
    code,
    source,
    trigMode: args.trigMode === 'rad' ? 'rad' : 'deg',
    renderMode: args.renderMode === 'decimal' ? 'decimal' : 'exact',
    contextPreset: (
      typeof args.contextPreset === 'string' ? args.contextPreset : 'bootstrap-only'
    ) as AssistantSandboxContextPreset,
    selectedCellIds: Array.isArray(args.selectedCellIds) ? args.selectedCellIds.map((value) => String(value)) : [],
    timeoutMs:
      typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) ? Math.round(args.timeoutMs) : 5000
  };
};

const summarizeSandboxExecution = (
  request: AssistantSandboxRequest,
  result: AssistantSandboxResult
): AssistantSandboxExecutionTrace => ({
  request: {
    target: request.target === 'math' ? 'math' : 'code',
    contextPreset: request.contextPreset ?? 'bootstrap-only',
    timeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : 5000,
    selectedCellIds: Array.isArray(request.selectedCellIds) ? request.selectedCellIds : [],
    sourcePreview: truncateText((request.target === 'math' ? request.source : request.code) ?? '', SANDBOX_PREVIEW_LIMIT)
  },
  result: {
    status: result.status,
    durationMs: result.durationMs,
    errorName: result.errorName,
    errorValue: truncateText(result.errorValue ?? '', SANDBOX_PREVIEW_LIMIT),
    stdoutPreview: truncateText(result.stdout ?? '', SANDBOX_PREVIEW_LIMIT),
    stderrPreview: truncateText(result.stderr ?? '', SANDBOX_PREVIEW_LIMIT),
    selectedCellIds: result.selectedCellIds ?? [],
    replayedCellIds: result.replayedCellIds,
    contextSourcesUsed: result.contextSourcesUsed ?? [],
    attemptCount: result.attempts?.length ?? 0,
    mathError: result.mathValidation?.error
  }
});

const extractSubmittedPlan = (response: OpenAIResponsesResponse): AssistantPlan | null => {
  const submitCall = parseOpenAIToolCalls(response).find((toolCall) => toolCall.name === 'submit_plan');
  if (!submitCall) return null;
  return normalizePlan(submitCall.args);
};

const buildPlanFromParts = (metadata: {
  summary: string;
  userMessage: string;
  warnings: string[];
} | null, operations: AssistantOperation[]): AssistantPlan | null => {
  if (!metadata) return null;
  return normalizePlan({
    summary: metadata.summary,
    userMessage: metadata.userMessage,
    warnings: metadata.warnings,
    operations
  });
};

const isRunnableOperation = (operation: AssistantOperation) =>
  (operation.type === 'insert_cell' && operation.cellType !== 'markdown') ||
  operation.type === 'update_cell';

const describeStepOperation = (operation: AssistantOperation) => {
  if (operation.reason?.trim()) return operation.reason.trim();
  if (operation.type === 'insert_cell') {
    const preview = previewText(operation.source, 80);
    return `Add ${operation.cellType} cell${preview ? `: ${preview}` : ''}`;
  }
  if (operation.type === 'update_cell') {
    const preview = previewText(operation.source, 80);
    return `Update cell${preview ? `: ${preview}` : ''}`;
  }
  if (operation.type === 'set_notebook_defaults') return 'Update notebook defaults';
  if (operation.type === 'move_cell') return 'Reorder a cell';
  return 'Delete a cell';
};

const buildPlanSteps = (operations: AssistantOperation[]) => {
  const steps: AssistantPlan['steps'] = [];
  let current: AssistantOperation[] = [];
  let currentWarnings: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const summary = describeStepOperation(current.find(isRunnableOperation) ?? current[0]);
    steps.push({
      id: `assistant-step-${steps.length + 1}`,
      title: `Step ${steps.length + 1}`,
      summary,
      operations: current,
      warnings: currentWarnings
    });
    current = [];
    currentWarnings = [];
  };

  operations.forEach((operation) => {
    const currentHasRunnable = current.some(isRunnableOperation);
    if (operation.type === 'set_notebook_defaults') {
      flush();
      current = [operation];
      flush();
      return;
    }
    if (operation.type === 'insert_cell' && operation.cellType === 'markdown') {
      if (currentHasRunnable) flush();
      current.push(operation);
      return;
    }
    if (currentHasRunnable) flush();
    current.push(operation);
    if (isRunnableOperation(operation)) {
      flush();
    }
  });
  flush();
  return steps;
};

const findTopLevelEquationBreaks = (line: string) => {
  const positions: number[] = [];
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char !== '=' || depth !== 0) continue;
    const prev = line[index - 1] || '';
    const next = line[index + 1] || '';
    if (prev === ':' || prev === '<' || prev === '>' || prev === '!' || next === '=') continue;
    positions.push(index);
  }
  return positions;
};

const sanitizeAssistantMathIdentifier = (value: string) =>
  value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .replace(/^[0-9]/, 'v_$&')
    .toLowerCase();

const buildAssistantIndexedName = (name: string, index: number) => `${sanitizeAssistantMathIdentifier(name)}_${index}`;

const normalizeAssistantMathRhs = (value: string) =>
  value
    .replace(/Δ([A-Za-z_][A-Za-z0-9_]*)/g, 'delta_$1')
    .replace(/\b([A-Za-z])([A-Za-z])\b/g, (match, left: string, right: string) => {
      const token = `${left}${right}`.toLowerCase();
      return token === 'eq' || token === 'pi' ? match : `${left}*${right}`;
    })
    .replace(/(?<![A-Za-z0-9_])(\d|\))(?=[A-Za-z_(])/g, '$1*')
    .replace(/(\d|\))\s+(sqrt\s*\()/g, '$1*$2')
    .replace(/(?<![A-Za-z0-9_])(\d|\))\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*\()?)/g, '$1*$2');

const extractAssistantMathLhs = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return '';
  const assignIndex = trimmed.indexOf(':=');
  if (assignIndex >= 0) return trimmed.slice(0, assignIndex).trim();
  const breaks = findTopLevelEquationBreaks(trimmed);
  if (breaks.length === 0) return '';
  return trimmed.slice(0, breaks[0]).trim();
};

const splitPlusMinusExpression = (expression: string) => {
  const index = expression.indexOf('±');
  if (index < 0) return null;
  return {
    minus: `${expression.slice(0, index)}-${expression.slice(index + 1)}`.replace(/\s+/g, ' ').trim(),
    plus: `${expression.slice(0, index)}+${expression.slice(index + 1)}`.replace(/\s+/g, ' ').trim()
  };
};

const resolveAssistantIndexedPlusMinus = (expression: string, lhs: string) => {
  if (!expression.includes('±')) return expression;
  const suffix = lhs.match(/_(\d+)$/)?.[1];
  if (suffix === '1') return expression.replace(/±/g, '-');
  if (suffix === '2') return expression.replace(/±/g, '+');
  return expression;
};

const rewriteAssistantProseLine = (line: string) => {
  const exampleMatch = line.match(/^\s*(?:For\s+eks\.?|For\s+example)\s*:\s*(.+)$/i);
  if (exampleMatch) {
    return [normalizeAssistantMathRhs((exampleMatch[1] || '').trim().replace(/\.$/, ''))];
  }

  const centerRadiusMatch = line.match(
    /^\s*(?:Vi\s+ser(?:\s+på\s+tegning)?\s+at\s+)?[Cc]entrum(?:\s+er)?\s*(\([^)]+\)).*?\b(?:og|and)\b.*?\bradius(?:\s+er)?\s*([A-Za-z0-9_()./+*\- ]+)\.?\s*$/i
  );
  if (centerRadiusMatch) {
    return [`center := ${centerRadiusMatch[1]}`, `radius := ${normalizeAssistantMathRhs((centerRadiusMatch[2] || '').trim())}`];
  }

  const pointPairMatch = line.match(
    /^\s*Punkterne.*?(\([^)]+\)).*?(?:og|and)\s*(\([^)]+\))\s*\.?\s*$/i
  );
  if (pointPairMatch) {
    return [`p_1 := ${pointPairMatch[1]}`, `p_2 := ${pointPairMatch[2]}`];
  }

  const intersectionMatch = line.match(/^\s*Skæringspunkt(?:et)?(?:\s+er(?:\s+\w+)?)?\s*(\([^)]+\))\s*\.?\s*$/i);
  if (intersectionMatch) {
    return [`intersection := ${intersectionMatch[1]}`];
  }

  const centerOnlyMatch = line.match(/^\s*Centrum(?:\s+er)?\s*(\([^)]+\))\s*\.?\s*$/i);
  if (centerOnlyMatch) {
    return [`center := ${centerOnlyMatch[1]}`];
  }

  const radiusOnlyMatch = line.match(/^\s*Radius(?:\s+er)?\s*([A-Za-z0-9_()./+*\- ]+)\.?\s*$/i);
  if (radiusOnlyMatch) {
    return [`radius := ${normalizeAssistantMathRhs((radiusOnlyMatch[1] || '').trim())}`];
  }

  const proseKeywordIndex = line.search(/\b(?:være|where|with|som)\b/i);
  if (proseKeywordIndex > 0) {
    const prefix = line.slice(0, proseKeywordIndex).trim();
    if (/[=:]/.test(prefix)) {
      return [normalizeAssistantMathRhs(prefix)];
    }
  }

  if (line.startsWith('#')) return [];
  if (!/[=:()^]/.test(line) && /[A-Za-zÆØÅæøå]/.test(line)) return [];
  return null;
};

export const normalizeAssistantMathSource = (source: string) => {
  const normAssignments = new Map<string, string>();
  let previousLhs = '';
  let bareTupleIndex = 0;
  let expectRadiusAfterCenter = false;
  const normalizedLines = source.split('\n').flatMap((rawLine) => {
    const line = rawLine.trim().replace(/\.$/, '');
    const indent = rawLine.match(/^\s*/)?.[0] ?? '';
    if (!line) {
      previousLhs = '';
      bareTupleIndex = 0;
      expectRadiusAfterCenter = false;
      return [rawLine];
    }

    const proseRewrite = rewriteAssistantProseLine(line);
    if (proseRewrite) {
      const cleaned = proseRewrite
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => `${indent}${entry}`);
      if (cleaned.some((entry) => entry.includes('center :='))) {
        expectRadiusAfterCenter = true;
      } else if (cleaned.length > 0) {
        expectRadiusAfterCenter = false;
      }
      if (cleaned.length > 0) {
        previousLhs = extractAssistantMathLhs(cleaned[cleaned.length - 1] || '');
      }
      return cleaned;
    }

    if (line.startsWith('=') && previousLhs) {
      const rhs = normalizeAssistantMathRhs(line.slice(1).trim());
      expectRadiusAfterCenter = false;
      return [`${indent}${previousLhs} = ${rhs}`];
    }

    const normMatch = rawLine.match(/^\s*\|([^|]+)\|\s*=\s*(.+)$/);
    if (normMatch) {
      const normLabel = sanitizeAssistantMathIdentifier(normMatch[1] || 'distance');
      const seenBefore = normAssignments.has(normLabel);
      const variableName = normAssignments.get(normLabel) || `distance_${normLabel}`;
      normAssignments.set(normLabel, variableName);
      previousLhs = variableName;
      const rhs = normalizeAssistantMathRhs((normMatch[2] || '').trim());
      const operator = seenBefore ? '=' : ':=';
      expectRadiusAfterCenter = false;
      return [`${indent}${variableName} ${operator} ${rhs}`];
    }

    const explicitAlternativeMatch = rawLine.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s+[vV]\s+\1\s*=\s*(.+)$/
    );
    if (explicitAlternativeMatch) {
      const variableName = sanitizeAssistantMathIdentifier(explicitAlternativeMatch[1] || 'value');
      const first = normalizeAssistantMathRhs((explicitAlternativeMatch[2] || '').trim());
      const second = normalizeAssistantMathRhs((explicitAlternativeMatch[3] || '').trim());
      previousLhs = buildAssistantIndexedName(variableName, 2);
      expectRadiusAfterCenter = false;
      return [
        `${indent}${buildAssistantIndexedName(variableName, 1)} := ${first}`,
        `${indent}${buildAssistantIndexedName(variableName, 2)} := ${second}`
      ];
    }

    const trailingAlternativeMatch = rawLine.match(/^\s*\(([^)]+)\)\s+[vV]\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (trailingAlternativeMatch) {
      const variableName = sanitizeAssistantMathIdentifier(trailingAlternativeMatch[2] || 'value');
      const first = normalizeAssistantMathRhs((trailingAlternativeMatch[1] || '').trim());
      const second = normalizeAssistantMathRhs((trailingAlternativeMatch[3] || '').trim());
      previousLhs = buildAssistantIndexedName(variableName, 2);
      expectRadiusAfterCenter = false;
      return [
        `${indent}${buildAssistantIndexedName(variableName, 1)} := ${first}`,
        `${indent}${buildAssistantIndexedName(variableName, 2)} := ${second}`
      ];
    }

    const solveAssignmentMatch = rawLine.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(solve\((.+),\s*\1\s*\))\s*$/i
    );
    if (solveAssignmentMatch) {
      const variableName = sanitizeAssistantMathIdentifier(solveAssignmentMatch[1] || 'value');
      previousLhs = buildAssistantIndexedName(variableName, 2);
      expectRadiusAfterCenter = false;
      return [
        `${indent}${buildAssistantIndexedName(variableName, 1)}, ${buildAssistantIndexedName(variableName, 2)} := ${normalizeAssistantMathRhs(
          solveAssignmentMatch[2] || ''
        )}`
      ];
    }

    const plusMinusMatch = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (plusMinusMatch) {
      const split = splitPlusMinusExpression(plusMinusMatch[2] || '');
      if (split) {
        const variableName = sanitizeAssistantMathIdentifier(plusMinusMatch[1] || 'value');
        previousLhs = buildAssistantIndexedName(variableName, 2);
        expectRadiusAfterCenter = false;
        return [
          `${indent}${buildAssistantIndexedName(variableName, 1)} := ${normalizeAssistantMathRhs(split.minus)}`,
          `${indent}${buildAssistantIndexedName(variableName, 2)} := ${normalizeAssistantMathRhs(split.plus)}`
        ];
      }
    }

    if (line.includes(':=')) {
      const assignIndex = line.indexOf(':=');
      const lhs = line.slice(0, assignIndex).trim();
      const rhs = line.slice(assignIndex + 2).trim();
      const breaks = findTopLevelEquationBreaks(rhs);
      if (breaks.length > 1) {
        const segments = rhs.split('=').map((part) => part.trim()).filter(Boolean);
        if (segments.length > 0) {
          const resolvedSegments = segments.map((segment) =>
            normalizeAssistantMathRhs(resolveAssistantIndexedPlusMinus(segment, lhs))
          );
          previousLhs = lhs;
          expectRadiusAfterCenter = false;
          return [
            `${indent}${lhs} := ${resolvedSegments[0]}`,
            ...resolvedSegments.slice(1).map((segment) => `${indent}${lhs} = ${segment}`)
          ];
        }
      }
      const normalized = `${indent}${lhs} := ${normalizeAssistantMathRhs(resolveAssistantIndexedPlusMinus(rhs, lhs))}`;
      previousLhs = extractAssistantMathLhs(normalized);
      expectRadiusAfterCenter = false;
      return [normalized];
    }

    if (/^\([^)]+\)$/.test(line)) {
      if (expectRadiusAfterCenter) {
        previousLhs = 'center';
        expectRadiusAfterCenter = true;
        return [`${indent}center := ${line}`];
      }
      bareTupleIndex += 1;
      previousLhs = `p_${bareTupleIndex}`;
      expectRadiusAfterCenter = false;
      return [`${indent}p_${bareTupleIndex} := ${line}`];
    }

    if (expectRadiusAfterCenter && /^[0-9.+\-/*\s]+$/.test(line)) {
      previousLhs = 'radius';
      expectRadiusAfterCenter = false;
      return [`${indent}radius := ${normalizeAssistantMathRhs(line)}`];
    }

    const breaks = findTopLevelEquationBreaks(rawLine);
    if (breaks.length <= 1) {
      const normalized = `${indent}${normalizeAssistantMathRhs(line)}`;
      previousLhs = extractAssistantMathLhs(normalized);
      expectRadiusAfterCenter = false;
      return [normalized];
    }

    const segments = rawLine.split('=').map((part) => part.trim()).filter(Boolean);
    if (segments.length <= 2) {
      const normalized = `${indent}${normalizeAssistantMathRhs(line)}`;
      previousLhs = extractAssistantMathLhs(normalized);
      expectRadiusAfterCenter = false;
      return [normalized];
    }

    const splitLines: string[] = [];
    for (let index = 0; index < segments.length - 1; index += 1) {
      splitLines.push(`${indent}${normalizeAssistantMathRhs(segments[index])} = ${normalizeAssistantMathRhs(segments[index + 1])}`);
    }
    previousLhs = extractAssistantMathLhs(splitLines[splitLines.length - 1] || '');
    expectRadiusAfterCenter = false;
    return splitLines;
  });

  return normalizedLines.join('\n');
};

const ASSISTANT_MATH_ALLOWED_WORDS = new Set([
  'a',
  'b',
  'c',
  'd',
  'x',
  'y',
  'l',
  'r',
  'D',
  'L',
  'sqrt',
  'solve',
  'Eq',
  'N',
  'render_decimal',
  'render_exact',
  'set_decimal_places',
  'center',
  'radius',
  'intersection',
  'point',
  'distance',
  'distance_p1p2'
]);

const ASSISTANT_PHOTO_IMPORT_PREFERRED_IDENTIFIERS = [
  /^a$/i,
  /^b$/i,
  /^c$/i,
  /^d$/i,
  /^x$/i,
  /^y$/i,
  /^r$/i,
  /^l$/i,
  /^eq\d*$/i,
  /^line\d*$/i,
  /^slope\d*$/i,
  /^circle\d*$/i,
  /^center\d*$/i,
  /^radius\d*$/i,
  /^intersection\d*$/i,
  /^distance(?:_[a-z0-9]+)*$/i,
  /^point\d*$/i,
  /^solution(?:s)?\d*$/i,
  /^result\d*$/i,
  /^answer\d*$/i,
  /^x_?\d+$/i,
  /^y_?\d+$/i,
  /^p_?\d+$/i
] as const;

const lineHasAssistantMathProse = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const words = trimmed.match(/[A-Za-zÆØÅæøå_]+/g) ?? [];
  if (words.length === 0) return false;
  const suspiciousWords = words.filter((word) => {
    if (ASSISTANT_MATH_ALLOWED_WORDS.has(word)) return false;
    if (/^[A-Za-z]_\d+$/.test(word)) return false;
    if (/^[A-Za-z]$/.test(word)) return false;
    if (/^[a-z]+_[a-z0-9_]+$/i.test(word)) return false;
    return word.length > 1;
  });
  return suspiciousWords.length >= 2 || /:\s*$/.test(trimmed);
};

const extractAssistantMathAssignedIdentifiers = (source: string) =>
  source
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      if (!line.includes(':=')) return [];
      const lhs = line.slice(0, line.indexOf(':=')).trim();
      return lhs
        .split(',')
        .map((part) => part.trim().replace(/^\(|\)$/g, ''))
        .filter(Boolean);
    });

export const collectAssistantPhotoImportSuspiciousIdentifiers = (source: string) =>
  Array.from(
    new Set(
      extractAssistantMathAssignedIdentifiers(source).filter((identifier) => {
        if (!identifier) return false;
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return true;
        if (ASSISTANT_PHOTO_IMPORT_PREFERRED_IDENTIFIERS.some((pattern) => pattern.test(identifier))) return false;
        if (/[^A-Za-z0-9_]/.test(identifier)) return true;
        if (identifier.length > 20) return true;
        if ((identifier.match(/_/g) || []).length >= 3 && !identifier.startsWith('distance_')) return true;
        if (!/^[\x00-\x7F]+$/.test(identifier)) return true;
        return /^[A-Za-z]+(?:_[A-Za-z]+)+$/.test(identifier);
      })
    )
  );

export const getAssistantPhotoImportMarkdownIssue = (source: string) => {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headingLines = lines.filter((line) => line.startsWith('#'));
  const noteLines = lines.filter((line) => !line.startsWith('#'));
  if (headingLines.length === 0) return 'Markdown cell should include a short heading for the imported problem.';
  if (noteLines.length === 0) return 'Markdown cell should include one short idea sentence under the heading.';
  const noteText = noteLines.join(' ').trim();
  const sentenceCount = noteText.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  if (sentenceCount > 2) return 'Markdown idea note should stay at one or two short sentences.';
  if (noteText.length > 180) return 'Markdown idea note is too long; keep it brief and paper-style.';
  return null;
};

const getPlanDiagnostics = (plan: AssistantPlan) =>
  ((plan as AssistantPlan & { [ASSISTANT_PLAN_DIAGNOSTICS]?: AssistantMathNormalizationDiagnostic[] })[
    ASSISTANT_PLAN_DIAGNOSTICS
  ] ?? []) as AssistantMathNormalizationDiagnostic[];

export const collectPhotoImportStructureDiagnostics = (plan: AssistantPlan): AssistantMathNormalizationDiagnostic[] => {
  const diagnostics: AssistantMathNormalizationDiagnostic[] = [];
  const insertOperations = plan.operations.filter((operation) => operation.type === 'insert_cell');
  const markdownOps = insertOperations.filter(
    (operation): operation is Extract<AssistantOperation, { type: 'insert_cell' }> =>
      operation.type === 'insert_cell' && operation.cellType === 'markdown'
  );
  const mathOps = insertOperations.filter(
    (operation): operation is Extract<AssistantOperation, { type: 'insert_cell' }> =>
      operation.type === 'insert_cell' && operation.cellType === 'math'
  );

  if (mathOps.length === 0) {
    diagnostics.push({
      operationIndex: -1,
      originalSource: '',
      normalizedSource: '',
      reason: 'Photo-import plan must include Math cells for the actual CAS derivation, not only Markdown notes.'
    });
  }

  markdownOps.forEach((operation, index) => {
    const bulletLines = operation.source.split('\n').filter((line) => line.trim().startsWith('- '));
    const codeLikeLines = operation.source.split('\n').filter((line) => /`.+`/.test(line) || /:=|=\s*.+/.test(line));
    if (bulletLines.length >= 4 || codeLikeLines.length >= 4 || operation.source.length > 320) {
      diagnostics.push({
        operationIndex: index,
        originalSource: operation.source,
        normalizedSource: operation.source,
        reason: 'Markdown cell is carrying too much derivation detail; keep the idea short and move the actual math into a Math cell.'
      });
    }
  });

  return diagnostics;
};

const summarizeCell = (cell: NotebookCellSnapshot) => ({
  id: cell.id,
  type: cell.type,
  preview: previewText(cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source),
  hasOutput: !!cell.hasOutput,
  hasError: !!cell.hasError,
  outputPreview: cell.outputPreview ? previewText(cell.outputPreview, 100) : ''
});

const renderCellDetail = (cell: NotebookCellSnapshot | null) => {
  if (!cell) return null;
  return {
    id: cell.id,
    type: cell.type,
    source: truncateText(cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source, DETAIL_SOURCE_LIMIT),
    mathRenderMode: cell.mathRenderMode,
    mathTrigMode: cell.mathTrigMode,
    hasOutput: !!cell.hasOutput,
    outputPreview: truncateText(cell.outputPreview || '', DETAIL_OUTPUT_LIMIT),
    hasError: !!cell.hasError
  };
};

const matchesCellSearchCategory = (
  cell: NotebookCellSnapshot,
  category: 'all' | 'errors' | 'solve-plot' | 'helpers' | 'markdown'
) => {
  const source = `${cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source}\n${cell.outputPreview || ''}`.toLowerCase();
  switch (category) {
    case 'errors':
      return !!cell.hasError;
    case 'solve-plot':
      return /\bsolve\s*\(|\bplot\s*\(/.test(source);
    case 'helpers':
      return cell.type === 'code' && (/^\s*(import|from)\b/m.test(source) || /\bdef\s+[A-Za-z_]/.test(source));
    case 'markdown':
      return cell.type === 'markdown';
    default:
      return true;
  }
};

const searchNotebookCells = (
  cells: NotebookCellSnapshot[],
  query: string,
  category: 'all' | 'errors' | 'solve-plot' | 'helpers' | 'markdown'
) => {
  const needle = query.trim().toLowerCase();
  return cells
    .filter((cell) => matchesCellSearchCategory(cell, category))
    .filter((cell) => {
      if (!needle) return true;
      const haystack = `${cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source}\n${cell.outputPreview || ''}`.toLowerCase();
      return haystack.includes(needle);
    })
    .map(renderCellDetail)
    .filter(Boolean)
    .slice(0, 12);
};

const executeTool = (
  tool: ToolCall,
  context: NotebookAssistantContext,
  scope: AssistantScope
) => {
  const activeCell = context.cells.find((cell) => cell.id === context.activeCellId) || null;
  switch (tool.name) {
    case 'get_notebook_summary':
      return {
        notebookName: context.notebookName,
        defaultTrigMode: context.defaultTrigMode,
        defaultMathRenderMode: context.defaultMathRenderMode,
        scope,
        activeCellId: context.activeCellId,
        cellCount: context.cells.length,
        cells:
          (tool.args.scope === 'active' ? (activeCell ? [activeCell] : []) : context.cells).map(summarizeCell)
      };
    case 'list_cells':
      return context.cells.map(summarizeCell);
    case 'get_active_cell':
      return renderCellDetail(activeCell);
    case 'get_cell': {
      const cellId = String(tool.args.cellId || '');
      return renderCellDetail(context.cells.find((cell) => cell.id === cellId) || null);
    }
    case 'get_recent_errors':
      return context.cells.filter((cell) => cell.hasError).map(renderCellDetail);
    case 'search_cells': {
      const query = String(tool.args.query || '');
      const category = (String(tool.args.category || 'all') as 'all' | 'errors' | 'solve-plot' | 'helpers' | 'markdown');
      return searchNotebookCells(context.cells, query, category);
    }
    case 'get_reference': {
      const section = String(tool.args.section || 'overview') as keyof typeof REFERENCE_SECTIONS;
      return {
        section,
        text: REFERENCE_SECTIONS[section] ?? REFERENCE_SECTIONS.overview
      };
    }
    default:
      return { error: `Unknown tool: ${tool.name}` };
  }
};

const parseToolCalls = (response: GeminiResponse): ToolCall[] => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part): part is Extract<GeminiPart, { functionCall: { name: string; args?: Record<string, unknown> } }> => 'functionCall' in part)
    .map((part) => ({
      name: part.functionCall.name,
      args: (part.functionCall.args ?? {}) as Record<string, unknown>
    }));
};

const parseOpenAIToolCalls = (response: OpenAIResponsesResponse): ToolCall[] => {
  const calls = (response.output ?? []).filter((item) => item?.type === 'function_call' && item.name);
  return calls
    .map((call) => {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch (_err) {
        args = {};
      }
      return {
        id: call.call_id,
        name: String(call.name ?? ''),
        args
      };
    });
};

const parseSseEvent = (rawEvent: string): OpenAIStreamingEvent | null => {
  const lines = rawEvent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as OpenAIStreamingEvent;
  } catch (_error) {
    return null;
  }
};

const parseOpenAICompatibleToolCalls = (response: OpenAICompatibleResponse): ToolCall[] => {
  const calls = response.choices?.[0]?.message?.tool_calls ?? [];
  return calls.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch (_error) {
      args = {};
    }
    return {
      id: call.id,
      name: String(call.function.name ?? ''),
      args
    };
  });
};

const parseOpenAICompatibleSseEvent = (rawEvent: string): OpenAICompatibleStreamingEvent | null => {
  const lines = rawEvent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as OpenAICompatibleStreamingEvent;
  } catch (_error) {
    return null;
  }
};

const extractText = (response: GeminiResponse) => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part): part is Extract<GeminiPart, { text: string }> => 'text' in part)
    .map((part) => part.text)
    .join('\n')
    .trim();
};

const extractOpenAIText = (response: OpenAIResponsesResponse) => {
  return (response.output ?? [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n')
    .trim();
};

const extractOpenAICompatibleText = (response: OpenAICompatibleResponse) =>
  (response.choices?.[0]?.message?.content ?? '').trim();

export const getSupportedThinkingLevels = (model: string): AssistantThinkingLevel[] => {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('gpt-5.1-codex')) return ['dynamic', 'low', 'medium', 'high'];
  if (normalized.startsWith('gpt-5.1')) return ['dynamic', 'minimal', 'low', 'medium', 'high'];
  if (normalized.startsWith('gpt-5')) return ['dynamic', 'minimal', 'low', 'medium', 'high'];
  if (!normalized.includes('gemini-3')) return ['dynamic'];
  if (normalized.includes('pro')) {
    return ['dynamic', 'low', 'high'];
  }
  return ['dynamic', 'minimal', 'low', 'medium', 'high'];
};

export const normalizeThinkingLevel = (
  model: string,
  thinkingLevel: AssistantThinkingLevel
): AssistantThinkingLevel => {
  const supported = getSupportedThinkingLevels(model);
  return supported.includes(thinkingLevel) ? thinkingLevel : supported[0];
};

const buildThinkingConfig = (model: string, thinkingLevel: AssistantThinkingLevel) => {
  const normalizedLevel = normalizeThinkingLevel(model, thinkingLevel);
  if (normalizedLevel === 'dynamic') return undefined;
  return {
    thinkingConfig: {
      thinkingLevel: normalizedLevel
    }
  };
};

const toOpenAICompatibleTools = (
  tools: ReadonlyArray<{
    type: 'function';
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>
): OpenAICompatibleTool[] =>
  tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));

const OPENAI_COMPATIBLE_TOOL_DECLARATIONS = toOpenAICompatibleTools(OPENAI_TOOL_DECLARATIONS);
const OPENAI_COMPATIBLE_SANDBOX_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_SANDBOX_TOOL_DECLARATION])[0];
const OPENAI_COMPATIBLE_SUBMIT_PLAN_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_SUBMIT_PLAN_TOOL_DECLARATION])[0];
const OPENAI_COMPATIBLE_PLAN_METADATA_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_PLAN_METADATA_TOOL_DECLARATION])[0];
const OPENAI_COMPATIBLE_PLAN_OPERATION_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_PLAN_OPERATION_TOOL_DECLARATION])[0];
const OPENAI_COMPATIBLE_FINALIZE_PLAN_TOOL_DECLARATION = toOpenAICompatibleTools([OPENAI_FINALIZE_PLAN_TOOL_DECLARATION])[0];

export const detectAssistantProvider = (model: string, apiKey = ''): AssistantProvider => {
  const proxyProvider = getServerProxyProvider(apiKey);
  if (proxyProvider) {
    return proxyProvider;
  }
  const normalized = model.toLowerCase();
  const trimmedKey = apiKey.trim();
  if (trimmedKey.startsWith('gsk_')) {
    return 'groq';
  }
  if (normalized.startsWith('gpt-') || normalized.startsWith('o') || normalized.includes('codex')) {
    return 'openai';
  }
  if (normalized.includes('kimi-k2') || normalized.startsWith('moonshotai/')) {
    return 'groq';
  }
  return 'gemini';
};

const buildOpenAIReasoningEffort = (model: string, thinkingLevel: AssistantThinkingLevel) => {
  const normalizedLevel = normalizeThinkingLevel(model, thinkingLevel);
  if (normalizedLevel === 'dynamic') return undefined;
  return normalizedLevel;
};

const callGemini = async (
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  retries = 3,
  signal?: AbortSignal,
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  stage: 'inspection' | 'planning' | 'validation' | 'extraction' = 'inspection',
  onResponseTrace?: (trace: AssistantResponseTrace) => void
): Promise<GeminiResponse> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let timeoutId: number | null = null;
    let lastStreamEvent = '';
    let partialText = '';
    const requestController = new AbortController();
    const abortFromParent = () => requestController.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) {
        requestController.abort(signal.reason);
      } else {
        signal.addEventListener('abort', abortFromParent, { once: true });
      }
    }
    timeoutId = window.setTimeout(() => {
      requestController.abort(new Error(`Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms`));
    }, GEMINI_REQUEST_TIMEOUT_MS);
    try {
      onNetworkEvent?.({
        phase: 'request_start',
        attempt: attempt + 1,
        stage
      });
      const baseGenerationConfig =
        body.generationConfig && typeof body.generationConfig === 'object'
          ? (body.generationConfig as Record<string, unknown>)
          : {};
      const generationConfig = {
        ...baseGenerationConfig,
        ...(buildThinkingConfig(model, thinkingLevel) ?? {})
      };
      const response = await fetch(
        isServerProxyKey(apiKey)
          ? `${buildAssistantProxyBaseUrl()}gemini/models/${encodeURIComponent(model)}:generateContent`
          : `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
        method: 'POST',
        headers: {
          ...(isServerProxyKey(apiKey) ? Object.fromEntries(buildServerProxyHeaders().entries()) : { 'Content-Type': 'application/json' })
        },
        body: JSON.stringify({
          ...body,
          generationConfig
        }),
        signal: requestController.signal,
        ...(isServerProxyKey(apiKey) ? { credentials: 'same-origin' as const } : {})
      });
      onNetworkEvent?.({
        phase: 'response',
        attempt: attempt + 1,
        stage,
        status: response.status
      });
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          onNetworkEvent?.({
            phase: 'error',
            attempt: attempt + 1,
            stage,
            status: response.status,
            detail: errorText
          });
          throw new Error(`Gemini API rate/quota limit hit (429). Wait a bit and retry. ${errorText}`);
        }
        if (response.status === 503 && attempt < retries) {
          onNetworkEvent?.({
            phase: 'retry',
            attempt: attempt + 1,
            stage,
            status: response.status,
            detail: '503 Service Unavailable'
          });
          await wait(1200 * (attempt + 1));
          continue;
        }
        onNetworkEvent?.({
          phase: 'error',
          attempt: attempt + 1,
          stage,
          status: response.status,
          detail: errorText
        });
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }
      const parsed = (await response.json()) as GeminiResponse;
      onResponseTrace?.({
        attempt: attempt + 1,
        provider: 'gemini',
        stage,
        text: extractText(parsed),
        toolCalls: parseToolCalls(parsed)
      });
      return parsed;
    } catch (error) {
      const didTimeout =
        requestController.signal.aborted &&
        !(signal?.aborted) &&
        error instanceof Error &&
        error.name === 'AbortError';
      if (didTimeout) {
        onNetworkEvent?.({
          phase: 'timeout',
          attempt: attempt + 1,
          stage,
          detail: `Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms`
        });
        lastError = new Error(`Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms.`);
        break;
      }
      if (signal?.aborted) {
        onNetworkEvent?.({
          phase: 'aborted',
          attempt: attempt + 1,
          stage,
          detail: error instanceof Error ? error.message : String(error)
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
      onNetworkEvent?.({
        phase: 'error',
        attempt: attempt + 1,
        stage,
        detail: error instanceof Error ? error.message : String(error)
      });
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      onNetworkEvent?.({
        phase: 'retry',
        attempt: attempt + 1,
        stage,
        detail: `Retrying after transport error`
      });
      await wait(1000 * (attempt + 1));
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (signal) {
        signal.removeEventListener('abort', abortFromParent);
      }
    }
  }
  throw lastError ?? new Error('Gemini API request failed.');
};

const callOpenAIResponses = async (
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  retries = 3,
  signal?: AbortSignal,
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  stage: 'inspection' | 'planning' | 'validation' | 'extraction' = 'inspection',
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  requestTimeoutMs = OPENAI_DEFAULT_REQUEST_TIMEOUT_MS
): Promise<OpenAIResponsesResponse> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let lastStreamEvent = '';
    let lastActivity = 'request_start';
    let partialText = '';
    const requestController = new AbortController();
    const abortFromParent = () => requestController.abort(signal?.reason);
    const inactivityTimeout = createInactivityTimeout(requestTimeoutMs, () => {
      requestController.abort(new Error(`OpenAI request timed out after ${requestTimeoutMs}ms`));
    });
    if (signal) {
      if (signal.aborted) {
        requestController.abort(signal.reason);
      } else {
        signal.addEventListener('abort', abortFromParent, { once: true });
      }
    }
    try {
      onNetworkEvent?.({ phase: 'request_start', attempt: attempt + 1, stage });
      inactivityTimeout.touch();
      const effort = buildOpenAIReasoningEffort(model, thinkingLevel);
      const response = await fetch(isServerProxyKey(apiKey) ? `${buildAssistantProxyBaseUrl()}openai/responses` : 'https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: isServerProxyKey(apiKey)
          ? buildServerProxyHeaders()
          : {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
        body: JSON.stringify({
          ...body,
          model,
          stream: true,
          ...(effort ? { reasoning: { effort } } : {})
        }),
        signal: requestController.signal,
        ...(isServerProxyKey(apiKey) ? { credentials: 'same-origin' as const } : {})
      });
      lastActivity = 'response_headers';
      inactivityTimeout.touch();
      onNetworkEvent?.({ phase: 'response', attempt: attempt + 1, stage, status: response.status });
      const contentType = response.headers.get('content-type') || '';
      const streamToolCalls = new Map<number, { id?: string; call_id?: string; name?: string; arguments: string }>();
      const readStreamResponse = async (): Promise<OpenAIResponsesResponse> => {
        if (!response.body) {
          throw new Error('OpenAI stream response body was empty.');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let responseId = '';
        let completedResponse: OpenAIResponsesResponse | null = null;
        let emittedTextStart = false;
        let emittedToolStart = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          lastActivity = 'response_chunk';
          inactivityTimeout.touch();
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const event = parseSseEvent(chunk);
            if (!event?.type) continue;
            lastStreamEvent = event.type;
            lastActivity = event.type;
            inactivityTimeout.touch();
            if (event.response?.id) {
              responseId = event.response.id;
            }
            if (
              event.type === 'response.created' ||
              event.type === 'response.in_progress' ||
              event.type === 'response.completed'
            ) {
              onNetworkEvent?.({
                phase: 'stream',
                attempt: attempt + 1,
                stage,
                detail: event.type
              });
            }
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
              partialText += event.delta;
              if (!emittedTextStart) {
                emittedTextStart = true;
                onNetworkEvent?.({
                  phase: 'stream',
                  attempt: attempt + 1,
                  stage,
                  detail: 'response.output_text.delta'
                });
              }
            }
            if (event.type === 'response.function_call_arguments.delta') {
              const index = typeof event.output_index === 'number' ? event.output_index : streamToolCalls.size;
              const existing = streamToolCalls.get(index) ?? {
                id: event.item_id,
                call_id: event.call_id,
                arguments: ''
              };
              existing.arguments += typeof event.delta === 'string' ? event.delta : '';
              if (event.call_id) existing.call_id = event.call_id;
              if (event.item_id) existing.id = event.item_id;
              streamToolCalls.set(index, existing);
              if (!emittedToolStart) {
                emittedToolStart = true;
                onNetworkEvent?.({
                  phase: 'stream',
                  attempt: attempt + 1,
                  stage,
                  detail: 'response.function_call_arguments.delta'
                });
              }
            }
            if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
              const index = typeof event.output_index === 'number' ? event.output_index : streamToolCalls.size;
              streamToolCalls.set(index, {
                id: event.item.id,
                call_id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments ?? ''
              });
            }
            if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
              const index = typeof event.output_index === 'number' ? event.output_index : streamToolCalls.size;
              streamToolCalls.set(index, {
                id: event.item.id,
                call_id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments ?? ''
              });
            }
            if (event.type === 'response.completed' && event.response) {
              completedResponse = event.response;
            }
            if (event.type === 'response.failed' || event.type === 'error') {
              throw new Error(event.error?.message || `OpenAI stream failed during ${event.type}.`);
            }
          }
        }
        if (completedResponse) return completedResponse;
        return {
          id: responseId || undefined,
          output: [
            ...Array.from(streamToolCalls.values()).map((tool) => ({
              type: 'function_call',
              id: tool.id,
              call_id: tool.call_id,
              name: tool.name,
              arguments: tool.arguments
            })),
            ...(partialText
              ? [
                  {
                    type: 'message',
                    content: [
                      {
                        type: 'output_text',
                        text: partialText
                      }
                    ]
                  }
                ]
              : [])
          ]
        };
      };
      const parsed = contentType.includes('text/event-stream')
        ? await readStreamResponse()
        : ((await response.json()) as OpenAIResponsesResponse);
      if (!response.ok) {
        const errorText = parsed?.error?.message || `OpenAI API error ${response.status}`;
        if ((response.status === 429 || response.status === 503) && attempt < retries) {
          onNetworkEvent?.({
            phase: 'retry',
            attempt: attempt + 1,
            stage,
            status: response.status,
            detail: errorText
          });
          await wait(1200 * (attempt + 1));
          continue;
        }
        onNetworkEvent?.({
          phase: 'error',
          attempt: attempt + 1,
          stage,
          status: response.status,
          detail: errorText
        });
        throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
      }
      onResponseTrace?.({
        provider: 'openai',
        attempt: attempt + 1,
        stage,
        text: extractOpenAIText(parsed),
        toolCalls: parseOpenAIToolCalls(parsed)
      });
      return parsed;
    } catch (error) {
      const didTimeout =
        requestController.signal.aborted &&
        !(signal?.aborted) &&
        error instanceof Error &&
        error.name === 'AbortError';
      if (didTimeout) {
        const streamHint =
          typeof lastStreamEvent === 'string' && lastStreamEvent
            ? ` Last stream event: ${lastStreamEvent}.${partialText ? ` Partial text: ${truncateText(partialText, 160)}` : ''}`
            : ` Last activity: ${lastActivity}.`;
        onNetworkEvent?.({
          phase: 'timeout',
          attempt: attempt + 1,
          stage,
          detail: `OpenAI request timed out after ${requestTimeoutMs}ms.${streamHint}`
        });
        lastError = new Error(`OpenAI request timed out after ${requestTimeoutMs}ms.${streamHint}`);
        break;
      }
      if (signal?.aborted) {
        onNetworkEvent?.({
          phase: 'aborted',
          attempt: attempt + 1,
          stage,
          detail: error instanceof Error ? error.message : String(error)
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
      onNetworkEvent?.({
        phase: 'error',
        attempt: attempt + 1,
        stage,
        detail: error instanceof Error ? error.message : String(error)
      });
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      onNetworkEvent?.({
        phase: 'retry',
        attempt: attempt + 1,
        stage,
        detail: 'Retrying after transport error'
      });
      await wait(1000 * (attempt + 1));
    } finally {
      inactivityTimeout.clear();
      if (signal) signal.removeEventListener('abort', abortFromParent);
    }
  }
  throw lastError ?? new Error('OpenAI API request failed.');
};

const callGroqChatCompletions = async (
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  retries = 3,
  signal?: AbortSignal,
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  stage: 'inspection' | 'planning' | 'validation' | 'extraction' = 'inspection',
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  requestTimeoutMs = OPENAI_DEFAULT_REQUEST_TIMEOUT_MS
): Promise<OpenAICompatibleResponse> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let lastStreamEvent = '';
    let lastActivity = 'request_start';
    let partialText = '';
    const requestController = new AbortController();
    const abortFromParent = () => requestController.abort(signal?.reason);
    const inactivityTimeout = createInactivityTimeout(requestTimeoutMs, () => {
      requestController.abort(new Error(`Groq request timed out after ${requestTimeoutMs}ms`));
    });
    if (signal) {
      if (signal.aborted) {
        requestController.abort(signal.reason);
      } else {
        signal.addEventListener('abort', abortFromParent, { once: true });
      }
    }
    try {
      onNetworkEvent?.({ phase: 'request_start', attempt: attempt + 1, stage });
      inactivityTimeout.touch();
      const response = await fetch(isServerProxyKey(apiKey) ? `${buildAssistantProxyBaseUrl()}groq/chat/completions` : `${GROQ_API_ROOT}/chat/completions`, {
        method: 'POST',
        headers: isServerProxyKey(apiKey)
          ? buildServerProxyHeaders()
          : {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
        body: JSON.stringify({
          ...body,
          model,
          stream: true
        }),
        signal: requestController.signal,
        ...(isServerProxyKey(apiKey) ? { credentials: 'same-origin' as const } : {})
      });
      lastActivity = 'response_headers';
      inactivityTimeout.touch();
      onNetworkEvent?.({ phase: 'response', attempt: attempt + 1, stage, status: response.status });
      const contentType = response.headers.get('content-type') || '';
      const readStreamResponse = async (): Promise<OpenAICompatibleResponse> => {
        if (!response.body) {
          throw new Error('Groq stream response body was empty.');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let responseId = '';
        const toolCalls = new Map<number, NonNullable<OpenAICompatibleMessage['tool_calls']>[number]>();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          lastActivity = 'response_chunk';
          inactivityTimeout.touch();
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const event = parseOpenAICompatibleSseEvent(chunk);
            if (!event) continue;
            if (event.id) responseId = event.id;
            const choice = event.choices?.[0];
            const delta = choice?.delta;
            if (choice?.finish_reason) {
              lastStreamEvent = choice.finish_reason;
              onNetworkEvent?.({
                phase: 'stream',
                attempt: attempt + 1,
                stage,
                detail: `finish:${choice.finish_reason}`
              });
            }
            if (delta?.content) {
              partialText += delta.content;
              lastStreamEvent = 'content';
              onNetworkEvent?.({
                phase: 'stream',
                attempt: attempt + 1,
                stage,
                detail: 'chat.completions.delta.content'
              });
            }
            if (Array.isArray(delta?.tool_calls)) {
              delta.tool_calls.forEach((toolCall) => {
                const index = typeof toolCall.index === 'number' ? toolCall.index : toolCalls.size;
                const existing = toolCalls.get(index) ?? {
                  id: toolCall.id || `groq-tool-${index}`,
                  type: 'function' as const,
                  function: {
                    name: '',
                    arguments: ''
                  }
                };
                if (toolCall.id) existing.id = toolCall.id;
                if (toolCall.function?.name) existing.function.name = toolCall.function.name;
                if (toolCall.function?.arguments) {
                  existing.function.arguments += toolCall.function.arguments;
                }
                toolCalls.set(index, existing);
              });
              lastStreamEvent = 'tool_calls';
              onNetworkEvent?.({
                phase: 'stream',
                attempt: attempt + 1,
                stage,
                detail: 'chat.completions.delta.tool_calls'
              });
            }
          }
        }
        return {
          id: responseId || undefined,
          choices: [
            {
              message: {
                role: 'assistant',
                content: partialText || null,
                tool_calls: Array.from(toolCalls.values())
              }
            }
          ]
        };
      };
      const parsed = contentType.includes('text/event-stream')
        ? await readStreamResponse()
        : ((await response.json()) as OpenAICompatibleResponse);
      if (!response.ok) {
        const errorText = parsed?.error?.message || `Groq API error ${response.status}`;
        if ((response.status === 429 || response.status === 503) && attempt < retries) {
          onNetworkEvent?.({
            phase: 'retry',
            attempt: attempt + 1,
            stage,
            status: response.status,
            detail: errorText
          });
          await wait(1200 * (attempt + 1));
          continue;
        }
        onNetworkEvent?.({
          phase: 'error',
          attempt: attempt + 1,
          stage,
          status: response.status,
          detail: errorText
        });
        throw new Error(`Groq API error ${response.status}: ${errorText}`);
      }
      onResponseTrace?.({
        provider: 'groq',
        attempt: attempt + 1,
        stage,
        text: extractOpenAICompatibleText(parsed),
        toolCalls: parseOpenAICompatibleToolCalls(parsed)
      });
      return parsed;
    } catch (error) {
      const didTimeout =
        requestController.signal.aborted &&
        !(signal?.aborted) &&
        error instanceof Error &&
        error.name === 'AbortError';
      if (didTimeout) {
        const streamHint =
          typeof lastStreamEvent === 'string' && lastStreamEvent
            ? ` Last stream event: ${lastStreamEvent}.${partialText ? ` Partial text: ${truncateText(partialText, 160)}` : ''}`
            : ` Last activity: ${lastActivity}.`;
        onNetworkEvent?.({
          phase: 'timeout',
          attempt: attempt + 1,
          stage,
          detail: `Groq request timed out after ${requestTimeoutMs}ms.${streamHint}`
        });
        lastError = new Error(`Groq request timed out after ${requestTimeoutMs}ms.${streamHint}`);
        break;
      }
      if (signal?.aborted) {
        onNetworkEvent?.({
          phase: 'aborted',
          attempt: attempt + 1,
          stage,
          detail: error instanceof Error ? error.message : String(error)
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
      onNetworkEvent?.({
        phase: 'error',
        attempt: attempt + 1,
        stage,
        detail: error instanceof Error ? error.message : String(error)
      });
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      onNetworkEvent?.({
        phase: 'retry',
        attempt: attempt + 1,
        stage,
        detail: 'Retrying after transport error'
      });
      await wait(1000 * (attempt + 1));
    } finally {
      inactivityTimeout.clear();
      if (signal) signal.removeEventListener('abort', abortFromParent);
    }
  }
  throw lastError ?? new Error('Groq API request failed.');
};

const buildInspectionPrompt = (
  request: string,
  scope: AssistantScope,
  conversationHistory: AssistantConversationEntry[],
  photoImport?: AssistantPhotoImportInput
) => {
  const attachmentSummary = (photoImport?.items ?? [])
    .map((item) => item.displayName || item.fileName || `attachment ${item.pageNumber ?? ''}`.trim())
    .filter(Boolean)
    .join(', ');
  const recentConversation = conversationHistory
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join('\n');
  return [
    'You are helping edit a SugarPy notebook.',
    COMPACT_REFERENCE,
    'First inspect the notebook using the available tools before planning changes.',
    'Only inspect what you need. Prefer concise tool usage.',
    ...(requestLooksMathLike(request)
      ? [
          'This request looks mathematical or plotting-related.',
          'Before planning, consult the SugarPy references you need to confirm Math-cell and plotting behavior.',
          "Start with get_reference('math_cells') and, if plotting or geometry is involved, get_reference('plotting').",
          'Do not assume Python is needed before checking whether SugarPy Math cells already support the workflow.'
        ]
      : []),
    ...(photoImport
      ? [
          'An ordered set of uploaded handwritten images is attached to this request.',
          'Inspect the readable content of the attached pages and use them as source material for new notebook cells.',
          'Preserve the page order when reasoning about the attached material.',
          'Treat scratched-out or unreadable parts as uncertain instead of inventing content.',
          'Keep import behavior additive: append new cells rather than rewriting existing notebook cells.',
          "For imported math content, consult get_reference('math_cells') before planning."
        ]
      : []),
    `Scope preference: ${scope}.`,
    `User request: ${request}`,
    attachmentSummary ? `Attached pages/files: ${attachmentSummary}` : '',
    photoImport?.instructions?.trim() ? `Photo import instruction: ${photoImport.instructions.trim()}` : '',
    recentConversation ? `Recent conversation:\n${recentConversation}` : ''
  ]
    .filter(Boolean)
    .join('\n');
};

export const buildOpenAIPhotoImportInput = (text: string, photoImport: AssistantPhotoImportInput) => [
  {
    role: 'user' as const,
    content: [
      {
        type: 'input_text' as const,
        text
      },
      ...photoImport.items.map((item) => ({
        type: 'input_image' as const,
        image_url: item.imageDataUrl
      }))
    ]
  }
];

const runGeminiToolLoop = async (
  apiKey: string,
  model: string,
  request: string,
  scope: AssistantScope,
  context: NotebookAssistantContext,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void
): Promise<ToolLoopResult> => {
  onActivity?.({ kind: 'phase', label: 'Starting notebook inspection' });
  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [
        {
          text: buildInspectionPrompt(request, scope, conversationHistory)
        }
      ]
    }
  ];
  const transcript: string[] = [];
  const seenCalls = new Set<string>();
  const inspectedCells = new Map<string, ReturnType<typeof renderCellDetail>>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onActivity?.({
      kind: 'phase',
      label: 'Waiting for model',
      detail: `Inspection round ${round + 1}`
    });
    const response = await callGemini(apiKey, model, {
      systemInstruction: {
        parts: [
          {
            text: [
              'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.',
              'Use get_reference when platform behavior matters.',
              ...(requestLooksMathLike(request)
                ? [
                    "For mathematical or plotting requests, confirm SugarPy support from references before planning.",
                    "Consult get_reference('math_cells') first and get_reference('plotting') when geometry or plotting is relevant."
                  ]
                : [])
            ].join('\n')
          }
        ]
      },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO'
        }
      },
      generationConfig: {
        temperature: 0.2
      }
    }, 3, signal, thinkingLevel, onNetworkEvent, 'inspection', onResponseTrace);

    const toolCalls = parseToolCalls(response);
    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent?.parts?.length) {
      contents.push({
        role: 'model',
        parts: candidateContent.parts
      });
    }

    if (toolCalls.length === 0) {
      const notes = extractText(response);
      if (notes) transcript.push(`Model notes: ${notes}`);
      onActivity?.({ kind: 'phase', label: 'Inspection finished', detail: notes || 'No extra notes.' });
      return { notes, transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }

    const toolResponses: GeminiPart[] = [];
    toolCalls.forEach((toolCall) => {
      const signature = JSON.stringify({ name: toolCall.name, args: toolCall.args ?? {} });
      if (seenCalls.has(signature)) {
        return;
      }
      seenCalls.add(signature);
      const result = executeTool(toolCall, context, scope);
      transcript.push(`Used tool ${toolCall.name}.`);
      onActivity?.({
        kind: toolCall.name === 'get_reference' ? 'reference' : 'tool',
        label: toolCall.name,
        detail:
          toolCall.name === 'get_reference'
            ? String(toolCall.args.section || '')
            : toolCall.name === 'get_cell'
              ? String(toolCall.args.cellId || '')
              : undefined
      });
      if (toolCall.name === 'get_cell' || toolCall.name === 'get_active_cell') {
        const detail = result as ReturnType<typeof renderCellDetail>;
        if (detail?.id) inspectedCells.set(detail.id, detail);
      }
      if (toolCall.name === 'get_recent_errors' && Array.isArray(result)) {
        result.forEach((detail) => {
          if (detail?.id) inspectedCells.set(detail.id, detail);
        });
      }
      toolResponses.push({
        functionResponse: {
          name: toolCall.name,
          response: { result }
        }
      });
    });
    if (toolResponses.length === 0) {
      onActivity?.({ kind: 'phase', label: 'Inspection stopped', detail: 'Repeated tool calls were ignored.' });
      return {
        notes: 'Stopped tool inspection after repeated tool calls.',
        transcript,
        inspectedCells: Array.from(inspectedCells.values())
      };
    }
    contents.push({
      role: 'tool',
      parts: toolResponses
    });
  }

  return {
    notes: '',
    transcript,
    inspectedCells: Array.from(inspectedCells.values())
  };
};

const runOpenAIToolLoop = async (
  apiKey: string,
  model: string,
  request: string,
  scope: AssistantScope,
  context: NotebookAssistantContext,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  photoImport?: AssistantPhotoImportInput
): Promise<ToolLoopResult> => {
  onActivity?.({ kind: 'phase', label: 'Starting notebook inspection' });
  const transcript: string[] = [];
  const seenCalls = new Set<string>();
  const inspectedCells = new Map<string, ReturnType<typeof renderCellDetail>>();
  let previousResponseId: string | undefined;
  const inspectionPrompt = buildInspectionPrompt(request, scope, conversationHistory, photoImport);
  let nextInput: unknown = photoImport ? buildOpenAIPhotoImportInput(inspectionPrompt, photoImport) : inspectionPrompt;
  const instructions = [
    'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.',
    'Use get_reference when platform behavior matters.',
    ...(requestLooksMathLike(request)
      ? [
          "For mathematical or plotting requests, confirm SugarPy support from references before planning.",
          "Consult get_reference('math_cells') first and get_reference('plotting') when geometry or plotting is relevant."
        ]
      : [])
  ].join('\n');

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onActivity?.({
      kind: 'phase',
      label: 'Waiting for model',
      detail: `Inspection round ${round + 1}`
    });
    const response = await callOpenAIResponses(
      apiKey,
      model,
      {
        instructions,
        input: nextInput,
        tools: OPENAI_TOOL_DECLARATIONS,
        tool_choice: 'auto',
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {})
      },
      3,
      signal,
      thinkingLevel,
      onNetworkEvent,
      'inspection',
      onResponseTrace
    );
    previousResponseId = response.id || previousResponseId;
    const toolCalls = parseOpenAIToolCalls(response);

    if (toolCalls.length === 0) {
      const notes = extractOpenAIText(response);
      if (notes) transcript.push(`Model notes: ${notes}`);
      onActivity?.({ kind: 'phase', label: 'Inspection finished', detail: notes || 'No extra notes.' });
      return { notes, transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }

    let uniqueToolCount = 0;
    const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];
    toolCalls.forEach((toolCall, index) => {
      const signature = JSON.stringify({ name: toolCall.name, args: toolCall.args ?? {} });
      const isRepeated = seenCalls.has(signature);
      if (!isRepeated) {
        seenCalls.add(signature);
        uniqueToolCount += 1;
      }
      const result = isRepeated
        ? { ignored: true, reason: 'Repeated tool call was ignored.' }
        : executeTool(toolCall, context, scope);
      if (!isRepeated) {
        transcript.push(`Used tool ${toolCall.name}.`);
        onActivity?.({
          kind: toolCall.name === 'get_reference' ? 'reference' : 'tool',
          label: toolCall.name,
          detail:
            toolCall.name === 'get_reference'
              ? String(toolCall.args.section || '')
              : toolCall.name === 'get_cell'
                ? String(toolCall.args.cellId || '')
                : undefined
        });
        if (toolCall.name === 'get_cell' || toolCall.name === 'get_active_cell') {
          const detail = result as ReturnType<typeof renderCellDetail>;
          if (detail?.id) inspectedCells.set(detail.id, detail);
        }
        if (toolCall.name === 'get_recent_errors' && Array.isArray(result)) {
          result.forEach((detail) => {
            if (detail?.id) inspectedCells.set(detail.id, detail);
          });
        }
      }
      toolOutputs.push({
        type: 'function_call_output',
        call_id: toolCall.id || `tool-call-${round}-${index}`,
        output: JSON.stringify(result)
      });
    });

    if (uniqueToolCount === 0) {
      onActivity?.({ kind: 'phase', label: 'Inspection stopped', detail: 'Repeated tool calls were ignored.' });
      return {
        notes: 'Stopped tool inspection after repeated tool calls.',
        transcript,
        inspectedCells: Array.from(inspectedCells.values())
      };
    }
    nextInput = toolOutputs;
  }

  return {
    notes: '',
    transcript,
    inspectedCells: Array.from(inspectedCells.values())
  };
};

const runGroqToolLoop = async (
  apiKey: string,
  model: string,
  request: string,
  scope: AssistantScope,
  context: NotebookAssistantContext,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  _thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void
): Promise<ToolLoopResult> => {
  onActivity?.({ kind: 'phase', label: 'Starting notebook inspection' });
  const transcript: string[] = [];
  const seenCalls = new Set<string>();
  const inspectedCells = new Map<string, ReturnType<typeof renderCellDetail>>();
  const messages: OpenAICompatibleMessage[] = [
    {
      role: 'system',
      content: [
        'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.',
        'Use get_reference when platform behavior matters.',
        ...(requestLooksMathLike(request)
          ? [
              "For mathematical or plotting requests, confirm SugarPy support from references before planning.",
              "Consult get_reference('math_cells') first and get_reference('plotting') when geometry or plotting is relevant."
            ]
          : [])
      ].join('\n')
    },
      {
        role: 'user',
        content: buildInspectionPrompt(request, scope, conversationHistory)
      }
    ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onActivity?.({
      kind: 'phase',
      label: 'Waiting for model',
      detail: `Inspection round ${round + 1}`
    });
    const response = await callGroqChatCompletions(
      apiKey,
      model,
      {
        messages,
        tools: OPENAI_COMPATIBLE_TOOL_DECLARATIONS,
        tool_choice: 'auto',
        temperature: 0.1
      },
      3,
      signal,
      onNetworkEvent,
      'inspection',
      onResponseTrace
    );
    const assistantMessage = response.choices?.[0]?.message ?? { role: 'assistant', content: null };
    const toolCalls = parseOpenAICompatibleToolCalls(response);
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      const notes = extractOpenAICompatibleText(response);
      if (notes) transcript.push(`Model notes: ${notes}`);
      onActivity?.({ kind: 'phase', label: 'Inspection finished', detail: notes || 'No extra notes.' });
      return { notes, transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }

    let uniqueToolCount = 0;
    toolCalls.forEach((toolCall, index) => {
      const signature = JSON.stringify({ name: toolCall.name, args: toolCall.args ?? {} });
      const isRepeated = seenCalls.has(signature);
      if (!isRepeated) {
        seenCalls.add(signature);
        uniqueToolCount += 1;
      }
      const result = isRepeated
        ? { ignored: true, reason: 'Repeated tool call was ignored.' }
        : executeTool(toolCall, context, scope);
      if (!isRepeated) {
        transcript.push(`Used tool ${toolCall.name}.`);
        onActivity?.({
          kind: toolCall.name === 'get_reference' ? 'reference' : 'tool',
          label: toolCall.name,
          detail:
            toolCall.name === 'get_reference'
              ? String(toolCall.args.section || '')
              : toolCall.name === 'get_cell'
                ? String(toolCall.args.cellId || '')
                : undefined
        });
        if (toolCall.name === 'get_cell' || toolCall.name === 'get_active_cell') {
          const detail = result as ReturnType<typeof renderCellDetail>;
          if (detail?.id) inspectedCells.set(detail.id, detail);
        }
        if (toolCall.name === 'get_recent_errors' && Array.isArray(result)) {
          result.forEach((detail) => {
            if (detail?.id) inspectedCells.set(detail.id, detail);
          });
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id || `tool-call-${round}-${index}`,
        content: JSON.stringify(result)
      });
    });

    if (uniqueToolCount === 0) {
      onActivity?.({ kind: 'phase', label: 'Inspection stopped', detail: 'Repeated tool calls were ignored.' });
      return {
        notes: 'Stopped tool inspection after repeated tool calls.',
        transcript,
        inspectedCells: Array.from(inspectedCells.values())
      };
    }
  }

  return {
    notes: '',
    transcript,
    inspectedCells: Array.from(inspectedCells.values())
  };
};

const runToolLoop = async (
  apiKey: string,
  model: string,
  request: string,
  scope: AssistantScope,
  context: NotebookAssistantContext,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  photoImport?: AssistantPhotoImportInput
): Promise<ToolLoopResult> => {
  if (!photoImport && requestLooksMathLike(request) && context.cells.length === 0) {
    onActivity?.({ kind: 'phase', label: 'Starting notebook inspection' });
    onActivity?.({ kind: 'reference', label: 'get_reference', detail: 'math_cells' });
    onActivity?.({ kind: 'reference', label: 'get_reference', detail: 'plotting' });
    onActivity?.({ kind: 'phase', label: 'Inspection finished', detail: 'Used built-in math and plotting references.' });
    return {
      notes: 'Empty notebook. Used built-in SugarPy math/plotting references; no notebook cells needed for inspection.',
      transcript: [
        'Used local reference: math_cells.',
        'Used local reference: plotting.',
        'Notebook is empty.'
      ],
      inspectedCells: []
    };
  }
  const provider = detectAssistantProvider(model, apiKey);
  if (provider === 'gemini') {
    if (photoImport) {
      throw new Error('Photo import tool-loop inspection currently requires an OpenAI model.');
    }
    return runGeminiToolLoop(
      apiKey,
      model,
      request,
      scope,
      context,
      onActivity,
      signal,
      conversationHistory,
      thinkingLevel,
      onNetworkEvent,
      onResponseTrace
    );
  }
  if (provider === 'groq') {
    if (photoImport) {
      throw new Error('Photo import tool-loop inspection currently requires an OpenAI model.');
    }
    return runGroqToolLoop(
      apiKey,
      model,
      request,
      scope,
      context,
      onActivity,
      signal,
      conversationHistory,
      thinkingLevel,
      onNetworkEvent,
      onResponseTrace
    );
  }
  return runOpenAIToolLoop(
    apiKey,
    model,
    request,
    scope,
    context,
    onActivity,
    signal,
    conversationHistory,
    thinkingLevel,
    onNetworkEvent,
    onResponseTrace,
    photoImport
  );
};

const buildValidationPrompt = (
  request: string,
  context: NotebookAssistantContext,
  draftPlan: AssistantPlan,
  conversationHistory: AssistantConversationEntry[]
) =>
  JSON.stringify({
    userRequest: request,
    notebookName: context.notebookName,
    activeCellId: context.activeCellId,
    defaults: {
      trigMode: context.defaultTrigMode,
      renderMode: context.defaultMathRenderMode
    },
    conversationHistory: conversationHistory.slice(-6),
    draftPlan
  });

const validationSystemPrompt = [
  'You are validating a drafted SugarPy notebook change set.',
  COMPACT_REFERENCE,
  'The live notebook has not been changed yet.',
  'You must use run_code_in_sandbox to self-check every runnable insert/update operation before returning the final plan.',
  'Use target=code for Python code cells and target=math for SugarPy Math cells.',
  'Sandbox execution is isolated and never mutates the notebook.',
  'A successful sandbox check means the code is valid for preview; actual notebook execution happens later when the user chooses Apply and Run.',
  'Do not claim that code execution is unavailable if sandbox validation succeeded.',
  'Default to contextPreset bootstrap-only unless the draft truly depends on notebook code state.',
  'Use imports-only, selected-cells, or full-notebook-replay only when that context is required.',
  'Sandbox responses report how validation actually ran, including replayed cells and fallback attempts; use that metadata when revising the draft.',
  'Math validation must use the notebook or cell trig/render mode that the inserted Math cell will use.',
  'Do not use sandbox execution for Stoich cells.',
  'If the sandbox reports an error or timeout, revise the draft plan or add a warning that validation failed.',
  'Return the full final AssistantPlan JSON and nothing else.'
].join('\n');

const VALIDATION_REQUIRED_REMINDER = [
  'Your previous validation response did not call run_code_in_sandbox.',
  'Before returning the final plan, validate every inserted or updated runnable cell with run_code_in_sandbox.',
  'If validation succeeds, return the updated AssistantPlan without warnings about execution being unavailable.',
  'If validation fails, revise the code or add a precise validation warning.'
].join('\n');

const buildPhotoImportRevisionFeedback = (diagnostics: AssistantMathNormalizationDiagnostic[]) =>
  [
    'Your previous photo-import plan used handwritten or non-CAS math syntax that had to be normalized after generation.',
    'Revise the plan so the Math-cell source is already valid SugarPy CAS syntax before any post-processing.',
    'Do not repeat the rewritten patterns below.',
    ...diagnostics.slice(0, 3).flatMap((diagnostic, index) => [
      `Issue ${index + 1} reason: ${diagnostic.reason}`,
      `Issue ${index + 1} original Math cell source:`,
      diagnostic.originalSource,
      `Issue ${index + 1} normalized target form:`,
      diagnostic.normalizedSource
    ]),
    'Return a full revised AssistantPlan. Keep the mathematical meaning, but write it directly in valid SugarPy CAS syntax.'
  ].join('\n');

const runGeminiValidationLoop = async (
  apiKey: string,
  model: string,
  request: string,
  context: NotebookAssistantContext,
  draftPlan: AssistantPlan,
  sandboxRunner: AssistantSandboxRunner,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  onSandboxExecution?: (trace: AssistantSandboxExecutionTrace) => void
): Promise<AssistantPlan> => {
  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [{ text: buildValidationPrompt(request, context, draftPlan, conversationHistory) }]
    }
  ];
  let sawSandboxValidation = false;

  for (let round = 0; round < MAX_VALIDATION_ROUNDS; round += 1) {
    onActivity?.({
      kind: 'phase',
      label: 'Waiting for model',
      detail: `Validation round ${round + 1}`
    });
    const response = await callGemini(
      apiKey,
      model,
      {
        systemInstruction: {
          parts: [{ text: validationSystemPrompt }]
        },
        contents,
        tools: [{ functionDeclarations: [SANDBOX_TOOL_DECLARATION] }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO'
          }
        },
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: PLAN_SCHEMA
        }
      },
      3,
      signal,
      thinkingLevel,
      onNetworkEvent,
      'validation',
      onResponseTrace
    );
    const toolCalls = parseToolCalls(response);
    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent?.parts?.length) {
      contents.push({
        role: 'model',
        parts: candidateContent.parts
      });
    }
    if (toolCalls.length === 0) {
      if (!sawSandboxValidation && round < MAX_VALIDATION_ROUNDS - 1) {
        contents.push({
          role: 'user',
          parts: [{ text: VALIDATION_REQUIRED_REMINDER }]
        });
        continue;
      }
      return normalizePlan(JSON.parse(stripCodeFence(extractText(response)) || '{}'));
    }

    const toolResponses: GeminiPart[] = [];
    for (const toolCall of toolCalls) {
      const sandboxRequest = normalizeSandboxRequest(toolCall.args);
      const result = await sandboxRunner(sandboxRequest, onActivity);
      sawSandboxValidation = true;
      onSandboxExecution?.(summarizeSandboxExecution(sandboxRequest, result));
      toolResponses.push({
        functionResponse: {
          name: toolCall.name,
          response: { result }
        }
      });
    }
    contents.push({
      role: 'tool',
      parts: toolResponses
    });
  }

  return draftPlan;
};

const runOpenAIValidationLoop = async (
  apiKey: string,
  model: string,
  request: string,
  context: NotebookAssistantContext,
  draftPlan: AssistantPlan,
  sandboxRunner: AssistantSandboxRunner,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  onSandboxExecution?: (trace: AssistantSandboxExecutionTrace) => void
): Promise<AssistantPlan> => {
  let previousResponseId: string | undefined;
  let nextInput: unknown = buildValidationPrompt(request, context, draftPlan, conversationHistory);
  let sawSandboxValidation = false;

  for (let round = 0; round < MAX_VALIDATION_ROUNDS; round += 1) {
    onActivity?.({
      kind: 'phase',
      label: 'Waiting for model',
      detail: `Validation round ${round + 1}`
    });
    const response = await callOpenAIResponses(
      apiKey,
      model,
      {
        instructions: validationSystemPrompt,
        input: nextInput,
        tools: [OPENAI_SANDBOX_TOOL_DECLARATION, OPENAI_SUBMIT_PLAN_TOOL_DECLARATION],
        tool_choice: 'auto',
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {})
      },
      3,
      signal,
      thinkingLevel,
      onNetworkEvent,
      'validation',
      onResponseTrace
    );
    previousResponseId = response.id || previousResponseId;
    const submittedPlan = extractSubmittedPlan(response);
    if (submittedPlan) {
      if (!sawSandboxValidation && round < MAX_VALIDATION_ROUNDS - 1) {
        nextInput = VALIDATION_REQUIRED_REMINDER;
        continue;
      }
      return submittedPlan;
    }
    const toolCalls = parseOpenAIToolCalls(response);
    if (toolCalls.length === 0) {
      if (!sawSandboxValidation && round < MAX_VALIDATION_ROUNDS - 1) {
        nextInput = VALIDATION_REQUIRED_REMINDER;
        continue;
      }
      return normalizePlan(JSON.parse(stripCodeFence(extractOpenAIText(response)) || '{}'));
    }
    if (!sawSandboxValidation && toolCalls.some((toolCall) => toolCall.name === 'submit_plan') && round < MAX_VALIDATION_ROUNDS - 1) {
      nextInput = VALIDATION_REQUIRED_REMINDER;
      continue;
    }

    const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];
    for (let index = 0; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];
      if (toolCall.name === 'submit_plan') {
        return normalizePlan(toolCall.args);
      }
      if (toolCall.name !== 'run_code_in_sandbox') continue;
      const sandboxRequest = normalizeSandboxRequest(toolCall.args);
      const result = await sandboxRunner(sandboxRequest, onActivity);
      sawSandboxValidation = true;
      onSandboxExecution?.(summarizeSandboxExecution(sandboxRequest, result));
      toolOutputs.push({
        type: 'function_call_output',
        call_id: toolCall.id || `validation-tool-${round}-${index}`,
        output: JSON.stringify(result)
      });
    }
    nextInput = toolOutputs;
  }

  return draftPlan;
};

const runGroqValidationLoop = async (
  apiKey: string,
  model: string,
  request: string,
  context: NotebookAssistantContext,
  draftPlan: AssistantPlan,
  sandboxRunner: AssistantSandboxRunner,
  onActivity?: (item: AssistantActivity) => void,
  signal?: AbortSignal,
  conversationHistory: AssistantConversationEntry[] = [],
  _thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void,
  onSandboxExecution?: (trace: AssistantSandboxExecutionTrace) => void
): Promise<AssistantPlan> => {
  const messages: OpenAICompatibleMessage[] = [
    { role: 'system', content: validationSystemPrompt },
    { role: 'user', content: buildValidationPrompt(request, context, draftPlan, conversationHistory) }
  ];
  let sawSandboxValidation = false;

  for (let round = 0; round < MAX_VALIDATION_ROUNDS; round += 1) {
    onActivity?.({
      kind: 'phase',
      label: 'Waiting for model',
      detail: `Validation round ${round + 1}`
    });
    const response = await callGroqChatCompletions(
      apiKey,
      model,
      {
        messages,
        tools: [OPENAI_COMPATIBLE_SANDBOX_TOOL_DECLARATION, OPENAI_COMPATIBLE_SUBMIT_PLAN_TOOL_DECLARATION],
        tool_choice: 'auto',
        temperature: 0.1
      },
      3,
      signal,
      onNetworkEvent,
      'validation',
      onResponseTrace
    );
    const assistantMessage = response.choices?.[0]?.message ?? { role: 'assistant', content: null };
    const toolCalls = parseOpenAICompatibleToolCalls(response);
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      if (!sawSandboxValidation && round < MAX_VALIDATION_ROUNDS - 1) {
        messages.push({ role: 'user', content: VALIDATION_REQUIRED_REMINDER });
        continue;
      }
      return normalizePlan(JSON.parse(stripCodeFence(extractOpenAICompatibleText(response)) || '{}'));
    }

    let returnedPlan: AssistantPlan | null = null;
    for (let index = 0; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];
      if (toolCall.name === 'submit_plan') {
        returnedPlan = normalizePlan(toolCall.args);
        continue;
      }
      if (toolCall.name !== 'run_code_in_sandbox') continue;
      const sandboxRequest = normalizeSandboxRequest(toolCall.args);
      const result = await sandboxRunner(sandboxRequest, onActivity);
      sawSandboxValidation = true;
      onSandboxExecution?.(summarizeSandboxExecution(sandboxRequest, result));
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id || `validation-tool-${round}-${index}`,
        content: JSON.stringify(result)
      });
    }
    if (returnedPlan) {
      if (!sawSandboxValidation && round < MAX_VALIDATION_ROUNDS - 1) {
        messages.push({ role: 'user', content: VALIDATION_REQUIRED_REMINDER });
        continue;
      }
      return returnedPlan;
    }
  }

  return draftPlan;
};

const runOpenAIPlanningLoop = async (
  apiKey: string,
  model: string,
  planningSystemPrompt: string,
  planningInput: unknown,
  signal?: AbortSignal,
  thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void
): Promise<AssistantPlan> => {
  let previousResponseId: string | undefined;
  let nextInput: unknown = planningInput;
  let metadata: { summary: string; userMessage: string; warnings: string[] } | null = null;
  const operations: AssistantOperation[] = [];

  for (let round = 0; round < MAX_PLANNING_ROUNDS; round += 1) {
    const response = await callOpenAIResponses(
      apiKey,
      model,
      {
        instructions: planningSystemPrompt,
        input: nextInput,
        tools: [
          OPENAI_SUBMIT_PLAN_TOOL_DECLARATION,
          OPENAI_PLAN_METADATA_TOOL_DECLARATION,
          OPENAI_PLAN_OPERATION_TOOL_DECLARATION,
          OPENAI_FINALIZE_PLAN_TOOL_DECLARATION
        ],
        tool_choice: 'auto',
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {})
      },
      0,
      signal,
      model.toLowerCase().startsWith('gpt-5.1-codex') ? 'low' : thinkingLevel,
      onNetworkEvent,
      'planning',
      onResponseTrace,
      OPENAI_PLANNING_REQUEST_TIMEOUT_MS
    );
    previousResponseId = response.id || previousResponseId;
    const submittedPlan = extractSubmittedPlan(response);
    if (submittedPlan) {
      return submittedPlan;
    }
    const toolCalls = parseOpenAIToolCalls(response);
    if (toolCalls.length === 0) {
      const fallbackText = extractOpenAIText(response);
      const parsedFallback = tryParsePlanText(fallbackText);
      if (parsedFallback) {
        return parsedFallback;
      }
      if (fallbackText.trim() && round < MAX_PLANNING_ROUNDS - 1) {
        nextInput = [
          'Your previous planning response was not valid AssistantPlan JSON and did not use the planning tools.',
          'Retry now.',
          'Return the plan only via tool calls or strict AssistantPlan JSON.',
          'Do not return prose.'
        ].join('\n');
        continue;
      }
      const currentPlan = buildPlanFromParts(metadata, operations);
      if (currentPlan) return currentPlan;
      throw new Error('OpenAI planning finished without a submitted plan.');
    }

    const toolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];
    let sawFinalize = false;
    for (let index = 0; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];
      if (toolCall.name === 'submit_plan') {
        return normalizePlan(toolCall.args);
      }
      if (toolCall.name === 'set_plan_metadata') {
        metadata = {
          summary: String(toolCall.args.summary ?? ''),
          userMessage: String(toolCall.args.userMessage ?? ''),
          warnings: Array.isArray(toolCall.args.warnings)
            ? toolCall.args.warnings.map((item) => String(item))
            : []
        };
        toolOutputs.push({
          type: 'function_call_output',
          call_id: toolCall.id || `planning-metadata-${round}-${index}`,
          output: JSON.stringify({ ok: true, metadataSet: true })
        });
        continue;
      }
      if (toolCall.name === 'add_plan_operation') {
        const normalized = normalizePlan({
          summary: metadata?.summary ?? '',
          userMessage: metadata?.userMessage ?? '',
          warnings: metadata?.warnings ?? [],
          operations: [toolCall.args]
        });
        if (normalized.operations[0]) {
          operations.push(normalized.operations[0]);
        }
        toolOutputs.push({
          type: 'function_call_output',
          call_id: toolCall.id || `planning-op-${round}-${index}`,
          output: JSON.stringify({ ok: true, operationCount: operations.length })
        });
        continue;
      }
      if (toolCall.name === 'finalize_plan') {
        sawFinalize = true;
        toolOutputs.push({
          type: 'function_call_output',
          call_id: toolCall.id || `planning-finalize-${round}-${index}`,
          output: JSON.stringify({ ok: true, finalized: true })
        });
      }
    }

    const currentPlan = buildPlanFromParts(metadata, operations);
    if (sawFinalize && currentPlan) {
      return currentPlan;
    }
    nextInput = toolOutputs;
  }

  const currentPlan = buildPlanFromParts(metadata, operations);
  if (currentPlan) return currentPlan;
  throw new Error('OpenAI planning exceeded the maximum number of planning rounds.');
};

const runGroqPlanningLoop = async (
  apiKey: string,
  model: string,
  planningSystemPrompt: string,
  planningPayload: string,
  signal?: AbortSignal,
  _thinkingLevel: AssistantThinkingLevel = 'dynamic',
  onNetworkEvent?: (event: AssistantNetworkEvent) => void,
  onResponseTrace?: (trace: AssistantResponseTrace) => void
): Promise<AssistantPlan> => {
  const messages: OpenAICompatibleMessage[] = [
    { role: 'system', content: planningSystemPrompt },
    { role: 'user', content: planningPayload }
  ];
  let metadata: { summary: string; userMessage: string; warnings: string[] } | null = null;
  const operations: AssistantOperation[] = [];

  for (let round = 0; round < MAX_PLANNING_ROUNDS; round += 1) {
    const response = await callGroqChatCompletions(
      apiKey,
      model,
      {
        messages,
        tools: [
          OPENAI_COMPATIBLE_SUBMIT_PLAN_TOOL_DECLARATION,
          OPENAI_COMPATIBLE_PLAN_METADATA_TOOL_DECLARATION,
          OPENAI_COMPATIBLE_PLAN_OPERATION_TOOL_DECLARATION,
          OPENAI_COMPATIBLE_FINALIZE_PLAN_TOOL_DECLARATION
        ],
        tool_choice: 'auto',
        temperature: 0.1
      },
      0,
      signal,
      onNetworkEvent,
      'planning',
      onResponseTrace,
      OPENAI_PLANNING_REQUEST_TIMEOUT_MS
    );
    const assistantMessage = response.choices?.[0]?.message ?? { role: 'assistant', content: null };
    const toolCalls = parseOpenAICompatibleToolCalls(response);
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      const fallbackText = extractOpenAICompatibleText(response);
      const parsedFallback = tryParsePlanText(fallbackText);
      if (parsedFallback) {
        return parsedFallback;
      }
      if (fallbackText.trim() && round < MAX_PLANNING_ROUNDS - 1) {
        messages.push({
          role: 'user',
          content: [
            'Your previous planning response was not valid AssistantPlan JSON and did not use the planning tools.',
            'Retry now.',
            'Return the plan only via tool calls or strict AssistantPlan JSON.',
            'Do not return prose.'
          ].join('\n')
        });
        continue;
      }
      const currentPlan = buildPlanFromParts(metadata, operations);
      if (currentPlan) return currentPlan;
      throw new Error('Groq planning finished without a submitted plan.');
    }

    let sawFinalize = false;
    for (let index = 0; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];
      if (toolCall.name === 'submit_plan') {
        return normalizePlan(toolCall.args);
      }
      if (toolCall.name === 'set_plan_metadata') {
        metadata = {
          summary: String(toolCall.args.summary ?? ''),
          userMessage: String(toolCall.args.userMessage ?? ''),
          warnings: Array.isArray(toolCall.args.warnings) ? toolCall.args.warnings.map((item) => String(item)) : []
        };
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id || `planning-metadata-${round}-${index}`,
          content: JSON.stringify({ ok: true, metadataSet: true })
        });
        continue;
      }
      if (toolCall.name === 'add_plan_operation') {
        const normalized = normalizePlan({
          summary: metadata?.summary ?? '',
          userMessage: metadata?.userMessage ?? '',
          warnings: metadata?.warnings ?? [],
          operations: [toolCall.args]
        });
        if (normalized.operations[0]) {
          operations.push(normalized.operations[0]);
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id || `planning-op-${round}-${index}`,
          content: JSON.stringify({ ok: true, operationCount: operations.length })
        });
        continue;
      }
      if (toolCall.name === 'finalize_plan') {
        sawFinalize = true;
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id || `planning-finalize-${round}-${index}`,
          content: JSON.stringify({ ok: true, finalized: true })
        });
      }
    }

    const currentPlan = buildPlanFromParts(metadata, operations);
    if (sawFinalize && currentPlan) {
      return currentPlan;
    }
  }

  const currentPlan = buildPlanFromParts(metadata, operations);
  if (currentPlan) return currentPlan;
  throw new Error('Groq planning exceeded the maximum number of planning rounds.');
};

const normalizePlan = (raw: any): AssistantPlan => {
  const payload = raw && typeof raw === 'object' && raw.plan && typeof raw.plan === 'object' ? raw.plan : raw;
  const operations = Array.isArray(payload?.operations) ? payload.operations : [];
  const diagnostics: AssistantMathNormalizationDiagnostic[] = [];
  const normalizedOperations = operations
    .map((item: any, index: number) => {
      const type = String(item?.type ?? '');
      if (type === 'insert_cell') {
        const cellType = (item?.cellType ?? 'code') as AssistantCellKind;
        const source = String(item?.source ?? '');
        const normalizedSource = cellType === 'math' ? normalizeAssistantMathSource(source) : source;
        if (cellType === 'math' && normalizedSource !== source) {
          diagnostics.push({
            operationIndex: index,
            originalSource: source,
            normalizedSource,
            reason: 'Math-cell source required textbook-to-CAS normalization.'
          });
        }
        if (cellType === 'math') {
          const proseLines = normalizedSource
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => lineHasAssistantMathProse(line));
          if (proseLines.length > 0) {
            diagnostics.push({
              operationIndex: index,
              originalSource: source,
              normalizedSource,
              reason: `Math-cell source still contains prose/non-CAS lines: ${proseLines.slice(0, 2).join(' | ')}`
            });
          }
          const suspiciousIdentifiers = collectAssistantPhotoImportSuspiciousIdentifiers(normalizedSource);
          if (suspiciousIdentifiers.length > 0) {
            diagnostics.push({
              operationIndex: index,
              originalSource: source,
              normalizedSource,
              reason: `Math-cell source uses suspicious identifier names: ${suspiciousIdentifiers.join(', ')}`
            });
          }
        }
        if (cellType === 'markdown') {
          const markdownIssue = getAssistantPhotoImportMarkdownIssue(source);
          if (markdownIssue) {
            diagnostics.push({
              operationIndex: index,
              originalSource: source,
              normalizedSource: source,
              reason: markdownIssue
            });
          }
        }
        return {
          type,
          index: Number(item?.index ?? 0),
          cellType,
          source: normalizedSource,
          reason: item?.reason ? String(item.reason) : undefined
        };
      }
      if (type === 'update_cell') {
        const source = String(item?.source ?? '');
        const normalizedSource = normalizeAssistantMathSource(source);
        if (normalizedSource !== source) {
          diagnostics.push({
            operationIndex: index,
            originalSource: source,
            normalizedSource,
            reason: 'Math-cell update required textbook-to-CAS normalization.'
          });
        }
        const proseLines = normalizedSource
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => lineHasAssistantMathProse(line));
        if (proseLines.length > 0) {
          diagnostics.push({
            operationIndex: index,
            originalSource: source,
            normalizedSource,
            reason: `Math-cell update still contains prose/non-CAS lines: ${proseLines.slice(0, 2).join(' | ')}`
          });
        }
        const suspiciousIdentifiers = collectAssistantPhotoImportSuspiciousIdentifiers(normalizedSource);
        if (suspiciousIdentifiers.length > 0) {
          diagnostics.push({
            operationIndex: index,
            originalSource: source,
            normalizedSource,
            reason: `Math-cell update uses suspicious identifier names: ${suspiciousIdentifiers.join(', ')}`
          });
        }
        return {
          type,
          cellId: String(item?.cellId ?? ''),
          source: normalizedSource,
          reason: item?.reason ? String(item.reason) : undefined
        };
      }
      if (type === 'delete_cell') {
        return {
          type,
          cellId: String(item?.cellId ?? ''),
          reason: item?.reason ? String(item.reason) : undefined
        };
      }
      if (type === 'move_cell') {
        return {
          type,
          cellId: String(item?.cellId ?? ''),
          index: Number(item?.index ?? 0),
          reason: item?.reason ? String(item.reason) : undefined
        };
      }
      if (type === 'set_notebook_defaults') {
        return {
          type,
          trigMode: item?.trigMode === 'rad' ? 'rad' : item?.trigMode === 'deg' ? 'deg' : undefined,
          renderMode:
            item?.renderMode === 'decimal' ? 'decimal' : item?.renderMode === 'exact' ? 'exact' : undefined,
          reason: item?.reason ? String(item.reason) : undefined
        };
      }
      return null;
    })
    .filter(Boolean) as AssistantOperation[];
  const steps = buildPlanSteps(normalizedOperations);
  const plan = {
    summary: String(payload?.summary ?? 'Prepared a notebook change set.'),
    userMessage: String(payload?.userMessage ?? ''),
    warnings: Array.isArray(payload?.warnings) ? payload.warnings.map((item: unknown) => String(item)) : [],
    operations: normalizedOperations,
    outline: {
      summary: String(payload?.summary ?? 'Prepared a notebook change set.'),
      steps: steps.map((step) => step.summary)
    },
    steps
  } satisfies AssistantPlan;
  (plan as AssistantPlan & { [ASSISTANT_PLAN_DIAGNOSTICS]?: AssistantMathNormalizationDiagnostic[] })[
    ASSISTANT_PLAN_DIAGNOSTICS
  ] = diagnostics;
  return plan;
};

export async function planNotebookChanges(params: {
  apiKey: string;
  model: string;
  request: string;
  scope: AssistantScope;
  preference: AssistantPreference;
  context: NotebookAssistantContext;
  photoImport?: AssistantPhotoImportInput;
  onActivity?: (item: AssistantActivity) => void;
  signal?: AbortSignal;
  conversationHistory?: AssistantConversationEntry[];
  thinkingLevel?: AssistantThinkingLevel;
  onNetworkEvent?: (event: AssistantNetworkEvent) => void;
  onResponseTrace?: (trace: AssistantResponseTrace) => void;
  sandboxRunner?: AssistantSandboxRunner;
  onSandboxExecution?: (trace: AssistantSandboxExecutionTrace) => void;
}) {
  const {
    apiKey,
    model,
    request,
    scope,
    preference,
    context,
    photoImport,
    onActivity,
    signal,
    conversationHistory = [],
    thinkingLevel = 'dynamic',
    onNetworkEvent,
    onResponseTrace,
    sandboxRunner,
    onSandboxExecution
  } = params;
  onActivity?.({ kind: 'phase', label: 'Preparing context' });
  const inspection = await runToolLoop(
    apiKey,
    model,
    request,
    scope,
    context,
    onActivity,
    signal,
    conversationHistory,
    thinkingLevel,
    onNetworkEvent,
    onResponseTrace,
    photoImport
  );
  const notebookManifest =
    scope === 'active'
      ? context.cells.filter((cell) => cell.id === context.activeCellId).map(summarizeCell)
      : context.cells.map(summarizeCell);

  const preferenceRules = (() => {
    switch (preference) {
      case 'cas':
        return [
          'Preference mode: CAS-first.',
          'Prefer Math cells over Code cells when the task can be expressed naturally in SugarPy CAS.',
          'Prefer equations, assignments, symbolic transformations, and SugarPy plot(...) workflows over Python implementations.',
          'Avoid Python helper functions unless they are required for the requested task.'
        ];
      case 'python':
        return [
          'Preference mode: Python-first.',
          'Prefer Code cells and ordinary Python/SymPy syntax over SugarPy CAS shorthand.',
          'Use Math cells only when the user explicitly wants CAS notation or symbolic card rendering.'
        ];
      case 'explain':
        return [
          'Preference mode: Explain-first.',
          'Prefer a short Markdown explanation plus the minimum runnable notebook content.',
          'Avoid adding extra implementation cells beyond what is necessary to answer the request.'
        ];
      default:
        return [
          'Preference mode: Auto.',
          'Default to CAS-first behavior.',
          'If the request is math, symbolic, equation-based, plotting-related, or naturally expressible in SugarPy Math cells, prefer Math cells over Code cells.',
          'Treat mathematical requests as Math-cell tasks by default; do not switch to Code cells unless CAS is clearly unsupported or the user explicitly asks for Python.',
          'Treat Code cells as a last resort for math requests, not as an equal alternative.',
          'Use Code cells only when the request is not really mathematical, when CAS is clearly a poor fit, or when the user explicitly asks for Python.'
        ];
    }
  })();

  onActivity?.({ kind: 'phase', label: 'Generating structured plan' });
  onActivity?.({ kind: 'phase', label: 'Waiting for model', detail: 'Final plan generation' });
  const planningSystemPrompt = [
    'You are generating a structured SugarPy notebook change set.',
    COMPACT_REFERENCE,
    'Return only operations that can be applied safely and deterministically.',
    'Use only these operation types: insert_cell, update_cell, delete_cell, move_cell, set_notebook_defaults.',
    'Prefer submitting the full plan in one submit_plan call.',
    'Use step-by-step planning tool calls only if you truly cannot produce the full plan in one response.',
    'For stoich cells, store the reaction text in source.',
    'Regression cells are UI-driven and should only be inserted when the user explicitly wants x/y regression editing.',
    'Prefer minimal edits over broad rewrites.',
    'Do not invent cell ids that do not exist.',
    'Prefer notebook content that is natively supported by SugarPy over mathematically equivalent but less compatible forms.',
    'This notebook is intended for teaching and demos.',
    'Optimize for clarity over compactness.',
    'Prefer a sequence of small, readable cells over one dense cell.',
    'When introducing a new runnable idea, add a short markdown explanation nearby instead of assuming the user knows why the cell exists.',
    'Do not combine multiple conceptual leaps into one code cell if two simpler cells would read better.',
    'Avoid boilerplate-heavy Python when a short SugarPy-native alternative exists.',
    'Use only documented SugarPy Math syntax in Math cells.',
    'Do not invent lambda, arrow-function, or functional-programming helpers such as x -> expr or map(...) unless the documented SugarPy Math syntax explicitly supports them.',
    MATH_ASSISTANT_SPEC,
    'For follow-up verification steps in Math cells, prefer explicit symbolic expressions such as sqrt(2)^2 or direct equation checks over anonymous-function patterns.',
    'Forbidden in Math cells unless explicitly documented: ->, lambda, map(...), Python comprehensions, Python for-loops, def blocks.',
    'Allowed Math-cell building blocks should stay narrow and explicit: symbolic assignments with :=, equations with =, unpack assignment, solve(...), Eq(...), linsolve(...), simplify(...), expand(...), factor(...), subs(...), N(...), render_decimal(...), render_exact(...), set_decimal_places(...), direct arithmetic, direct symbolic expressions, and plot(...).',
    'For multi-equation CAS solves, prefer documented ordered forms such as solve((equation1, equation2), (x, y)) or direct inline equations passed to solve(...).',
    'Assigned equation forms like eq1 := a = b and eq1 := Eq(a, b) are supported, but assistant plans should still prefer ordered solve(...) forms over set literals for deterministic output.',
    'Use plain equation syntax by default; Eq(...) is supported for compatibility, but it should not replace simpler = notation without a reason.',
    'subs(...) is available for symbolic post-processing, but it is not the preferred default for demos or teaching flows when a more direct symbolic expression would be clearer.',
    'For plot(...), choose one range convention per call. Do not mix Maple-style x = a..b / y = c..d, compatibility tuples like (x, a, b), and xmin/xmax/ymin/ymax kwargs in the same plot.',
    'By default, prefer SugarPy Math cells and CAS-native syntax for mathematical work.',
    'If the request is mathematical, solve it in SugarPy Math cells by default.',
    'Do not switch a math request into Python/Code cells just because code could also solve it.',
    'Treat Code cells as last resort only for mathematical work.',
    'Before choosing Code cells for a math task, assume the documented Math-cell workflow is the preferred path and use code only if that documented path still cannot express the task.',
    'Only fall back to Code cells when the task is not math-oriented, when CAS would be awkward or unsupported, or when the user explicitly asks for Python.',
    'When there are multiple equivalent representations, choose the one that SugarPy can execute, render, and plot directly with the current documented behavior.',
    'For geometry and plotting tasks, prefer implicit equations or directly plottable expressions over parametric forms unless the user explicitly asked for a parametric representation.',
    'Do not assume plot() supports representations that are not documented in SugarPy.',
    'If a request asks for a graph, generate notebook content that will actually produce the graph, not just helper definitions.',
    'SugarPy Math cells are sensitive to the notebook or cell trig mode (Deg/Rad).',
    'Do not generate trig-based plotting formulas whose correctness depends on the current Deg/Rad toggle unless the user explicitly asked for that form.',
    'If a geometric plot can be written without trig, prefer the trig-free form.',
    'If you choose a trig-based form, you must account for the current trig mode explicitly or change notebook defaults on purpose.',
    'For direct geometry-solving tasks, prefer short CAS derivations over helper-heavy code.',
    'When the user gives concrete points or constants, substitute those numeric values directly into the Math-cell equations instead of introducing Python tuples, indexing, or symbols(...) boilerplate unless that extra structure is truly required.',
    'For circle-from-points/radius tasks, prefer a minimal Math-cell workflow: define the given coordinates, write one distance equation per point, pass those equations to solve(...), then build the resulting circle equations from the returned centers.',
    'When solve(...) is the natural SugarPy/CAS tool for the request, use it directly instead of replacing it with manual algebra or Python/SymPy scaffolding.',
    'In Math cells, name := expr is an assignment, not a function definition.',
    'Use name(arg) := expr only when the user actually needs a callable function.',
    'Do not later call a name as a function if you defined it with plain := assignment.',
    ...(requestLooksLikeDirectGeometrySolve(request)
      ? [
          'This request looks like a direct geometry solve with concrete inputs.',
          'Favor 1-2 compact Math cells that a student can read top-to-bottom.',
          'Avoid over-engineered intermediate abstractions when two explicit equations and one solve(...) call are enough.'
        ]
      : []),
    ...(requestLooksMathLike(request)
      ? [
          'This request looks mathematical.',
          'Stay in Math cells unless there is a concrete CAS limitation that blocks the task.',
          'Do not generate Python scaffolding for a math exercise unless the user explicitly requested Python.',
          'Prefer step-by-step symbolic cells that a student can read from top to bottom.'
        ]
      : []),
    ...(photoImport
      ? [
          'This request is importing a handwritten set of images into the notebook.',
          'Treat the uploaded pages as ordered source material for new notebook cells.',
          'Preserve page order when extracting multi-page material.',
          'Photo import is additive: append imported cells after the current notebook content and do not update, move, or delete existing cells.',
          'Prefer Math cells for formulas and derivations from the photo.',
          'Use Markdown to explain the paper-style idea in short natural language, and keep Math cells strictly CAS-only.',
          'For each imported problem or page section, prefer a short Markdown heading plus one concise Markdown note that says what would be done on paper before the CAS steps.',
          'Keep Markdown notes short: usually one sentence, at most two short sentences.',
          'If a handwritten part is unreadable or ambiguous, omit it and record a warning instead of guessing.',
          'For photo-import Math cells, prefer plain equations as standalone cells and use := only for pure assignments such as x := 3 or point := (3, 2).',
          'Do not write labels like Intersection = (3, 2); use point := (3, 2) or leave the tuple unlabelled.',
          'Never use textbook norm notation such as |AB| or |P_1P_2| on the left-hand side. Use a named assignment such as distance_ab := sqrt(...).',
          'If a final object depends on solved values, substitute the concrete values before writing the final assignment. Do not leave placeholders such as (x, y).',
          'Do not use textbook notation such as sum_{k=1}^n, display-style chained equalities, or mixed assignment-plus-equation lines when a direct SugarPy form exists.',
          'Never write chained equalities such as a = b = c in one Math-cell line. Rewrite them as separate one-equation lines.',
          'Each imported Math cell should be either one equation or a block of simple assignments, not both at once.',
          'Your plan will be rejected and sent back for revision if the Math-cell source still needs textbook-to-CAS normalization after generation.'
        ]
      : []),
    ...preferenceRules
  ].join('\n');
  const planningPayload = JSON.stringify({
    userRequest: request,
    conversationHistory: conversationHistory.slice(-6),
    scope,
    preference,
    notebookName: context.notebookName,
    activeCellId: context.activeCellId,
    defaults: {
      trigMode: context.defaultTrigMode,
      renderMode: context.defaultMathRenderMode
    },
    notebookManifest,
    inspectedCells: inspection.inspectedCells,
    inspectionNotes: inspection.notes,
    inspectionSummary: inspection.transcript,
    photoImport: photoImport
      ? {
          enabled: true,
          fileCount: photoImport.items.length,
          attachments: photoImport.items.map((item, index) => ({
            index,
            fileName: item.fileName ?? '',
            displayName: item.displayName ?? '',
            pageNumber: item.pageNumber ?? null,
            mimeType: item.mimeType ?? ''
          })),
          instructions: photoImport.instructions?.trim() ?? '',
          insertStartIndex: notebookManifest.length
        }
      : undefined
  });

  const provider = detectAssistantProvider(model, apiKey);
  if (photoImport && provider !== 'openai') {
    throw new Error('Photo import currently requires an OpenAI model path.');
  }
  const planningInput = photoImport ? buildOpenAIPhotoImportInput(planningPayload, photoImport) : planningPayload;
  const runPlanning = async (systemPrompt: string, revisionFeedback?: string) => {
    const revisedPayload = revisionFeedback ? `${planningPayload}\n\nPlanner revision feedback:\n${revisionFeedback}` : planningPayload;
    const revisedInput =
      photoImport && provider === 'openai'
        ? buildOpenAIPhotoImportInput(revisedPayload, photoImport)
        : photoImport
          ? planningInput
          : revisedPayload;
    if (provider === 'openai') {
      return runOpenAIPlanningLoop(
        apiKey,
        model,
        systemPrompt,
        revisedInput,
        signal,
        thinkingLevel,
        onNetworkEvent,
        onResponseTrace
      );
    }
    if (provider === 'groq') {
      return runGroqPlanningLoop(
        apiKey,
        model,
        systemPrompt,
        revisedPayload,
        signal,
        thinkingLevel,
        onNetworkEvent,
        onResponseTrace
      );
    }
    const rawText = stripCodeFence(
      extractText(
        await callGemini(
          apiKey,
          model,
          {
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: revisedPayload }]
              }
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: PLAN_SCHEMA
            }
          },
          3,
          signal,
          thinkingLevel,
          onNetworkEvent,
          'planning',
          onResponseTrace
        )
      )
    );
    return normalizePlan(JSON.parse(rawText || '{}'));
  };

  let plan: AssistantPlan = await runPlanning(planningSystemPrompt);
  if (photoImport) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const diagnostics = [...getPlanDiagnostics(plan), ...collectPhotoImportStructureDiagnostics(plan)];
      if (diagnostics.length === 0) break;
      onActivity?.({
        kind: 'phase',
        label: 'Revising photo-import syntax',
        detail: `Requesting CAS-native rewrite ${attempt + 1}`
      });
      plan = await runPlanning(planningSystemPrompt, buildPhotoImportRevisionFeedback(diagnostics));
    }
  }

  if (requestLooksMathLike(request) && !requestExplicitlyAsksForPython(request) && planHasPythonCodeOperations(plan)) {
    onActivity?.({
      kind: 'phase',
      label: 'Revising plan',
      detail: 'Math request should stay in Math cells'
    });
    plan = await runPlanning(
      [
        planningSystemPrompt,
        'The previous draft incorrectly used Code cells for a mathematical request.',
        'Regenerate the plan using Math cells only.',
        'For this request, plans that insert or update Code cells are invalid unless the user explicitly asked for Python.',
        'If SugarPy CAS cannot express the task, explain that limitation in warnings instead of generating Python code.'
      ].join('\n')
    );
  }

  if (
    requestLooksLikeDirectGeometrySolve(request) &&
    !requestExplicitlyAsksForPython(request) &&
    !planUsesSolveInMathCells(plan)
  ) {
    const localSolvePlan = buildDirectCircleSolvePlan(request);
    if (localSolvePlan) {
      onActivity?.({
        kind: 'phase',
        label: 'Revising plan',
        detail: 'Replaced non-solve geometry draft with local CAS solve template'
      });
      plan = localSolvePlan;
    } else {
      onActivity?.({
        kind: 'phase',
        label: 'Revising plan',
        detail: 'Direct geometry request should use solve(...) in Math cells'
      });
      plan = await runPlanning(
        [
          planningSystemPrompt,
          'The previous draft avoided solve(...) even though this direct geometry task should use it.',
          'Regenerate the plan so the Math-cell solution explicitly uses solve(...) for the circle-center equations.',
          'For this request, manual geometric derivation without solve(...) is not preferred unless solve(...) is impossible in SugarPy CAS.',
          'Return a compact Math-cell solution that uses solve(...) directly.'
        ].join('\n')
      );
    }
  }

  if (planHasUnsupportedMathSyntax(plan)) {
    const unsupportedWarnings = collectUnsupportedMathWarnings(plan);
    onActivity?.({
      kind: 'phase',
      label: 'Revising plan',
      detail: 'Generated Math cells used unsupported syntax'
    });
    plan = await runPlanning(
      [
        planningSystemPrompt,
        'The previous draft used unsupported Math-cell syntax.',
        ...unsupportedWarnings,
        'Regenerate the plan using only documented SugarPy Math syntax.',
        MATH_ASSISTANT_SPEC,
        'If you need to verify a result, do it with explicit symbolic expressions instead of undocumented helper functions.'
      ].join('\n')
    );
  }

  if (planHasRiskySolveIndexing(plan)) {
    onActivity?.({
      kind: 'phase',
      label: 'Revising plan',
      detail: 'Generated Math cells indexed one-variable solve results unsafely'
    });
    plan = await runPlanning(
      [
        planningSystemPrompt,
        'The previous draft solved for a single variable and then indexed into solutions[...] in later Math cells.',
        'That is unsafe for SugarPy Math notebooks because the exact container shape is not guaranteed to match that indexing pattern.',
        'Regenerate the plan without indexing into solutions from a one-variable solve.',
        'For one-variable teaching examples, prefer: show the solve(...) result directly, then verify with explicit symbolic expressions such as sqrt(2)^2 and (-sqrt(2))^2, or another equally explicit documented CAS step.',
        'Do not use solutions[0], solutions[1], solutions[2], or similar indexing after solve(..., x).'
      ].join('\n')
    );
  }

  if (sandboxRunner && planHasRunnableValidationOperations(plan)) {
    onActivity?.({ kind: 'phase', label: 'Validating generated code' });
    plan =
      provider === 'openai'
        ? await runOpenAIValidationLoop(
            apiKey,
            model,
            request,
            context,
            plan,
            sandboxRunner,
            onActivity,
            signal,
            conversationHistory,
            thinkingLevel,
            onNetworkEvent,
            onResponseTrace,
            onSandboxExecution
          )
        : provider === 'groq'
          ? await runGroqValidationLoop(
              apiKey,
              model,
              request,
              context,
              plan,
              sandboxRunner,
              onActivity,
              signal,
              conversationHistory,
              thinkingLevel,
              onNetworkEvent,
              onResponseTrace,
              onSandboxExecution
            )
        : await runGeminiValidationLoop(
            apiKey,
            model,
            request,
            context,
            plan,
            sandboxRunner,
            onActivity,
            signal,
            conversationHistory,
            thinkingLevel,
            onNetworkEvent,
            onResponseTrace,
            onSandboxExecution
          );
  }

  onActivity?.({ kind: 'phase', label: 'Plan ready' });
  return plan;
}
