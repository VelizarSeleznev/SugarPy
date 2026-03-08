import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ContentsManager, KernelManager, ServerConnection } from '@jupyterlab/services';

import { FunctionEntry, useFunctionLibrary } from './hooks/useFunctionLibrary';
import { NotebookCell } from './components/NotebookCell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildSuggestions } from './utils/suggestUtils';
import { extractFunctionNames } from './utils/functionParse';
import { moveCellDown, moveCellUp, deleteCell } from './utils/cellOps';
import { StoichOutput, StoichState } from './utils/stoichTypes';
import {
  createNotebookId,
  deserializeIpynb,
  deserializeSugarPy,
  downloadBlob,
  loadFromLocalStorage,
  loadLastOpenId,
  readFileAsText,
  saveToLocalStorage,
  serializeIpynb,
  serializeSugarPy
} from './utils/notebookIO';
import {
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  CodeLanguage,
  DEFAULT_CODE_LANGUAGE,
  isExecutableCodeLanguage,
  normalizeCodeLanguage
} from './utils/codeLanguage';

export type CellModel = {
  id: string;
  source: string;
  output?: CellOutput;
  type?: 'code' | 'markdown' | 'math' | 'stoich';
  runtimeLanguage?: CodeLanguage;
  execCount?: number;
  isRunning?: boolean;
  mathOutput?: {
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
    }>;
  };
  mathRenderMode?: 'exact' | 'decimal';
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

