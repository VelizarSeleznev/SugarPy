import type {
  AssistantSandboxContextPreset,
  AssistantSandboxTarget,
  AssistantSandboxRequest,
  AssistantSandboxResult
} from './assistantSandbox.ts';
import {
  detectAssistantProvider,
} from '../assistant/catalog';
import {
  attachPlanDiagnostics,
  collectAssistantPhotoImportSuspiciousIdentifiers,
  collectPhotoImportStructureDiagnostics,
  getAssistantPhotoImportMarkdownIssue,
  getPlanDiagnostics,
  lineHasAssistantMathProse,
  normalizeAssistantMathSource,
  type AssistantMathNormalizationDiagnostic
} from '../assistant/mathNormalization';
import {
  buildOpenAIPhotoImportInput,
  buildPhotoImportRevisionFeedback,
  buildPlanningPayload,
  buildPlanningSystemPrompt,
  buildValidationPrompt,
  MATH_ASSISTANT_SPEC,
  requestExplicitlyAsksForPython,
  requestLooksLikeDirectGeometrySolve,
  requestLooksMathLike,
  VALIDATION_REQUIRED_REMINDER,
  validationSystemPrompt
} from '../assistant/prompts';
import {
  callGemini,
  callGroqChatCompletions,
  callOpenAIResponses,
  extractOpenAICompatibleText,
  extractOpenAIText,
  extractText,
  parseOpenAICompatibleToolCalls,
  parseOpenAIToolCalls,
  parseToolCalls,
  stripCodeFence,
  truncateText,
  type GeminiContent,
  type GeminiResponse,
  type OpenAICompatibleMessage,
  type OpenAICompatibleResponse,
  type OpenAIResponsesResponse
} from '../assistant/providerTransport';
import { runToolLoop, summarizeCell } from '../assistant/inspection';
import {
  OPENAI_COMPATIBLE_FINALIZE_PLAN_TOOL_DECLARATION,
  OPENAI_COMPATIBLE_PLAN_METADATA_TOOL_DECLARATION,
  OPENAI_COMPATIBLE_PLAN_OPERATION_TOOL_DECLARATION,
  OPENAI_COMPATIBLE_SANDBOX_TOOL_DECLARATION,
  OPENAI_COMPATIBLE_SUBMIT_PLAN_TOOL_DECLARATION,
  OPENAI_FINALIZE_PLAN_TOOL_DECLARATION,
  OPENAI_PLAN_METADATA_TOOL_DECLARATION,
  OPENAI_PLAN_OPERATION_TOOL_DECLARATION,
  OPENAI_SANDBOX_TOOL_DECLARATION,
  OPENAI_SUBMIT_PLAN_TOOL_DECLARATION,
  PLAN_SCHEMA,
  SANDBOX_TOOL_DECLARATION
} from '../assistant/schemas';
import type { AssistantOperation } from '../assistant/types';
import type { CellKind } from '../cells/types';

export {
  ASSISTANT_MODEL_PRESETS,
  ASSISTANT_THINKING_LEVELS,
  DEFAULT_ASSISTANT_MODEL,
  detectAssistantProvider,
  getSupportedThinkingLevels,
  normalizeThinkingLevel
} from '../assistant/catalog';
export { buildOpenAIPhotoImportInput } from '../assistant/prompts';

export type AssistantScope = 'notebook' | 'active';
export type AssistantPreference = 'auto' | 'cas' | 'python' | 'explain';

export type AssistantCellKind = CellKind;

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

const MAX_VALIDATION_ROUNDS = 4;
const MAX_PLANNING_ROUNDS = 16;
const SANDBOX_PREVIEW_LIMIT = 240;
const OPENAI_PLANNING_REQUEST_TIMEOUT_MS = 90000;

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

