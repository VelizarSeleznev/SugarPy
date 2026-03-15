import React, { useEffect, useMemo, useRef, useState } from 'react';

import { FunctionEntry, useFunctionLibrary } from './hooks/useFunctionLibrary';
import { NotebookCell } from './components/NotebookCell';
import { AssistantDrawer } from './components/AssistantDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildSuggestions } from './utils/suggestUtils';
import { extractFunctionNames } from './utils/functionParse';
import { moveCellDown, moveCellUp, deleteCell } from './utils/cellOps';
import { StoichOutput, StoichState } from './utils/stoichTypes';
import { createCustomCellData, CustomCellData, CustomCellTemplateId } from './utils/customCellTypes';
import { SpecialCellDescriptor, specialCellRegistry, specialFunctionIds } from './utils/specialCells';
import {
  AssistantActivity,
  AssistantConversationEntry,
  AssistantDraftRun,
  AssistantDraftStep,
  AssistantNetworkEvent,
  AssistantResponseTrace,
  AssistantSandboxExecutionTrace,
  AssistantValidationSummary,
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
  connectNotebookRuntime,
  deleteNotebookRuntime,
  executeNotebookCell,
  fetchNotebookRuntime,
  fetchRuntimeConfig,
  loadServerAutosave as loadServerAutosaveRequest,
  persistAssistantTraceToServer,
  restartNotebookRuntime,
  saveNotebookDocument,
  saveServerAutosave as saveServerAutosaveRequest,
  SugarPyNotebookRuntime,
  SugarPyRuntimeConfig
} from './utils/backendApi';
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
  type?: 'code' | 'markdown' | 'math' | 'stoich' | 'custom';
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
  customCell?: CustomCellData;
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
const SUGARPY_MIME_CUSTOM = 'application/vnd.sugarpy.custom+json';
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
  model?: string;
  providers?: {
    openai?: boolean;
    gemini?: boolean;
    groq?: boolean;
  };
};

const matchesAssistantProvider = (apiKey: string, model: string) => {
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('test-')) return true;
  const provider = detectAssistantProvider(model, trimmed);
  if (provider === 'openai') {
    return trimmed.startsWith('sk-');
  }
  if (provider === 'groq') {
    return trimmed.startsWith('gsk_');
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
  draftRun?: AssistantDraftRun | null;
  error?: string;
  requestPrompt?: string;
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
  draftValidations: Array<{
    stepId: string;
    stepTitle: string;
    operationIndex: number;
    cellType: AssistantCellKind;
    request: AssistantSandboxRequest;
    summary: AssistantValidationSummary;
  }>;
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

const readOptionalStorageItem = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
};

