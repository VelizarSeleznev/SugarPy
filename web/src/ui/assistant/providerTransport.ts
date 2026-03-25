import { normalizeThinkingLevel } from './catalog';
import { buildAssistantProxyBaseUrl } from '../utils/backendApi';
import type {
  AssistantNetworkEvent,
  AssistantResponseTrace,
  AssistantThinkingLevel
} from '../utils/assistant';

const SERVER_PROXY_KEY_PREFIX = 'server-proxy:';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_API_ROOT = 'https://api.groq.com/openai/v1';
const GEMINI_REQUEST_TIMEOUT_MS = 45000;
const OPENAI_DEFAULT_REQUEST_TIMEOUT_MS = 45000;

export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
};

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: unknown } } };

export type GeminiContent = {
  role: 'user' | 'model' | 'tool';
  parts: GeminiPart[];
};

export type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
      role?: 'model';
    };
  }>;
};

export type OpenAIResponsesResponse = {
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
  error?: {
    message?: string;
  };
};

export type OpenAICompatibleTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type OpenAICompatibleMessage = {
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

export type OpenAICompatibleResponse = {
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

const isServerProxyKey = (apiKey: string) => apiKey.trim().startsWith(SERVER_PROXY_KEY_PREFIX);

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

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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

export const stripCodeFence = (raw: string) =>
  raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

export const truncateText = (value: string, limit: number) => {
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
};

export const parseToolCalls = (response: GeminiResponse): ToolCall[] => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part): part is Extract<GeminiPart, { functionCall: { name: string; args?: Record<string, unknown> } }> => 'functionCall' in part)
    .map((part) => ({
      name: part.functionCall.name,
      args: (part.functionCall.args ?? {}) as Record<string, unknown>
    }));
};

export const parseOpenAIToolCalls = (response: OpenAIResponsesResponse): ToolCall[] => {
  const calls = (response.output ?? []).filter((item) => item?.type === 'function_call' && item.name);
  return calls.map((call) => {
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

export const parseOpenAICompatibleToolCalls = (response: OpenAICompatibleResponse): ToolCall[] => {
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

export const extractText = (response: GeminiResponse) => {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part): part is Extract<GeminiPart, { text: string }> => 'text' in part)
    .map((part) => part.text)
    .join('\n')
    .trim();
};

export const extractOpenAIText = (response: OpenAIResponsesResponse) =>
  (response.output ?? [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n')
    .trim();

export const extractOpenAICompatibleText = (response: OpenAICompatibleResponse) =>
  (response.choices?.[0]?.message?.content ?? '').trim();

const buildThinkingConfig = (model: string, thinkingLevel: AssistantThinkingLevel) => {
  const normalizedLevel = normalizeThinkingLevel(model, thinkingLevel);
  if (normalizedLevel === 'dynamic') return undefined;
  return {
    thinkingConfig: {
      thinkingLevel: normalizedLevel
    }
  };
};

const buildOpenAIReasoningEffort = (model: string, thinkingLevel: AssistantThinkingLevel) => {
  const normalizedLevel = normalizeThinkingLevel(model, thinkingLevel);
  if (normalizedLevel === 'dynamic') return undefined;
  return normalizedLevel;
};

export const toOpenAICompatibleTools = (
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

export const callGemini = async (
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
      onNetworkEvent?.({ phase: 'request_start', attempt: attempt + 1, stage });
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
          headers: isServerProxyKey(apiKey)
            ? Object.fromEntries(buildServerProxyHeaders().entries())
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            generationConfig
          }),
          signal: requestController.signal,
          ...(isServerProxyKey(apiKey) ? { credentials: 'same-origin' as const } : {})
        }
      );
      onNetworkEvent?.({ phase: 'response', attempt: attempt + 1, stage, status: response.status });
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, status: response.status, detail: errorText });
          throw new Error(`Gemini API rate/quota limit hit (429). Wait a bit and retry. ${errorText}`);
        }
        if (response.status === 503 && attempt < retries) {
          onNetworkEvent?.({ phase: 'retry', attempt: attempt + 1, stage, status: response.status, detail: '503 Service Unavailable' });
          await wait(1200 * (attempt + 1));
          continue;
        }
        onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, status: response.status, detail: errorText });
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
        onNetworkEvent?.({ phase: 'timeout', attempt: attempt + 1, stage, detail: `Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms` });
        lastError = new Error(`Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms.`);
        break;
      }
      if (signal?.aborted) {
        onNetworkEvent?.({ phase: 'aborted', attempt: attempt + 1, stage, detail: error instanceof Error ? error.message : String(error) });
        throw error instanceof Error ? error : new Error(String(error));
      }
      onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, detail: error instanceof Error ? error.message : String(error) });
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      onNetworkEvent?.({ phase: 'retry', attempt: attempt + 1, stage, detail: 'Retrying after transport error' });
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