const getOperationSource = (operation: AssistantOperation) => {
  if (operation.type === 'insert_cell' || operation.type === 'update_cell') {
    return operation.source;
  }
  if (operation.type === 'replace_cell_editable') {
    return typeof operation.document?.source === 'string' ? operation.document.source : '';
  }
  if (operation.type === 'patch_cell') {
    return typeof operation.patch.document?.source === 'string' ? operation.patch.document.source : '';
  }
  return '';
};

const planHasPythonCodeOperations = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) =>
      (operation.type === 'insert_cell' && operation.cellType === 'code' && operation.source.trim()) ||
      (operation.type === 'update_cell' && operation.source.trim()) ||
      ((operation.type === 'patch_cell' || operation.type === 'replace_cell_editable') &&
        getOperationSource(operation).trim())
  );

const planHasRunnableValidationOperations = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) =>
      (operation.type === 'insert_cell' &&
        (operation.cellType === 'code' || operation.cellType === 'math') &&
        operation.source.trim()) ||
      (operation.type === 'update_cell' && operation.source.trim()) ||
      ((operation.type === 'patch_cell' || operation.type === 'replace_cell_editable') &&
        getOperationSource(operation).trim())
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

const planHasUnsupportedMathSyntax = (plan: AssistantPlan) =>
  plan.operations.some(
    (operation) => {
      const source = getOperationSource(operation);
      const targetsMath =
        (operation.type === 'insert_cell' && operation.cellType === 'math') ||
        operation.type === 'update_cell' ||
        operation.type === 'patch_cell' ||
        operation.type === 'replace_cell_editable';
      return targetsMath && getUnsupportedMathPatterns(source).length > 0;
    }
  );

const collectUnsupportedMathWarnings = (plan: AssistantPlan) =>
  plan.operations.flatMap((operation) => {
    const source = getOperationSource(operation);
    if (!source) return [];
    const unsupported = getUnsupportedMathPatterns(source);
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
  operation.type === 'update_cell' ||
  operation.type === 'patch_cell' ||
  operation.type === 'replace_cell_editable';

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
  if (operation.type === 'patch_cell') return 'Patch editable cell data';
  if (operation.type === 'replace_cell_editable') return 'Replace editable cell data';
  if (operation.type === 'set_notebook_defaults') return 'Update notebook defaults';
  if (operation.type === 'patch_user_preferences') return 'Update local user preferences';
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
    if (operation.type === 'set_notebook_defaults' || operation.type === 'patch_user_preferences') {
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
      if (type === 'patch_cell') {
        return {
          type,
          cellId: String(item?.cellId ?? ''),
          patch:
            item?.patch && typeof item.patch === 'object'
              ? JSON.parse(JSON.stringify(item.patch))
              : { document: {}, config: {} },
          reason: item?.reason ? String(item.reason) : undefined
        };
      }
      if (type === 'replace_cell_editable') {
        return {
          type,
          cellId: String(item?.cellId ?? ''),
          document:
            item?.document && typeof item.document === 'object'
              ? JSON.parse(JSON.stringify(item.document))
              : {},
          config:
            item?.config && typeof item.config === 'object'
              ? JSON.parse(JSON.stringify(item.config))
              : {},
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
      if (type === 'patch_user_preferences') {
        return {
          type,
          patch:
            item?.patch && typeof item.patch === 'object'
              ? JSON.parse(JSON.stringify(item.patch))
              : {},
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
  return attachPlanDiagnostics(plan, diagnostics);
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

  onActivity?.({ kind: 'phase', label: 'Generating structured plan' });
  onActivity?.({ kind: 'phase', label: 'Waiting for model', detail: 'Final plan generation' });
  const planningSystemPrompt = buildPlanningSystemPrompt(request, preference, photoImport);
  const planningPayload = buildPlanningPayload({
    request,
    scope,
    preference,
    context,
    conversationHistory,
    notebookManifest,
    inspectedCells: inspection.inspectedCells,
    inspectionNotes: inspection.notes,
    inspectionSummary: inspection.transcript,
    photoImport
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
