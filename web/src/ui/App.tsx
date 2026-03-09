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
  AssistantOperation,
  AssistantPlan,
  AssistantPreference,
  AssistantScope,
  planNotebookChanges
} from './utils/geminiAssistant';
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
const ASSISTANT_API_KEY_STORAGE = 'sugarpy:assistant:gemini:key';
const ASSISTANT_MODEL_STORAGE = 'sugarpy:assistant:gemini:model';
const ASSISTANT_SCOPE_STORAGE = 'sugarpy:assistant:scope';
const ASSISTANT_PREFERENCE_STORAGE = 'sugarpy:assistant:preference';

type AssistantSnapshot = {
  cells: CellModel[];
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  activeCellId: string | null;
};

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
  const [assistantApiKey, setAssistantApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  const [assistantModel, setAssistantModel] = useState(
    import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.1-flash-lite-preview'
  );
  const [assistantScope, setAssistantScope] = useState<AssistantScope>('notebook');
  const [assistantPreference, setAssistantPreference] = useState<AssistantPreference>('auto');
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantStatus, setAssistantStatus] = useState('');
  const [assistantActivity, setAssistantActivity] = useState<AssistantActivity[]>([]);
  const [assistantPlan, setAssistantPlan] = useState<AssistantPlan | null>(null);
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

  const ensureServerDir = async (path: string) => {
    const contents = ensureContents();
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try {
        await contents.save(current, { type: 'directory' as any });
      } catch (_err) {
        // Directory may already exist or server may return noisy 4xx for nested checks.
        // Fall through: later writes will surface real failures if path is unusable.
      }
    }
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
      reply = await future.done;
    } catch (error) {
      if (isDeadKernelError(error)) {
        setStatus('error');
        setErrorMsg('Kernel is dead. Reconnect to continue.');
      }
      if (!isCanceledFutureError(error) && !isDeadKernelError(error)) {
        throw error;
      }
      if (showOutput) {
        setCells((prev) =>
          prev.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  output: { type: 'error', ename: 'ExecutionCanceled', evalue: 'Kernel execution was canceled.' },
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
      await future.done;
    } catch (error) {
      if (isDeadKernelError(error)) {
        setStatus('error');
        setErrorMsg('Kernel is dead. Reconnect to continue.');
      }
      if (!isCanceledFutureError(error) && !isDeadKernelError(error)) {
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
                  error: 'Kernel execution was canceled.',
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
      await future.done;
    } catch (error) {
      if (isDeadKernelError(error)) {
        setStatus('error');
        setErrorMsg('Kernel is dead. Reconnect to continue.');
      }
      if (!isCanceledFutureError(error) && !isDeadKernelError(error)) {
        throw error;
      }
      parsed = { ok: false, error: 'Kernel execution was canceled.', species: [] };
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
    const storedModel = readOptionalStorageItem(ASSISTANT_MODEL_STORAGE);
    const storedScope = readOptionalStorageItem(ASSISTANT_SCOPE_STORAGE);
    const storedPreference = readOptionalStorageItem(ASSISTANT_PREFERENCE_STORAGE);
    if (storedKey) setAssistantApiKey(storedKey);
    if (storedModel) setAssistantModel(storedModel);
    if (storedScope === 'active' || storedScope === 'notebook') {
      setAssistantScope(storedScope);
    }
    if (storedPreference === 'auto' || storedPreference === 'cas' || storedPreference === 'python' || storedPreference === 'explain') {
      setAssistantPreference(storedPreference);
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
    writeStorageItem(ASSISTANT_SCOPE_STORAGE, assistantScope);
  }, [assistantScope]);

  useEffect(() => {
    writeStorageItem(ASSISTANT_PREFERENCE_STORAGE, assistantPreference);
  }, [assistantPreference]);

  const runAssistant = async () => {
    if (!assistantApiKey.trim()) {
      setAssistantError('Gemini API key is required.');
      return;
    }
    if (!assistantPrompt.trim()) {
      setAssistantError('Write a request for the assistant first.');
      return;
    }
    setAssistantLoading(true);
    setAssistantError('');
    setAssistantStatus('Inspecting notebook…');
    setAssistantActivity([]);
    try {
      const plan = await planNotebookChanges({
        apiKey: assistantApiKey.trim(),
        model: assistantModel.trim(),
        request: assistantPrompt.trim(),
        scope: assistantScope,
        preference: assistantPreference,
        context: buildAssistantContext(),
        onActivity: (item) => {
          setAssistantActivity((prev) => [...prev, item]);
        }
      });
      setAssistantPlan(plan);
      setAssistantStatus(
        plan.operations.length > 0 ? `Prepared ${plan.operations.length} notebook change(s).` : 'No notebook changes proposed.'
      );
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : 'Assistant request failed.');
      setAssistantStatus('');
    } finally {
      setAssistantLoading(false);
    }
  };

  const applyAssistantPlan = async (runAfterApply = false) => {
    if (!assistantPlan) return;
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

    assistantPlan.operations.forEach((operation) => {
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
    setAssistantStatus(runAfterApply ? 'Applied changes. Running updated cells…' : 'Applied assistant changes.');

    if (runAfterApply) {
      const runTargets = nextCells.filter(
        (cell) =>
          newCellIds.includes(cell.id) ||
          assistantPlan.operations.some(
            (operation) => operation.type === 'update_cell' && operation.cellId === cell.id
          )
      );
      for (const cell of runTargets) {
        if (cell.type === 'markdown') continue;
        await runCellById(cell);
      }
      setAssistantStatus('Applied assistant changes and ran updated cells.');
    }
  };

  const undoAssistantPlan = () => {
    const snapshot = assistantUndoStack[assistantUndoStack.length - 1];
    if (!snapshot) return;
    restoreAssistantSnapshot(snapshot);
    setAssistantUndoStack((prev) => prev.slice(0, -1));
    setAssistantStatus('Reverted last assistant change.');
  };

  useEffect(() => {
    const bootstrap = async () => {
      if (!activeKernel || bootstrapLoaded) return;
      try {
        await runCell(`bootstrap-math-${Date.now()}`, 'import math', false, false);
      } catch (_error) {
        return;
      }
      const defs = allFunctions
        .map((fn) => {
          const lines = fn.snippet.split('\n');
          const start = lines.findIndex((line) => line.startsWith('def '));
          if (start === -1) return '';
          const block: string[] = [];
          for (let i = start; i < lines.length; i += 1) {
            const line = lines[i];
            if (i > start && line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) break;
            block.push(line);
          }
          return block.join('\n').trim();
        })
        .filter((block) => block.startsWith('def '))
        .join('\n\n');
      if (!defs) return;
      try {
        await runCell(`bootstrap-${Date.now()}`, defs, false, false);
      } catch (_error) {
        return;
      }
      setBootstrapLoaded(true);
    };
    bootstrap().catch(() => undefined);
  }, [activeKernel, bootstrapLoaded, allFunctions]);

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
              onClick={() => setAssistantOpen((prev) => !prev)}
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
            model={assistantModel}
            scope={assistantScope}
            preference={assistantPreference}
            prompt={assistantPrompt}
            loading={assistantLoading}
            error={assistantError}
            status={assistantStatus}
            activity={assistantActivity}
            plan={assistantPlan}
            canUndo={assistantUndoStack.length > 0}
            onClose={() => setAssistantOpen(false)}
            onChangeApiKey={setAssistantApiKey}
            onChangeModel={setAssistantModel}
            onChangeScope={setAssistantScope}
            onChangePreference={setAssistantPreference}
            onChangePrompt={setAssistantPrompt}
            onGenerate={() => {
              void runAssistant();
            }}
            onApply={() => {
              void applyAssistantPlan(false);
            }}
            onApplyAndRun={() => {
              void applyAssistantPlan(true);
            }}
            onUndo={undoAssistantPlan}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
