import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ContentsManager, KernelManager, ServerConnection } from '@jupyterlab/services';

import { FunctionEntry, useFunctionLibrary } from './hooks/useFunctionLibrary';
import { NotebookCell } from './components/NotebookCell';
import { AssistantDrawer } from './components/AssistantDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildSuggestions } from './utils/suggestUtils';
import { extractFunctionNames } from './utils/functionParse';
import { moveCellDown, moveCellUp, deleteCell } from './utils/cellOps';
import { StoichOutput, StoichState } from './utils/stoichTypes';
import {
  AssistantActivity,
  AssistantConversationEntry,
  AssistantNetworkEvent,
  AssistantResponseTrace,
  AssistantSandboxExecutionTrace,
  DEFAULT_ASSISTANT_MODEL,
  detectAssistantProvider,
  normalizeThinkingLevel,
  AssistantOperation,
  AssistantPlan,
  AssistantThinkingLevel,
  planNotebookChanges
} from './utils/assistant';
import {
  AssistantSandboxNotebookCell,
  AssistantSandboxRequest,
  buildAssistantBootstrapCode,
  runAssistantSandbox as runIsolatedAssistantSandbox
} from './utils/assistantSandbox';
import {
  createNotebookId,
  deserializeIpynb,
  deserializeSugarPy,
  downloadBlob,
  loadFromLocalStorage,
  loadLastOpenId,
  pruneLocalNotebookSnapshots,
  removeStorageItem,
  readFileAsText,
  saveToLocalStorage,
  serializeIpynb,
  serializeSugarPy,
  writeStorageItem
} from './utils/notebookIO';

export type CellModel = {
  id: string;
  source: string;
  output?: CellOutput;
  type?: 'code' | 'markdown' | 'math' | 'stoich';
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
};

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

const createStoichState = (reaction = ''): StoichState => ({
  reaction,
  inputs: {}
});

const slugifyCommand = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
};

const getCommandName = (fn: FunctionEntry) => {
  if (fn.signature) {
    const base = fn.signature.split('(')[0]?.trim();
    if (base) return base;
  }
  return slugifyCommand(fn.title || '');
};

const asText = (value: unknown) => {
  if (Array.isArray(value)) return value.join('');
  if (value === null || value === undefined) return '';
  return String(value);
};

const SUGARPY_MIME_MATH = 'application/vnd.sugarpy.math+json';
const SUGARPY_MIME_STOICH = 'application/vnd.sugarpy.stoich+json';
const SERVER_AUTOSAVE_DIR = 'notebooks/sugarpy-autosave';
const ASSISTANT_TRACE_SERVER_DIR = 'notebooks/sugarpy-assistant-traces';
const ASSISTANT_SERVER_CONFIG_PATH = 'notebooks/sugarpy-assistant-config.json';
const ASSISTANT_HISTORY_STORAGE_PREFIX = 'sugarpy:assistant:history:v1:';
const ASSISTANT_TRACE_STORAGE_PREFIX = 'sugarpy:assistant:traces:v1:';
const ASSISTANT_API_KEY_STORAGE = 'sugarpy:assistant:api:key';
const ASSISTANT_MODEL_STORAGE = 'sugarpy:assistant:model';
const ASSISTANT_THINKING_STORAGE = 'sugarpy:assistant:thinking';
const ASSISTANT_SCOPE: 'notebook' = 'notebook';
const ASSISTANT_PREFERENCE: 'auto' = 'auto';

type AssistantSnapshot = {
  cells: CellModel[];
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  activeCellId: string | null;
};

type AssistantRuntimeConfig = {
  apiKey?: string;
  model?: string;
};

const matchesAssistantProvider = (apiKey: string, model: string) => {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  const provider = detectAssistantProvider(model);
  if (provider === 'openai') {
    return trimmed.startsWith('sk-');
  }
  return trimmed.startsWith('AIza');
};

type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'loading' | 'ready' | 'error' | 'stopped' | 'applied' | 'dismissed';
  activity?: AssistantActivity[];
  plan?: AssistantPlan | null;
  error?: string;
};

type AssistantChatSession = {
  id: string;
  title: string;
  messages: AssistantChatMessage[];
  updatedAt: string;
};

type AssistantRunTrace = {
  id: string;
  chatId: string;
  messageId: string;
  notebookId: string;
  notebookName: string;
  prompt: string;
  model: string;
  thinkingLevel: AssistantThinkingLevel;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'running' | 'completed' | 'error' | 'stopped';
  error?: string;
  context: {
    cellCount: number;
    activeCellId: string | null;
    defaults: {
      trigMode: 'deg' | 'rad';
      renderMode: 'exact' | 'decimal';
    };
  };
  conversationHistory: AssistantConversationEntry[];
  activity: AssistantActivity[];
  network: AssistantNetworkEvent[];
  responses: AssistantResponseTrace[];
  sandboxExecutions: AssistantSandboxExecutionTrace[];
  result?: {
    summary: string;
    warningCount: number;
    operationCount: number;
  };
};

const previewAssistantLabel = (value: string, fallback: string) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.length <= 36 ? compact : `${compact.slice(0, 35)}…`;
};

const createAssistantChat = (title = 'New chat'): AssistantChatSession => {
  const now = new Date().toISOString();
  return {
    id: `assistant-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [],
    updatedAt: now
  };
};

const getAssistantTraceStorageKey = (id: string) => `${ASSISTANT_TRACE_STORAGE_PREFIX}${id}`;

const isCanceledFutureError = (error: unknown) => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Canceled future for execute_request message before replies were done');
};

const isDeadKernelError = (error: unknown) => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('kernel is dead');
};

const CELL_EXECUTION_TIMEOUT_MS = 20_000;

const isExecutionTimeoutError = (error: unknown) => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Cell execution timed out after');
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: number | null = null;
  try {
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      window.clearTimeout(timer);
    }
  }
};

const awaitFutureDoneWithTimeout = async (future: any, kernel: any) => {
  try {
    return await withTimeout(future.done, CELL_EXECUTION_TIMEOUT_MS, 'Cell execution');
  } catch (error) {
    if (!isExecutionTimeoutError(error)) {
      throw error;
    }
    try {
      await kernel?.interrupt();
    } catch {
      // Keep the timeout visible even if kernel interruption fails.
    }
    throw new Error(`Cell execution timed out after ${CELL_EXECUTION_TIMEOUT_MS}ms. The kernel was interrupted.`);
  }
};

const resolveDefaultServerUrl = () => {
  const envUrl = (import.meta.env.VITE_JUPYTER_URL || '').trim();
  const host = window.location.hostname.toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (envUrl) {
    const envLooksLocal =
      envUrl.startsWith('http://localhost') || envUrl.startsWith('http://127.0.0.1') || envUrl.startsWith('https://localhost');
    if (envLooksLocal && !isLocalHost) {
      return '/jupyter/';
    }
    return envUrl;
  }
  return isLocalHost ? 'http://localhost:8888' : '/jupyter/';
};

const resolveServerConfig = (rawServerUrl: string) => {
  const fallback = resolveDefaultServerUrl();
  const trimmed = (rawServerUrl || '').trim() || fallback;
  const resolved = new URL(trimmed, window.location.origin);
  const protocol = resolved.protocol.toLowerCase();
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = resolved.toString().replace(/\/?$/, '/');
  const wsUrl = `${wsProtocol}//${resolved.host}${resolved.pathname.replace(/\/?$/, '/')}`;
  return { baseUrl, wsUrl };
};

const isEditableElement = (element: Element | null) => {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element.matches('input, textarea, select')) return true;
  if (element.closest('.cm-editor')) return true;
  return false;
};

const readOptionalStorageItem = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
};