export const callOpenAIResponses = async (
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
      const response = await fetch(
        isServerProxyKey(apiKey) ? `${buildAssistantProxyBaseUrl()}openai/responses` : 'https://api.openai.com/v1/responses',
        {
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
        }
      );
      lastActivity = 'response_headers';
      inactivityTimeout.touch();
      onNetworkEvent?.({ phase: 'response', attempt: attempt + 1, stage, status: response.status });
      const contentType = response.headers.get('content-type') || '';
      const streamToolCalls = new Map<number, { id?: string; call_id?: string; name?: string; arguments: string }>();
      const readStreamResponse = async (): Promise<OpenAIResponsesResponse> => {
        if (!response.body) throw new Error('OpenAI stream response body was empty.');
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
            if (event.response?.id) responseId = event.response.id;
            if (
              event.type === 'response.created' ||
              event.type === 'response.in_progress' ||
              event.type === 'response.completed'
            ) {
              onNetworkEvent?.({ phase: 'stream', attempt: attempt + 1, stage, detail: event.type });
            }
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
              partialText += event.delta;
              if (!emittedTextStart) {
                emittedTextStart = true;
                onNetworkEvent?.({ phase: 'stream', attempt: attempt + 1, stage, detail: 'response.output_text.delta' });
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
                onNetworkEvent?.({ phase: 'stream', attempt: attempt + 1, stage, detail: 'response.function_call_arguments.delta' });
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
            if (event.type === 'response.completed' && event.response) completedResponse = event.response;
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
          onNetworkEvent?.({ phase: 'retry', attempt: attempt + 1, stage, status: response.status, detail: errorText });
          await wait(1200 * (attempt + 1));
          continue;
        }
        onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, status: response.status, detail: errorText });
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
        onNetworkEvent?.({ phase: 'timeout', attempt: attempt + 1, stage, detail: `OpenAI request timed out after ${requestTimeoutMs}ms.${streamHint}` });
        lastError = new Error(`OpenAI request timed out after ${requestTimeoutMs}ms.${streamHint}`);
        break;
      }
      if (signal?.aborted) {
        onNetworkEvent?.({ phase: 'aborted', attempt: attempt + 1, stage, detail: error instanceof Error ? error.message : String(error) });
        throw error instanceof Error ? error : new Error(String(error));
      }
      onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, detail: error instanceof Error ? error.message : String(error) });
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      onNetworkEvent?.({ phase: 'retry', attempt: attempt + 1, stage, detail: 'Retrying after transport error' });
      await wait(1000 * (attempt + 1));
    } finally {
      inactivityTimeout.clear();
      if (signal) signal.removeEventListener('abort', abortFromParent);
    }
  }
  throw lastError ?? new Error('OpenAI API request failed.');
};

export const callGroqChatCompletions = async (
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
      const response = await fetch(
        isServerProxyKey(apiKey) ? `${buildAssistantProxyBaseUrl()}groq/chat/completions` : `${GROQ_API_ROOT}/chat/completions`,
        {
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
        }
      );
      lastActivity = 'response_headers';
      inactivityTimeout.touch();
      onNetworkEvent?.({ phase: 'response', attempt: attempt + 1, stage, status: response.status });
      const contentType = response.headers.get('content-type') || '';
      const readStreamResponse = async (): Promise<OpenAICompatibleResponse> => {
        if (!response.body) throw new Error('Groq stream response body was empty.');
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
              onNetworkEvent?.({ phase: 'stream', attempt: attempt + 1, stage, detail: `finish:${choice.finish_reason}` });
            }
            if (delta?.content) {
              partialText += delta.content;
              lastStreamEvent = 'content';
              onNetworkEvent?.({ phase: 'stream', attempt: attempt + 1, stage, detail: 'chat.completions.delta.content' });
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
              onNetworkEvent?.({ phase: 'stream', attempt: attempt + 1, stage, detail: 'chat.completions.delta.tool_calls' });
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
          onNetworkEvent?.({ phase: 'retry', attempt: attempt + 1, stage, status: response.status, detail: errorText });
          await wait(1200 * (attempt + 1));
          continue;
        }
        onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, status: response.status, detail: errorText });
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
        onNetworkEvent?.({ phase: 'timeout', attempt: attempt + 1, stage, detail: `Groq request timed out after ${requestTimeoutMs}ms.${streamHint}` });
        lastError = new Error(`Groq request timed out after ${requestTimeoutMs}ms.${streamHint}`);
        break;
      }
      if (signal?.aborted) {
        onNetworkEvent?.({ phase: 'aborted', attempt: attempt + 1, stage, detail: error instanceof Error ? error.message : String(error) });
        throw error instanceof Error ? error : new Error(String(error));
      }
      onNetworkEvent?.({ phase: 'error', attempt: attempt + 1, stage, detail: error instanceof Error ? error.message : String(error) });
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= retries) break;
      onNetworkEvent?.({ phase: 'retry', attempt: attempt + 1, stage, detail: 'Retrying after transport error' });
      await wait(1000 * (attempt + 1));
    } finally {
      inactivityTimeout.clear();
      if (signal) signal.removeEventListener('abort', abortFromParent);
    }
  }
  throw lastError ?? new Error('Groq API request failed.');
};
