import { detectAssistantProvider } from './catalog';
import {
  buildInspectionPrompt,
  buildOpenAIPhotoImportInput,
  REFERENCE_SECTIONS
} from './prompts';
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
  type GeminiContent,
  type GeminiPart
} from './providerTransport';
import { OPENAI_COMPATIBLE_TOOL_DECLARATIONS, OPENAI_TOOL_DECLARATIONS } from './schemas';
import type {
  AssistantActivity,
  AssistantConversationEntry,
  AssistantNetworkEvent,
  AssistantPhotoImportInput,
  AssistantResponseTrace,
  AssistantScope,
  AssistantThinkingLevel,
  NotebookAssistantContext,
  NotebookCellSnapshot
} from '../utils/assistant';

const MAX_TOOL_ROUNDS = 5;
const DETAIL_SOURCE_LIMIT = 700;
const DETAIL_OUTPUT_LIMIT = 240;

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

export const summarizeCell = (cell: NotebookCellSnapshot) => ({
  id: cell.id,
  type: cell.type,
  preview: previewText(cell.type === 'stoich' ? cell.stoichReaction || '' : cell.source),
  hasOutput: !!cell.hasOutput,
  hasError: !!cell.hasError,
  outputPreview: cell.outputPreview ? previewText(cell.outputPreview, 100) : ''
});

export const renderCellDetail = (cell: NotebookCellSnapshot | null) => {
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

type ToolLoopResult = {
  notes: string;
  transcript: string[];
  inspectedCells: Array<ReturnType<typeof renderCellDetail>>;
};

type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
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

const executeTool = (tool: ToolCall, context: NotebookAssistantContext, scope: AssistantScope) => {
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
      const category = String(tool.args.category || 'all') as 'all' | 'errors' | 'solve-plot' | 'helpers' | 'markdown';
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

const recordToolUsage = (
  toolCall: ToolCall,
  result: unknown,
  transcript: string[],
  inspectedCells: Map<string, ReturnType<typeof renderCellDetail>>,
  onActivity?: (item: AssistantActivity) => void
) => {
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
};

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
      parts: [{ text: buildInspectionPrompt(request, scope, conversationHistory) }]
    }
  ];
  const transcript: string[] = [];
  const seenCalls = new Set<string>();
  const inspectedCells = new Map<string, ReturnType<typeof renderCellDetail>>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onActivity?.({ kind: 'phase', label: 'Waiting for model', detail: `Inspection round ${round + 1}` });
    const response = await callGemini(
      apiKey,
      model,
      {
        systemInstruction: {
          parts: [
            {
              text: 'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.\nUse get_reference when platform behavior matters.'
            }
          ]
        },
        contents,
        tools: [{ functionDeclarations: OPENAI_TOOL_DECLARATIONS.map(({ name, description, parameters }) => ({ name, description, parameters })) }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO'
          }
        },
        generationConfig: {
          temperature: 0.2
        }
      },
      3,
      signal,
      thinkingLevel,
      onNetworkEvent,
      'inspection',
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
      const notes = extractText(response);
      if (notes) transcript.push(`Model notes: ${notes}`);
      onActivity?.({ kind: 'phase', label: 'Inspection finished', detail: notes || 'No extra notes.' });
      return { notes, transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }
    const toolResponses: GeminiPart[] = [];
    toolCalls.forEach((toolCall) => {
      const signature = JSON.stringify({ name: toolCall.name, args: toolCall.args ?? {} });
      if (seenCalls.has(signature)) return;
      seenCalls.add(signature);
      const result = executeTool(toolCall, context, scope);
      recordToolUsage(toolCall, result, transcript, inspectedCells, onActivity);
      toolResponses.push({
        functionResponse: {
          name: toolCall.name,
          response: { result }
        }
      });
    });
    if (toolResponses.length === 0) {
      onActivity?.({ kind: 'phase', label: 'Inspection stopped', detail: 'Repeated tool calls were ignored.' });
      return { notes: 'Stopped tool inspection after repeated tool calls.', transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }
    contents.push({ role: 'tool', parts: toolResponses });
  }
  return { notes: '', transcript, inspectedCells: Array.from(inspectedCells.values()) };
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
  const instructions =
    'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.\nUse get_reference when platform behavior matters.';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onActivity?.({ kind: 'phase', label: 'Waiting for model', detail: `Inspection round ${round + 1}` });
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
      const result = isRepeated ? { ignored: true, reason: 'Repeated tool call was ignored.' } : executeTool(toolCall, context, scope);
      if (!isRepeated) {
        recordToolUsage(toolCall, result, transcript, inspectedCells, onActivity);
      }
      toolOutputs.push({
        type: 'function_call_output',
        call_id: toolCall.id || `tool-call-${round}-${index}`,
        output: JSON.stringify(result)
      });
    });
    if (uniqueToolCount === 0) {
      onActivity?.({ kind: 'phase', label: 'Inspection stopped', detail: 'Repeated tool calls were ignored.' });
      return { notes: 'Stopped tool inspection after repeated tool calls.', transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }
    nextInput = toolOutputs;
  }
  return { notes: '', transcript, inspectedCells: Array.from(inspectedCells.values()) };
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
  const messages = [
    {
      role: 'system' as const,
      content: 'Inspect the notebook with function calls, then respond with short planning notes once you have enough context.\nUse get_reference when platform behavior matters.'
    },
    {
      role: 'user' as const,
      content: buildInspectionPrompt(request, scope, conversationHistory)
    }
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onActivity?.({ kind: 'phase', label: 'Waiting for model', detail: `Inspection round ${round + 1}` });
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
      const result = isRepeated ? { ignored: true, reason: 'Repeated tool call was ignored.' } : executeTool(toolCall, context, scope);
      if (!isRepeated) {
        recordToolUsage(toolCall, result, transcript, inspectedCells, onActivity);
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id || `tool-call-${round}-${index}`,
        content: JSON.stringify(result)
      });
    });
    if (uniqueToolCount === 0) {
      onActivity?.({ kind: 'phase', label: 'Inspection stopped', detail: 'Repeated tool calls were ignored.' });
      return { notes: 'Stopped tool inspection after repeated tool calls.', transcript, inspectedCells: Array.from(inspectedCells.values()) };
    }
  }
  return { notes: '', transcript, inspectedCells: Array.from(inspectedCells.values()) };
};

export const runToolLoop = async (
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
  const provider = detectAssistantProvider(model, apiKey);
  if (provider === 'gemini') {
    if (photoImport) throw new Error('Photo import tool-loop inspection currently requires an OpenAI model.');
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
    if (photoImport) throw new Error('Photo import tool-loop inspection currently requires an OpenAI model.');
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