const defaultCell: CellModel = {
  id: 'cell-1',
  source: '# Try: find_hypotenuse(3, 4)\n',
  type: 'code',
  runtimeLanguage: DEFAULT_CODE_LANGUAGE
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

const getCodeLanguage = (cell: Pick<CellModel, 'type' | 'runtimeLanguage'> | null | undefined): CodeLanguage => {
  if (!cell || cell.type !== 'code') return DEFAULT_CODE_LANGUAGE;
  return normalizeCodeLanguage(cell.runtimeLanguage);
};

const buildPhpBridgeCode = (source: string) => {
  const payload = JSON.stringify({ source });
  return [
    'import json',
    'import os',
    'import shutil',
    'import subprocess',
    'import tempfile',
    `_payload = json.loads(${JSON.stringify(payload)})`,
    "_php_source = _payload.get('source', '')",
    '_proc = None',
    "if shutil.which('php') is None:",
    "    raise RuntimeError('PHP runtime is not installed on server. Install php CLI to run PHP cells.')",
    "with tempfile.NamedTemporaryFile('w', suffix='.php', delete=False, encoding='utf-8') as _tmp:",
    '    _tmp.write(_php_source)',
    '    _path = _tmp.name',
    'try:',
    "    _proc = subprocess.run(['php', _path], capture_output=True, text=True)",
    'finally:',
    '    try:',
    '        os.unlink(_path)',
    '    except OSError:',
    '        pass',
    'if _proc is None:',
    "    raise RuntimeError('PHP process did not start.')",
    'if _proc.stdout:',
    "    print(_proc.stdout, end='')",
    'if _proc.stderr:',
    "    print(_proc.stderr, end='')",
    'if _proc.returncode != 0:',
    "    raise RuntimeError(f'PHP exited with code {_proc.returncode}')"
  ].join('\n');
};

const buildExecutionCode = (language: CodeLanguage, source: string) => {
  if (language === 'php') return buildPhpBridgeCode(source);
  return source;
};

const SUGARPY_MIME_MATH = 'application/vnd.sugarpy.math+json';
const SUGARPY_MIME_STOICH = 'application/vnd.sugarpy.stoich+json';
const SERVER_AUTOSAVE_DIR = 'notebooks/sugarpy-autosave';

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

function App() {
  const defaultServerUrl = resolveDefaultServerUrl();
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [token, setToken] = useState(import.meta.env.VITE_JUPYTER_TOKEN || 'sugarpy');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [kernel, setKernel] = useState<any>(null);
  const [cells, setCells] = useState<CellModel[]>([defaultCell]);
  const { allFunctions } = useFunctionLibrary();
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false);
  const [userFunctions, setUserFunctions] = useState<string[]>([]);
  const [execCounter, setExecCounter] = useState(0);
  const [trigMode, setTrigMode] = useState<'deg' | 'rad'>('deg');
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
  const hydrated = useRef(false);
  const lastSnapshot = useRef<string>('');
  const contentsRef = useRef<ContentsManager | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  const buildSnapshot = (nextCells: CellModel[], nextTrigMode: 'deg' | 'rad', nextName: string, nextId: string) =>
    JSON.stringify({
      id: nextId,
      name: nextName,
      trigMode: nextTrigMode,
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
      const nextCells = decoded.cells.length > 0 ? decoded.cells : [defaultCell];
      setNotebookId(decoded.id);
      setNotebookName(decoded.name);
      setTrigMode(decoded.trigMode);
      setCells(nextCells);
      setActiveCellId(nextCells[0]?.id ?? null);
      setLastSavedAt(selected.updatedAt ?? null);
      lastSnapshot.current = buildSnapshot(nextCells, decoded.trigMode, decoded.name, decoded.id);
      hydrated.current = true;
    };

    hydrate().catch(() => {
      hydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl, token]);

  const runCell = async (
    cellId: string,
    code: string,
    showOutput = true,
    countExecution = true,
    language?: CodeLanguage
  ) => {
    if (!activeKernel) return;
    const resolvedLanguage = language ?? getCodeLanguage(cells.find((cell) => cell.id === cellId));
    if (!isExecutableCodeLanguage(resolvedLanguage)) {
      if (showOutput) {
        setCells((prev) =>
          prev.map((c) =>
            c.id === cellId
              ? {
                  ...c,
                  isRunning: false,
                  output: {
                    type: 'error',
                    ename: 'UnsupportedLanguage',
                    evalue: `${resolvedLanguage.toUpperCase()} execution is not available yet. Switch to Python to run this cell.`
                  }
                }
              : c
          )
        );
      }
      return;
    }
    if (showOutput) {
      setCells((prev) => {
        const exists = prev.some((c) => c.id === cellId);
        if (exists) return prev;
        return [...prev, { id: cellId, source: code, type: 'code', runtimeLanguage: resolvedLanguage }];
      });
    }
    let future: any;
    const codeToExecute = buildExecutionCode(resolvedLanguage, code);
    try {
      future = activeKernel.requestExecute({ code: codeToExecute, stop_on_error: true });
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

  const runMathCell = async (cellId: string, source: string, renderModeOverride?: 'exact' | 'decimal') => {
    if (!activeKernel) return;
    const renderMode =
      renderModeOverride ??
      (cells.find((cell) => cell.id === cellId)?.mathRenderMode === 'decimal' ? 'decimal' : 'exact');
    const payload = JSON.stringify({ source, mode: trigMode });
    const code = [
      'import json',
      'from sugarpy.math_cell import display_math_cell',
      `_payload = json.loads(${JSON.stringify(payload)})`,
      `_ = display_math_cell(_payload['source'], _payload['mode'], ${JSON.stringify(renderMode)})`
    ].join('\n');

    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId ? { ...c, isRunning: true, mathOutput: undefined, output: undefined } : c
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
                  mode: trigMode,
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
        parsed = { kind: 'expression', steps: [], error: err, mode: trigMode, warnings: [] };
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
                  mode: trigMode,
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
          await runMathCell(cell.id, cell.source, cell.mathRenderMode ?? 'exact');
          continue;
        }
        if (cell.type === 'stoich') {
          await runStoichCell(cell.id, cell.stoichState ?? { reaction: '', inputs: {} });
          continue;
        }
        await runCell(cell.id, cell.source, true, true, getCodeLanguage(cell));
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
      ...(type === 'code' ? { runtimeLanguage: DEFAULT_CODE_LANGUAGE } : {}),
      ...(type === 'math' ? { mathRenderMode: 'exact' as const } : {})
    };
  };

  const createInitialCell = () => createCell('code');

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
          runtimeLanguage: DEFAULT_CODE_LANGUAGE,
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
    const snapshot = buildSnapshot(cells, trigMode, notebookName, notebookId);
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
        cells
      });
      saveToLocalStorage(payload);
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
        cells,
        silent: true
      }).then((saved) => {
        if (!saved) return;
        setLastSavedAt(saved.updatedAt);
      });
    }, 1500);
  }, [cells, trigMode, notebookName, notebookId]);

  useEffect(() => {
    const flush = () => {
      if (!hydrated.current) return;
      const payload = serializeSugarPy({
        id: notebookId,
        name: notebookName,
        trigMode,
        cells
      });
      saveToLocalStorage(payload);
      setLastSavedAt(payload.updatedAt);
      saveServerAutosave({
        id: notebookId,
        name: notebookName,
        trigMode,
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
  }, [cells, trigMode, notebookName, notebookId]);

  const confirmDiscard = () => {
    if (!dirty) return true;
    return window.confirm('There are unsaved changes. Continue without saving?');
  };

  const handleNewNotebook = () => {
    if (!confirmDiscard()) return;
    const nextId = createNotebookId();
    const nextCells = [createInitialCell()];
    setNotebookId(nextId);
    setNotebookName('Untitled');
    setTrigMode('deg');
    setCells(nextCells);
    setActiveCellId(nextCells[0]?.id ?? null);
    setLastSavedAt(null);
    lastSnapshot.current = buildSnapshot(nextCells, 'deg', 'Untitled', nextId);
    setDirty(false);
  };

  const handleDownloadSugarPy = () => {
    const payload = serializeSugarPy({
      id: notebookId,
      name: notebookName,
      trigMode,
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
        cells,
        silent: true
      });
      const snapshot = buildSnapshot(cells, trigMode, notebookName, notebookId);
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
      let next: { id: string; name: string; trigMode: 'deg' | 'rad'; cells: CellModel[] } | null = null;
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
      setCells(safeCells);
      setActiveCellId(safeCells[0]?.id ?? null);
      const payload = serializeSugarPy({
        id: next.id,
        name: next.name || 'Untitled',
        trigMode: next.trigMode,
        cells: safeCells
      });
      saveToLocalStorage(payload);
      setLastSavedAt(payload.updatedAt);
      lastSnapshot.current = buildSnapshot(safeCells, next.trigMode, next.name || 'Untitled', next.id);
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
      await runMathCell(cell.id, cell.source, cell.mathRenderMode ?? 'exact');
      return;
    }
    if (cell.type === 'stoich') {
      await runStoichCell(cell.id, cell.stoichState ?? { reaction: '', inputs: {} });
      return;
    }
    await runCell(cell.id, cell.source, true, true, getCodeLanguage(cell));
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
              className="button secondary"
              onClick={() => setTrigMode((prev) => (prev === 'deg' ? 'rad' : 'deg'))}
            >
              Trig: {trigMode === 'deg' ? 'Deg' : 'Rad'}
            </button>
            <div className={`conn-pill status-${status}`}>
              <span className={`conn-dot ${status}`} />
              {status === 'connected'
                ? 'Connected'
                : status === 'connecting'
                  ? statusDetail || 'Initializing environment...'
                  : status}
            </div>
            <div className={`save-status ${dirty ? 'dirty' : 'clean'}`}>
              {lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved'}
              {dirty ? ' · editing…' : ''}
              {syncMessage ? ` · ${syncMessage}` : ''}
            </div>
            <div className="header-menu-wrap">
              <button
                className="menu-button"
                onClick={() => setHeaderMenuOpen((prev) => !prev)}
                aria-label="More actions"
              >
                ⋮
              </button>
              {headerMenuOpen ? (
                <div className="header-menu">
                  <button className="menu-item" onClick={connectKernel}>
                    {activeKernel ? 'Kernel Connected' : 'Connect to Kernel'}
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
                  <button className="menu-item" onClick={handleSaveToServer}>Save to Server</button>
                  <button className="menu-item" onClick={handleExportPdf}>Export PDF</button>
                  <button className="menu-item" onClick={handleDownloadIpynb}>Download .ipynb</button>
                  <button className="menu-item" onClick={handleDownloadSugarPy}>Download .sugarpy</button>
                  <button className="menu-item" onClick={handleImportClick}>Import</button>
                  <button className="menu-item" onClick={handleNewNotebook}>New Notebook</button>
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
                <div className="subtitle">Your notebook is empty.</div>
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
                        onRun={(value) =>
                          runCell(cells[index].id, value, true, true, getCodeLanguage(cells[index]))
                        }
                        onRunMath={(value) =>
                          runMathCell(cells[index].id, value, cells[index].mathRenderMode ?? 'exact')
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
                          setCells((prev) =>
                            prev.map((cell) =>
                              cell.id === cells[index].id ? { ...cell, mathRenderMode: mode } : cell
                            )
                          )
                        }
                        onSetCodeLanguage={(language) =>
                          setCells((prev) =>
                            prev.map((cell) =>
                              cell.id === cells[index].id
                                ? {
                                    ...cell,
                                    runtimeLanguage: language,
                                    output: undefined,
                                    execCount: undefined,
                                    isRunning: false
                                  }
                                : cell
                            )
                          )
                        }
                        onToggleTrigMode={() => setTrigMode((prev) => (prev === 'deg' ? 'rad' : 'deg'))}
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
            {mobileActionCell.type === 'code' ? (
              <label className="mobile-cell-language-wrap">
                <span className="mobile-cell-language-label">Lang</span>
                <select
                  className="mobile-cell-language-select"
                  data-testid="mobile-code-language-select"
                  value={getCodeLanguage(mobileActionCell)}
                  onChange={(event) => {
                    const nextLanguage = normalizeCodeLanguage(event.target.value);
                    setCells((prev) =>
                      prev.map((cell) =>
                        cell.id === mobileActionCell.id
                          ? {
                              ...cell,
                              runtimeLanguage: nextLanguage,
                              output: undefined,
                              execCount: undefined,
                              isRunning: false
                            }
                          : cell
                      )
                    );
                  }}
                >
                  {CODE_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {CODE_LANGUAGE_LABELS[language]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {mobileActionCell.type === 'math' ? (
              <button
                type="button"
                className="mobile-cell-action-btn"
                onClick={() =>
                  setCells((prev) =>
                    prev.map((cell) =>
                      cell.id === mobileActionCell.id
                        ? {
                            ...cell,
                            mathRenderMode: cell.mathRenderMode === 'decimal' ? 'exact' : 'decimal'
                          }
                        : cell
                    )
                  )
                }
              >
                {mobileActionCell.mathRenderMode === 'decimal' ? 'Decimal' : 'Exact'}
              </button>
            ) : null}
            {mobileActionCell.type === 'math' ? (
              <button
                type="button"
                className="mobile-cell-action-btn"
                onClick={() => setTrigMode((prev) => (prev === 'deg' ? 'rad' : 'deg'))}
              >
                {trigMode === 'deg' ? 'Deg' : 'Rad'}
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
      </div>
    </ErrorBoundary>
  );
}

export default App;