function App() {
  const defaultServerUrl = resolveDefaultServerUrl();
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [token, setToken] = useState(import.meta.env.VITE_JUPYTER_TOKEN || 'sugarpy');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [kernel, setKernel] = useState<any>(null);
  const [cells, setCells] = useState<CellModel[]>([]);
  const { allFunctions } = useFunctionLibrary();
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false);
  const [userFunctions, setUserFunctions] = useState<string[]>([]);
  const [execCounter, setExecCounter] = useState(0);
  const [trigMode, setTrigMode] = useState<'deg' | 'rad'>('deg');
  const [defaultMathRenderMode, setDefaultMathRenderMode] = useState<'exact' | 'decimal'>('exact');
  const [notebookId, setNotebookId] = useState(createNotebookId());
  const [notebookName, setNotebookName] = useState('Untitled');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [configureConnection, setConfigureConnection] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [mobileActionsEligible, setMobileActionsEligible] = useState(false);
  const [mobileKeyboardOpen, setMobileKeyboardOpen] = useState(false);
  const [mobileEditorCellId, setMobileEditorCellId] = useState<string | null>(null);
  const [mobileVisualTop, setMobileVisualTop] = useState(0);
  const [mobileVisualHeight, setMobileVisualHeight] = useState(window.innerHeight);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantApiKey, setAssistantApiKey] = useState('');
  const [assistantDefaultApiKey, setAssistantDefaultApiKey] = useState(
    import.meta.env.VITE_ASSISTANT_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || ''
  );
  const [assistantModel, setAssistantModel] = useState(
    import.meta.env.VITE_ASSISTANT_MODEL || import.meta.env.VITE_OPENAI_MODEL || import.meta.env.VITE_GEMINI_MODEL || DEFAULT_ASSISTANT_MODEL
  );
  const [assistantThinkingLevel, setAssistantThinkingLevel] = useState<AssistantThinkingLevel>('dynamic');
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantChats, setAssistantChats] = useState<AssistantChatSession[]>([]);
  const [assistantActiveChatId, setAssistantActiveChatId] = useState<string | null>(null);
  const [assistantUndoStack, setAssistantUndoStack] = useState<AssistantSnapshot[]>([]);
  const mathSuggestions = useMemo(
    () => [
      { label: 'sqrt', detail: 'square root' },
      { label: 'sin', detail: 'sine' },
      { label: 'cos', detail: 'cosine' },
      { label: 'tan', detail: 'tangent' },
      { label: 'asin', detail: 'inverse sine' },
      { label: 'acos', detail: 'inverse cosine' },
      { label: 'atan', detail: 'inverse tangent' },
      { label: 'log', detail: 'logarithm (base e by default)' },
      { label: 'ln', detail: 'natural log' },
      { label: 'exp', detail: 'exponential' },
      { label: 'abs', detail: 'absolute value' },
      { label: 'pi', detail: 'pi constant' },
      { label: 'e', detail: 'Euler constant' },
      { label: 'render_decimal', detail: 'render expression as decimal (with optional places)' },
      { label: 'render_exact', detail: 'render expression in exact symbolic form' },
      { label: 'set_decimal_places', detail: 'set default decimal places for render_decimal' },
    ],
    []
  );
  const connectOnce = useRef(false);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const autosaveServerTimer = useRef<number | undefined>(undefined);
  const localAutosaveWarningShown = useRef(false);
  const hydrated = useRef(false);
  const lastSnapshot = useRef<string>('');
  const contentsRef = useRef<ContentsManager | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const assistantDrawerRef = useRef<HTMLDivElement | null>(null);
  const assistantToggleRef = useRef<HTMLButtonElement | null>(null);
  const assistantRuntimeConfigAttemptedRef = useRef(false);
  const assistantHistoryNotebookRef = useRef<string | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantTracePendingRef = useRef<Map<string, AssistantRunTrace>>(new Map());
  const assistantTraceFlushRef = useRef<Map<string, Promise<void>>>(new Map());
  const ensuredServerDirsRef = useRef<Set<string>>(new Set());
  const ensuringServerDirsRef = useRef<Map<string, Promise<void>>>(new Map());
  const connectingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const kernelRef = useRef<any>(null);
  const reconnectAttemptsRef = useRef(0);
  const slashData = useMemo(() => {
    const map = new Map<string, FunctionEntry>();
    const list: { label: string; detail?: string }[] = [];
    allFunctions.forEach((fn) => {
      const name = getCommandName(fn);
      if (!name || map.has(name)) return;
      map.set(name, fn);
      list.push({ label: name, detail: fn.signature ?? fn.description });
    });
    return { map, list };
  }, [allFunctions]);
  const slashCommands = slashData.list;
  const slashCommandMap = slashData.map;
  const codeSuggestions = useMemo(
    () => [
      ...buildSuggestions(allFunctions),
      ...userFunctions.map((name) => ({ label: name, detail: 'user function' }))
    ],
    [allFunctions, userFunctions]
  );
  const assistantBootstrapCode = useMemo(() => buildAssistantBootstrapCode(allFunctions), [allFunctions]);

  const connectKernel = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setStatus('connecting');
    setStatusDetail('Initializing environment...');
    setErrorMsg('');
    try {
      if (kernel) {
        try {
          await kernel.shutdown();
        } catch (_err) {
          // ignore stale kernel shutdown failures
        }
        setKernel(null);
        kernelRef.current = null;
      }
      const { baseUrl, wsUrl } = resolveServerConfig(serverUrl);
      const settings = ServerConnection.makeSettings({
        baseUrl,
        token,
        wsUrl,
        appendToken: true
      });
      const manager = new KernelManager({ serverSettings: settings });
      const newKernel = await withTimeout(manager.startNew({ name: 'python3' }), 12000, 'Kernel start');
      kernelRef.current = newKernel;
      newKernel.statusChanged.connect((_sender: any, nextStatus: string) => {
        if (kernelRef.current !== newKernel) return;
        if (nextStatus === 'dead' || nextStatus === 'terminating') {
          setStatus('error');
          setStatusDetail('');
          setErrorMsg('Kernel is dead. Reconnect to continue.');
        }
      });
      newKernel.connectionStatusChanged.connect((_sender: any, nextStatus: string) => {
        if (kernelRef.current !== newKernel) return;
        const runReconnectAttempt = () => {
          if (kernelRef.current !== newKernel) return;
          if ((newKernel as any).isDisposed) {
            setStatus('connecting');
            setStatusDetail('Kernel was disposed. Starting a new session...');
            connectKernel().catch(() => undefined);
            return;
          }
          reconnectAttemptsRef.current += 1;
          if (reconnectAttemptsRef.current > 3) {
            setStatus('error');
            setStatusDetail('');
            setErrorMsg('Kernel connection lost. Please reconnect.');
            return;
          }
          setStatus('connecting');
          setStatusDetail(`Reinitializing environment (${reconnectAttemptsRef.current}/3)...`);
          let reconnectPromise: Promise<void>;
          try {
            reconnectPromise = newKernel.reconnect();
          } catch (_err) {
            if (kernelRef.current !== newKernel) return;
            setStatus('connecting');
            setStatusDetail('Kernel reconnect failed. Starting a new session...');
            connectKernel().catch(() => undefined);
            return;
          }
          withTimeout(reconnectPromise, 8000, 'Kernel reconnect').catch(() => {
            if (kernelRef.current !== newKernel) return;
            if (reconnectTimerRef.current) return;
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              runReconnectAttempt();
            }, 1600);
          });
        };

        if (nextStatus === 'disconnected') {
          if (reconnectTimerRef.current) return;
          setStatus('connecting');
          setStatusDetail('Kernel disconnected. Waiting for reconnection...');
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            runReconnectAttempt();
          }, 1200);
          return;
        }
        if (nextStatus === 'connected' && reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        if (nextStatus === 'connected') {
          reconnectAttemptsRef.current = 0;
          setStatusDetail('');
        }
      });
      setKernel(newKernel);
      setBootstrapLoaded(false);
      setStatus('connected');
      setStatusDetail('');
      setErrorMsg('');
      reconnectAttemptsRef.current = 0;
    } catch (err) {
      setStatus('error');
      setStatusDetail('');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      connectingRef.current = false;
    }
  };

  const activeKernel = kernel;

  const getServerSettings = () => {
    const { baseUrl, wsUrl } = resolveServerConfig(serverUrl);
    return ServerConnection.makeSettings({
      baseUrl,
      token,
      wsUrl,
      appendToken: true
    });
  };

  const getAutosavePath = (id: string) => `${SERVER_AUTOSAVE_DIR}/${id}.sugarpy`;
  const getAssistantTraceServerPath = (trace: AssistantRunTrace) =>
    `${ASSISTANT_TRACE_SERVER_DIR}/${trace.notebookId}/${trace.id}.json`;

  const buildSnapshot = (
    nextCells: CellModel[],
    nextTrigMode: 'deg' | 'rad',
    nextDefaultMathRenderMode: 'exact' | 'decimal',
    nextName: string,
    nextId: string
  ) =>
    JSON.stringify({
      id: nextId,
      name: nextName,
      trigMode: nextTrigMode,
      defaultMathRenderMode: nextDefaultMathRenderMode,
      cells: nextCells.map(({ isRunning, ...rest }) => rest)
    });

  const ensureContents = () => {
    if (!contentsRef.current) {
      contentsRef.current = new ContentsManager({ serverSettings: getServerSettings() });
    }
    return contentsRef.current;
  };

  const loadAssistantRuntimeConfig = async (): Promise<AssistantRuntimeConfig | null> => {
    const contents = ensureContents();
    try {
      const directory = await contents.get('notebooks', { content: true });
      const entries = Array.isArray(directory.content) ? directory.content : [];
      const hasConfig = entries.some(
        (entry: any) => entry?.type === 'file' && entry?.path === ASSISTANT_SERVER_CONFIG_PATH
      );
      if (!hasConfig) return null;
      const model = await contents.get(ASSISTANT_SERVER_CONFIG_PATH, { content: true });
      const raw = typeof model.content === 'string' ? model.content : '';
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
      const runtimeModel =
        typeof parsed.model === 'string'
          ? parsed.model.trim()
          : typeof parsed.defaultModel === 'string'
            ? parsed.defaultModel.trim()
            : '';
      return {
        apiKey: apiKey || undefined,
        model: runtimeModel || undefined
      };
    } catch (_err) {
      return null;
    }
  };

  const ensureServerDir = async (path: string) => {
    const contents = ensureContents();
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (ensuredServerDirsRef.current.has(current)) {
        continue;
      }
      const pending = ensuringServerDirsRef.current.get(current);
      if (pending) {
        await pending;
        continue;
      }
      const ensurePromise = (async () => {
        try {
          await contents.save(current, { type: 'directory' as any });
        } catch (_err) {
          // Directory may already exist or server may return noisy 4xx for nested checks.
          // Fall through: later writes will surface real failures if path is unusable.
        }
        ensuredServerDirsRef.current.add(current);
      })();
      ensuringServerDirsRef.current.set(current, ensurePromise);
      try {
        await ensurePromise;
      } finally {
        ensuringServerDirsRef.current.delete(current);
      }
    }
  };

  const persistAssistantTrace = async (trace: AssistantRunTrace) => {
    const localKey = `${getAssistantTraceStorageKey(trace.notebookId)}`;
    try {
      const existingRaw = readOptionalStorageItem(localKey);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const next = Array.isArray(existing)
        ? [
            trace,
            ...existing.filter((entry: any) => entry && typeof entry === 'object' && entry.id !== trace.id)
          ].slice(0, 25)
        : [trace];
      writeStorageItem(localKey, JSON.stringify(next));
    } catch (_err) {
      // ignore local trace persistence failures
    }

    assistantTracePendingRef.current.set(trace.id, trace);
    if (assistantTraceFlushRef.current.has(trace.id)) {
      return;
    }

    const flushTrace = async () => {
      while (assistantTracePendingRef.current.has(trace.id)) {
        const nextTrace = assistantTracePendingRef.current.get(trace.id);
        assistantTracePendingRef.current.delete(trace.id);
        if (!nextTrace) continue;
        try {
          const notebookTraceDir = `${ASSISTANT_TRACE_SERVER_DIR}/${nextTrace.notebookId}`;
          await ensureServerDir(ASSISTANT_TRACE_SERVER_DIR);
          await ensureServerDir(notebookTraceDir);
          await ensureContents().save(getAssistantTraceServerPath(nextTrace), {
            type: 'file' as any,
            format: 'text' as any,
            content: JSON.stringify(nextTrace, null, 2)
          });
        } catch (_err) {
          // trace persistence must never block assistant execution
        }
      }
    };

    const flushPromise = flushTrace().finally(() => {
      assistantTraceFlushRef.current.delete(trace.id);
      const pendingTrace = assistantTracePendingRef.current.get(trace.id);
      if (pendingTrace) {
        void persistAssistantTrace(pendingTrace);
      }
    });
    assistantTraceFlushRef.current.set(trace.id, flushPromise);
    await flushPromise;
  };

  const loadServerAutosave = async (id: string) => {
    const contents = ensureContents();
    const path = getAutosavePath(id);
    try {
      await ensureServerDir(SERVER_AUTOSAVE_DIR);
      const model = await contents.get(path, { content: true });
      const raw = typeof model.content === 'string' ? model.content : '';
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1) return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  };

  const saveServerAutosave = async (params: {
    id: string;
    name: string;
    trigMode: 'deg' | 'rad';
    defaultMathRenderMode: 'exact' | 'decimal';
    cells: CellModel[];
    silent?: boolean;
  }) => {
    try {
      if (!params.silent) {
        setSyncMessage('Saving to server...');
      }
      await ensureServerDir(SERVER_AUTOSAVE_DIR);
      const payload = serializeSugarPy({
        id: params.id,
        name: params.name,
        trigMode: params.trigMode,
        defaultMathRenderMode: params.defaultMathRenderMode,
        cells: params.cells
      });
      await ensureContents().save(getAutosavePath(params.id), {
        type: 'file' as any,
        format: 'text' as any,
        content: JSON.stringify(payload, null, 2)
      });
      if (!params.silent) {
        setSyncMessage('Saved to server autosave.');
      }
      return payload;
    } catch (err) {
      setSyncMessage('Server autosave failed.');
      return null;
    }
  };

  useEffect(() => {
    contentsRef.current = null;
  }, [serverUrl, token]);

  useEffect(() => {
    if (cells.length === 0) {
      setActiveCellId(null);
      return;
    }
    if (!activeCellId || !cells.some((cell) => cell.id === activeCellId)) {
      setActiveCellId(cells[0].id);
    }
  }, [cells, activeCellId]);

  useEffect(() => {
    if (connectOnce.current) return;
    connectOnce.current = true;
    connectKernel().catch(() => {
      // handled in connectKernel
    });
  }, []);

  useEffect(() => {
    const updateEligibility = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const noHover = window.matchMedia('(hover: none)').matches;
      const anyFine = window.matchMedia('(any-pointer: fine)').matches;
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      const narrow = window.innerWidth <= 900;
      setMobileActionsEligible(coarse && noHover && !anyFine && narrow && portrait);
    };
    updateEligibility();
    window.addEventListener('resize', updateEligibility);
    window.addEventListener('orientationchange', updateEligibility);
    return () => {
      window.removeEventListener('resize', updateEligibility);
      window.removeEventListener('orientationchange', updateEligibility);
    };
  }, []);

  useEffect(() => {
    const readActiveEditorCell = () => {
      const active = document.activeElement;
      if (!isEditableElement(active)) {
        setMobileEditorCellId(null);
        return;
      }
      const cellHost = (active as HTMLElement).closest('[data-cell-id]') as HTMLElement | null;
      setMobileEditorCellId(cellHost?.dataset.cellId ?? null);
    };
    const onFocusIn = () => readActiveEditorCell();
    const onFocusOut = () => window.setTimeout(readActiveEditorCell, 0);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    const updateKeyboard = () => {
      if (!mobileActionsEligible) {
        setMobileKeyboardOpen(false);
        setMobileVisualTop(0);
        setMobileVisualHeight(window.innerHeight);
        return;
      }
      const vv = window.visualViewport;
      if (!vv) {
        setMobileKeyboardOpen(!!mobileEditorCellId);
        setMobileVisualTop(0);
        setMobileVisualHeight(window.innerHeight);
        return;
      }
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height));
      setMobileVisualTop(Math.max(0, Math.round(vv.offsetTop)));
      setMobileVisualHeight(Math.max(0, Math.round(vv.height)));
      setMobileKeyboardOpen(inset > 120);
    };
    updateKeyboard();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', updateKeyboard);
      vv.addEventListener('scroll', updateKeyboard);
    }
    window.addEventListener('resize', updateKeyboard);
    return () => {
      if (vv) {
        vv.removeEventListener('resize', updateKeyboard);
        vv.removeEventListener('scroll', updateKeyboard);
      }
      window.removeEventListener('resize', updateKeyboard);
    };
  }, [mobileActionsEligible, mobileEditorCellId]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (headerMenuOpen && headerMenuRef.current && target && !headerMenuRef.current.contains(target)) {
        setHeaderMenuOpen(false);
      }
      if (
        assistantOpen &&
        target &&
        assistantDrawerRef.current &&
        !assistantDrawerRef.current.contains(target) &&
        !assistantToggleRef.current?.contains(target)
      ) {
        setAssistantOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (headerMenuOpen) setHeaderMenuOpen(false);
      if (assistantOpen) setAssistantOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [assistantOpen, headerMenuOpen]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (!kernel) return;
      if (kernelRef.current === kernel) {
        kernelRef.current = null;
      }
      kernel.shutdown().catch(() => undefined);
    };
  }, [kernel]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const lastId = loadLastOpenId();
      pruneLocalNotebookSnapshots(lastId);
      if (!lastId) {
        hydrated.current = true;
        return;
      }
      const localStored = loadFromLocalStorage(lastId);
      const serverStored = await loadServerAutosave(lastId);

      const pickNewest = () => {
        if (localStored && serverStored) {
          const localTs = Date.parse(localStored.updatedAt ?? '') || 0;
          const serverTs = Date.parse(serverStored.updatedAt ?? '') || 0;
          return serverTs > localTs ? serverStored : localStored;
        }
        return serverStored ?? localStored ?? null;
      };

      const selected = pickNewest();
      if (!selected || cancelled) {
        hydrated.current = true;
        return;
      }

      const decoded = deserializeSugarPy(selected);
      const nextCells = decoded.cells;
      setNotebookId(decoded.id);
      setNotebookName(decoded.name);
      setTrigMode(decoded.trigMode);
      setDefaultMathRenderMode(decoded.defaultMathRenderMode);
      setCells(nextCells);
      setActiveCellId(nextCells[0]?.id ?? null);
      setLastSavedAt(selected.updatedAt ?? null);
      lastSnapshot.current = buildSnapshot(
        nextCells,
        decoded.trigMode,
        decoded.defaultMathRenderMode,
        decoded.name,
        decoded.id
      );
      hydrated.current = true;
    };

    hydrate().catch(() => {
      hydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl, token]);

  const runCell = async (cellId: string, code: string, showOutput = true, countExecution = true) => {
    if (!activeKernel) return;
    if (showOutput) {
      setCells((prev) => {
        const exists = prev.some((c) => c.id === cellId);
        if (exists) return prev;
        return [...prev, { id: cellId, source: code, type: 'code' }];
      });
    }
    let future: any;
    try {
      future = activeKernel.requestExecute({ code, stop_on_error: true });
    } catch (error) {
      if (showOutput) {
        const message = isCanceledFutureError(error)
          ? 'Kernel execution was canceled.'
          : String(error instanceof Error ? error.message : error);
        setCells((prev) =>
          prev.map((c) =>
            c.id === cellId ? { ...c, output: { type: 'error', ename: 'ExecutionError', evalue: message }, isRunning: false } : c
          )
        );
      }
      return;
    }
    let streamText = '';
    let mimeData: Record<string, unknown> = {};
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, isRunning: true, output: undefined } : c))
    );
    future.onIOPub = (msg) => {
      if (msg.header.msg_type === 'stream') {
        // @ts-ignore
        streamText += msg.content.text ?? '';
        mimeData = { ...mimeData, 'text/plain': streamText };
      }
      if (msg.header.msg_type === 'execute_result' || msg.header.msg_type === 'display_data') {
        // @ts-ignore
        const data = msg.content.data ?? {};
        const merged: Record<string, unknown> = { ...mimeData };
        Object.entries(data).forEach(([mime, value]) => {
          if (mime === 'text/plain') {
            const existing = asText(merged['text/plain']);
            merged['text/plain'] = `${existing}${asText(value)}`;
          } else {
            merged[mime] = value as unknown;
          }
        });
        mimeData = merged;
      }
      if (msg.header.msg_type === 'error') {
        const ename = (msg.content as any).ename ?? 'Error';
        const evalue = (msg.content as any).evalue ?? '';
        if (showOutput) {
          setCells((prev) =>
            prev.map((c) =>
              c.id === cellId
                ? {
                    ...c,
                    output: { type: 'error', ename, evalue }
                  }
                : c
            )
          );
        }
        return;
      }
      if (showOutput) {
        setCells((prev) =>
          prev.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  output: { type: 'mime', data: mimeData }
                }
              : c
          )
        );
      }
    };
    let reply: any = null;
    try {
      reply = await awaitFutureDoneWithTimeout(future, activeKernel);
    } catch (error) {
      if (isDeadKernelError(error)) {
        setStatus('error');
        setErrorMsg('Kernel is dead. Reconnect to continue.');
      }
      if (!isCanceledFutureError(error) && !isDeadKernelError(error) && !isExecutionTimeoutError(error)) {
        throw error;
      }
      const evalue = isExecutionTimeoutError(error)
        ? String(error instanceof Error ? error.message : error)
        : 'Kernel execution was canceled.';
      if (showOutput) {
        setCells((prev) =>
          prev.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  output: {
                    type: 'error',
                    ename: isExecutionTimeoutError(error) ? 'ExecutionTimeout' : 'ExecutionCanceled',
                    evalue
                  },
                  isRunning: false
                }
              : c
          )
        );
      }
      return;
    }
    if (showOutput) {
      const content = (reply as any)?.content;
      if (content?.status === 'error') {
        const ename = content.ename ?? 'Error';
        const evalue = content.evalue ?? '';
        setCells((prev) =>
          prev.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  output: { type: 'error', ename, evalue }
                }
              : c
          )
        );
      }
    }
    if (showOutput) {
      const defs = extractFunctionNames(code);
      if (defs.length > 0) {
        setUserFunctions((prev) => Array.from(new Set([...prev, ...defs])));
      }
    }
    if (countExecution) {
      setExecCounter((prev) => {
        const next = prev + 1;
        setCells((cellsPrev) =>
          cellsPrev.map((c) =>
            c.id === cellId ? { ...c, isRunning: false, execCount: next } : c
          )
        );
        return next;
      });
    } else {
      setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, isRunning: false } : c)));
    }
  };

  const runMathCell = async (
    cellId: string,
    source: string,
    renderModeOverride?: 'exact' | 'decimal',
    trigModeOverride?: 'deg' | 'rad',
    preserveOutput = false
  ) => {
    if (!activeKernel) return;
    const cell = cells.find((entry) => entry.id === cellId);
    const renderMode =
      renderModeOverride ??
      (cell?.mathRenderMode === 'decimal' ? 'decimal' : defaultMathRenderMode);
    const mode = trigModeOverride ?? cell?.mathTrigMode ?? trigMode;
    const payload = JSON.stringify({ source, mode });
    const code = [
      'import json',
      'from sugarpy.math_cell import display_math_cell',
      `_payload = json.loads(${JSON.stringify(payload)})`,
      `_ = display_math_cell(_payload['source'], _payload['mode'], ${JSON.stringify(renderMode)})`
    ].join('\n');

    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId
          ? {
              ...c,
              isRunning: true,
              ...(preserveOutput ? {} : { mathOutput: undefined, output: undefined })
            }
          : c
      )
    );
    let future: any;
    try {
      future = activeKernel.requestExecute({ code, stop_on_error: true });
    } catch (error) {
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId
            ? {
                ...c,
                isRunning: false,
                mathOutput: {
                  kind: 'expression',
                  steps: [],
                  error: isCanceledFutureError(error) ? 'Kernel execution was canceled.' : String(error),
                  mode,
                  warnings: []
                }
              }
            : c
        )
      );
      return;
    }
    let streamText = '';
    let mimeData: Record<string, unknown> = {};
    let parsed: (CellModel['mathOutput'] & { plotly_figure?: unknown }) | null = null;

    const setMimeOutput = (nextData: Record<string, unknown>) => {
      if (Object.keys(nextData).length === 0) return;
      setCells((prev) =>
        prev.map((c) => (c.id === cellId ? { ...c, output: { type: 'mime', data: nextData } } : c))
      );
    };

    future.onIOPub = (msg) => {
      if (msg.header.msg_type === 'stream') {
        // @ts-ignore
        const text = msg.content.text ?? '';
        streamText += text;
        const nextData = { ...mimeData, 'text/plain': streamText };
        mimeData = nextData;
        setMimeOutput(nextData);
      }
      if (msg.header.msg_type === 'execute_result' || msg.header.msg_type === 'display_data') {
        // @ts-ignore
        const data = msg.content.data ?? {};
        const merged: Record<string, unknown> = { ...mimeData };
        Object.entries(data).forEach(([mime, value]) => {
          if (mime === SUGARPY_MIME_MATH && value && typeof value === 'object') {
            parsed = value as CellModel['mathOutput'] & { plotly_figure?: unknown };
            return;
          }
          if (mime === 'text/plain') {
            const existing = asText(merged['text/plain']);
            merged['text/plain'] = `${existing}${asText(value)}`;
          } else {
            merged[mime] = value as unknown;
          }
        });
        mimeData = merged;
        setMimeOutput(merged);
      }
      if (msg.header.msg_type === 'error') {
        // @ts-ignore
        const err = (msg.content.ename ?? 'Error') + ': ' + (msg.content.evalue ?? '');
        parsed = { kind: 'expression', steps: [], error: err, mode, warnings: [] };
      }
      if (parsed) {
        setCells((prev) =>
          prev.map((c) => {
            if (c.id !== cellId) return c;
            const next: any = { ...c, mathOutput: parsed };
            const fig = (parsed as any)?.plotly_figure;
            if (fig && typeof fig === 'object') {
              next.output = { type: 'mime', data: { 'application/vnd.plotly.v1+json': fig } };
            }
            return next;
          })
        );
      }
    };
    try {
      await awaitFutureDoneWithTimeout(future, activeKernel);
    } catch (error) {
      if (isDeadKernelError(error)) {
        setStatus('error');
        setErrorMsg('Kernel is dead. Reconnect to continue.');
      }
      if (!isCanceledFutureError(error) && !isDeadKernelError(error) && !isExecutionTimeoutError(error)) {
        throw error;
      }
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId
            ? {
                ...c,
                isRunning: false,
                mathOutput: {
                  kind: 'expression',
                  steps: [],
                  error: isExecutionTimeoutError(error)
                    ? String(error instanceof Error ? error.message : error)
                    : 'Kernel execution was canceled.',
                  mode,
                  warnings: []
                }
              }
            : c
        )
      );
      return;
    }
    setMimeOutput(mimeData);
    setExecCounter((prev) => {
      const next = prev + 1;
      setCells((cellsPrev) =>
        cellsPrev.map((c) =>
          c.id === cellId ? { ...c, isRunning: false, execCount: next } : c
        )
      );
      return next;
    });
  };

  const runStoichCell = async (cellId: string, state: StoichState) => {
    if (!activeKernel) return;
    const payload = JSON.stringify({ reaction: state.reaction, inputs: state.inputs });
    const code = [
      'import json',
      'from sugarpy.stoichiometry import display_stoichiometry',
      `_payload = json.loads(${JSON.stringify(payload)})`,
      "_ = display_stoichiometry(_payload.get('reaction', ''), _payload.get('inputs'))"
    ].join('\n');

    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, isRunning: true } : c))
    );

    let future: any;
    try {
      future = activeKernel.requestExecute({ code, stop_on_error: true });
    } catch (error) {
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId
            ? { ...c, isRunning: false, stoichOutput: { ok: false, error: String(error), species: [] } }
            : c
        )
      );
      return;
    }
    let parsed: StoichOutput | null = null;

    future.onIOPub = (msg) => {
      if (msg.header.msg_type === 'execute_result' || msg.header.msg_type === 'display_data') {
        // @ts-ignore
        const data = msg.content.data ?? {};
        const payload = data[SUGARPY_MIME_STOICH];
        if (payload && typeof payload === 'object') {
          parsed = payload as StoichOutput;
        }
      }
      if (msg.header.msg_type === 'error') {
        const ename = (msg.content as any).ename ?? 'Error';
        const evalue = (msg.content as any).evalue ?? '';
        parsed = { ok: false, error: `${ename}: ${evalue}`, species: [] };
      }
    };

    try {
      await awaitFutureDoneWithTimeout(future, activeKernel);
    } catch (error) {
      if (isDeadKernelError(error)) {
        setStatus('error');
        setErrorMsg('Kernel is dead. Reconnect to continue.');
      }
      if (!isCanceledFutureError(error) && !isDeadKernelError(error) && !isExecutionTimeoutError(error)) {
        throw error;
      }
      parsed = {
        ok: false,
        error: isExecutionTimeoutError(error)
          ? String(error instanceof Error ? error.message : error)
          : 'Kernel execution was canceled.',
        species: []
      };
    }
    if (!parsed) {
      parsed = { ok: false, error: 'No structured output received.', species: [] };
    }

    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId ? { ...c, stoichOutput: parsed ?? undefined, isRunning: false } : c
      )
    );
  };

  const runAllCells = async () => {
    if (isRunningAll) return;
    if (!activeKernel) {
      await connectKernel();
      if (!kernelRef.current) return;
    }
    setIsRunningAll(true);
    try {
      const queue = [...cells];
      for (const cell of queue) {
        setActiveCellId(cell.id);
        if (cell.type === 'markdown') continue;
        if (cell.type === 'math') {
          await runMathCell(
            cell.id,
            cell.source,
            cell.mathRenderMode ?? defaultMathRenderMode,
            cell.mathTrigMode ?? trigMode
          );
          continue;
        }
        if (cell.type === 'stoich') {
          await runStoichCell(cell.id, cell.stoichState ?? { reaction: '', inputs: {} });
          continue;
        }
        await runCell(cell.id, cell.source);
      }
    } finally {
      setIsRunningAll(false);
    }
  };

  const createCell = (
    type: 'code' | 'markdown' | 'math' | 'stoich',
    source = '',
    indexSeed?: number
  ): CellModel => {
    const idSuffix = indexSeed ? `${indexSeed}-${Date.now()}` : `${Date.now()}`;
    if (type === 'stoich') {
      return {
        id: `cell-${idSuffix}`,
        source,
        type,
        stoichState: createStoichState()
      };
    }
    return {
      id: `cell-${idSuffix}`,
      source,
      type,
      ...(type === 'math' ? { mathRenderMode: defaultMathRenderMode, mathTrigMode: trigMode } : {})
    };
  };

  const getCellDisplayText = (cell: CellModel) => {
    if (cell.type === 'stoich') {
      return cell.stoichState?.reaction ?? '';
    }
    if (cell.output?.type === 'error') {
      return `${cell.output.ename}: ${cell.output.evalue}`;
    }
    if (cell.mathOutput?.error) {
      return cell.mathOutput.error;
    }
    if (cell.mathOutput?.steps?.length) {
      return cell.mathOutput.steps.join('\n');
    }
    const plain = cell.output?.type === 'mime' ? cell.output.data['text/plain'] : '';
    return asText(plain);
  };

  const buildAssistantContext = () => ({
    notebookName,
    defaultTrigMode: trigMode,
    defaultMathRenderMode,
    activeCellId,
    cells: cells.map((cell) => ({
      id: cell.id,
      type: (cell.type ?? 'code') as 'code' | 'markdown' | 'math' | 'stoich',
      source: cell.source,
      mathRenderMode: cell.mathRenderMode,
      mathTrigMode: cell.mathTrigMode,
      stoichReaction: cell.stoichState?.reaction ?? '',
      outputText: getCellDisplayText(cell),
      hasError: !!(
        cell.output?.type === 'error' ||
        cell.mathOutput?.error ||
        (cell.stoichOutput && cell.stoichOutput.ok === false)
      )
    }))
  });

  const buildAssistantSandboxCells = (): AssistantSandboxNotebookCell[] =>
    cells.map((cell) => ({
      id: cell.id,
      type: cell.type ?? 'code',
      source: cell.type === 'stoich' ? cell.stoichState?.reaction ?? '' : cell.source
    }));

  const runAssistantSandbox = async (
    request: AssistantSandboxRequest,
    onActivity?: (item: AssistantActivity) => void
  ) =>
    runIsolatedAssistantSandbox({
      request,
      serverSettings: getServerSettings(),
      notebookCells: buildAssistantSandboxCells(),
      bootstrapCode: assistantBootstrapCode,
      onActivity: (label, detail) => onActivity?.({ kind: 'phase', label, detail })
    });

  const captureAssistantSnapshot = (): AssistantSnapshot => ({
    cells: cells.map((cell) => ({
      ...cell,
      mathOutput: cell.mathOutput ? JSON.parse(JSON.stringify(cell.mathOutput)) : undefined,
      stoichState: cell.stoichState ? JSON.parse(JSON.stringify(cell.stoichState)) : undefined,
      stoichOutput: cell.stoichOutput ? JSON.parse(JSON.stringify(cell.stoichOutput)) : undefined,
      output: cell.output ? JSON.parse(JSON.stringify(cell.output)) : undefined
    })),
    trigMode,
    defaultMathRenderMode,
    activeCellId
  });

  const restoreAssistantSnapshot = (snapshot: AssistantSnapshot) => {
    setCells(snapshot.cells);
    setTrigMode(snapshot.trigMode);
    setDefaultMathRenderMode(snapshot.defaultMathRenderMode);
    setActiveCellId(snapshot.activeCellId);
  };

  const insertCellAt = (
    index: number,
    type: 'code' | 'markdown' | 'math',
    source = ''
  ) => {
    const bounded = Math.max(0, Math.min(index, cells.length));
    const nextCell = createCell(type, source, bounded + 1);
    setCells((prev) => [...prev.slice(0, bounded), nextCell, ...prev.slice(bounded)]);
    setActiveCellId(nextCell.id);
  };

  const updateCell = (cellId: string, source: string) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, source } : c)));
  };

  const updateStoichState = (cellId: string, state: StoichState) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, stoichState: state } : c)));
  };

  const updateAssistantChat = (chatId: string, updater: (chat: AssistantChatSession) => AssistantChatSession) => {
    setAssistantChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        const next = updater(chat);
        return {
          ...next,
          updatedAt: new Date().toISOString()
        };
      })
    );
  };

  const updateAssistantMessage = (
    chatId: string,
    messageId: string,
    updater: (message: AssistantChatMessage) => AssistantChatMessage
  ) => {
    updateAssistantChat(chatId, (chat) => ({
      ...chat,
      messages: chat.messages.map((message) => (message.id === messageId ? updater(message) : message))
    }));
  };

  const ensureAssistantChat = () => {
    if (assistantActiveChatId && assistantChats.some((chat) => chat.id === assistantActiveChatId)) {
      return assistantActiveChatId;
    }
    const nextChat = createAssistantChat();
    setAssistantChats([nextChat]);
    setAssistantActiveChatId(nextChat.id);
    return nextChat.id;
  };

  const createNewAssistantChat = () => {
    const nextChat = createAssistantChat();
    setAssistantChats((prev) => [nextChat, ...prev].slice(0, 5));
    setAssistantActiveChatId(nextChat.id);
    setAssistantError('');
    return nextChat.id;
  };

  const activeAssistantChat =
    assistantChats.find((chat) => chat.id === assistantActiveChatId) ??
    assistantChats[0] ??
    null;

  const handleSlashCommand = (cellId: string, command: string) => {
    const entry = slashCommandMap.get(command);
    if (!entry) return false;
    setCells((prev) =>
      prev.map((cell) => {
        if (cell.id !== cellId) return cell;
        if (entry.id === 'chem.stoichiometry_table') {
          return {
            ...cell,
            type: 'stoich',
            source: '',
            output: undefined,
            execCount: undefined,
            isRunning: false,
            mathOutput: undefined,
            stoichOutput: undefined,
            stoichState: createStoichState()
          };
        }
        return {
          ...cell,
          type: 'code',
          source: entry.snippet,
          output: undefined,
          execCount: undefined,
          isRunning: false,
          mathOutput: undefined,
          stoichOutput: undefined,
          stoichState: undefined
        };
      })
    );
    return true;
  };

  useEffect(() => {
    const storedKey = readOptionalStorageItem(ASSISTANT_API_KEY_STORAGE);
    const storedModel =
      readOptionalStorageItem(ASSISTANT_MODEL_STORAGE) ?? readOptionalStorageItem('sugarpy:assistant:gemini:model');
    const storedThinking = readOptionalStorageItem(ASSISTANT_THINKING_STORAGE);
    if (storedKey) setAssistantApiKey(storedKey);
    if (storedModel) setAssistantModel(storedModel);
    if (
      storedThinking === 'dynamic' ||
      storedThinking === 'minimal' ||
      storedThinking === 'low' ||
      storedThinking === 'medium' ||
      storedThinking === 'high'
    ) {
      setAssistantThinkingLevel(storedThinking);
    }
  }, []);

  useEffect(() => {
    if (assistantApiKey) {
      writeStorageItem(ASSISTANT_API_KEY_STORAGE, assistantApiKey);
    } else {
      removeStorageItem(ASSISTANT_API_KEY_STORAGE);
    }
  }, [assistantApiKey]);

  useEffect(() => {
    writeStorageItem(ASSISTANT_MODEL_STORAGE, assistantModel);
  }, [assistantModel]);

  useEffect(() => {
    writeStorageItem(ASSISTANT_THINKING_STORAGE, assistantThinkingLevel);
  }, [assistantThinkingLevel]);

  useEffect(() => {
    const normalized = normalizeThinkingLevel(assistantModel, assistantThinkingLevel);
    if (normalized !== assistantThinkingLevel) {
      setAssistantThinkingLevel(normalized);
    }
  }, [assistantModel, assistantThinkingLevel]);

  useEffect(() => {
    if (assistantHistoryNotebookRef.current !== notebookId) return;
    const storageKey = `${ASSISTANT_HISTORY_STORAGE_PREFIX}${notebookId}`;
    writeStorageItem(storageKey, JSON.stringify(assistantChats.slice(0, 5)));
  }, [assistantChats, notebookId]);

  useEffect(() => {
    assistantHistoryNotebookRef.current = null;
    setAssistantDraft('');
    setAssistantError('');
    const storageKey = `${ASSISTANT_HISTORY_STORAGE_PREFIX}${notebookId}`;
    const raw = readOptionalStorageItem(storageKey);
    if (!raw) {
      const nextChat = createAssistantChat();
      setAssistantChats([nextChat]);
      setAssistantActiveChatId(nextChat.id);
      assistantHistoryNotebookRef.current = notebookId;
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        const nextChat = createAssistantChat();
        setAssistantChats([nextChat]);
        setAssistantActiveChatId(nextChat.id);
        return;
      }
      const normalized = parsed
        .slice(0, 5)
        .filter((entry: any) => entry && typeof entry === 'object')
        .map((entry: any) => ({
          id: typeof entry.id === 'string' ? entry.id : createAssistantChat().id,
          title: typeof entry.title === 'string' ? entry.title : 'Chat',
          updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
          messages: Array.isArray(entry.messages)
            ? entry.messages
                .filter((message: any) => message && typeof message === 'object')
                .map((message: any) => ({
                  id: typeof message.id === 'string' ? message.id : `assistant-message-${Date.now()}`,
                  role: message.role === 'assistant' ? 'assistant' : 'user',
                  content: typeof message.content === 'string' ? message.content : '',
                  createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
                  status: typeof message.status === 'string' ? message.status : undefined,
                  activity: Array.isArray(message.activity) ? message.activity : [],
                  plan: message.plan ?? null,
                  error: typeof message.error === 'string' ? message.error : undefined
                }))
            : []
        })) as AssistantChatSession[];
      setAssistantChats(normalized);
      setAssistantActiveChatId(normalized[0]?.id ?? null);
      assistantHistoryNotebookRef.current = notebookId;
    } catch (_err) {
      const nextChat = createAssistantChat();
      setAssistantChats([nextChat]);
      setAssistantActiveChatId(nextChat.id);
      assistantHistoryNotebookRef.current = notebookId;
    }
  }, [notebookId]);

  useEffect(() => {
    return () => {
      assistantAbortRef.current?.abort();
    };
  }, [notebookId]);

  const hydrateAssistantRuntimeConfig = async (): Promise<AssistantRuntimeConfig | null> => {
    if (assistantRuntimeConfigAttemptedRef.current) {
      return assistantDefaultApiKey.trim()
        ? { apiKey: assistantDefaultApiKey.trim(), model: assistantModel.trim() || undefined }
        : null;
    }
    const storedKey = readOptionalStorageItem(ASSISTANT_API_KEY_STORAGE);
    const storedModel =
      readOptionalStorageItem(ASSISTANT_MODEL_STORAGE) ?? readOptionalStorageItem('sugarpy:assistant:gemini:model');
    const envApiKey = (
      import.meta.env.VITE_ASSISTANT_API_KEY ||
      import.meta.env.VITE_OPENAI_API_KEY ||
      import.meta.env.VITE_GEMINI_API_KEY ||
      ''
    ).trim();
    const envModel = (
      import.meta.env.VITE_ASSISTANT_MODEL ||
      import.meta.env.VITE_OPENAI_MODEL ||
      import.meta.env.VITE_GEMINI_MODEL ||
      ''
    ).trim();
    if (storedKey || envApiKey) return null;
    assistantRuntimeConfigAttemptedRef.current = true;
    const runtimeConfig = await loadAssistantRuntimeConfig();
    if (!runtimeConfig) return null;
    if (runtimeConfig.apiKey) {
      setAssistantDefaultApiKey(runtimeConfig.apiKey);
    }
    if (!storedModel && !envModel && runtimeConfig.model) {
      setAssistantModel(runtimeConfig.model);
    }
    return runtimeConfig;
  };

  const runAssistant = async () => {
    const runtimeConfig = await hydrateAssistantRuntimeConfig();
    const chatId = ensureAssistantChat();
    const effectiveModel = (
      runtimeConfig?.model?.trim() ||
      assistantModel.trim() ||
      readOptionalStorageItem(ASSISTANT_MODEL_STORAGE) ||
      readOptionalStorageItem('sugarpy:assistant:gemini:model') ||
      DEFAULT_ASSISTANT_MODEL
    ).trim();
    if (effectiveModel && effectiveModel !== assistantModel) {
      setAssistantModel(effectiveModel);
    }
    const overrideApiKey = (assistantApiKey.trim() || readOptionalStorageItem(ASSISTANT_API_KEY_STORAGE) || '').trim();
    const defaultApiKey = (runtimeConfig?.apiKey?.trim() || assistantDefaultApiKey.trim()).trim();
    const effectiveApiKey = matchesAssistantProvider(overrideApiKey, effectiveModel)
      ? overrideApiKey
      : matchesAssistantProvider(defaultApiKey, effectiveModel)
        ? defaultApiKey
        : '';
    if (!effectiveApiKey) {
      const provider = detectAssistantProvider(effectiveModel);
      setAssistantError(
        provider === 'openai'
          ? 'No OpenAI API key is available. Add your own key in settings or configure a shared OpenAI key on the server.'
          : 'No Gemini API key is available. Add your own key in settings or configure a shared Gemini key on the server.'
      );
      return;
    }
    if (!assistantDraft.trim()) {
      setAssistantError('Write a request for the assistant first.');
      return;
    }
    const prompt = assistantDraft.trim();
    const effectiveThinkingLevel = normalizeThinkingLevel(effectiveModel, assistantThinkingLevel);
    const activeChat =
      assistantChats.find((chat) => chat.id === chatId) ??
      activeAssistantChat;
    const previousConversation: AssistantConversationEntry[] = (activeChat?.messages ?? [])
      .filter((message) => message.status !== 'dismissed')
      .map((message) => ({
        role: message.role,
        content:
          message.role === 'assistant'
            ? [message.content, message.plan?.summary].filter(Boolean).join('\n')
            : message.content
      }))
      .filter((entry) => entry.content.trim())
      .slice(-6);
    const userMessageId = `assistant-user-${Date.now()}`;
    const assistantMessageId = `assistant-reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const traceId = `assistant-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const userMessage: AssistantChatMessage = {
      id: userMessageId,
      role: 'user',
      content: prompt,
      createdAt: timestamp,
      status: 'ready'
    };
    const assistantMessage: AssistantChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      createdAt: timestamp,
      status: 'loading',
      activity: []
    };

    updateAssistantChat(chatId, (chat) => ({
      ...chat,
      title: chat.messages.length > 0 ? chat.title : previewAssistantLabel(prompt, 'New chat'),
      messages: [...chat.messages, userMessage, assistantMessage]
    }));

    const baseTrace: AssistantRunTrace = {
      id: traceId,
      chatId,
      messageId: assistantMessageId,
      notebookId,
      notebookName,
      prompt,
      model: effectiveModel,
      thinkingLevel: effectiveThinkingLevel,
      startedAt: timestamp,
      status: 'running',
      context: {
        cellCount: cells.length,
        activeCellId,
        defaults: {
          trigMode,
          renderMode: defaultMathRenderMode
        }
      },
      conversationHistory: [...previousConversation, { role: 'user', content: prompt }].slice(-6),
      activity: [],
      network: [],
      responses: [],
      sandboxExecutions: []
    };
    const collectedActivity: AssistantActivity[] = [];
    const collectedNetwork: AssistantNetworkEvent[] = [];
    const collectedResponses: AssistantResponseTrace[] = [];
    const collectedSandboxExecutions: AssistantSandboxExecutionTrace[] = [];
    void persistAssistantTrace(baseTrace);

    setAssistantLoading(true);
    setAssistantError('');
    setAssistantDraft('');
    const controller = new AbortController();
    assistantAbortRef.current = controller;
    try {
      const plan = await planNotebookChanges({
        apiKey: effectiveApiKey,
        model: effectiveModel,
        request: prompt,
        scope: ASSISTANT_SCOPE,
        preference: ASSISTANT_PREFERENCE,
        context: buildAssistantContext(),
        signal: controller.signal,
        conversationHistory: [...previousConversation, { role: 'user', content: prompt }].slice(-6),
        thinkingLevel: effectiveThinkingLevel,
        sandboxRunner: runAssistantSandbox,
        onNetworkEvent: (event) => {
          collectedNetwork.push(event);
          void persistAssistantTrace({
            ...baseTrace,
            activity: [...collectedActivity],
            network: [...collectedNetwork],
            responses: [...collectedResponses],
            sandboxExecutions: [...collectedSandboxExecutions]
          });
        },
        onResponseTrace: (trace) => {
          collectedResponses.push(trace);
          void persistAssistantTrace({
            ...baseTrace,
            activity: [...collectedActivity],
            network: [...collectedNetwork],
            responses: [...collectedResponses],
            sandboxExecutions: [...collectedSandboxExecutions]
          });
        },
        onSandboxExecution: (trace) => {
          collectedSandboxExecutions.push(trace);
          void persistAssistantTrace({
            ...baseTrace,
            activity: [...collectedActivity],
            network: [...collectedNetwork],
            responses: [...collectedResponses],
            sandboxExecutions: [...collectedSandboxExecutions]
          });
        },
        onActivity: (item) => {
          collectedActivity.push(item);
          updateAssistantMessage(chatId, assistantMessageId, (message) => ({
            ...message,
            activity: [...(message.activity ?? []), item]
          }));
          void persistAssistantTrace({
            ...baseTrace,
            activity: [...collectedActivity],
            network: [...collectedNetwork],
            responses: [...collectedResponses],
            sandboxExecutions: [...collectedSandboxExecutions]
          });
        }
      });
      updateAssistantMessage(chatId, assistantMessageId, (message) => ({
        ...message,
        content: plan.userMessage || plan.summary,
        plan,
        status: 'ready'
      }));
      void persistAssistantTrace({
        ...baseTrace,
        activity: [...collectedActivity],
        network: [...collectedNetwork],
        responses: [...collectedResponses],
        sandboxExecutions: [...collectedSandboxExecutions],
        status: 'completed',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(timestamp),
        result: {
          summary: plan.summary,
          warningCount: plan.warnings.length,
          operationCount: plan.operations.length
        }
      });
    } catch (error) {
      const wasAborted =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError');
      if (wasAborted) {
        updateAssistantMessage(chatId, assistantMessageId, (message) => ({
          ...message,
          content: 'Generation stopped.',
          status: 'stopped'
        }));
        void persistAssistantTrace({
          ...baseTrace,
          activity: [...collectedActivity],
          network: [...collectedNetwork],
          responses: [...collectedResponses],
          sandboxExecutions: [...collectedSandboxExecutions],
          status: 'stopped',
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(timestamp)
        });
      } else {
        const message = error instanceof Error ? error.message : 'Assistant request failed.';
        updateAssistantMessage(chatId, assistantMessageId, (entry) => ({
          ...entry,
          content: 'Assistant request failed.',
          error: message,
          status: 'error'
        }));
        setAssistantError(message);
        void persistAssistantTrace({
          ...baseTrace,
          activity: [...collectedActivity],
          network: [...collectedNetwork],
          responses: [...collectedResponses],
          sandboxExecutions: [...collectedSandboxExecutions],
          status: 'error',
          error: message,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(timestamp)
        });
      }
    } finally {
      assistantAbortRef.current = null;
      setAssistantLoading(false);
    }
  };

  const stopAssistant = () => {
    assistantAbortRef.current?.abort();
  };

  const applyAssistantPlan = async (messageId: string, plan: AssistantPlan, runAfterApply = false) => {
    const snapshot = captureAssistantSnapshot();
    const newCellIds: string[] = [];
    let nextCells = [...cells];
    let nextTrigMode = trigMode;
    let nextRenderMode = defaultMathRenderMode;
    let nextActiveCellId = activeCellId;

    const makeStoichCell = (source: string, indexSeed?: number) => {
      const cell = createCell('stoich', '', indexSeed);
      return {
        ...cell,
        stoichState: createStoichState(source)
      };
    };

    const createFromOperation = (operation: Extract<AssistantOperation, { type: 'insert_cell' }>) => {
      if (operation.cellType === 'stoich') {
        return makeStoichCell(operation.source, operation.index + 1);
      }
      return createCell(operation.cellType, operation.source, operation.index + 1);
    };

    plan.operations.forEach((operation) => {
      if (operation.type === 'insert_cell') {
        const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
        const nextCell = createFromOperation(operation);
        nextCells = [...nextCells.slice(0, bounded), nextCell, ...nextCells.slice(bounded)];
        newCellIds.push(nextCell.id);
        nextActiveCellId = nextCell.id;
        return;
      }
      if (operation.type === 'update_cell') {
        nextCells = nextCells.map((cell) => {
          if (cell.id !== operation.cellId) return cell;
          if (cell.type === 'stoich') {
            return {
              ...cell,
              source: '',
              stoichState: createStoichState(operation.source),
              stoichOutput: undefined
            };
          }
          return {
            ...cell,
            source: operation.source,
            output: undefined,
            mathOutput: cell.type === 'math' ? undefined : cell.mathOutput,
            stoichOutput: cell.type === 'stoich' ? undefined : cell.stoichOutput
          };
        });
        nextActiveCellId = operation.cellId;
        return;
      }
      if (operation.type === 'delete_cell') {
        nextCells = nextCells.filter((cell) => cell.id !== operation.cellId);
        if (nextActiveCellId === operation.cellId) {
          nextActiveCellId = nextCells[0]?.id ?? null;
        }
        return;
      }
      if (operation.type === 'move_cell') {
        const index = nextCells.findIndex((cell) => cell.id === operation.cellId);
        if (index === -1) return;
        const [cell] = nextCells.splice(index, 1);
        const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
        nextCells.splice(bounded, 0, cell);
        nextCells = [...nextCells];
        nextActiveCellId = operation.cellId;
        return;
      }
      if (operation.type === 'set_notebook_defaults') {
        if (operation.trigMode) nextTrigMode = operation.trigMode;
        if (operation.renderMode) nextRenderMode = operation.renderMode;
      }
    });

    setAssistantUndoStack((prev) => [...prev.slice(-9), snapshot]);
    setCells(nextCells);
    setTrigMode(nextTrigMode);
    setDefaultMathRenderMode(nextRenderMode);
    setActiveCellId(nextActiveCellId);
    if (assistantActiveChatId) {
      updateAssistantMessage(assistantActiveChatId, messageId, (message) => ({
        ...message,
        status: 'applied'
      }));
    }

    if (runAfterApply) {
      const runTargets = nextCells.filter(
        (cell) =>
          newCellIds.includes(cell.id) ||
          plan.operations.some(
            (operation) => operation.type === 'update_cell' && operation.cellId === cell.id
          )
      );
      for (const cell of runTargets) {
        if (cell.type === 'markdown') continue;
        await runCellById(cell);
      }
    }
  };

  const undoAssistantPlan = () => {
    const snapshot = assistantUndoStack[assistantUndoStack.length - 1];
    if (!snapshot) return;
    restoreAssistantSnapshot(snapshot);
    setAssistantUndoStack((prev) => prev.slice(0, -1));
  };

  const dismissAssistantPlan = (messageId: string) => {
    if (!assistantActiveChatId) return;
    updateAssistantMessage(assistantActiveChatId, messageId, (message) => ({
      ...message,
      status: 'dismissed'
    }));
  };

  useEffect(() => {
    const bootstrap = async () => {
      if (!activeKernel || bootstrapLoaded) return;
      if (!assistantBootstrapCode) return;
      try {
        await runCell(`bootstrap-${Date.now()}`, assistantBootstrapCode, false, false);
      } catch (_error) {
        return;
      }
      setBootstrapLoaded(true);
    };
    bootstrap().catch(() => undefined);
  }, [activeKernel, bootstrapLoaded, assistantBootstrapCode]);

  useEffect(() => {
    if (!hydrated.current) return;
    const snapshot = buildSnapshot(cells, trigMode, defaultMathRenderMode, notebookName, notebookId);
    if (snapshot === lastSnapshot.current) return;
    setDirty(true);
    if (autosaveTimer.current) {
      window.clearTimeout(autosaveTimer.current);
    }
    autosaveTimer.current = window.setTimeout(() => {
      const payload = serializeSugarPy({
        id: notebookId,
        name: notebookName,
        trigMode,
        defaultMathRenderMode,
        cells
      });
      const saved = saveToLocalStorage(payload);
      if (!saved.ok) {
        if (!localAutosaveWarningShown.current) {
          console.warn(`Local autosave skipped: ${saved.reason}`);
          localAutosaveWarningShown.current = true;
        }
      } else {
        localAutosaveWarningShown.current = false;
      }
      setLastSavedAt(payload.updatedAt);
      lastSnapshot.current = snapshot;
      setDirty(false);
    }, 800);

    if (autosaveServerTimer.current) {
      window.clearTimeout(autosaveServerTimer.current);
    }
    autosaveServerTimer.current = window.setTimeout(() => {
      saveServerAutosave({
        id: notebookId,
        name: notebookName,
        trigMode,
        defaultMathRenderMode,
        cells,
        silent: true
      }).then((saved) => {
        if (!saved) return;
        setLastSavedAt(saved.updatedAt);
      });
    }, 1500);
  }, [cells, trigMode, defaultMathRenderMode, notebookName, notebookId]);

  useEffect(() => {
    const flush = () => {
      if (!hydrated.current) return;
      const payload = serializeSugarPy({
        id: notebookId,
        name: notebookName,
        trigMode,
        defaultMathRenderMode,
        cells
      });
      const saved = saveToLocalStorage(payload);
      if (!saved.ok && !localAutosaveWarningShown.current) {
        console.warn(`Local autosave skipped during flush: ${saved.reason}`);
        localAutosaveWarningShown.current = true;
      }
      setLastSavedAt(payload.updatedAt);
      saveServerAutosave({
        id: notebookId,
        name: notebookName,
        trigMode,
        defaultMathRenderMode,
        cells,
        silent: true
      }).then(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cells, trigMode, defaultMathRenderMode, notebookName, notebookId]);

  const confirmDiscard = () => {
    if (!dirty) return true;
    return window.confirm('There are unsaved changes. Continue without saving?');
  };

  const handleNewNotebook = () => {
    if (!confirmDiscard()) return;
    const nextId = createNotebookId();
    const nextCells: CellModel[] = [];
    setNotebookId(nextId);
    setNotebookName('Untitled');
    setTrigMode('deg');
    setDefaultMathRenderMode('exact');
    setCells(nextCells);
    setActiveCellId(nextCells[0]?.id ?? null);
    setLastSavedAt(null);
    lastSnapshot.current = buildSnapshot(nextCells, 'deg', 'exact', 'Untitled', nextId);
    setDirty(false);
  };

  const handleDownloadSugarPy = () => {
    const payload = serializeSugarPy({
      id: notebookId,
      name: notebookName,
      trigMode,
      defaultMathRenderMode,
      cells
    });
    const rawName = (notebookName || 'Untitled').trim();
    const normalizedName = rawName.replace(/\.sugarpy(?:\.json)?$/i, '');
    const filename = `${normalizedName}.sugarpy`;
    downloadBlob(filename, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  };

  const handleDownloadIpynb = () => {
    const payload = serializeIpynb({
      id: notebookId,
      name: notebookName,
      trigMode,
      defaultMathRenderMode,
      cells
    });
    const filename = `${notebookName || 'Untitled'}.ipynb`;
    downloadBlob(filename, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  };

  const handleSaveToServer = async () => {
    const name = notebookName.trim() || 'Untitled';
    const filename = name.endsWith('.ipynb') ? name : `${name}.ipynb`;
    const path = filename.includes('/') ? filename : `notebooks/${filename}`;
    const { baseUrl, wsUrl } = resolveServerConfig(serverUrl);
    const settings = ServerConnection.makeSettings({
      baseUrl,
      token,
      wsUrl,
      appendToken: true
    });
    const contents = new ContentsManager({ serverSettings: settings });
    const payload = serializeIpynb({
      id: notebookId,
      name: notebookName,
      trigMode,
      defaultMathRenderMode,
      cells
    });
    try {
      await contents.save(path, {
        type: 'notebook',
        format: 'json',
        content: payload
      });
      await saveServerAutosave({
        id: notebookId,
        name: notebookName,
        trigMode,
        defaultMathRenderMode,
        cells,
        silent: true
      });
      const snapshot = buildSnapshot(cells, trigMode, defaultMathRenderMode, notebookName, notebookId);
      lastSnapshot.current = snapshot;
      setLastSavedAt(new Date().toISOString());
      setDirty(false);
    } catch (err) {
      window.alert('Failed to save to the server.');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirmDiscard()) return;
    try {
      const text = await readFileAsText(file);
      let next: {
        id: string;
        name: string;
        trigMode: 'deg' | 'rad';
        defaultMathRenderMode: 'exact' | 'decimal';
        cells: CellModel[];
      } | null = null;
      if (file.name.endsWith('.ipynb')) {
        next = deserializeIpynb(JSON.parse(text));
      } else {
        const parsed = JSON.parse(text);
        if (parsed?.version === 1) {
          next = deserializeSugarPy(parsed);
        }
      }
      if (!next) {
        window.alert('Unsupported notebook format.');
        return;
      }
      const safeCells = next.cells.length > 0 ? next.cells : [createCell('code')];
      setNotebookId(next.id);
      setNotebookName(next.name || 'Untitled');
      setTrigMode(next.trigMode);
      setDefaultMathRenderMode(next.defaultMathRenderMode);
      setCells(safeCells);
      setActiveCellId(safeCells[0]?.id ?? null);
      const payload = serializeSugarPy({
        id: next.id,
        name: next.name || 'Untitled',
        trigMode: next.trigMode,
        defaultMathRenderMode: next.defaultMathRenderMode,
        cells: safeCells
      });
      const saved = saveToLocalStorage(payload);
      if (!saved.ok && !localAutosaveWarningShown.current) {
        console.warn(`Local autosave skipped after import: ${saved.reason}`);
        localAutosaveWarningShown.current = true;
      }
      setLastSavedAt(payload.updatedAt);
      lastSnapshot.current = buildSnapshot(
        safeCells,
        next.trigMode,
        next.defaultMathRenderMode,
        next.name || 'Untitled',
        next.id
      );
      setDirty(false);
    } catch (err) {
      window.alert('Failed to import notebook.');
    } finally {
      event.target.value = '';
    }
  };

  const handleExportPdf = () => {
    const body = document.body;
    body.classList.add('print-mode');

    const cleanup = () => {
      body.classList.remove('print-mode');
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup, { once: true });

    // Let layout settle before opening print preview so print CSS is applied consistently.
    window.setTimeout(() => {
      window.print();
    }, 50);
  };

  const mobileActionCellId = mobileEditorCellId ?? activeCellId;
  const mobileActionCell = cells.find((cell) => cell.id === mobileActionCellId) ?? null;
  const showMobileActionBar = mobileActionsEligible && mobileKeyboardOpen && !!mobileActionCell;

  const runCellById = async (cell: CellModel) => {
    if (cell.type === 'markdown') return;
    if (cell.type === 'math') {
      await runMathCell(
        cell.id,
        cell.source,
        cell.mathRenderMode ?? defaultMathRenderMode,
        cell.mathTrigMode ?? trigMode
      );
      return;
    }
    if (cell.type === 'stoich') {
      await runStoichCell(cell.id, cell.stoichState ?? { reaction: '', inputs: {} });
      return;
    }
    await runCell(cell.id, cell.source);
  };

  return (
    <ErrorBoundary>
      <div className={`app${mobileActionsEligible ? ' mobile-actions-mode' : ''}`}>
        <header className="app-header">
          <div className="header-left">
            <input
              className="file-name-input"
              value={notebookName}
              onChange={(e) => setNotebookName(e.target.value)}
              placeholder="Notebook name"
            />
          </div>
          <div className="header-right">
            <button className="button" onClick={runAllCells} disabled={isRunningAll || status === 'connecting'}>
              {isRunningAll ? 'Running…' : 'Run All'}
            </button>
            <button
              ref={assistantToggleRef}
              className="button secondary"
              data-testid="assistant-toggle"
              onClick={() => {
                const nextOpen = !assistantOpen;
                setAssistantOpen(nextOpen);
                if (nextOpen) {
                  void hydrateAssistantRuntimeConfig();
                }
              }}
            >
              Assistant
            </button>
            <div className={`conn-pill status-${status}`}>
              <span className={`conn-dot ${status}`} />
              {status === 'connected'
                ? 'Connected'
                : status === 'connecting'
                  ? statusDetail || 'Initializing environment...'
                  : status}
            </div>
            <div className="header-menu-wrap" ref={headerMenuRef}>
              <button
                className="menu-button"
                onClick={() => setHeaderMenuOpen((prev) => !prev)}
                aria-label="More actions"
              >
                ⋮
              </button>
              {headerMenuOpen ? (
                <div className="header-menu">
                  <div className="menu-section-label">Notebook</div>
                  <div className={`save-status menu-save-status ${dirty ? 'dirty' : 'clean'}`}>
                    {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved'}
                    {dirty ? ' · editing…' : ''}
                    {syncMessage ? ` · ${syncMessage}` : ''}
                  </div>
                  <button className="menu-item" onClick={connectKernel}>
                    {activeKernel ? 'Kernel Connected' : 'Connect to Kernel'}
                  </button>
                  <button className="menu-item" onClick={() => setTrigMode((prev) => (prev === 'deg' ? 'rad' : 'deg'))}>
                    Default Math Angle Mode: {trigMode === 'deg' ? 'Degrees' : 'Radians'}
                  </button>
                  <button
                    className="menu-item"
                    onClick={() =>
                      setDefaultMathRenderMode((prev) => (prev === 'decimal' ? 'exact' : 'decimal'))
                    }
                  >
                    Default Math Display: {defaultMathRenderMode === 'decimal' ? 'Decimal' : 'Exact'}
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => setConfigureConnection((prev) => !prev)}
                  >
                    {configureConnection ? 'Hide Connection Settings' : 'Configure Connection'}
                  </button>
                  {configureConnection ? (
                    <div className="menu-connection-form">
                      <input
                        className="input"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        placeholder="Server URL"
                      />
                      <input
                        className="input"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Token"
                      />
                    </div>
                  ) : null}
                  <div className="menu-section-label">File</div>
                  <button className="menu-item" onClick={handleSaveToServer}>Save to Server</button>
                  <button className="menu-item" onClick={handleExportPdf}>Export PDF</button>
                  <button className="menu-item" onClick={handleDownloadIpynb}>Download .ipynb</button>
                  <button className="menu-item" onClick={handleDownloadSugarPy}>Download .sugarpy</button>
                  <button className="menu-item" onClick={handleImportClick}>Import</button>
                  <button className="menu-item" onClick={handleNewNotebook}>New Notebook</button>
                  <div className="menu-section-label">Reference</div>
                  <a className="menu-item" href="/wiki" target="_blank" rel="noreferrer">
                    Open Wiki
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="workspace">
          {status === 'error' ? (
            <div className="output">
              {errorMsg}
              {'\n'}
              Check that Jupyter Server is running on {serverUrl} and the token is correct.
            </div>
          ) : null}

          <div className="notebook-stack">
            {cells.length === 0 ? (
              <div className="cell-empty">
                <div className="cell-empty-title">This notebook is empty.</div>
                <div className="divider-menu open">
                  <button className="divider-btn" onClick={() => insertCellAt(0, 'code')}>Code</button>
                  <button className="divider-btn" onClick={() => insertCellAt(0, 'markdown')}>Text</button>
                  <button className="divider-btn" onClick={() => insertCellAt(0, 'math')}>Math</button>
                </div>
              </div>
            ) : null}
            {cells.length > 0 ? (
              <>
                {Array.from({ length: cells.length + 1 }).map((_, index) => (
                  <React.Fragment key={`slot-${index}`}>
                    <div
                      className="cell-divider"
                      data-testid={`cell-divider-${index}`}
                    >
                      <div className="cell-divider-line" />
                      <div className="divider-menu" role="menu" aria-label="Insert cell type">
                        <button className="divider-btn" onClick={() => insertCellAt(index, 'code')}>Code</button>
                        <button className="divider-btn" onClick={() => insertCellAt(index, 'markdown')}>Text</button>
                        <button className="divider-btn" onClick={() => insertCellAt(index, 'math')}>Math</button>
                      </div>
                    </div>
                    {index < cells.length ? (
                      <NotebookCell
                        key={cells[index].id}
                        cell={cells[index]}
                        isActive={cells[index].id === activeCellId}
                        onActivate={() => setActiveCellId(cells[index].id)}
                        onChange={(value) => updateCell(cells[index].id, value)}
                        onRun={(value) => runCell(cells[index].id, value)}
                        onRunMath={(value) =>
                          runMathCell(
                            cells[index].id,
                            value,
                            cells[index].mathRenderMode ?? defaultMathRenderMode,
                            cells[index].mathTrigMode ?? trigMode
                          )
                        }
                        onRunStoich={(state) => runStoichCell(cells[index].id, state)}
                        onChangeStoich={(state) => updateStoichState(cells[index].id, state)}
                        onMoveUp={() => setCells((prev) => moveCellUp(prev, cells[index].id))}
                        onMoveDown={() => setCells((prev) => moveCellDown(prev, cells[index].id))}
                        onDelete={() => setCells((prev) => deleteCell(prev, cells[index].id))}
                        suggestions={codeSuggestions}
                        slashCommands={slashCommands}
                        onSlashCommand={(command) => handleSlashCommand(cells[index].id, command)}
                        mathSuggestions={mathSuggestions}
                        trigMode={trigMode}
                        kernelReady={!!activeKernel}
                        onSetMathRenderMode={(mode) =>
                          {
                            setCells((prev) =>
                              prev.map((cell) =>
                                cell.id === cells[index].id ? { ...cell, mathRenderMode: mode } : cell
                              )
                            );
                          }
                        }
                        onSetMathTrigMode={(mode) => {
                          setCells((prev) =>
                            prev.map((cell) =>
                              cell.id === cells[index].id ? { ...cell, mathTrigMode: mode } : cell
                            )
                          );
                          if (cells[index].source.trim()) {
                            void runMathCell(
                              cells[index].id,
                              cells[index].source,
                              cells[index].mathRenderMode ?? defaultMathRenderMode,
                              mode,
                              true
                            );
                          }
                        }}
                      />
                    ) : null}
                  </React.Fragment>
                ))}
              </>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ipynb,.sugarpy,.sugarpy.json,application/json"
            onChange={handleImportFile}
            className="file-input"
          />
        </main>
        {showMobileActionBar && mobileActionCell ? (
          <div
            className="mobile-cell-actions"
            role="toolbar"
            aria-label="Cell actions mobile"
            style={{ top: `${Math.max(56, mobileVisualTop + mobileVisualHeight - 8)}px` }}
          >
            <button
              type="button"
              className="mobile-cell-action-btn primary"
              onClick={() => {
                runCellById(mobileActionCell).catch(() => undefined);
              }}
              disabled={mobileActionCell.type === 'markdown'}
            >
              Run
            </button>
            {mobileActionCell.type === 'math' ? (
              <button
                type="button"
                className="mobile-cell-action-btn"
                onClick={() =>
                  {
                    const currentMode = mobileActionCell.mathRenderMode ?? defaultMathRenderMode;
                    const nextMode = currentMode === 'decimal' ? 'exact' : 'decimal';
                    setCells((prev) =>
                      prev.map((cell) =>
                        cell.id === mobileActionCell.id ? { ...cell, mathRenderMode: nextMode } : cell
                      )
                    );
                  }
                }
              >
                {(mobileActionCell.mathRenderMode ?? defaultMathRenderMode) === 'decimal' ? 'Decimal' : 'Exact'}
              </button>
            ) : null}
            {mobileActionCell.type === 'math' ? (
              <button
                type="button"
                className="mobile-cell-action-btn"
                onClick={() => {
                  const nextMode = (mobileActionCell.mathTrigMode ?? trigMode) === 'deg' ? 'rad' : 'deg';
                  setCells((prev) =>
                    prev.map((cell) =>
                      cell.id === mobileActionCell.id ? { ...cell, mathTrigMode: nextMode } : cell
                    )
                  );
                  if (mobileActionCell.source.trim()) {
                    void runMathCell(
                      mobileActionCell.id,
                      mobileActionCell.source,
                      mobileActionCell.mathRenderMode ?? defaultMathRenderMode,
                      nextMode,
                      true
                    );
                  }
                }}
              >
                {(mobileActionCell.mathTrigMode ?? trigMode) === 'deg' ? 'Deg' : 'Rad'}
              </button>
            ) : null}
            <button
              type="button"
              className="mobile-cell-action-btn"
              onClick={() => setCells((prev) => moveCellUp(prev, mobileActionCell.id))}
            >
              ↑
            </button>
            <button
              type="button"
              className="mobile-cell-action-btn"
              onClick={() => setCells((prev) => moveCellDown(prev, mobileActionCell.id))}
            >
              ↓
            </button>
            <button
              type="button"
              className="mobile-cell-action-btn danger"
              onClick={() => {
                setCells((prev) => deleteCell(prev, mobileActionCell.id));
                setMobileEditorCellId(null);
                setMobileKeyboardOpen(false);
              }}
            >
              ✕
            </button>
          </div>
        ) : null}
        <div ref={assistantDrawerRef}>
          <AssistantDrawer
            open={assistantOpen}
            apiKey={assistantApiKey}
            hasDefaultApiKey={matchesAssistantProvider(assistantDefaultApiKey, assistantModel)}
            model={assistantModel}
            thinkingLevel={assistantThinkingLevel}
            draft={assistantDraft}
            loading={assistantLoading}
            error={assistantError}
            chats={assistantChats}
            activeChatId={assistantActiveChatId}
            canUndo={assistantUndoStack.length > 0}
            settingsOpen={assistantSettingsOpen}
            onClose={() => setAssistantOpen(false)}
            onToggleSettings={() => setAssistantSettingsOpen((prev) => !prev)}
            onChangeApiKey={setAssistantApiKey}
            onChangeModel={setAssistantModel}
            onChangeThinkingLevel={setAssistantThinkingLevel}
            onChangeDraft={setAssistantDraft}
            onSend={() => {
              void runAssistant();
            }}
            onStop={stopAssistant}
            onApply={(messageId) => {
              const message = activeAssistantChat?.messages.find((entry) => entry.id === messageId);
              if (!message?.plan || !assistantActiveChatId) return;
              void applyAssistantPlan(messageId, message.plan, false);
            }}
            onApplyAndRun={(messageId) => {
              const message = activeAssistantChat?.messages.find((entry) => entry.id === messageId);
              if (!message?.plan || !assistantActiveChatId) return;
              void applyAssistantPlan(messageId, message.plan, true);
            }}
            onDismiss={dismissAssistantPlan}
            onUndo={undoAssistantPlan}
            onSelectChat={setAssistantActiveChatId}
            onNewChat={() => {
              createNewAssistantChat();
            }}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