function App() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [notebookRuntime, setNotebookRuntime] = useState<SugarPyNotebookRuntime>({
    notebookId: '',
    status: 'disconnected'
  });
  const [cells, setCells] = useState<CellModel[]>([]);
  const { allFunctions } = useFunctionLibrary();
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
  const [addCellMenuOpen, setAddCellMenuOpen] = useState(false);
  const [addCellSpecialMenuOpen, setAddCellSpecialMenuOpen] = useState(false);
  const [dividerSpecialMenuIndex, setDividerSpecialMenuIndex] = useState<number | null>(null);
  const [specialPaletteOpen, setSpecialPaletteOpen] = useState(false);
  const [specialPaletteQuery, setSpecialPaletteQuery] = useState('');
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [touchUiEnabled, setTouchUiEnabled] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantApiKey, setAssistantApiKey] = useState('');
  const [assistantModel, setAssistantModel] = useState(
    import.meta.env.VITE_ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL
  );
  const [assistantThinkingLevel, setAssistantThinkingLevel] = useState<AssistantThinkingLevel>('dynamic');
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantChats, setAssistantChats] = useState<AssistantChatSession[]>([]);
  const [assistantActiveChatId, setAssistantActiveChatId] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<SugarPyRuntimeConfig | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const notebookStackRef = useRef<HTMLDivElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const addCellMenuRef = useRef<HTMLDivElement | null>(null);
  const specialPaletteRef = useRef<HTMLDivElement | null>(null);
  const specialPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const assistantDrawerRef = useRef<HTMLDivElement | null>(null);
  const assistantToggleRef = useRef<HTMLButtonElement | null>(null);
  const assistantRuntimeConfigAttemptedRef = useRef(false);
  const assistantHistoryNotebookRef = useRef<string | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantTracePendingRef = useRef<Map<string, AssistantRunTrace>>(new Map());
  const assistantTraceFlushRef = useRef<Map<string, Promise<void>>>(new Map());
  const connectingRef = useRef(false);
  const cellsRef = useRef<CellModel[]>([]);
  const trigModeRef = useRef<'deg' | 'rad'>('deg');
  const renderModeRef = useRef<'exact' | 'decimal'>('exact');
  const activeCellIdRef = useRef<string | null>(null);
  const slashData = useMemo(() => {
    const map = new Map<string, FunctionEntry>();
    const list: { label: string; detail?: string }[] = [];
    allFunctions.forEach((fn) => {
      if (specialFunctionIds.has(fn.id)) return;
      const name = getCommandName(fn);
      if (!name || map.has(name)) return;
      map.set(name, fn);
      list.push({ label: name, detail: fn.signature ?? fn.description });
    });
    return { map, list };
  }, [allFunctions]);
  const slashCommands = slashData.list;
  const slashCommandMap = slashData.map;
  const filteredSpecialCells = useMemo(() => {
    const needle = specialPaletteQuery.trim().toLowerCase();
    if (!needle) return specialCellRegistry;
    return specialCellRegistry.filter((entry) => {
      const haystack = [entry.title, entry.description, ...entry.aliases].join('\n').toLowerCase();
      return haystack.includes(needle);
    });
  }, [specialPaletteQuery]);
  const codeSuggestions = useMemo(
    () => [
      ...buildSuggestions(allFunctions.filter((fn) => !specialFunctionIds.has(fn.id))),
      ...userFunctions.map((name) => ({ label: name, detail: 'user function' }))
    ],
    [allFunctions, userFunctions]
  );

  useEffect(() => {
    cellsRef.current = cells;
    trigModeRef.current = trigMode;
    renderModeRef.current = defaultMathRenderMode;
    activeCellIdRef.current = activeCellId;
  }, [cells, trigMode, defaultMathRenderMode, activeCellId]);
  const assistantBootstrapCode = useMemo(() => buildAssistantBootstrapCode(allFunctions), [allFunctions]);

  useEffect(() => {
    if (!specialPaletteOpen) return;
    specialPaletteInputRef.current?.focus();
    specialPaletteInputRef.current?.select();
  }, [specialPaletteOpen]);

  const connectBackend = async (): Promise<boolean> => {
    if (connectingRef.current) return false;
    connectingRef.current = true;
    setStatus('connecting');
    setStatusDetail('Checking backend runtime...');
    setErrorMsg('');
    try {
      const config = await fetchRuntimeConfig();
      setRuntimeConfig(config);
      setStatus('connected');
      setStatusDetail(config.mode ? `Mode: ${config.mode}` : 'Backend ready');
      setErrorMsg('');
      return true;
    } catch (err) {
      setStatus('error');
      setStatusDetail('');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect to SugarPy backend.');
      return false;
    } finally {
      connectingRef.current = false;
    }
  };

  const activeKernel = status === 'connected';

  const applyNotebookRuntime = (runtime: SugarPyNotebookRuntime) => {
    setNotebookRuntime(runtime);
    const detail =
      runtime.status === 'connected'
        ? 'Notebook runtime connected'
        : runtime.status === 'disconnected'
          ? 'Notebook runtime disconnected'
          : runtime.status === 'starting'
            ? 'Starting notebook runtime...'
            : runtime.status === 'restarting'
              ? 'Restarting notebook runtime...'
              : runtime.status === 'deleting'
                ? 'Deleting notebook runtime...'
                : runtime.error || 'Notebook runtime error';
    if (status === 'connected') {
      setStatusDetail(detail);
    }
  };

  const refreshNotebookRuntime = async (targetNotebookId = notebookId) => {
    if (status !== 'connected') return;
    try {
      const runtime = await fetchNotebookRuntime(targetNotebookId);
      applyNotebookRuntime(runtime);
    } catch (_err) {
      applyNotebookRuntime({ notebookId: targetNotebookId, status: 'disconnected' });
    }
  };

  const ensureNotebookRuntime = async (targetNotebookId = notebookId) => {
    let backendReady = status === 'connected';
    if (!backendReady) {
      backendReady = await connectBackend();
    }
    if (!backendReady) {
      throw new Error(errorMsg || 'SugarPy backend is not connected.');
    }
    if (
      notebookRuntime.notebookId === targetNotebookId &&
      notebookRuntime.status === 'connected'
    ) {
      return notebookRuntime;
    }
    const starting: SugarPyNotebookRuntime = {
      notebookId: targetNotebookId,
      status: 'starting'
    };
    applyNotebookRuntime(starting);
    const runtime = await connectNotebookRuntime(targetNotebookId);
    applyNotebookRuntime(runtime);
    return runtime;
  };

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

  const loadAssistantRuntimeConfig = async (): Promise<AssistantRuntimeConfig | null> => {
    try {
      const parsed = await fetchRuntimeConfig();
      setRuntimeConfig(parsed);
      const runtimeModel = typeof parsed.model === 'string' ? parsed.model.trim() : '';
      return {
        model: runtimeModel || undefined,
        providers: parsed.providers
      };
    } catch (_err) {
      return null;
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
          await persistAssistantTraceToServer(nextTrace as unknown as Record<string, unknown>);
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
    try {
      const parsed = await loadServerAutosaveRequest(id);
      return parsed && (parsed as any).version === 1 ? parsed : null;
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
      const payload = serializeSugarPy({
        id: params.id,
        name: params.name,
        trigMode: params.trigMode,
        defaultMathRenderMode: params.defaultMathRenderMode,
        cells: params.cells
      });
      await saveServerAutosaveRequest(payload as unknown as Record<string, unknown>);
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
    if (cells.length === 0) {
      setActiveCellId(null);
      return;
    }
    if (activeCellId && !cells.some((cell) => cell.id === activeCellId)) {
      setActiveCellId(cells[0].id);
    }
  }, [cells, activeCellId]);

  useEffect(() => {
    if (connectOnce.current) return;
    connectOnce.current = true;
    connectBackend().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!notebookId || status !== 'connected') return;
    void refreshNotebookRuntime(notebookId);
  }, [notebookId, status]);

  useEffect(() => {
    const updateEligibility = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const noHover = window.matchMedia('(hover: none)').matches;
      const touchCapable = navigator.maxTouchPoints > 0 || coarse || noHover;
      setTouchUiEnabled(touchCapable);
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
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !document.querySelector('.cell-divider:hover')) {
        setDividerSpecialMenuIndex(null);
      }
      if (headerMenuOpen && headerMenuRef.current && target && !headerMenuRef.current.contains(target)) {
        setHeaderMenuOpen(false);
      }
      if (addCellMenuOpen && addCellMenuRef.current && target && !addCellMenuRef.current.contains(target)) {
        setAddCellMenuOpen(false);
        setAddCellSpecialMenuOpen(false);
        setDividerSpecialMenuIndex(null);
      }
      if (specialPaletteOpen && specialPaletteRef.current && target && !specialPaletteRef.current.contains(target)) {
        setSpecialPaletteOpen(false);
      }
      if (
        target &&
        notebookStackRef.current &&
        !notebookStackRef.current.contains(target) &&
        !headerMenuRef.current?.contains(target) &&
        !addCellMenuRef.current?.contains(target) &&
        !specialPaletteRef.current?.contains(target)
      ) {
        setActiveCellId(null);
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSpecialPaletteOpen(true);
        setSpecialPaletteQuery('');
        setHeaderMenuOpen(false);
        setAddCellMenuOpen(false);
        setAddCellSpecialMenuOpen(false);
        setDividerSpecialMenuIndex(null);
        return;
      }
      if (event.key !== 'Escape') return;
      if (headerMenuOpen) setHeaderMenuOpen(false);
      if (addCellMenuOpen) {
        setAddCellMenuOpen(false);
        setAddCellSpecialMenuOpen(false);
        setDividerSpecialMenuIndex(null);
      }
      if (specialPaletteOpen) setSpecialPaletteOpen(false);
      if (assistantOpen) setAssistantOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [addCellMenuOpen, assistantOpen, headerMenuOpen, specialPaletteOpen]);

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
      setNotebookRuntime({ notebookId: decoded.id, status: 'disconnected' });
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
  }, []);

  const buildExecutionCells = (cellId: string, source: string, type: 'code' | 'math' | 'stoich' | 'custom') =>
    cellsRef.current.map((cell) =>
      cell.id === cellId
        ? {
            ...cell,
            type,
            source,
            ...(type === 'stoich'
              ? {
                  stoichState: {
                    reaction: cell.stoichState?.reaction ?? source,
                    inputs: cell.stoichState?.inputs ?? {}
                  }
                }
              : {}),
            ...(type === 'custom'
              ? {
                  customCell: cell.customCell
                }
              : {})
          }
        : cell
    );

  const applyExecutionResult = (cellId: string, response: SugarPyExecutionResponse, countExecution = true) => {
    if (response.runtime) {
      applyNotebookRuntime(response.runtime);
    }
    const updateCellState = (nextExecCount?: number) => {
      setCells((prev) =>
        prev.map((cell) => {
          if (cell.id !== cellId) return cell;
          if (response.cellType === 'math') {
            return {
              ...cell,
              isRunning: false,
              execCount: nextExecCount ?? cell.execCount,
              mathOutput: response.mathOutput as any,
              output: response.output as any,
              ui: {
                ...cell.ui,
                outputCollapsed: false,
                mathView: 'rendered'
              }
            };
          }
          if (response.cellType === 'stoich') {
            return {
              ...cell,
              isRunning: false,
              execCount: nextExecCount ?? cell.execCount,
              stoichOutput: response.stoichOutput as any,
              ui: {
                ...cell.ui,
                outputCollapsed: false
              }
            };
          }
          if (response.cellType === 'custom') {
            return {
              ...cell,
              isRunning: false,
              execCount: nextExecCount ?? cell.execCount,
              customCell: cell.customCell
                ? {
                    ...cell.customCell,
                    output: response.customOutput as CustomCellData['output']
                  }
                : cell.customCell,
              ui: {
                ...cell.ui,
                outputCollapsed: false
              }
            };
          }
          return {
            ...cell,
            isRunning: false,
            execCount: nextExecCount ?? cell.execCount,
            output: response.output as any,
            ui: {
              ...cell.ui,
              outputCollapsed: false
            }
          };
        })
      );
    };
    if (countExecution && response.execCountIncrement) {
      setExecCounter((prev) => {
        const next = prev + 1;
        updateCellState(next);
        return next;
      });
      return;
    }
    updateCellState();
  };

  const runCell = async (cellId: string, code: string, showOutput = true, countExecution = true) => {
    setCells((prev) =>
      prev.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              source: code,
              isRunning: true,
              output: undefined,
              ui: {
                ...cell.ui,
                outputCollapsed: false
              }
            }
          : cell
      )
    );
    try {
      if (!activeKernel) {
        const backendReady = await connectBackend();
        if (!backendReady) {
          throw new Error(errorMsg || 'SugarPy backend is not connected.');
        }
      }
      await ensureNotebookRuntime();
      const response = await executeNotebookCell({
        notebookId,
        cells: buildExecutionCells(cellId, code, 'code') as Array<Record<string, unknown>>,
        targetCellId: cellId,
        trigMode,
        defaultMathRenderMode,
        timeoutMs: CELL_EXECUTION_TIMEOUT_MS
      });
      if (showOutput) {
        applyExecutionResult(cellId, response, countExecution);
      }
      const defs = extractFunctionNames(code);
      if (defs.length > 0) {
        setUserFunctions((prev) => Array.from(new Set([...prev, ...defs])));
      }
    } catch (error) {
      setCells((prev) =>
        prev.map((cell) =>
          cell.id === cellId
            ? {
                ...cell,
                isRunning: false,
                output: {
                  type: 'error',
                  ename: 'ExecutionError',
                  evalue: error instanceof Error ? error.message : String(error)
                }
              }
            : cell
        )
      );
    }
  };

  const runMathCell = async (
    cellId: string,
    source: string,
    renderModeOverride?: 'exact' | 'decimal',
    trigModeOverride?: 'deg' | 'rad',
    preserveOutput = false
  ) => {
    const cell = cells.find((entry) => entry.id === cellId);
    const renderMode =
      renderModeOverride ??
      (cell?.mathRenderMode === 'decimal' ? 'decimal' : defaultMathRenderMode);
    const mode = trigModeOverride ?? cell?.mathTrigMode ?? trigMode;
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId
          ? {
              ...c,
              isRunning: true,
              ...(preserveOutput ? {} : { mathOutput: undefined, output: undefined }),
              ui: {
                ...c.ui,
                outputCollapsed: false
              }
            }
          : c
      )
    );
    try {
      if (!activeKernel) {
        const backendReady = await connectBackend();
        if (!backendReady) {
          throw new Error(errorMsg || 'SugarPy backend is not connected.');
        }
      }
      await ensureNotebookRuntime();
      const response = await executeNotebookCell({
        notebookId,
        cells: buildExecutionCells(cellId, source, 'math') as Array<Record<string, unknown>>,
        targetCellId: cellId,
        trigMode,
        defaultMathRenderMode,
        timeoutMs: CELL_EXECUTION_TIMEOUT_MS
      });
      applyExecutionResult(cellId, response, true);
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
    }
  };

  const runStoichCell = async (cellId: string, state: StoichState) => {
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId
          ? {
              ...c,
              isRunning: true,
              ui: {
                ...c.ui,
                outputCollapsed: false
              }
            }
          : c
      )
    );
    try {
      if (!activeKernel) {
        const backendReady = await connectBackend();
        if (!backendReady) {
          throw new Error(errorMsg || 'SugarPy backend is not connected.');
        }
      }
      await ensureNotebookRuntime();
      const nextCells = cellsRef.current.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              type: 'stoich',
              stoichState: state
            }
          : cell
      );
      const response = await executeNotebookCell({
        notebookId,
        cells: nextCells as Array<Record<string, unknown>>,
        targetCellId: cellId,
        trigMode,
        defaultMathRenderMode,
        timeoutMs: CELL_EXECUTION_TIMEOUT_MS
      });
      applyExecutionResult(cellId, response, true);
    } catch (error) {
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId
            ? { ...c, isRunning: false, stoichOutput: { ok: false, error: String(error), species: [] } }
            : c
        )
      );
    }
  };

  const runCustomCell = async (
    cellId: string,
    customCell: CustomCellData,
    options?: { exportBindings?: boolean }
  ) => {
    const nextCustomCell: CustomCellData = {
      ...customCell,
      state: {
        ...customCell.state,
        ...(options?.exportBindings ? { exportBindings: true } : { exportBindings: false }),
      } as CustomCellData['state'],
    };
    setCells((prev) =>
      prev.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              isRunning: true,
              customCell: nextCustomCell,
              ui: {
                ...cell.ui,
                outputCollapsed: false
              }
            }
          : cell
      )
    );
    try {
      if (!activeKernel) {
        const backendReady = await connectBackend();
        if (!backendReady) {
          throw new Error(errorMsg || 'SugarPy backend is not connected.');
        }
      }
      await ensureNotebookRuntime();
      const nextCells = cellsRef.current.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              type: 'custom',
              customCell: nextCustomCell
            }
          : cell
      );
      const response = await executeNotebookCell({
        notebookId,
        cells: nextCells as Array<Record<string, unknown>>,
        targetCellId: cellId,
        trigMode,
        defaultMathRenderMode,
        timeoutMs: CELL_EXECUTION_TIMEOUT_MS
      });
      applyExecutionResult(cellId, response, true);
    } catch (error) {
      setCells((prev) =>
        prev.map((cell) =>
          cell.id === cellId
            ? {
                ...cell,
                isRunning: false,
                customCell: cell.customCell
                  ? {
                      ...cell.customCell,
                      output: {
                        schema_version: 1,
                        template_id: cell.customCell.templateId,
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                      } as CustomCellData['output']
                    }
                  : cell.customCell
              }
            : cell
        )
      );
    }
  };

  const runAllCells = async () => {
    if (isRunningAll) return;
    try {
      await ensureNotebookRuntime();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
      return;
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
        if (cell.type === 'custom' && cell.customCell) {
          await runCustomCell(cell.id, cell.customCell);
          continue;
        }
        await runCell(cell.id, cell.source);
      }
    } finally {
      setIsRunningAll(false);
    }
  };

  const createCell = (
    type: 'code' | 'markdown' | 'math' | 'stoich' | 'custom',
    source = '',
    indexSeed?: number,
    options?: { templateId?: CustomCellTemplateId }
  ): CellModel => {
    const idSuffix = indexSeed ? `${indexSeed}-${Date.now()}` : `${Date.now()}`;
    if (type === 'stoich') {
      return {
        id: `cell-${idSuffix}`,
        source,
        type,
        stoichState: createStoichState(),
        ui: {
          outputCollapsed: false
        }
      };
    }
    if (type === 'custom') {
      return {
        id: `cell-${idSuffix}`,
        source: '',
        type,
        customCell: createCustomCellData(options?.templateId ?? 'regression'),
        ui: {
          outputCollapsed: false
        }
      };
    }
    return {
      id: `cell-${idSuffix}`,
      source,
      type,
      ...(type === 'math' ? { mathRenderMode: defaultMathRenderMode, mathTrigMode: trigMode } : {}),
      ui: {
        outputCollapsed: false,
        ...(type === 'math' ? { mathView: 'source' as const } : {})
      }
    };
  };

  const updateCellUi = (
    cellId: string,
    updater: (current: NonNullable<CellModel['ui']>) => NonNullable<CellModel['ui']>
  ) => {
    setCells((prev) =>
      prev.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              ui: updater(cell.ui ?? {})
            }
          : cell
      )
    );
  };

  const toggleCellOutputCollapsed = (cellId: string) => {
    setCells((prev) =>
      prev.map((cell) => {
        if (cell.id !== cellId) return cell;
        const nextCollapsed = !(cell.ui?.outputCollapsed ?? false);
        return {
          ...cell,
          ui: {
            ...cell.ui,
            outputCollapsed: nextCollapsed,
            ...(cell.type === 'math' && nextCollapsed ? { mathView: 'source' as const } : {})
          }
        };
      })
    );
  };

  const clearCellOutput = (cellId: string) => {
    setCells((prev) =>
      prev.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              output: undefined,
              mathOutput: undefined,
              stoichOutput: undefined,
              customCell: cell.customCell ? { ...cell.customCell, output: undefined } : undefined,
              ui: {
                ...cell.ui,
                outputCollapsed: false,
                ...(cell.type === 'math' ? { mathView: 'source' as const } : {})
              }
            }
          : cell
      )
    );
  };

  const clearNotebookOutputs = () => {
    setCells((prev) =>
      prev.map((cell) => ({
        ...cell,
        output: undefined,
        mathOutput: undefined,
        stoichOutput: undefined,
        customCell: cell.customCell ? { ...cell.customCell, output: undefined } : undefined,
        ui: {
          ...cell.ui,
          outputCollapsed: false,
          ...(cell.type === 'math' ? { mathView: 'source' as const } : {})
        }
      }))
    );
    setHeaderMenuOpen(false);
  };

  const handleRestartNotebookRuntime = async () => {
    if (!(await connectBackend()) && status !== 'connected') return;
    const nextRuntime: SugarPyNotebookRuntime = { notebookId, status: 'restarting' };
    applyNotebookRuntime(nextRuntime);
    try {
      const runtime = await restartNotebookRuntime(notebookId);
      applyNotebookRuntime(runtime);
      clearNotebookOutputs();
    } catch (error) {
      applyNotebookRuntime({
        notebookId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setHeaderMenuOpen(false);
    }
  };

  const handleDeleteNotebookRuntime = async () => {
    if (!(await connectBackend()) && status !== 'connected') return;
    const nextRuntime: SugarPyNotebookRuntime = { notebookId, status: 'deleting' };
    applyNotebookRuntime(nextRuntime);
    try {
      const runtime = await deleteNotebookRuntime(notebookId);
      applyNotebookRuntime(runtime);
      clearNotebookOutputs();
    } catch (error) {
      applyNotebookRuntime({
        notebookId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setHeaderMenuOpen(false);
    }
  };

  const handleConnectNotebookRuntime = async () => {
    try {
      await ensureNotebookRuntime();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMsg(message);
      applyNotebookRuntime({
        notebookId,
        status: 'error',
        error: message
      });
    } finally {
      setHeaderMenuOpen(false);
    }
  };

  const toggleMathView = (cellId: string) => {
    updateCellUi(cellId, (current) => {
      const nextView = current.mathView === 'rendered' ? 'source' : 'rendered';
      return {
        ...current,
        mathView: nextView,
        outputCollapsed: nextView === 'source' ? true : false
      };
    });
  };

  const showMathRenderedView = (cellId: string) => {
    updateCellUi(cellId, (current) => ({
      ...current,
      mathView: 'rendered',
      outputCollapsed: false
    }));
  };

  const getCellDisplayText = (cell: CellModel) => {
    if (cell.type === 'stoich') {
      return cell.stoichState?.reaction ?? '';
    }
    if (cell.type === 'custom') {
      const output = cell.customCell?.output;
      if (output && 'error' in output && output.error) return output.error;
      if (output && 'equation_text' in output && output.equation_text) return output.equation_text;
      return cell.customCell?.templateId ?? '';
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
      type: (cell.type ?? 'code') as 'code' | 'markdown' | 'math' | 'stoich' | 'custom',
      source: cell.source,
      mathRenderMode: cell.mathRenderMode,
      mathTrigMode: cell.mathTrigMode,
      stoichReaction: cell.stoichState?.reaction ?? '',
      hasOutput: !!(cell.output || cell.mathOutput || cell.stoichOutput || cell.customCell?.output),
      outputPreview: getCellDisplayText(cell),
      hasError: !!(
        cell.output?.type === 'error' ||
        cell.mathOutput?.error ||
        (cell.stoichOutput && cell.stoichOutput.ok === false) ||
        (cell.customCell?.output && 'ok' in cell.customCell.output && cell.customCell.output.ok === false)
      )
    }))
  });

  const buildAssistantSandboxCells = (): AssistantSandboxNotebookCell[] =>
    cells.map((cell) => ({
      id: cell.id,
      type: cell.type ?? 'code',
      source:
        cell.type === 'stoich'
          ? cell.stoichState?.reaction ?? ''
          : cell.type === 'custom'
            ? cell.customCell?.templateId ?? ''
            : cell.source,
      mathTrigMode: cell.mathTrigMode,
      mathRenderMode: cell.mathRenderMode
    }));

  const runAssistantSandbox = async (
    request: AssistantSandboxRequest,
    onActivity?: (item: AssistantActivity) => void
  ) =>
    runIsolatedAssistantSandbox({
      request,
      notebookCells: buildAssistantSandboxCells(),
      bootstrapCode: assistantBootstrapCode,
      onActivity: (label, detail) => onActivity?.({ kind: 'phase', label, detail })
    });

  const captureAssistantSnapshot = (): AssistantSnapshot => ({
    cells: cellsRef.current.map((cell) => ({
      ...cell,
      mathOutput: cell.mathOutput ? JSON.parse(JSON.stringify(cell.mathOutput)) : undefined,
      stoichState: cell.stoichState ? JSON.parse(JSON.stringify(cell.stoichState)) : undefined,
      stoichOutput: cell.stoichOutput ? JSON.parse(JSON.stringify(cell.stoichOutput)) : undefined,
      customCell: cell.customCell ? JSON.parse(JSON.stringify(cell.customCell)) : undefined,
      output: cell.output ? JSON.parse(JSON.stringify(cell.output)) : undefined
    })),
    trigMode: trigModeRef.current,
    defaultMathRenderMode: renderModeRef.current,
    activeCellId: activeCellIdRef.current
  });

  const restoreAssistantSnapshot = (snapshot: AssistantSnapshot) => {
    setCells(snapshot.cells);
    setTrigMode(snapshot.trigMode);
    setDefaultMathRenderMode(snapshot.defaultMathRenderMode);
    setActiveCellId(snapshot.activeCellId);
    cellsRef.current = snapshot.cells;
    trigModeRef.current = snapshot.trigMode;
    renderModeRef.current = snapshot.defaultMathRenderMode;
    activeCellIdRef.current = snapshot.activeCellId;
  };

  const isRunnableAssistantOperation = (operation: AssistantOperation) =>
    (operation.type === 'insert_cell' && operation.cellType !== 'markdown') || operation.type === 'update_cell';

  const isReplayableSandboxCell = (cell: AssistantSandboxNotebookCell) =>
    (cell.type === 'code' || cell.type === 'math') && cell.source.trim().length > 0;

  const cloneSandboxCells = (input: AssistantSandboxNotebookCell[]): AssistantSandboxNotebookCell[] =>
    input.map((cell) => ({ ...cell }));

  const buildLiveSandboxCells = (): AssistantSandboxNotebookCell[] =>
    cellsRef.current.map((cell) => ({
      id: cell.id,
      type: cell.type ?? 'code',
      source:
        cell.type === 'stoich'
          ? cell.stoichState?.reaction ?? ''
          : cell.type === 'custom'
            ? cell.customCell?.templateId ?? ''
            : cell.source,
      mathTrigMode: cell.mathTrigMode,
      mathRenderMode: cell.mathRenderMode
    }));

  const runAssistantSandboxForCells = async (
    request: AssistantSandboxRequest,
    notebookCells: AssistantSandboxNotebookCell[],
    onActivity?: (item: AssistantActivity) => void
  ) =>
    runIsolatedAssistantSandbox({
      request,
      notebookCells,
      bootstrapCode: assistantBootstrapCode,
      onActivity: (label, detail) => onActivity?.({ kind: 'phase', label, detail })
    });

  const describeAssistantOperationChange = (operation: AssistantOperation) => {
    switch (operation.type) {
      case 'insert_cell':
        return `Add ${operation.cellType} cell at ${operation.index + 1}`;
      case 'update_cell':
        return `Update cell ${operation.cellId}`;
      case 'delete_cell':
        return `Delete cell ${operation.cellId}`;
      case 'move_cell':
        return `Move cell ${operation.cellId} to ${operation.index + 1}`;
      case 'set_notebook_defaults':
        return 'Update notebook defaults';
      default:
        return operation.type;
    }
  };

  const describeValidationOutputKind = (source: string, result: Awaited<ReturnType<typeof runAssistantSandbox>>) => {
    if (result.status === 'timeout') return 'timeout';
    if (result.status === 'error') return 'error';
    if (result.target === 'math') {
      if (/\bplot\s*\(/.test(source) || result.mathValidation?.hasPlot) return 'plot';
      if (/\bsolve\s*\(/.test(source)) return 'symbolic solve';
      return result.mathValidation?.kind ?? 'math';
    }
    const mimeKeys = Object.keys(result.mimeData ?? {});
    if (mimeKeys.includes('application/vnd.plotly.v1+json')) return 'plot';
    if (mimeKeys.includes('text/latex')) return 'latex';
    if (mimeKeys.includes('text/plain')) return 'text';
    if (result.stdout.trim()) return 'stdout';
    return mimeKeys[0] ?? 'code';
  };

  const describeValidationPreview = (result: Awaited<ReturnType<typeof runAssistantSandbox>>) => {
    if (result.target === 'math') {
      if (result.mathValidation?.error) return result.mathValidation.error;
      if (result.mathValidation?.stepsPreview?.length) {
        return result.mathValidation.stepsPreview.join(' | ');
      }
    }
    const plain = result.mimeData?.['text/plain'];
    if (plain) return asText(plain);
    if (result.stdout.trim()) return result.stdout.trim();
    if (result.stderr.trim()) return result.stderr.trim();
    return '';
  };

  const buildValidationSummary = (
    source: string,
    result: Awaited<ReturnType<typeof runAssistantSandbox>>
  ): AssistantValidationSummary => {
    const rawPreview = describeValidationPreview(result).replace(/\s+/g, ' ').trim();
    const errorSummary =
      result.status === 'error'
        ? result.mathValidation?.error || result.errorValue || result.errorName || 'Validation failed.'
        : result.status === 'timeout'
          ? result.errorValue || 'Validation timed out.'
          : undefined;
    return {
      status: result.status,
      outputKind: describeValidationOutputKind(source, result),
      outputPreview: rawPreview || (result.status === 'ok' ? 'No visible output.' : ''),
      errorSummary,
      replayContextUsed: result.contextPresetUsed,
      replayedCellIds: result.replayedCellIds
    };
  };

  const applyDraftOperationToSandboxCells = (
    cellsInput: AssistantSandboxNotebookCell[],
    operation: AssistantOperation,
    options?: { insertedCellId?: string }
  ) => {
    let nextCells = cloneSandboxCells(cellsInput);
    if (operation.type === 'insert_cell') {
      const nextCellId = options?.insertedCellId ?? `draft-cell-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nextCell: AssistantSandboxNotebookCell = {
        id: nextCellId,
        type: operation.cellType,
        source: operation.source
      };
      const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
      nextCells = [...nextCells.slice(0, bounded), nextCell, ...nextCells.slice(bounded)];
      return { cells: nextCells, insertedCellId: nextCellId };
    }
    if (operation.type === 'update_cell') {
      return {
        cells: nextCells.map((cell) =>
          cell.id === operation.cellId ? { ...cell, source: operation.source } : cell
        )
      };
    }
    if (operation.type === 'delete_cell') {
      return { cells: nextCells.filter((cell) => cell.id !== operation.cellId) };
    }
    if (operation.type === 'move_cell') {
      const currentIndex = nextCells.findIndex((cell) => cell.id === operation.cellId);
      if (currentIndex === -1) return { cells: nextCells };
      const [moved] = nextCells.splice(currentIndex, 1);
      const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
      nextCells.splice(bounded, 0, moved);
      return { cells: [...nextCells] };
    }
    return { cells: nextCells };
  };

  const buildDraftFromPlan = async (
    plan: AssistantPlan,
    onActivity?: (item: AssistantActivity) => void,
    onValidation?: (entry: {
      stepId: string;
      stepTitle: string;
      operationIndex: number;
      cellType: AssistantCellKind;
      request: AssistantSandboxRequest;
      summary: AssistantValidationSummary;
    }) => void
  ): Promise<AssistantDraftRun> => {
    let draftCells = buildLiveSandboxCells();
    let draftTrigMode = trigModeRef.current;
    let draftRenderMode = renderModeRef.current;
    const steps: AssistantDraftStep[] = [];

    for (const step of plan.steps) {
      const validations: AssistantDraftStep['validations'] = [];
      const warnings = [...step.warnings];
      const errors: string[] = [];
      let workingCells = cloneSandboxCells(draftCells);
      let workingTrigMode = draftTrigMode;
      let workingRenderMode = draftRenderMode;

      for (let operationIndex = 0; operationIndex < step.operations.length; operationIndex += 1) {
        const operation = step.operations[operationIndex];
        if (operation.type === 'set_notebook_defaults') {
          if (operation.trigMode) workingTrigMode = operation.trigMode;
          if (operation.renderMode) workingRenderMode = operation.renderMode;
          continue;
        }

        if (!isRunnableAssistantOperation(operation)) {
          workingCells = applyDraftOperationToSandboxCells(workingCells, operation).cells;
          continue;
        }

        const sandboxSource = operation.source;
        const replayableCellIds = workingCells
          .filter((cell) => {
            if (!isReplayableSandboxCell(cell)) return false;
            return operation.type !== 'update_cell' || cell.id !== operation.cellId;
          })
          .map((cell) => cell.id);
        const usesReplayContext =
          replayableCellIds.length > 0 &&
          (operation.type === 'update_cell' || steps.some((entry) => entry.isRunnable));
        const request: AssistantSandboxRequest =
          operation.type === 'insert_cell' && operation.cellType === 'math'
            ? {
                target: 'math',
                source: sandboxSource,
                trigMode: workingTrigMode,
                renderMode: workingRenderMode,
                contextPreset: usesReplayContext ? 'selected-cells' : 'none',
                selectedCellIds: usesReplayContext ? replayableCellIds : [],
                timeoutMs: 5000
              }
            : operation.type === 'update_cell' && workingCells.find((cell) => cell.id === operation.cellId)?.type === 'math'
              ? {
                  target: 'math',
                  source: sandboxSource,
                  trigMode: workingTrigMode,
                  renderMode: workingRenderMode,
                  contextPreset: usesReplayContext ? 'selected-cells' : 'none',
                  selectedCellIds: usesReplayContext ? replayableCellIds : [],
                  timeoutMs: 5000
                }
              : {
                  target: 'code',
                  code: sandboxSource,
                  contextPreset: usesReplayContext ? 'selected-cells' : 'bootstrap-only',
                  selectedCellIds: usesReplayContext ? replayableCellIds : [],
                  timeoutMs: 5000
                };

        onActivity?.({
          kind: 'phase',
          label: 'Validating draft step',
          detail: `${step.title}: ${step.summary}`
        });
        const result = await runAssistantSandboxForCells(request, workingCells, onActivity);
        const cellType =
          operation.type === 'insert_cell'
            ? operation.cellType
            : (workingCells.find((cell) => cell.id === operation.cellId)?.type ?? 'code');
        const summary = buildValidationSummary(sandboxSource, result);
        validations.push({
          operationIndex,
          cellType,
          source: sandboxSource,
          summary
        });
        onValidation?.({
          stepId: step.id,
          stepTitle: step.title,
          operationIndex,
          cellType,
          request,
          summary
        });
        if (result.status !== 'ok') {
          errors.push(summary.errorSummary || 'Validation failed.');
        }
        workingCells = applyDraftOperationToSandboxCells(workingCells, operation).cells;
      }

      steps.push({
        id: step.id,
        title: step.title,
        summary: step.summary,
        explanation: step.summary,
        operations: step.operations,
        validations,
        warnings,
        errors,
        sourcePreview: step.operations
          .filter((operation) => 'source' in operation && operation.source)
          .map((operation) => operation.source)
          .join('\n\n'),
        changes: step.operations.map(describeAssistantOperationChange),
        isRunnable: step.operations.some(isRunnableAssistantOperation)
      });

      draftCells = workingCells;
      draftTrigMode = workingTrigMode;
      draftRenderMode = workingRenderMode;
    }

    return {
      summary: plan.summary,
      hasFailures: steps.some((step) => step.errors.length > 0),
      steps
    };
  };

  const insertCellAt = (
    index: number,
    type: 'code' | 'markdown' | 'math' | 'custom',
    source = '',
    options?: { templateId?: CustomCellTemplateId }
  ) => {
    const bounded = Math.max(0, Math.min(index, cells.length));
    const nextCell = createCell(type, source, bounded + 1, options);
    setCells((prev) => [...prev.slice(0, bounded), nextCell, ...prev.slice(bounded)]);
    setActiveCellId(nextCell.id);
    setAddCellMenuOpen(false);
    setAddCellSpecialMenuOpen(false);
    setDividerSpecialMenuIndex(null);
  };

  const insertSpecialCellAt = (index: number, descriptor: SpecialCellDescriptor) => {
    if (descriptor.kind === 'stoich') {
      const bounded = Math.max(0, Math.min(index, cells.length));
      const nextCell = createCell('stoich', '', bounded + 1);
      setCells((prev) => [...prev.slice(0, bounded), nextCell, ...prev.slice(bounded)]);
      setActiveCellId(nextCell.id);
      setAddCellMenuOpen(false);
      setAddCellSpecialMenuOpen(false);
      setDividerSpecialMenuIndex(null);
      setSpecialPaletteOpen(false);
      setSpecialPaletteQuery('');
      return;
    }
    insertCellAt(index, 'custom', '', { templateId: descriptor.templateId });
    setSpecialPaletteOpen(false);
    setSpecialPaletteQuery('');
  };

  const insertCellBelowActive = (type: 'code' | 'markdown' | 'math' | 'custom', options?: { templateId?: CustomCellTemplateId }) => {
    const activeIndex = activeCellId ? cells.findIndex((cell) => cell.id === activeCellId) : -1;
    const targetIndex = activeIndex >= 0 ? activeIndex + 1 : cells.length;
    insertCellAt(targetIndex, type, '', options);
  };

  const insertSpecialCellBelowActive = (descriptor: SpecialCellDescriptor) => {
    const activeIndex = activeCellId ? cells.findIndex((cell) => cell.id === activeCellId) : -1;
    const targetIndex = activeIndex >= 0 ? activeIndex + 1 : cells.length;
    insertSpecialCellAt(targetIndex, descriptor);
  };

  const insertSiblingCell = (cellId: string, position: 'above' | 'below') => {
    const sourceIndex = cells.findIndex((cell) => cell.id === cellId);
    if (sourceIndex < 0) return;
    const sourceCell = cells[sourceIndex];
    const targetIndex = position === 'above' ? sourceIndex : sourceIndex + 1;
    if (sourceCell.type === 'custom') {
      insertCellAt(targetIndex, 'custom', '', { templateId: sourceCell.customCell?.templateId ?? 'regression' });
      return;
    }
    const nextType: 'code' | 'markdown' | 'math' =
      sourceCell.type === 'markdown' || sourceCell.type === 'math' ? sourceCell.type : 'code';
    insertCellAt(targetIndex, nextType);
  };

  const updateCell = (cellId: string, source: string) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, source } : c)));
  };

  const updateStoichState = (cellId: string, state: StoichState) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, stoichState: state } : c)));
  };

  const updateCustomCell = (cellId: string, customCell: CustomCellData) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, customCell } : c)));
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
        return {
          ...cell,
          type: 'code',
          source: entry.snippet,
          output: undefined,
          execCount: undefined,
          isRunning: false,
          mathOutput: undefined,
          stoichOutput: undefined,
          customCell: undefined,
          stoichState: undefined,
          ui: {
            outputCollapsed: false
          }
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
                  draftRun: message.draftRun ?? null,
                  error: typeof message.error === 'string' ? message.error : undefined,
                  requestPrompt: typeof message.requestPrompt === 'string' ? message.requestPrompt : undefined
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
      return runtimeConfig
        ? {
            model: runtimeConfig.model?.trim() || undefined,
            providers: runtimeConfig.providers
          }
        : null;
    }
    const storedKey = readOptionalStorageItem(ASSISTANT_API_KEY_STORAGE);
    const storedModel =
      readOptionalStorageItem(ASSISTANT_MODEL_STORAGE) ?? readOptionalStorageItem('sugarpy:assistant:gemini:model');
    const envModel = (import.meta.env.VITE_ASSISTANT_MODEL || '').trim();
    if (storedKey) return null;
    assistantRuntimeConfigAttemptedRef.current = true;
    const nextRuntimeConfig = await loadAssistantRuntimeConfig();
    if (!nextRuntimeConfig) return null;
    if (!storedModel && !envModel && nextRuntimeConfig.model) {
      setAssistantModel(nextRuntimeConfig.model);
    }
    return nextRuntimeConfig;
  };

  const runAssistant = async (promptOverride?: string, options?: { chatId?: string; reviseFromMessageId?: string }) => {
    const runtimeConfig = await hydrateAssistantRuntimeConfig();
    const chatId = options?.chatId ?? ensureAssistantChat();
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
    const provider = detectAssistantProvider(effectiveModel, overrideApiKey);
    const serverProviderAvailable =
      (provider === 'openai' && !!runtimeConfig?.providers?.openai) ||
      (provider === 'gemini' && !!runtimeConfig?.providers?.gemini) ||
      (provider === 'groq' && !!runtimeConfig?.providers?.groq);
    const effectiveApiKey = matchesAssistantProvider(overrideApiKey, effectiveModel)
      ? overrideApiKey
      : serverProviderAvailable
        ? `server-proxy:${provider}`
        : '';
    if (!effectiveApiKey) {
      setAssistantError(
        provider === 'openai'
          ? 'No OpenAI API key is available. Add your own key in settings or configure a server proxy key.'
          : provider === 'groq'
            ? 'No Groq API key is available. Add your own key in settings or configure a server proxy key.'
            : 'No Gemini API key is available. Add your own key in settings or configure a server proxy key.'
      );
      return;
    }
    const promptSource = (promptOverride ?? assistantDraft).trim();
    if (!promptSource) {
      setAssistantError('Write a request for the assistant first.');
      return;
    }
    const prompt = promptSource;
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
      activity: [],
      requestPrompt: prompt
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
      sandboxExecutions: [],
      draftValidations: []
    };
    const collectedActivity: AssistantActivity[] = [];
    const collectedNetwork: AssistantNetworkEvent[] = [];
    const collectedResponses: AssistantResponseTrace[] = [];
    const collectedSandboxExecutions: AssistantSandboxExecutionTrace[] = [];
    const collectedDraftValidations: AssistantRunTrace['draftValidations'] = [];
    void persistAssistantTrace(baseTrace);

    setAssistantLoading(true);
    setAssistantError('');
    setAssistantDraft('');
    const controller = new AbortController();
    assistantAbortRef.current = controller;
    try {
      const requestPlan = async (requestText: string, prependActivityLabel?: string) => {
        if (prependActivityLabel) {
          const activityItem = { kind: 'phase' as const, label: prependActivityLabel };
          collectedActivity.push(activityItem);
          updateAssistantMessage(chatId, assistantMessageId, (message) => ({
            ...message,
            activity: [...(message.activity ?? []), activityItem]
          }));
        }
        return planNotebookChanges({
          apiKey: effectiveApiKey,
          model: effectiveModel,
          request: requestText,
          scope: ASSISTANT_SCOPE,
          preference: ASSISTANT_PREFERENCE,
          context: buildAssistantContext(),
          signal: controller.signal,
          conversationHistory: [...previousConversation, { role: 'user', content: requestText }].slice(-6),
          thinkingLevel: effectiveThinkingLevel,
          sandboxRunner: runAssistantSandbox,
          onNetworkEvent: (event) => {
            collectedNetwork.push(event);
            void persistAssistantTrace({
              ...baseTrace,
              activity: [...collectedActivity],
              network: [...collectedNetwork],
              responses: [...collectedResponses],
              sandboxExecutions: [...collectedSandboxExecutions],
              draftValidations: [...collectedDraftValidations]
            });
          },
          onResponseTrace: (trace) => {
            collectedResponses.push(trace);
            void persistAssistantTrace({
              ...baseTrace,
              activity: [...collectedActivity],
              network: [...collectedNetwork],
              responses: [...collectedResponses],
              sandboxExecutions: [...collectedSandboxExecutions],
              draftValidations: [...collectedDraftValidations]
            });
          },
          onSandboxExecution: (trace) => {
            collectedSandboxExecutions.push(trace);
            void persistAssistantTrace({
              ...baseTrace,
              activity: [...collectedActivity],
              network: [...collectedNetwork],
              responses: [...collectedResponses],
              sandboxExecutions: [...collectedSandboxExecutions],
              draftValidations: [...collectedDraftValidations]
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
              sandboxExecutions: [...collectedSandboxExecutions],
              draftValidations: [...collectedDraftValidations]
            });
          }
        });
      };

      const reviseMessage = options?.reviseFromMessageId
        ? activeAssistantChat?.messages.find((entry) => entry.id === options.reviseFromMessageId)
        : null;
      const revisedPrompt =
        reviseMessage?.draftRun
          ? [
              prompt,
              'Revise the previous staged draft.',
              'Keep the validated parts when possible, but fix any failed validations and improve the preview clarity.',
              ...reviseMessage.draftRun.steps
                .filter((step) => step.errors.length > 0)
                .map((step) => `${step.title}: ${step.errors.join(' ')}`)
            ].join('\n')
          : prompt;
      const plan = await requestPlan(revisedPrompt);
      const draftRun = await buildDraftFromPlan(
        plan,
        (item) => {
          collectedActivity.push(item);
          updateAssistantMessage(chatId, assistantMessageId, (message) => ({
            ...message,
            activity: [...(message.activity ?? []), item]
          }));
        },
        (entry) => {
          collectedDraftValidations.push(entry);
          void persistAssistantTrace({
            ...baseTrace,
            activity: [...collectedActivity],
            network: [...collectedNetwork],
            responses: [...collectedResponses],
            sandboxExecutions: [...collectedSandboxExecutions],
            draftValidations: [...collectedDraftValidations]
          });
        }
      );
      updateAssistantMessage(chatId, assistantMessageId, (message) => ({
        ...message,
        content:
          draftRun.hasFailures
            ? 'Draft ready. Some steps failed validation, so nothing was applied.'
            : plan.userMessage || plan.summary,
        plan,
        draftRun,
        error: draftRun.hasFailures ? 'One or more draft steps failed validation. Revise or reject the draft.' : undefined,
        status: draftRun.hasFailures ? 'error' : 'ready'
      }));
      void persistAssistantTrace({
        ...baseTrace,
        activity: [...collectedActivity],
        network: [...collectedNetwork],
        responses: [...collectedResponses],
        sandboxExecutions: [...collectedSandboxExecutions],
        draftValidations: [...collectedDraftValidations],
        status: draftRun.hasFailures ? 'error' : 'completed',
        error: draftRun.hasFailures ? 'Draft validation failed.' : undefined,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - Date.parse(timestamp),
        result: {
          summary: plan.summary,
          warningCount: plan.warnings.length + draftRun.steps.reduce((sum, step) => sum + step.errors.length, 0),
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
          draftValidations: [...collectedDraftValidations],
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
          draftValidations: [...collectedDraftValidations],
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

  const applyAcceptedDraft = async (stepsToApply: AssistantDraftStep[]) => {
    let nextCells = [...cellsRef.current];
    let nextTrigMode = trigModeRef.current;
    let nextRenderMode = renderModeRef.current;
    let nextActiveCellId = activeCellIdRef.current;

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

    stepsToApply.forEach((step) => {
      step.operations.forEach((operation) => {
        if (operation.type === 'insert_cell') {
          const bounded = Math.max(0, Math.min(operation.index, nextCells.length));
          const nextCell = createFromOperation(operation);
          nextCells = [...nextCells.slice(0, bounded), nextCell, ...nextCells.slice(bounded)];
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
              stoichOutput: cell.type === 'stoich' ? undefined : cell.stoichOutput,
              assistantMeta: undefined
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
          nextCells.splice(bounded, 0, { ...cell, assistantMeta: undefined });
          nextCells = [...nextCells];
          nextActiveCellId = operation.cellId;
          return;
        }
        if (operation.type === 'set_notebook_defaults') {
          if (operation.trigMode) nextTrigMode = operation.trigMode;
          if (operation.renderMode) nextRenderMode = operation.renderMode;
        }
      });
    });

    setCells(nextCells);
    setTrigMode(nextTrigMode);
    setDefaultMathRenderMode(nextRenderMode);
    setActiveCellId(nextActiveCellId);
    cellsRef.current = nextCells;
    trigModeRef.current = nextTrigMode;
    renderModeRef.current = nextRenderMode;
    activeCellIdRef.current = nextActiveCellId;
  };

  const rejectAssistantDraft = (messageId: string) => {
    if (!assistantActiveChatId) return;
    updateAssistantMessage(assistantActiveChatId, messageId, (message) => ({
      ...message,
      content: 'Draft rejected. Notebook unchanged.',
      plan: null,
      draftRun: null,
      status: 'ready',
      error: undefined
    }));
  };

  const acceptAssistantSteps = async (messageId: string, stepIds?: string[]) => {
    if (!assistantActiveChatId) return;
    const message = activeAssistantChat?.messages.find((entry) => entry.id === messageId);
    if (!message?.plan || !message.draftRun) return;
    const acceptedSteps = message.draftRun.steps.filter(
      (step) =>
        (stepIds ? stepIds.includes(step.id) : true) &&
        step.errors.length === 0
    );
    if (acceptedSteps.length === 0) {
      updateAssistantMessage(assistantActiveChatId, messageId, (entry) => ({
        ...entry,
        status: 'error',
        error: 'Nothing to accept. Revise or reject the failed draft first.'
      }));
      return;
    }
    await applyAcceptedDraft(acceptedSteps);
    updateAssistantMessage(assistantActiveChatId, messageId, (entry) => {
      if (!entry.draftRun) {
        return {
          ...entry,
          status: 'applied'
        };
      }
      const remainingSteps = entry.draftRun.steps.filter((step) => !acceptedSteps.some((accepted) => accepted.id === step.id));
      return {
        ...entry,
        content:
          remainingSteps.length > 0
            ? 'Accepted the selected draft step. The remaining staged draft stays in chat.'
            : 'Accepted the validated draft.',
        status: remainingSteps.length > 0 ? 'ready' : 'applied',
        draftRun:
          remainingSteps.length > 0
            ? {
                ...entry.draftRun,
                hasFailures: remainingSteps.some((step) => step.errors.length > 0),
                steps: remainingSteps
              }
            : null,
        plan:
          remainingSteps.length > 0
            ? {
                ...entry.plan!,
                steps: entry.plan!.steps.filter((step) => !acceptedSteps.some((accepted) => accepted.id === step.id)),
                operations: entry.plan!.steps
                  .filter((step) => !acceptedSteps.some((accepted) => accepted.id === step.id))
                  .flatMap((step) => step.operations),
                outline: {
                  ...entry.plan!.outline,
                  steps: entry.plan!.steps
                    .filter((step) => !acceptedSteps.some((accepted) => accepted.id === step.id))
                    .map((step) => step.summary)
                }
              }
            : null,
        error: undefined
      };
    });
  };

  const reviseAssistantDraft = async (messageId: string) => {
    if (!assistantActiveChatId) return;
    const message = activeAssistantChat?.messages.find((entry) => entry.id === messageId);
    const fallbackPrompt =
      message?.requestPrompt ||
      activeAssistantChat?.messages
        .slice()
        .reverse()
        .find((entry) => entry.role === 'user')?.content ||
      '';
    if (!fallbackPrompt) {
      setAssistantError('Could not find the original request for this draft.');
      return;
    }
    await runAssistant(fallbackPrompt, { chatId: assistantActiveChatId, reviseFromMessageId: messageId });
  };

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
    setNotebookRuntime({ notebookId: nextId, status: 'disconnected' });
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
    const payload = serializeSugarPy({
      id: notebookId,
      name: notebookName,
      trigMode,
      defaultMathRenderMode,
      cells
    });
    try {
      await saveNotebookDocument(payload as unknown as Record<string, unknown>);
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
      setNotebookRuntime({ notebookId: next.id, status: 'disconnected' });
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

  return (
    <ErrorBoundary>
      <div className={`app${touchUiEnabled ? ' touch-ui' : ''}`}>
        <header className="app-header">
          <div className="header-main">
            <div className="header-left">
              <input
                className="file-name-input"
                value={notebookName}
                onChange={(e) => setNotebookName(e.target.value)}
                placeholder="Notebook name"
              />
            </div>
            <div className={`conn-pill status-${status}`}>
              <span className={`conn-dot ${status}`} />
              {status === 'connected'
                ? 'Connected'
                : status === 'connecting'
                  ? statusDetail || 'Initializing environment...'
                  : status}
            </div>
          </div>
          <div className="header-right">
            <div className="header-menu-wrap" ref={addCellMenuRef}>
              <button
                className="menu-button"
                data-testid="add-cell-button"
                onClick={() => {
                  setAddCellMenuOpen((prev) => !prev);
                  setAddCellSpecialMenuOpen(false);
                  setDividerSpecialMenuIndex(null);
                }}
                aria-label="Add cell below selected"
              >
                ＋
              </button>
              {addCellMenuOpen ? (
                <div className="header-menu add-cell-menu">
                  <div className="menu-section-label">Add below selected</div>
                  <button className="menu-item" onClick={() => insertCellBelowActive('code')}>Code cell</button>
                  <button className="menu-item" onClick={() => insertCellBelowActive('markdown')}>Text cell</button>
                  <button className="menu-item" onClick={() => insertCellBelowActive('math')}>Math cell</button>
                  <button
                    className="menu-item"
                    onClick={() => setAddCellSpecialMenuOpen((prev) => !prev)}
                    aria-expanded={addCellSpecialMenuOpen}
                  >
                    Special…
                  </button>
                  {addCellSpecialMenuOpen ? (
                    <div className="menu-submenu" data-testid="header-special-submenu">
                      {specialCellRegistry.map((entry) => (
                        <button
                          key={`header-special-${entry.id}`}
                          className="menu-item submenu-item"
                          onClick={() => insertSpecialCellBelowActive(entry)}
                        >
                          {entry.insertLabel}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              className="button secondary"
              data-testid="special-cell-palette-button"
              onClick={() => {
                setSpecialPaletteOpen(true);
                setSpecialPaletteQuery('');
                setHeaderMenuOpen(false);
                setAddCellMenuOpen(false);
                setAddCellSpecialMenuOpen(false);
                setDividerSpecialMenuIndex(null);
              }}
            >
              Special
            </button>
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
                  <button className="menu-item" onClick={connectBackend}>
                    {activeKernel ? 'Backend Ready' : 'Reconnect Backend'}
                  </button>
                  <div className="menu-section-label">Runtime</div>
                  <div className="save-status menu-save-status clean">
                    {notebookRuntime.status === 'connected'
                      ? 'Connected'
                      : notebookRuntime.status === 'starting'
                        ? 'Starting…'
                        : notebookRuntime.status === 'restarting'
                          ? 'Restarting…'
                          : notebookRuntime.status === 'deleting'
                            ? 'Deleting…'
                            : notebookRuntime.status === 'error'
                              ? `Error${notebookRuntime.error ? ` · ${notebookRuntime.error}` : ''}`
                              : 'Disconnected'}
                  </div>
                  <button className="menu-item" onClick={handleConnectNotebookRuntime}>
                    {notebookRuntime.status === 'connected' ? 'Reconnect Runtime' : 'Connect Runtime'}
                  </button>
                  <button className="menu-item" onClick={handleRestartNotebookRuntime}>
                    Restart Runtime
                  </button>
                  <button className="menu-item" onClick={handleDeleteNotebookRuntime}>
                    Disconnect and Delete Runtime
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
                  <button className="menu-item" onClick={clearNotebookOutputs}>Clear Outputs</button>
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
            </div>
          ) : null}

          <div className="notebook-stack" ref={notebookStackRef}>
            {cells.length === 0 ? (
              <div className="cell-empty">
                <div className="cell-empty-title">Start with a cell.</div>
                <button className="button" onClick={() => insertCellAt(0, 'code')}>Add code cell</button>
              </div>
            ) : null}
            {cells.length > 0 ? (
              <>
                {Array.from({ length: cells.length + 1 }).map((_, index) => (
                  <React.Fragment key={`cell-slot-${index}`}>
                    {!touchUiEnabled && cells.length > 0 ? (
                      <div
                        className="cell-divider"
                        data-testid={`cell-divider-${index}`}
                        onMouseLeave={() => setDividerSpecialMenuIndex((prev) => (prev === index ? null : prev))}
                      >
                        <div className="cell-divider-line" />
                        <div className="divider-menu" role="menu" aria-label="Insert cell type">
                          <button className="divider-btn" onClick={() => insertCellAt(index, 'code')}>Code</button>
                          <button className="divider-btn" onClick={() => insertCellAt(index, 'markdown')}>Text</button>
                          <button className="divider-btn" onClick={() => insertCellAt(index, 'math')}>Math</button>
                          <button
                            className="divider-btn divider-btn-icon"
                            onClick={() => setDividerSpecialMenuIndex((prev) => (prev === index ? null : index))}
                            aria-expanded={dividerSpecialMenuIndex === index}
                            aria-label="Special cells"
                            title="Special cells"
                          >
                            ⋮
                          </button>
                          {dividerSpecialMenuIndex === index ? (
                            <div className="divider-submenu" data-testid={`divider-special-submenu-${index}`}>
                              {specialCellRegistry.map((entry) => (
                                <button
                                  key={`divider-special-${index}-${entry.id}`}
                                  className="divider-btn divider-submenu-btn"
                                  onClick={() => insertSpecialCellAt(index, entry)}
                                >
                                  {entry.insertLabel}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {index < cells.length ? (
                      <NotebookCell
                        key={cells[index].id}
                        cell={cells[index]}
                        isActive={cells[index].id === activeCellId}
                        onActivate={() => setActiveCellId(cells[index].id)}
                        onAddAbove={() => insertSiblingCell(cells[index].id, 'above')}
                        onAddBelow={() => insertSiblingCell(cells[index].id, 'below')}
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
                        onRunCustom={(customCell, options) => runCustomCell(cells[index].id, customCell, options)}
                        onChangeCustom={(customCell) => updateCustomCell(cells[index].id, customCell)}
                        onMoveUp={() => setCells((prev) => moveCellUp(prev, cells[index].id))}
                        onMoveDown={() => setCells((prev) => moveCellDown(prev, cells[index].id))}
                        onDelete={() => setCells((prev) => deleteCell(prev, cells[index].id))}
                        onToggleOutput={() => toggleCellOutputCollapsed(cells[index].id)}
                        onClearOutput={() => clearCellOutput(cells[index].id)}
                        onToggleMathView={() => toggleMathView(cells[index].id)}
                        onShowMathRendered={() => showMathRenderedView(cells[index].id)}
                        suggestions={codeSuggestions}
                        slashCommands={slashCommands}
                        onSlashCommand={(command) => handleSlashCommand(cells[index].id, command)}
                        mathSuggestions={mathSuggestions}
                        trigMode={trigMode}
                        kernelReady={!!activeKernel}
                        onSetMathRenderMode={(mode) => {
                          setCells((prev) =>
                            prev.map((entry) =>
                              entry.id === cells[index].id ? { ...entry, mathRenderMode: mode } : entry
                            )
                          );
                        }}
                        onSetMathTrigMode={(mode) => {
                          setCells((prev) =>
                            prev.map((entry) =>
                              entry.id === cells[index].id ? { ...entry, mathTrigMode: mode } : entry
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
        {specialPaletteOpen ? (
          <div className="special-palette-backdrop">
            <div
              ref={specialPaletteRef}
              className="special-palette"
              role="dialog"
              aria-modal="true"
              aria-label="Insert special cell"
              data-testid="special-cell-palette"
            >
              <div className="special-palette-header">
                <div>
                  <div className="special-palette-title">Insert Special Cell</div>
                  <div className="special-palette-subtitle">Rare structured widgets like Stoich and Regression</div>
                </div>
                <button
                  className="menu-button"
                  onClick={() => setSpecialPaletteOpen(false)}
                  aria-label="Close special cell palette"
                >
                  ×
                </button>
              </div>
              <input
                ref={specialPaletteInputRef}
                className="special-palette-input"
                placeholder="Search special cells"
                value={specialPaletteQuery}
                onChange={(event) => setSpecialPaletteQuery(event.target.value)}
              />
              <div className="special-palette-results">
                {filteredSpecialCells.map((entry) => (
                  <button
                    key={`special-palette-${entry.id}`}
                    className="special-palette-item"
                    onClick={() => insertSpecialCellBelowActive(entry)}
                  >
                    <span className="special-palette-item-title">{entry.title}</span>
                    <span className="special-palette-item-description">{entry.description}</span>
                  </button>
                ))}
                {filteredSpecialCells.length === 0 ? (
                  <div className="special-palette-empty">No special cells match that search.</div>
                ) : null}
              </div>
              <div className="special-palette-hint">Shortcut: Cmd/Ctrl+K</div>
            </div>
          </div>
        ) : null}
        <div ref={assistantDrawerRef}>
          <AssistantDrawer
            open={assistantOpen}
            apiKey={assistantApiKey}
            hasDefaultApiKey={false}
            model={assistantModel}
            thinkingLevel={assistantThinkingLevel}
            draft={assistantDraft}
            loading={assistantLoading}
            error={assistantError}
            chats={assistantChats}
            activeChatId={assistantActiveChatId}
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
            onAcceptAll={(messageId) => {
              void acceptAssistantSteps(messageId);
            }}
            onAcceptStep={(messageId, stepId) => {
              void acceptAssistantSteps(messageId, [stepId]);
            }}
            onReject={rejectAssistantDraft}
            onRevise={(messageId) => {
              void reviseAssistantDraft(messageId);
            }}
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
