export type AssistantScope = 'notebook' | 'active';
export type AssistantPreference = 'auto' | 'cas' | 'python' | 'explain';

export type AssistantCellKind = 'code' | 'markdown' | 'math' | 'stoich';

export type NotebookCellSnapshot = {
  id: string;
  type: AssistantCellKind;
  source: string;
  mathRenderMode?: 'exact' | 'decimal';
  mathTrigMode?: 'deg' | 'rad';
  stoichReaction?: string;
  outputText?: string;
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
};

export type AssistantActivity = {
  kind: 'phase' | 'tool' | 'reference';
  label: string;
  detail?: string;
};

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

type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

type ToolLoopResult = {
  notes: string;
  transcript: string[];
  inspectedCells: Array<ReturnType<typeof renderCellDetail>>;
};

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_TOOL_ROUNDS = 5;
const DETAIL_SOURCE_LIMIT = 700;
const DETAIL_OUTPUT_LIMIT = 240;
const COMPACT_REFERENCE = [
  'SugarPy compact reference:',
  '- Cell types: code, markdown, math, stoich.',
  '- Math cells are CAS-style, not Python-style.',
  '- In Math cells: = means equation, := means assignment, ^ is exponent, implicit multiplication works.',
  '- Math cells share namespace with Code cells.',
  '- Notebook defaults include trig mode (deg/rad) and render mode (exact/decimal).',
  '- Each Math cell may override trig/render mode.',
  '- Math plotting uses plot(...).',
  '- Safe plotting defaults for geometry: prefer implicit equations or directly plottable expressions.',
  '- For circles and geometry, prefer circle := equation and then plot(circle, ..., equal_axes=True).',
  '- Do not rely on trig parameterizations unless the user explicitly asks for them.',
  '- Trig expressions in Math cells depend on Deg/Rad mode.',
  '- If a graph is requested, generate notebook content that actually renders the graph in SugarPy.',
  '- Stoich cells are for chemistry tables, not generic math.',
  '- Prefer CAS-first outputs when the task is naturally symbolic or equation-based.'
].join('\n');
const REFERENCE_SECTIONS = {
  overview: [
    'SugarPy product overview:',
    '- Notebook app with code, markdown, math, and stoich cells.',
    '- Optional Gemini assistant edits notebook cells through structured operations.',
    '- Run All executes code, math, and stoich cells top-to-bottom.',
    '- Header defaults include Degrees/Radians and Exact/Decimal for Math cells.'
  ].join('\n'),
  math_cells: [
    'Math cell reference:',
    '- CAS-style input over SymPy.',
    '- = means equation; := means assignment.',
    '- ^ is exponent; implicit multiplication works.',
    '- Multiple statements per cell are allowed.',
    '- Math cells share namespace with Code cells.',
    '- Trig mode is deg or rad and affects trig evaluation.',
    '- Prefer Math cells for symbolic equations, solve, expand, factor, N, and plot workflows.'
  ].join('\n'),
  plotting: [
    'Plotting reference:',
    '- plot(...) works in Code and Math cells.',
    '- Supported options include xmin, xmax, ymin, ymax, equal_axes, showlegend, title.',
    '- Geometry-safe pattern: store an implicit equation assignment, then call plot(name, ...).',
    '- Example: circle := (x-2)^2 + (y+10)^2 = 25; plot(circle, xmin=-5, xmax=9, equal_axes=True).',
    '- Do not assume parametric plotting support from plot(x(t), y(t), t=...).',
    '- Trig-based plotting in Math cells depends on the Deg/Rad mode.',
    '- If a non-trig form exists, prefer it.'
  ].join('\n'),
  cell_types: [
    'Cell type reference:',
    '- code: Python execution.',
    '- markdown: text/notes.',
    '- math: CAS symbolic input with rendered math card.',
    '- stoich: chemistry stoichiometry table over a reaction.'
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
      }
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
            enum: ['code', 'markdown', 'math', 'stoich']
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

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const stripCodeFence = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

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

const summarizeCell = (cell: NotebookCellSnapshot) => ({
  id: cell.id,
  type: cell.type,
  preview: previewText(cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source),
  hasError: !!cell.hasError
});

const renderCellDetail = (cell: NotebookCellSnapshot | null) => {
  if (!cell) return null;
  return {
    id: cell.id,
    type: cell.type,
    source: truncateText(cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source, DETAIL_SOURCE_LIMIT),
    mathRenderMode: cell.mathRenderMode,
    mathTrigMode: cell.mathTrigMode,
    outputText: truncateText(cell.outputText || '', DETAIL_OUTPUT_LIMIT),
    hasError: !!cell.hasError
  };
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

const extractText = (response: GeminiResponse) => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part): part is Extract<GeminiPart, { text: string }> => 'text' in part)
    .map((part) => part.text)
    .join('\n')
    .trim();
};

const callGemini = async (
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  retries = 3
): Promise<GeminiResponse> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${API_ROOT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          throw new Error(`Gemini API rate/quota limit hit (429). Wait a bit and retry. ${errorText}`);
        }
        if (response.status === 503 && attempt < retries) {
          await wait(1200 * (attempt + 1));
          continue;
        }
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }
      return (await response.json()) as GeminiResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      await wait(1000 * (attempt + 1));
    }
  }
  throw lastError ?? new Error('Gemini API request failed.');
};

const runToolLoop = async (
  apiKey: string,
  model: string,
  request: string,
  scope: AssistantScope,
  context: NotebookAssistantContext,
  onActivity?: (item: AssistantActivity) => void
): Promise<ToolLoopResult> => {
  onActivity?.({ kind: 'phase', label: 'Starting notebook inspection' });
  const contents: GeminiContent[] = [
    {
      role: 'user',
      parts: [
        {
          text: [
            'You are helping edit a SugarPy notebook.',
            COMPACT_REFERENCE,
            'First inspect the notebook using the available tools before planning changes.',
            'Only inspect what you need. Prefer concise tool usage.',
            `Scope preference: ${scope}.`,
            `User request: ${request}`
          ].join('\n')
        }
      ]
    }
  ];
  const transcript: string[] = [];
  const seenCalls = new Set<string>();
  const inspectedCells = new Map<string, ReturnType<typeof renderCellDetail>>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callGemini(apiKey, model, {
      systemInstruction: {
        parts: [
          {
            text: [
              'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.',
              'Use get_reference when platform behavior matters.'
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
    });

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

const normalizePlan = (raw: any): AssistantPlan => {
  const operations = Array.isArray(raw?.operations) ? raw.operations : [];
  return {
    summary: String(raw?.summary ?? 'Prepared a notebook change set.'),
    userMessage: String(raw?.userMessage ?? ''),
    warnings: Array.isArray(raw?.warnings) ? raw.warnings.map((item: unknown) => String(item)) : [],
    operations: operations
      .map((item: any) => {
        const type = String(item?.type ?? '');
        if (type === 'insert_cell') {
          return {
            type,
            index: Number(item?.index ?? 0),
            cellType: (item?.cellType ?? 'code') as AssistantCellKind,
            source: String(item?.source ?? ''),
            reason: item?.reason ? String(item.reason) : undefined
          };
        }
        if (type === 'update_cell') {
          return {
            type,
            cellId: String(item?.cellId ?? ''),
            source: String(item?.source ?? ''),
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
      .filter(Boolean) as AssistantOperation[]
  };
};

export async function planNotebookChanges(params: {
  apiKey: string;
  model: string;
  request: string;
  scope: AssistantScope;
  preference: AssistantPreference;
  context: NotebookAssistantContext;
  onActivity?: (item: AssistantActivity) => void;
}) {
  const { apiKey, model, request, scope, preference, context, onActivity } = params;
  onActivity?.({ kind: 'phase', label: 'Preparing context' });
  const inspection = await runToolLoop(apiKey, model, request, scope, context, onActivity);
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
          'Choose the most native SugarPy representation for the task.'
        ];
    }
  })();

  onActivity?.({ kind: 'phase', label: 'Generating structured plan' });
  const planResponse = await callGemini(apiKey, model, {
    systemInstruction: {
      parts: [
        {
          text: [
            'You are generating a structured SugarPy notebook change set.',
            COMPACT_REFERENCE,
            'Return only operations that can be applied safely and deterministically.',
            'Use only these operation types: insert_cell, update_cell, delete_cell, move_cell, set_notebook_defaults.',
            'For stoich cells, store the reaction text in source.',
            'Prefer minimal edits over broad rewrites.',
            'Do not invent cell ids that do not exist.',
            'Prefer notebook content that is natively supported by SugarPy over mathematically equivalent but less compatible forms.',
            'When there are multiple equivalent representations, choose the one that SugarPy can execute, render, and plot directly with the current documented behavior.',
            'For geometry and plotting tasks, prefer implicit equations or directly plottable expressions over parametric forms unless the user explicitly asked for a parametric representation.',
            'Do not assume plot() supports representations that are not documented in SugarPy.',
            'If a request asks for a graph, generate notebook content that will actually produce the graph, not just helper definitions.',
            'SugarPy Math cells are sensitive to the notebook or cell trig mode (Deg/Rad).',
            'Do not generate trig-based plotting formulas whose correctness depends on the current Deg/Rad toggle unless the user explicitly asked for that form.',
            'If a geometric plot can be written without trig, prefer the trig-free form.',
            'If you choose a trig-based form, you must account for the current trig mode explicitly or change notebook defaults on purpose.',
            ...preferenceRules
          ].join('\n')
        }
      ]
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: JSON.stringify(
              {
                userRequest: request,
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
                inspectionSummary: inspection.transcript
              }
            )
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: PLAN_SCHEMA
    }
  });

  const rawText = stripCodeFence(extractText(planResponse));
  const parsed = rawText ? JSON.parse(rawText) : {};
  onActivity?.({ kind: 'phase', label: 'Plan ready' });
  return normalizePlan(parsed);
}
