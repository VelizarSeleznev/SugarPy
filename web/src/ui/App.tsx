import React, { useEffect, useMemo, useRef, useState } from 'react';

import { FunctionEntry, useFunctionLibrary } from './hooks/useFunctionLibrary';
import { NotebookCell } from './components/NotebookCell';
import { AssistantDrawer, AssistantDrawerSection } from './components/AssistantDrawer';
import { OnboardingCoachmark } from './components/OnboardingCoachmark';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyAssistantOperations } from './assistant/patches';
import type { AssistantOperation } from './assistant/types';
import { buildSuggestions } from './utils/suggestUtils';
import { moveCellDown, moveCellUp, moveCellToIndex, deleteCell } from './utils/cellOps';
import { createCellRecord } from './cells/registry';
import type { CellOutput, CellRecord } from './cells/types';
import { useUserPreferences } from './preferences/useUserPreferences';
import { StoichOutput, StoichState } from './utils/stoichTypes';
import { RegressionOutput, RegressionState, createRegressionState } from './utils/regressionTypes';
import {
  AssistantActivity,
  AssistantCellKind,
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
  deleteNotebookRuntime,
  executeNotebookCell,
  fetchRuntimeConfig,
  interruptNotebookRuntime,
  restartNotebookRuntime,
  loadServerAutosave as loadServerAutosaveRequest,
  persistAssistantTraceToServer,
  saveNotebookDocument,
  saveServerAutosave as saveServerAutosaveRequest,
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
import {
  AssistantImportItem,
  buildFileDedupKey,
  prepareAssistantImportFile
} from './utils/assistantImport';
import { buildAssistantImportSummary } from './utils/assistantImportSummary';
import {
  FIRST_RUN_NOTEBOOK_NAME,
  getFirstRunNotebookCells,
  hasSeenOnboarding,
  loadCoachmarksDismissed,
  loadTutorialNotebookId,
  markOnboardingSeen,
  saveCoachmarksDismissed,
  saveTutorialNotebookId
} from './utils/onboarding';
import {
  extractCodeSymbols,
  extractMathSymbols,
  mergeEditorCompletions,
  type EditorCompletionItem
} from './utils/editorSymbols';

export type CellModel = CellRecord;
export type { CellOutput };

type InsertCellType = 'code' | 'markdown' | 'math' | 'stoich' | 'regression';

type InsertCellOption = {
  type: InsertCellType;
  label: string;
  searchTerms: string;
  priority: 'primary' | 'secondary';
};

const INSERT_CELL_OPTIONS: InsertCellOption[] = [
  { type: 'code', label: 'Code', searchTerms: 'code python script', priority: 'primary' },
  { type: 'markdown', label: 'Text', searchTerms: 'text markdown note', priority: 'primary' },
  { type: 'math', label: 'Math', searchTerms: 'math formula cas', priority: 'primary' },
  { type: 'stoich', label: 'Stoich', searchTerms: 'stoich chemistry reaction table', priority: 'secondary' },
  {
    type: 'regression',
    label: 'Regression',
    searchTerms: 'regression fit trendline xy data table scatter',
    priority: 'secondary'
  }
];

const matchesInsertCellQuery = (option: InsertCellOption, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return (
    option.label.toLowerCase().includes(normalizedQuery) ||
    option.searchTerms.includes(normalizedQuery)
  );
};

const PRIMARY_INSERT_CELL_OPTIONS = INSERT_CELL_OPTIONS.filter((option) => option.priority === 'primary');
const SECONDARY_INSERT_CELL_OPTIONS = INSERT_CELL_OPTIONS.filter((option) => option.priority === 'secondary');

const CELL_DRAG_LONG_PRESS_MS = 400;
const CELL_DRAG_MOVE_THRESHOLD = 14;

type CellDragStartDetail = {
  cellId: string;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  origin: 'handle' | 'touch';
};

type DragState = CellDragStartDetail & {
  insertionIndex: number;
  sourceIndex: number;
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
  lastActiveCellId: string | null;
};

type AssistantRuntimeConfig = {
  model?: string;
  providers?: {
    openai?: boolean;
    gemini?: boolean;
    groq?: boolean;
  };
};

type AssistantPhotoImport = {
  items: AssistantImportItem[];
  instructions: string;
};

type CoachmarkStep = 'add' | 'menu' | 'drag' | 'math' | 'done';

const MAX_ASSISTANT_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ASSISTANT_IMPORT_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_ASSISTANT_IMPORT_PDF_PAGES = 8;
const MAX_ASSISTANT_IMPORT_ITEMS = 16;
const ASSISTANT_PHOTO_IMPORT_MODEL = 'gpt-5.4-mini';

const getNotebookExecCounter = (cells: CellModel[]) =>
  cells.reduce((max, cell) => {
    if (typeof cell.execCount !== 'number' || Number.isNaN(cell.execCount)) return max;
    return Math.max(max, cell.execCount);
  }, 0);

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
  photoImport?: {
    instructions: string;
    items: Array<{
      index: number;
      fileName: string;
      displayName: string;
      pageNumber: number | null;
      mimeType: string;
    }>;
  };
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

const CELL_EXECUTION_TIMEOUT_MS = 20_000;

const readOptionalStorageItem = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
};

const RunAllIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M3 3.25v9.5L7.9 8 3 3.25Z" fill="currentColor" />
    <path d="M8.1 3.25v9.5L13 8 8.1 3.25Z" fill="currentColor" opacity="0.82" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.8" fill="currentColor" />
  </svg>
);

const PhotoImportIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path
      d="M2.5 4.25A1.75 1.75 0 0 1 4.25 2.5h2.1l.7.95h4.7A1.75 1.75 0 0 1 13.5 5.2v6.55a1.75 1.75 0 0 1-1.75 1.75h-7.5A1.75 1.75 0 0 1 2.5 11.75v-7.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <circle cx="5.35" cy="6.1" r="1.05" fill="currentColor" />
    <path
      d="m4.1 11 2.2-2.35 1.7 1.55 1.65-1.85L11.9 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function App() {
  const { patchPreferences } = useUserPreferences();
  const [assistantEntryMode, setAssistantEntryMode] = useState<'photo-import' | 'chat'>('photo-import');
  const [assistantDrawerSection, setAssistantDrawerSection] = useState<AssistantDrawerSection>('hub');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
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
  const [runtimeNotice, setRuntimeNotice] = useState<string>('');
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [lastActiveCellId, setLastActiveCellId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [addCellMenuOpen, setAddCellMenuOpen] = useState(false);
  const [emptyMoreBlocksOpen, setEmptyMoreBlocksOpen] = useState(false);
  const [cellInsertMenu, setCellInsertMenu] = useState<{
    cellId: string;
    placement: 'above' | 'below';
  } | null>(null);
  const [cellInsertMenuQuery, setCellInsertMenuQuery] = useState('');
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [touchUiEnabled, setTouchUiEnabled] = useState(false);
  const [wideTouchRailEnabled, setWideTouchRailEnabled] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantApiKey, setAssistantApiKey] = useState('');
  const [assistantModel, setAssistantModel] = useState(
    import.meta.env.VITE_ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL
  );
  const [assistantThinkingLevel, setAssistantThinkingLevel] = useState<AssistantThinkingLevel>('dynamic');
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantPhotoImport, setAssistantPhotoImport] = useState<AssistantPhotoImport | null>(null);
  const [assistantPhotoImportPreparing, setAssistantPhotoImportPreparing] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantChats, setAssistantChats] = useState<AssistantChatSession[]>([]);
  const [assistantActiveChatId, setAssistantActiveChatId] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<SugarPyRuntimeConfig | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [tutorialNotebookId, setTutorialNotebookId] = useState<string | null>(() => loadTutorialNotebookId());
  const [coachmarkStep, setCoachmarkStep] = useState<CoachmarkStep>(() =>
    loadCoachmarksDismissed() ? 'done' : 'add'
  );
  const mathBuiltins = useMemo<EditorCompletionItem[]>(
    () => [
      { label: 'sqrt', detail: 'square root', type: 'function', snippet: 'sqrt(${})', boost: 130 },
      { label: 'sin', detail: 'sine', type: 'function', snippet: 'sin(${})', boost: 130 },
      { label: 'cos', detail: 'cosine', type: 'function', snippet: 'cos(${})', boost: 130 },
      { label: 'tan', detail: 'tangent', type: 'function', snippet: 'tan(${})', boost: 130 },
      { label: 'asin', detail: 'inverse sine', type: 'function', snippet: 'asin(${})', boost: 130 },
      { label: 'acos', detail: 'inverse cosine', type: 'function', snippet: 'acos(${})', boost: 130 },
      { label: 'atan', detail: 'inverse tangent', type: 'function', snippet: 'atan(${})', boost: 130 },
      { label: 'log', detail: 'logarithm (base e by default)', type: 'function', snippet: 'log(${})', boost: 130 },
      { label: 'ln', detail: 'natural log', type: 'function', snippet: 'ln(${})', boost: 130 },
      { label: 'exp', detail: 'exponential', type: 'function', snippet: 'exp(${})', boost: 130 },
      { label: 'abs', detail: 'absolute value', type: 'function', snippet: 'abs(${})', boost: 130 },
      { label: 'solve', detail: 'solve equations', type: 'function', snippet: 'solve(__CURSOR__, x)', boost: 150 },
      { label: 'expand', detail: 'expand expression', type: 'function', snippet: 'expand(${})', boost: 130 },
      { label: 'factor', detail: 'factor expression', type: 'function', snippet: 'factor(${})', boost: 130 },
      { label: 'N', detail: 'decimal evaluation', type: 'function', snippet: 'N(${})', boost: 130 },
      { label: 'plot', detail: 'plot expression or equations', type: 'function', snippet: 'plot(${})', boost: 130 },
      {
        label: 'render_decimal',
        detail: 'render expression as decimal (with optional places)',
        type: 'function',
        snippet: 'render_decimal(${})',
        boost: 130
      },
      {
        label: 'render_exact',
        detail: 'render expression in exact symbolic form',
        type: 'function',
        snippet: 'render_exact(${})',
        boost: 130
      },
      {
        label: 'set_decimal_places',
        detail: 'set default decimal places for render_decimal',
        type: 'function',
        snippet: 'set_decimal_places(${})',
        boost: 130
      },
      { label: 'pi', detail: 'pi constant', type: 'constant', boost: 100 },
      { label: 'e', detail: 'Euler constant', type: 'constant', boost: 100 }
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
  const emptyMoreBlocksRef = useRef<HTMLDivElement | null>(null);
  const cellInsertMenuRef = useRef<HTMLDivElement | null>(null);
  const cellInsertMenuShellRef = useRef<HTMLDivElement | null>(null);
  const assistantDrawerRef = useRef<HTMLDivElement | null>(null);
  const assistantToggleRef = useRef<HTMLButtonElement | null>(null);
  const assistantRuntimeConfigAttemptedRef = useRef(false);
  const assistantHistoryNotebookRef = useRef<string | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantTracePendingRef = useRef<Map<string, AssistantRunTrace>>(new Map());
  const assistantTraceFlushRef = useRef<Map<string, Promise<void>>>(new Map());
  const connectingRef = useRef(false);
  const stopRunAllRequestedRef = useRef(false);
  const executionGenerationRef = useRef(0);
  const cellsRef = useRef<CellModel[]>([]);
  const trigModeRef = useRef<'deg' | 'rad'>('deg');
  const renderModeRef = useRef<'exact' | 'decimal'>('exact');
  const activeCellIdRef = useRef<string | null>(null);
  const lastActiveCellIdRef = useRef<string | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragScrollFrameRef = useRef<number | null>(null);
  const dragClickSuppressedCellIdRef = useRef<string | null>(null);
  const dragTouchPendingRef = useRef<{
    pointerId: number;
    timerId: number;
    startX: number;
    startY: number;
    cellId: string;
    target: HTMLElement;
    onMove: (event: PointerEvent) => void;
    onEnd: (event: PointerEvent) => void;
  } | null>(null);
  const slashData = useMemo(() => {
    const map = new Map<string, FunctionEntry>();
    const list: EditorCompletionItem[] = [];
    allFunctions.forEach((fn) => {
      const name = getCommandName(fn);
      if (!name || map.has(name)) return;
      map.set(name, fn);
      list.push({ label: name, detail: fn.signature ?? fn.description, type: 'function', boost: 100 });
    });
    return { map, list };
  }, [allFunctions]);
  const slashCommands = slashData.list;
  const slashCommandMap = slashData.map;
  const builtinCodeSuggestions = useMemo<EditorCompletionItem[]>(
    () =>
      buildSuggestions(allFunctions).map((item) => ({
        ...item,
        type: 'function',
        boost: 120
      })),
    [allFunctions]
  );
  const userFunctionSuggestions = useMemo<EditorCompletionItem[]>(
    () =>
      userFunctions.map((name) => ({
        label: name,
        detail: 'user function',
        type: 'function',
        snippet: `${name}(\${})`,
        boost: 180
      })),
    [userFunctions]
  );

  const getNotebookSymbolSuggestions = (cellId: string): EditorCompletionItem[] => {
    const currentIndex = cells.findIndex((entry) => entry.id === cellId);
    if (currentIndex < 0) return [];
    const priorCells = cells.slice(0, currentIndex);
    const collected = priorCells.flatMap((entry) => {
      if (entry.type === 'math') {
        if (!entry.mathOutput || entry.mathOutput.error) return [];
        return extractMathSymbols(entry.source, 220);
      }
      if (entry.type === 'code') {
        if (entry.execCount === null || entry.execCount === undefined) return [];
        return extractCodeSymbols(entry.source, 220);
      }
      return [];
    });
    return mergeEditorCompletions(collected);
  };

  const getCodeSuggestions = (cellId: string) =>
    mergeEditorCompletions(getNotebookSymbolSuggestions(cellId), builtinCodeSuggestions, userFunctionSuggestions);

  const getMathSuggestions = (cellId: string) =>
    mergeEditorCompletions(getNotebookSymbolSuggestions(cellId), mathBuiltins, userFunctionSuggestions);
  const tutorialMathCardReady = useMemo(
    () =>
      cells.some(
        (cell) => cell.type === 'math' && !!cell.mathOutput && (cell.ui?.mathView ?? 'rendered') === 'rendered'
      ),
    [cells]
  );
  const showingTutorialCoachmarks =
    tutorialNotebookId === notebookId && coachmarkStep !== 'done' && cells.length > 0;
  const activeCoachmarkStep =
    showingTutorialCoachmarks && !(coachmarkStep === 'math' && !tutorialMathCardReady) ? coachmarkStep : null;
  const dragCoachmarkUsesCellShell = touchUiEnabled && !wideTouchRailEnabled;
  const dragCoachmarkTargetSelector = dragCoachmarkUsesCellShell ? '.cell-row-shell' : '.cell-row-drag-btn';

  useEffect(() => {
    cellsRef.current = cells;
    trigModeRef.current = trigMode;
    renderModeRef.current = defaultMathRenderMode;
    activeCellIdRef.current = activeCellId;
    lastActiveCellIdRef.current = lastActiveCellId;
  }, [cells, trigMode, defaultMathRenderMode, activeCellId, lastActiveCellId]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const activateCell = (cellId: string | null, options?: { preserveLast?: boolean }) => {
    setActiveCellId(cellId);
    if (!options?.preserveLast) {
      setLastActiveCellId(cellId);
    }
  };
  const assistantBootstrapCode = useMemo(() => buildAssistantBootstrapCode(allFunctions), [allFunctions]);

  const connectBackend = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setStatus('connecting');
    setStatusDetail('Checking restricted runtime...');
    setErrorMsg('');
    try {
      const config = await fetchRuntimeConfig();
      setRuntimeConfig(config);
      setStatus('connected');
      setStatusDetail(config.mode ? `Mode: ${config.mode}` : 'Restricted runtime ready');
      setErrorMsg('');
    } catch (err) {
      setStatus('error');
      setStatusDetail('');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect to SugarPy backend.');
    } finally {
      connectingRef.current = false;
    }
  };

  const activeKernel = status === 'connected';
  const hasRunningCells = cells.some((cell) => !!cell.isRunning);
  const isDraggingCells = !!dragState;

  const clearRunningState = (message: string) => {
    setCells((prev) =>
      prev.map((cell) => {
        if (!cell.isRunning) return cell;
        const nextCell: CellModel = { ...cell, isRunning: false };
        if (cell.type === 'math') {
          nextCell.mathOutput = {
            kind: cell.mathOutput?.kind ?? 'expression',
            steps: [],
            error: message,
            mode: cell.mathTrigMode ?? trigModeRef.current,
            warnings: []
          };
          return nextCell;
        }
        if (cell.type === 'stoich') {
          nextCell.stoichOutput = {
            ok: false,
            error: message,
            species: []
          };
          return nextCell;
        }
        if (cell.type === 'regression') {
          nextCell.regressionOutput = {
            ok: false,
            model: cell.regressionState?.model ?? 'auto',
            error: message,
            points: [],
            invalid_rows: []
          };
          return nextCell;
        }
        nextCell.output = {
          type: 'error',
          ename: 'ExecutionStopped',
          evalue: message
        };
        return nextCell;
      })
    );
    setIsRunningAll(false);
  };

  const showRuntimeResetNotice = (message: string) => {
    setRuntimeNotice(message);
  };

  const getDragInsertionIndex = (clientY: number) => {
    const stack = notebookStackRef.current;
    if (!stack) return 0;
    const rows = Array.from(stack.querySelectorAll<HTMLElement>('.notebook-item[data-cell-id]'));
    if (!rows.length) return 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return index;
      }
    }
    return rows.length;
  };

  const clearDragTouchPending = () => {
    const pending = dragTouchPendingRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timerId);
    window.removeEventListener('pointermove', pending.onMove, true);
    window.removeEventListener('pointerup', pending.onEnd, true);
    window.removeEventListener('pointercancel', pending.onEnd, true);
    if (typeof pending.target.releasePointerCapture === 'function') {
      try {
        pending.target.releasePointerCapture(pending.pointerId);
      } catch (_err) {
        // ignore pointer capture failures
      }
    }
    dragTouchPendingRef.current = null;
  };

  const finishDrag = (cancel = false) => {
    const current = dragStateRef.current;
    if (!current) return;
    if (!cancel) {
      setCells((prev) => moveCellToIndex(prev, current.cellId, current.insertionIndex));
      activateCell(current.cellId);
    }
    dragStateRef.current = null;
    setDragState(null);
    window.setTimeout(() => {
      if (dragClickSuppressedCellIdRef.current === current.cellId) {
        dragClickSuppressedCellIdRef.current = null;
      }
    }, 0);
    if (dragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragScrollFrameRef.current);
      dragScrollFrameRef.current = null;
    }
  };

  const beginDrag = (detail: CellDragStartDetail) => {
    if (dragStateRef.current) return;
    const sourceIndex = cellsRef.current.findIndex((cell) => cell.id === detail.cellId);
    if (sourceIndex < 0) return;
    const nextState: DragState = {
      ...detail,
      sourceIndex,
      insertionIndex: getDragInsertionIndex(detail.clientY)
    };
    dragClickSuppressedCellIdRef.current = detail.cellId;
    dragStateRef.current = nextState;
    setDragState(nextState);
  };

  const beginTouchDragPending = (cellId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') return;
    if (!canStartTouchDragFromTarget(event.currentTarget, event.target)) return;
    if (dragStateRef.current || dragTouchPendingRef.current) return;
    const target = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const pointerType = event.pointerType;

    const pending: NonNullable<typeof dragTouchPendingRef.current> = {
      pointerId,
      timerId: window.setTimeout(() => {
        clearDragTouchPending();
        window.getSelection?.()?.removeAllRanges?.();
        beginDrag({
          cellId,
          pointerId,
          pointerType,
          clientX: startX,
          clientY: startY,
          origin: 'touch'
        });
        if (typeof target.setPointerCapture === 'function') {
          try {
            target.setPointerCapture(pointerId);
          } catch (_err) {
            // ignore pointer capture failures
          }
        }
      }, CELL_DRAG_LONG_PRESS_MS),
      startX,
      startY,
      cellId,
      target,
      onMove: (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > CELL_DRAG_MOVE_THRESHOLD) {
          clearDragTouchPending();
        }
      },
      onEnd: (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        clearDragTouchPending();
      }
    };
    dragTouchPendingRef.current = pending;
    window.addEventListener('pointermove', pending.onMove, true);
    window.addEventListener('pointerup', pending.onEnd, true);
    window.addEventListener('pointercancel', pending.onEnd, true);
  };

  const beginHandleDrag = (cellId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.getSelection?.()?.removeAllRanges?.();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_err) {
        // ignore pointer capture failures
      }
    }
    beginDrag({
      cellId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      origin: 'handle'
    });
  };

  const isInteractiveDragTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      'button, input, textarea, select, a, [contenteditable="true"], .cm-editor, .cm-content, .cell-action-bar, .cell-overflow-menu, .cell-insert-menu'
    );
  };

  const canStartTouchDragFromTarget = (currentTarget: HTMLElement, target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (isInteractiveDragTarget(target)) return false;
    return !!target.closest('.cell-row-shell, .cell-shell, .cell-gutter, .cell-main');
  };

  const invalidateActiveExecutions = () => {
    executionGenerationRef.current += 1;
    stopRunAllRequestedRef.current = true;
  };

  const stopNotebookRuntimeExecution = async () => {
    invalidateActiveExecutions();
    try {
      const runtime = await interruptNotebookRuntime(notebookId);
      const restartedAfterInterrupt = runtime.sessionState === 'restarted-after-interrupt';
      const message = runtime.interrupted
        ? restartedAfterInterrupt
          ? 'Execution interrupted. Runtime restarted to clear the busy kernel.'
          : 'Execution interrupted.'
        : runtime.error || 'Runtime interrupt was requested.';
      clearRunningState(message);
      if (restartedAfterInterrupt) {
        showRuntimeResetNotice('Runtime restarted after interrupt. Previous outputs may be stale; rerun setup cells or use Run All.');
      }
      setSyncMessage(
        runtime.interrupted
          ? restartedAfterInterrupt
            ? 'Runtime interrupted and restarted.'
            : 'Runtime interrupt sent.'
          : message
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to interrupt runtime.';
      clearRunningState(message);
      setSyncMessage(message);
    }
  };

  const handleRestartNotebookRuntime = async () => {
    invalidateActiveExecutions();
    setHeaderMenuOpen(false);
    try {
      await restartNotebookRuntime(notebookId);
      clearRunningState('Runtime restarted. Rerun setup cells or use Run All.');
      showRuntimeResetNotice('Runtime restarted. Previous outputs belong to the old kernel; rerun setup cells or use Run All.');
      setSyncMessage('Runtime restarted.');
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Failed to restart runtime.');
    }
  };

  const handleDeleteNotebookRuntime = async () => {
    invalidateActiveExecutions();
    setHeaderMenuOpen(false);
    try {
      await deleteNotebookRuntime(notebookId);
      clearRunningState('Runtime deleted. The next execution will start a fresh runtime.');
      showRuntimeResetNotice('Runtime deleted. The next run will start a fresh kernel, so existing outputs may be stale.');
      setSyncMessage('Runtime deleted.');
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Failed to delete runtime.');
    }
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
      setLastActiveCellId(null);
      return;
    }
    if (activeCellId && !cells.some((cell) => cell.id === activeCellId)) {
      activateCell(cells[0].id);
      return;
    }
    if (lastActiveCellId && !cells.some((cell) => cell.id === lastActiveCellId)) {
      setLastActiveCellId(activeCellId && cells.some((cell) => cell.id === activeCellId) ? activeCellId : cells[0].id);
    }
  }, [cells, activeCellId, lastActiveCellId]);

  useEffect(() => {
    if (connectOnce.current) return;
    connectOnce.current = true;
    connectBackend().catch(() => undefined);
  }, []);

  useEffect(() => {
    const updateEligibility = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const noHover = window.matchMedia('(hover: none)').matches;
      const touchCapable = navigator.maxTouchPoints > 0 || coarse || noHover;
      setTouchUiEnabled(touchCapable);
      setWideTouchRailEnabled(touchCapable && window.innerWidth >= 900);
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
      if (headerMenuOpen && headerMenuRef.current && target && !headerMenuRef.current.contains(target)) {
        setHeaderMenuOpen(false);
      }
      if (addCellMenuOpen && addCellMenuRef.current && target && !addCellMenuRef.current.contains(target)) {
        setAddCellMenuOpen(false);
      }
      if (emptyMoreBlocksOpen && emptyMoreBlocksRef.current && target && !emptyMoreBlocksRef.current.contains(target)) {
        setEmptyMoreBlocksOpen(false);
      }
      if (
        cellInsertMenu &&
        target &&
        !cellInsertMenuRef.current?.contains(target) &&
        !cellInsertMenuShellRef.current?.contains(target)
      ) {
        setCellInsertMenu(null);
        setCellInsertMenuQuery('');
      }
      if (
        target &&
        notebookStackRef.current &&
        !notebookStackRef.current.contains(target) &&
        !headerMenuRef.current?.contains(target) &&
        !addCellMenuRef.current?.contains(target) &&
        !cellInsertMenuRef.current?.contains(target) &&
        !cellInsertMenuShellRef.current?.contains(target)
      ) {
        if (activeCellIdRef.current !== null) {
          setActiveCellId(null);
        } else if (lastActiveCellIdRef.current !== null) {
          setLastActiveCellId(null);
        }
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
      if (dragStateRef.current) {
        event.preventDefault();
        finishDrag(true);
        return;
      }
      if (headerMenuOpen) setHeaderMenuOpen(false);
      if (addCellMenuOpen) setAddCellMenuOpen(false);
      if (emptyMoreBlocksOpen) setEmptyMoreBlocksOpen(false);
      if (cellInsertMenu) {
        setCellInsertMenu(null);
        setCellInsertMenuQuery('');
      }
      if (assistantOpen) setAssistantOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [addCellMenuOpen, assistantOpen, cellInsertMenu, emptyMoreBlocksOpen, headerMenuOpen]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const insertionIndex = getDragInsertionIndex(event.clientY);
      const nextState: DragState = {
        ...current,
        clientX: event.clientX,
        clientY: event.clientY,
        insertionIndex
      };
      dragStateRef.current = nextState;
      setDragState(nextState);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const current = dragStateRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      finishDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!dragStateRef.current) return;
      event.preventDefault();
      finishDrag(true);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const current = dragStateRef.current;
      if (!current || current.pointerType !== 'touch') return;
      event.preventDefault();
    };

    const autoScroll = () => {
      const current = dragStateRef.current;
      if (!current) return;
      const edge = 90;
      const viewportHeight = window.innerHeight;
      const y = current.clientY;
      let delta = 0;
      if (y < edge) {
        delta = -Math.max(4, (edge - y) / 7);
      } else if (y > viewportHeight - edge) {
        delta = Math.max(4, (y - (viewportHeight - edge)) / 7);
      }
      if (delta !== 0) {
        window.scrollBy({ top: delta, behavior: 'auto' });
      }
      const next = dragStateRef.current;
      if (next) {
        const insertionIndex = getDragInsertionIndex(next.clientY);
        if (insertionIndex !== next.insertionIndex) {
          const updated: DragState = { ...next, insertionIndex };
          dragStateRef.current = updated;
          setDragState(updated);
        }
      }
      dragScrollFrameRef.current = window.requestAnimationFrame(autoScroll);
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerEnd, true);
    window.addEventListener('pointercancel', handlePointerEnd, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    dragScrollFrameRef.current = window.requestAnimationFrame(autoScroll);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerEnd, true);
      window.removeEventListener('pointercancel', handlePointerEnd, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('touchmove', handleTouchMove, true);
      if (dragScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragScrollFrameRef.current);
        dragScrollFrameRef.current = null;
      }
    };
  }, [dragState?.pointerId]);

  useEffect(() => {
    return () => {
      clearDragTouchPending();
      if (dragScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragScrollFrameRef.current);
        dragScrollFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const lastId = loadLastOpenId();
      pruneLocalNotebookSnapshots(lastId);
      let selected: ReturnType<typeof loadFromLocalStorage> | Awaited<ReturnType<typeof loadServerAutosave>> = null;

      if (lastId) {
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

        selected = pickNewest();
      }

      if (!selected && !hasSeenOnboarding()) {
        const nextId = createNotebookId();
        const nextCells = getFirstRunNotebookCells().map((cell, index) => createCell(cell.type, cell.source, index + 1));
        const seeded = serializeSugarPy({
          id: nextId,
          name: FIRST_RUN_NOTEBOOK_NAME,
          trigMode: 'deg',
          defaultMathRenderMode: 'exact',
          cells: nextCells
        });
        saveToLocalStorage(seeded);
        markOnboardingSeen();
        saveTutorialNotebookId(nextId);
        setTutorialNotebookId(nextId);
        selected = seeded;
        if (!loadCoachmarksDismissed()) {
          setCoachmarkStep('add');
        }
      }

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
      setExecCounter(getNotebookExecCounter(nextCells));
      activateCell(nextCells[0]?.id ?? null);
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

  const buildExecutionCells = (cellId: string, source: string, type: 'code' | 'math' | 'stoich' | 'regression') =>
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
              : type === 'regression'
                ? {
                    regressionState: cell.regressionState ?? createRegressionState()
                  }
              : {})
          }
        : cell
    );

  const applyExecutionResult = (cellId: string, response: SugarPyExecutionResponse, countExecution = true) => {
    const shouldAnnounceFreshRuntime = response.freshRuntime && execCounter > 0;
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
          if (response.cellType === 'regression') {
            return {
              ...cell,
              isRunning: false,
              execCount: nextExecCount ?? cell.execCount,
              regressionOutput: response.regressionOutput as any,
              output: response.output as any,
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
    setRuntimeNotice('');
    if (countExecution && response.execCountIncrement) {
      setExecCounter((prev) => {
        const next = prev + 1;
        updateCellState(next);
        return next;
      });
    } else {
      updateCellState();
    }
    if (shouldAnnounceFreshRuntime) {
      setSyncMessage('Fresh runtime started. Rerun setup cells or use Run All.');
      showRuntimeResetNotice('Fresh runtime started. Kernel state was reset, so rerun setup cells or use Run All.');
    }
  };

  const runCell = async (cellId: string, code: string, showOutput = true, countExecution = true) => {
    if (!activeKernel) return;
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
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
      const response = await executeNotebookCell({
        notebookId,
        cells: buildExecutionCells(cellId, code, 'code') as Array<Record<string, unknown>>,
        targetCellId: cellId,
        trigMode,
        defaultMathRenderMode,
        timeoutMs: CELL_EXECUTION_TIMEOUT_MS
      });
      if (executionGeneration !== executionGenerationRef.current) return;
      if (showOutput) {
        applyExecutionResult(cellId, response, countExecution);
      }
      const defs = extractCodeSymbols(code, 180)
        .filter((item) => item.type === 'function')
        .map((item) => item.label);
      if (defs.length > 0) {
        setUserFunctions((prev) => Array.from(new Set([...prev, ...defs])));
      }
    } catch (error) {
      if (executionGeneration !== executionGenerationRef.current) return;
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
    if (!activeKernel) return;
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
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
      const response = await executeNotebookCell({
        notebookId,
        cells: buildExecutionCells(cellId, source, 'math') as Array<Record<string, unknown>>,
        targetCellId: cellId,
        trigMode,
        defaultMathRenderMode,
        timeoutMs: CELL_EXECUTION_TIMEOUT_MS
      });
      if (executionGeneration !== executionGenerationRef.current) return;
      applyExecutionResult(cellId, response, true);
    } catch (error) {
      if (executionGeneration !== executionGenerationRef.current) return;
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
    if (!activeKernel) return;
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
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
      if (executionGeneration !== executionGenerationRef.current) return;
      applyExecutionResult(cellId, response, true);
    } catch (error) {
      if (executionGeneration !== executionGenerationRef.current) return;
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId
            ? { ...c, isRunning: false, stoichOutput: { ok: false, error: String(error), species: [] } }
            : c
        )
      );
    }
  };

  const runRegressionCell = async (cellId: string, state: RegressionState) => {
    if (!activeKernel) return;
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
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
      const nextCells = cellsRef.current.map((cell) =>
        cell.id === cellId
          ? {
              ...cell,
              type: 'regression',
              regressionState: state
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
      if (executionGeneration !== executionGenerationRef.current) return;
      applyExecutionResult(cellId, response, true);
    } catch (error) {
      if (executionGeneration !== executionGenerationRef.current) return;
      setCells((prev) =>
        prev.map((c) =>
          c.id === cellId
            ? {
                ...c,
                isRunning: false,
                regressionOutput: {
                  ok: false,
                  model: c.regressionState?.model ?? 'auto',
                  error: String(error),
                  points: [],
                  invalid_rows: []
                }
              }
            : c
        )
      );
    }
  };

  const runAllCells = async () => {
    if (isRunningAll) return;
    if (!activeKernel) {
      await connectBackend();
      if (status !== 'connected') return;
    }
    stopRunAllRequestedRef.current = false;
    setIsRunningAll(true);
    try {
      const queue = [...cells];
      for (const cell of queue) {
        if (stopRunAllRequestedRef.current) break;
        activateCell(cell.id);
        if (cell.type === 'markdown') continue;
        if (cell.type === 'math') {
          await runMathCell(
            cell.id,
            cell.source,
            cell.mathRenderMode ?? defaultMathRenderMode,
            cell.mathTrigMode ?? trigMode
          );
          if (stopRunAllRequestedRef.current) break;
          continue;
        }
        if (cell.type === 'stoich') {
          await runStoichCell(cell.id, cell.stoichState ?? { reaction: '', inputs: {} });
          if (stopRunAllRequestedRef.current) break;
          continue;
        }
        if (cell.type === 'regression') {
          await runRegressionCell(cell.id, cell.regressionState ?? createRegressionState());
          if (stopRunAllRequestedRef.current) break;
          continue;
        }
        await runCell(cell.id, cell.source);
        if (stopRunAllRequestedRef.current) break;
      }
    } finally {
      setIsRunningAll(false);
    }
  };

  const createCell = (
    type: 'code' | 'markdown' | 'math' | 'stoich' | 'regression',
    source = '',
    indexSeed?: number
  ): CellModel =>
    createCellRecord(type, {
      trigMode,
      defaultMathRenderMode
    }, {
      id: `cell-${indexSeed ? `${indexSeed}-` : ''}${Date.now()}`,
      source
    });

  const getInsertionAnchorId = () => activeCellId || lastActiveCellId;

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
              regressionOutput: undefined,
              ui: {
                ...cell.ui,
                outputCollapsed: false,
                ...(cell.type === 'math' ? { mathView: 'rendered' as const } : {})
              }
            }
          : cell
      )
    );
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
    if (cell.type === 'regression') {
      return cell.regressionOutput?.equation_text ?? cell.regressionOutput?.error ?? '';
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
      type: (cell.type ?? 'code') as 'code' | 'markdown' | 'math' | 'stoich' | 'regression',
      source: cell.source,
      mathRenderMode: cell.mathRenderMode,
      mathTrigMode: cell.mathTrigMode,
      stoichReaction: cell.stoichState?.reaction ?? '',
      hasOutput: !!(cell.output || cell.mathOutput || cell.stoichOutput || cell.regressionOutput),
      outputPreview: getCellDisplayText(cell),
      hasError: !!(
        cell.output?.type === 'error' ||
        cell.mathOutput?.error ||
        (cell.stoichOutput && cell.stoichOutput.ok === false) ||
        (cell.regressionOutput && cell.regressionOutput.ok === false)
      )
    }))
  });

  const buildAssistantSandboxCells = (): AssistantSandboxNotebookCell[] =>
    cells.map((cell) => ({
      id: cell.id,
      type: cell.type ?? 'code',
      source: cell.type === 'stoich' ? cell.stoichState?.reaction ?? '' : cell.source,
      mathTrigMode: cell.mathTrigMode,
      mathRenderMode: cell.mathRenderMode,
      contextSource: 'notebook'
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
      regressionState: cell.regressionState ? JSON.parse(JSON.stringify(cell.regressionState)) : undefined,
      regressionOutput: cell.regressionOutput ? JSON.parse(JSON.stringify(cell.regressionOutput)) : undefined,
      output: cell.output ? JSON.parse(JSON.stringify(cell.output)) : undefined
    })),
    trigMode: trigModeRef.current,
    defaultMathRenderMode: renderModeRef.current,
    activeCellId: activeCellIdRef.current,
    lastActiveCellId: lastActiveCellIdRef.current
  });

  const restoreAssistantSnapshot = (snapshot: AssistantSnapshot) => {
    setCells(snapshot.cells);
    setTrigMode(snapshot.trigMode);
    setDefaultMathRenderMode(snapshot.defaultMathRenderMode);
    setActiveCellId(snapshot.activeCellId);
    setLastActiveCellId(snapshot.lastActiveCellId);
    cellsRef.current = snapshot.cells;
    trigModeRef.current = snapshot.trigMode;
    renderModeRef.current = snapshot.defaultMathRenderMode;
    activeCellIdRef.current = snapshot.activeCellId;
    lastActiveCellIdRef.current = snapshot.lastActiveCellId;
  };

  const getAssistantOperationSource = (operation: AssistantOperation) => {
    if (operation.type === 'insert_cell' || operation.type === 'update_cell') return operation.source;
    if (operation.type === 'replace_cell_editable') {
      return typeof operation.document?.source === 'string' ? operation.document.source : '';
    }
    if (operation.type === 'patch_cell') {
      const document = operation.patch.document as Record<string, unknown> | undefined;
      return typeof document?.source === 'string' ? document.source : '';
    }
    return '';
  };

  const isRunnableAssistantOperation = (operation: AssistantOperation) =>
    (operation.type === 'insert_cell' && operation.cellType !== 'markdown') ||
    operation.type === 'update_cell' ||
    operation.type === 'patch_cell' ||
    operation.type === 'replace_cell_editable';

  const isReplayableSandboxCell = (cell: AssistantSandboxNotebookCell) =>
    (cell.type === 'code' || cell.type === 'math') && cell.source.trim().length > 0;

  const cloneSandboxCells = (input: AssistantSandboxNotebookCell[]): AssistantSandboxNotebookCell[] =>
    input.map((cell) => ({ ...cell }));

  const buildLiveSandboxCells = (): AssistantSandboxNotebookCell[] =>
    cellsRef.current.map((cell) => ({
      id: cell.id,
      type: cell.type ?? 'code',
      source: cell.type === 'stoich' ? cell.stoichState?.reaction ?? '' : cell.source,
      mathTrigMode: cell.mathTrigMode,
      mathRenderMode: cell.mathRenderMode,
      contextSource: 'notebook'
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
      case 'patch_cell':
        return `Patch cell ${operation.cellId}`;
      case 'replace_cell_editable':
        return `Replace editable state for cell ${operation.cellId}`;
      case 'delete_cell':
        return `Delete cell ${operation.cellId}`;
      case 'move_cell':
        return `Move cell ${operation.cellId} to ${operation.index + 1}`;
      case 'set_notebook_defaults':
        return 'Update notebook defaults';
      case 'patch_user_preferences':
        return 'Update local preferences';
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
    const contextSummary =
      result.replayedCellIds.length > 0
        ? `${result.contextPresetUsed} using ${result.replayedCellIds.length} prior cell${result.replayedCellIds.length === 1 ? '' : 's'}`
        : result.executedBootstrap || result.contextPresetUsed === 'bootstrap-only'
          ? 'bootstrap only'
          : 'isolation only';
    const attemptSuffix = (result.attempts?.length ?? 0) > 1 ? ` after ${result.attempts?.length} attempts` : '';
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
      contextSummary: `${contextSummary}${attemptSuffix}`,
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
        source: operation.source,
        contextSource: 'draft'
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
    if (operation.type === 'patch_cell' || operation.type === 'replace_cell_editable') {
      const nextSource = getAssistantOperationSource(operation);
      if (!nextSource) return { cells: nextCells };
      return {
        cells: nextCells.map((cell) =>
          cell.id === operation.cellId ? { ...cell, source: nextSource } : cell
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
        if (operation.type === 'patch_user_preferences') {
          continue;
        }

        if (!isRunnableAssistantOperation(operation)) {
          workingCells = applyDraftOperationToSandboxCells(workingCells, operation).cells;
          continue;
        }

        const sandboxSource = getAssistantOperationSource(operation);
        const replayableCellIds = workingCells
          .filter((cell) => {
            if (!isReplayableSandboxCell(cell)) return false;
            return (
              (operation.type !== 'update_cell' &&
                operation.type !== 'patch_cell' &&
                operation.type !== 'replace_cell_editable') ||
              cell.id !== operation.cellId
            );
          })
          .map((cell) => cell.id);
        const usesReplayContext =
          replayableCellIds.length > 0 &&
          (
            operation.type === 'update_cell' ||
            operation.type === 'patch_cell' ||
            operation.type === 'replace_cell_editable' ||
            steps.some((entry) => entry.isRunnable)
          );
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
            : (operation.type === 'update_cell' ||
                operation.type === 'patch_cell' ||
                operation.type === 'replace_cell_editable') &&
              workingCells.find((cell) => cell.id === operation.cellId)?.type === 'math'
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
          .map((operation) => getAssistantOperationSource(operation))
          .filter(Boolean)
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
    type: InsertCellType,
    source = ''
  ) => {
    const bounded = Math.max(0, Math.min(index, cells.length));
    const nextCell = createCell(type, source, bounded + 1);
    setCells((prev) => [...prev.slice(0, bounded), nextCell, ...prev.slice(bounded)]);
    activateCell(nextCell.id);
    setAddCellMenuOpen(false);
  };

  const insertCellBelowActive = (type: InsertCellType) => {
    const insertionAnchorId = getInsertionAnchorId();
    const activeIndex = insertionAnchorId ? cells.findIndex((cell) => cell.id === insertionAnchorId) : -1;
    const targetIndex = activeIndex >= 0 ? activeIndex + 1 : cells.length;
    insertCellAt(targetIndex, type);
  };

  const openCellInsertMenu = (cellId: string, placement: 'above' | 'below') => {
    setCellInsertMenu({ cellId, placement });
    setCellInsertMenuQuery('');
  };

  const closeCellInsertMenu = () => {
    setCellInsertMenu(null);
    setCellInsertMenuQuery('');
  };

  const insertCellFromMenu = (cellId: string, type: InsertCellType) => {
    const sourceIndex = cells.findIndex((cell) => cell.id === cellId);
    if (sourceIndex < 0) return;
    const placement = cellInsertMenu?.placement ?? 'below';
    const targetIndex = placement === 'above' ? sourceIndex : sourceIndex + 1;
    insertCellAt(targetIndex, type);
    closeCellInsertMenu();
  };

  const insertSiblingCell = (cellId: string, position: 'above' | 'below') => {
    const sourceIndex = cells.findIndex((cell) => cell.id === cellId);
    if (sourceIndex < 0) return;
    const sourceCell = cells[sourceIndex];
    const nextType: InsertCellType =
      sourceCell.type === 'markdown' || sourceCell.type === 'math' ? sourceCell.type : 'code';
    const targetIndex = position === 'above' ? sourceIndex : sourceIndex + 1;
    insertCellAt(targetIndex, nextType);
  };

  const updateCell = (cellId: string, source: string) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, source } : c)));
  };

  const updateStoichState = (cellId: string, state: StoichState) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, stoichState: state } : c)));
  };

  const updateRegressionState = (cellId: string, state: RegressionState) => {
    setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, regressionState: state } : c)));
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
    setAssistantDrawerSection('hub');
    setAssistantError('');
    return nextChat.id;
  };

  const activeAssistantChat =
    assistantChats.find((chat) => chat.id === assistantActiveChatId) ??
    assistantChats[0] ??
    null;
  const assistantDefaultProviderAvailable = useMemo(() => {
    const configuredModel = (
      runtimeConfig?.model?.trim() ||
      assistantModel.trim() ||
      readOptionalStorageItem(ASSISTANT_MODEL_STORAGE) ||
      readOptionalStorageItem('sugarpy:assistant:gemini:model') ||
      DEFAULT_ASSISTANT_MODEL
    ).trim();
    const overrideApiKey = (assistantApiKey.trim() || readOptionalStorageItem(ASSISTANT_API_KEY_STORAGE) || '').trim();
    const provider = detectAssistantProvider(configuredModel, overrideApiKey);
    return (
      (provider === 'openai' && !!runtimeConfig?.providers?.openai) ||
      (provider === 'gemini' && !!runtimeConfig?.providers?.gemini) ||
      (provider === 'groq' && !!runtimeConfig?.providers?.groq)
    );
  }, [assistantApiKey, assistantModel, runtimeConfig]);

  const filteredCellInsertOptions = useMemo(
    () => INSERT_CELL_OPTIONS.filter((option) => matchesInsertCellQuery(option, cellInsertMenuQuery)),
    [cellInsertMenuQuery]
  );
  const filteredPrimaryInsertOptions = filteredCellInsertOptions.filter((option) => option.priority === 'primary');
  const filteredSecondaryInsertOptions = filteredCellInsertOptions.filter((option) => option.priority === 'secondary');

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
            stoichState: createStoichState(),
            ui: {
              outputCollapsed: false
            }
          };
        }
        if (entry.id === 'math.regression_table') {
          return {
            ...cell,
            type: 'regression',
            source: '',
            output: undefined,
            execCount: undefined,
            isRunning: false,
            mathOutput: undefined,
            stoichOutput: undefined,
            regressionOutput: undefined,
            stoichState: undefined,
            regressionState: createRegressionState(),
            ui: {
              outputCollapsed: false
            }
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
          regressionOutput: undefined,
          stoichState: undefined,
          regressionState: undefined,
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
    setAssistantPhotoImport(null);
    setAssistantDrawerSection('hub');
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

  const resolveAssistantDrawerSection = (mode: 'photo-import' | 'chat'): AssistantDrawerSection => {
    if (assistantPhotoImportPreparing || (assistantPhotoImport?.items.length ?? 0) > 0) {
      return 'photo-import';
    }
    if (mode === 'chat') {
      return 'hub';
    }
    return 'hub';
  };

  const openAssistantDrawer = (mode: 'photo-import' | 'chat') => {
    setAssistantEntryMode(mode);
    setAssistantDrawerSection(resolveAssistantDrawerSection(mode));
    setAssistantOpen(true);
    void hydrateAssistantRuntimeConfig();
  };

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

  const resolvePhotoImportApiKey = (config: AssistantRuntimeConfig | null) => {
    const overrideApiKey = (assistantApiKey.trim() || readOptionalStorageItem(ASSISTANT_API_KEY_STORAGE) || '').trim();
    if (overrideApiKey.startsWith('sk-')) {
      return overrideApiKey;
    }
    if (config?.providers?.openai) {
      return 'server-proxy:openai';
    }
    return '';
  };

  const getAssistantImportTotalBytes = (items: AssistantImportItem[]) =>
    items.reduce((total, item) => total + item.sourceSizeBytes, 0);

  const handleSelectAssistantPhotos = async (files: File[] | FileList | null | undefined) => {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) return;
    const existingImport = assistantPhotoImport;
    const existingItems = existingImport?.items ?? [];
    const knownSourceKeys = new Set(existingItems.map((item) => item.sourceKey));
    const dedupedFiles: File[] = [];
    for (const file of nextFiles) {
      const sourceKey = buildFileDedupKey(file);
      if (knownSourceKeys.has(sourceKey)) continue;
      knownSourceKeys.add(sourceKey);
      dedupedFiles.push(file);
    }
    if (dedupedFiles.length === 0) {
      setAssistantError('Those files are already queued for import.');
      return;
    }
    if (existingItems.length + dedupedFiles.length > MAX_ASSISTANT_IMPORT_ITEMS) {
      setAssistantError(`Photo import currently supports up to ${MAX_ASSISTANT_IMPORT_ITEMS} queued pages or images.`);
      return;
    }

    setAssistantPhotoImportPreparing(true);
    try {
      const preparedItems = [...existingItems];
      let totalBytes = getAssistantImportTotalBytes(preparedItems);
      for (const file of dedupedFiles) {
        const prepared = await prepareAssistantImportFile(file, {
          maxImageBytes: MAX_ASSISTANT_IMPORT_IMAGE_BYTES,
          maxPdfPages: MAX_ASSISTANT_IMPORT_PDF_PAGES,
          maxTotalBytes: MAX_ASSISTANT_IMPORT_TOTAL_BYTES,
          currentTotalBytes: totalBytes
        });
        if (!prepared.ok) {
          setAssistantError(prepared.error);
          return;
        }
        preparedItems.push(...prepared.items);
        totalBytes = getAssistantImportTotalBytes(preparedItems);
        if (preparedItems.length > MAX_ASSISTANT_IMPORT_ITEMS) {
          setAssistantError(`Photo import currently supports up to ${MAX_ASSISTANT_IMPORT_ITEMS} queued pages or images.`);
          return;
        }
      }
      setAssistantPhotoImport({
        items: preparedItems,
        instructions: existingImport?.instructions ?? ''
      });
      setAssistantDrawerSection('photo-import');
      setAssistantError('');
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : 'Failed to prepare imported files.');
    } finally {
      setAssistantPhotoImportPreparing(false);
    }
  };

  const runAssistantPhotoImport = async (options?: { chatId?: string; instructionOverride?: string }) => {
    const photoImport = assistantPhotoImport;
    if (!photoImport || photoImport.items.length === 0) {
      setAssistantError('Choose at least one image or PDF before extracting a draft.');
      return;
    }
    if (assistantPhotoImportPreparing) {
      setAssistantError('Wait for the selected files to finish preparing before extracting a draft.');
      return;
    }
    const runtimeConfig = await hydrateAssistantRuntimeConfig();
    const effectiveApiKey = resolvePhotoImportApiKey(runtimeConfig);
    if (!effectiveApiKey) {
      setAssistantError('No OpenAI API key is available for photo import. Add an OpenAI key or configure the server proxy key.');
      return;
    }

    const chatId = options?.chatId ?? ensureAssistantChat();
    const traceId = `assistant-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const importSummary = buildAssistantImportSummary(photoImport.items);
    const effectiveInstruction = (options?.instructionOverride ?? photoImport.instructions ?? '').trim();
    const instructionSuffix = effectiveInstruction ? `\nInstruction: ${effectiveInstruction}` : '';
    const messageLabel = `Import pages: ${importSummary}${instructionSuffix}`;
    const userMessageId = `assistant-user-${Date.now()}`;
    const assistantMessageId = `assistant-reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMessage: AssistantChatMessage = {
      id: userMessageId,
      role: 'user',
      content: messageLabel,
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
      title: chat.messages.length > 0 ? chat.title : previewAssistantLabel(`Photo import ${importSummary}`, 'Photo import'),
      messages: [...chat.messages, userMessage, assistantMessage]
    }));

    const baseTrace: AssistantRunTrace = {
      id: traceId,
      chatId,
      messageId: assistantMessageId,
      notebookId,
      notebookName,
      prompt: messageLabel,
      model: ASSISTANT_PHOTO_IMPORT_MODEL,
      thinkingLevel: assistantThinkingLevel,
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
      conversationHistory: [{ role: 'user', content: messageLabel }],
      photoImport: {
        instructions: effectiveInstruction,
        items: photoImport.items.map((item, index) => ({
          index,
          fileName: item.sourceFileName,
          displayName: item.displayName,
          pageNumber: item.pageNumber ?? null,
          mimeType: item.mimeType
        }))
      },
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
    const controller = new AbortController();
    assistantAbortRef.current = controller;

    try {
      const requestText = [
        'Import the uploaded handwritten pages into SugarPy notebook cells.',
        'Append imported content as new cells only.',
        `Attached pages/images: ${importSummary}.`,
        effectiveInstruction ? `User import goal: ${effectiveInstruction}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      const plan = await planNotebookChanges({
        apiKey: effectiveApiKey,
        model: ASSISTANT_PHOTO_IMPORT_MODEL,
        request: requestText,
        scope: ASSISTANT_SCOPE,
        preference: ASSISTANT_PREFERENCE,
        context: buildAssistantContext(),
        photoImport: {
          items: photoImport.items.map((item) => ({
            imageDataUrl: item.dataUrl,
            fileName: item.sourceFileName,
            displayName: item.displayName,
            mimeType: item.mimeType,
            pageNumber: item.pageNumber
          })),
          instructions: effectiveInstruction
        },
        signal: controller.signal,
        conversationHistory: [{ role: 'user', content: requestText }],
        thinkingLevel: assistantThinkingLevel,
        sandboxRunner: runAssistantSandbox,
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
        },
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
        }
      });
      const draftRun = await buildDraftFromPlan(
        plan,
        (item) => {
          collectedActivity.push(item);
          updateAssistantMessage(chatId, assistantMessageId, (message) => ({
            ...message,
            activity: [...(message.activity ?? []), item]
          }));
        },
        (validation) => {
          collectedDraftValidations.push(validation);
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
        status: 'ready',
        content: plan.userMessage || `Prepared ${plan.operations.length} imported cell${plan.operations.length === 1 ? '' : 's'}.`,
        plan,
        draftRun
      }));
      setAssistantPhotoImport(null);
      setAssistantDrawerSection('hub');
      setAssistantDraft('');
      void persistAssistantTrace({
        ...baseTrace,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(timestamp).getTime(),
        activity: [...collectedActivity],
        network: [...collectedNetwork],
        responses: [...collectedResponses],
        sandboxExecutions: [...collectedSandboxExecutions],
        draftValidations: [...collectedDraftValidations],
        result: {
          summary: plan.summary,
          warningCount: plan.warnings.length,
          operationCount: plan.operations.length
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Photo import failed.';
      updateAssistantMessage(chatId, assistantMessageId, (entry) => ({
        ...entry,
        status: controller.signal.aborted ? 'stopped' : 'error',
        error: message,
        content: controller.signal.aborted ? 'Photo import stopped.' : ''
      }));
      setAssistantError(message);
      void persistAssistantTrace({
        ...baseTrace,
        status: controller.signal.aborted ? 'stopped' : 'error',
        error: message,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(timestamp).getTime(),
        activity: [...collectedActivity],
        network: [...collectedNetwork],
        responses: [...collectedResponses],
        sandboxExecutions: [...collectedSandboxExecutions],
        draftValidations: [...collectedDraftValidations]
      });
    } finally {
      if (assistantAbortRef.current === controller) {
        assistantAbortRef.current = null;
      }
      setAssistantLoading(false);
    }
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
    let nextLastActiveCellId = lastActiveCellIdRef.current;

    const applied = applyAssistantOperations({
      cells: nextCells,
      operations: stepsToApply.flatMap((step) => step.operations),
      defaults: {
        trigMode: nextTrigMode,
        defaultMathRenderMode: nextRenderMode
      },
      activeCellId: nextActiveCellId,
      lastActiveCellId: nextLastActiveCellId
    });
    nextCells = applied.cells.map((cell) => ({ ...cell, assistantMeta: undefined }));
    nextTrigMode = applied.defaults.trigMode;
    nextRenderMode = applied.defaults.defaultMathRenderMode;
    nextActiveCellId = applied.activeCellId;
    nextLastActiveCellId = applied.lastActiveCellId;
    if (applied.preferencesPatch) {
      patchPreferences(applied.preferencesPatch as never);
    }

    setCells(nextCells);
    setTrigMode(nextTrigMode);
    setDefaultMathRenderMode(nextRenderMode);
    setActiveCellId(nextActiveCellId);
    setLastActiveCellId(nextLastActiveCellId);
    cellsRef.current = nextCells;
    trigModeRef.current = nextTrigMode;
    renderModeRef.current = nextRenderMode;
    activeCellIdRef.current = nextActiveCellId;
    lastActiveCellIdRef.current = nextLastActiveCellId;
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
    setHeaderMenuOpen(false);
    const nextId = createNotebookId();
    const nextCells: CellModel[] = [];
    setNotebookId(nextId);
    setNotebookName('Untitled');
    setTrigMode('deg');
    setDefaultMathRenderMode('exact');
    setCells(nextCells);
    setExecCounter(0);
    activateCell(nextCells[0]?.id ?? null);
    setLastSavedAt(null);
    lastSnapshot.current = buildSnapshot(nextCells, 'deg', 'exact', 'Untitled', nextId);
    setDirty(false);
  };

  const dismissCoachmarks = () => {
    setCoachmarkStep('done');
    saveCoachmarksDismissed();
  };

  const advanceCoachmark = () => {
    setCoachmarkStep((prev) => {
      if (prev === 'add') return 'menu';
      if (prev === 'menu') return 'drag';
      if (prev === 'drag') return 'math';
      return 'done';
    });
  };

  const clearNotebookOutputs = () => {
    setCells((prev) =>
      prev.map((cell) => ({
        ...cell,
        output: undefined,
        mathOutput: undefined,
        stoichOutput: undefined,
        regressionOutput: undefined,
        ui: {
          ...cell.ui,
          outputCollapsed: false,
          ...(cell.type === 'math' ? { mathView: 'rendered' as const } : {})
        }
      }))
    );
    setHeaderMenuOpen(false);
  };

  const handleDownloadSugarPy = () => {
    setHeaderMenuOpen(false);
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
    setHeaderMenuOpen(false);
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
    setHeaderMenuOpen(false);
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
    setHeaderMenuOpen(false);
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
      setExecCounter(getNotebookExecCounter(safeCells));
      activateCell(safeCells[0]?.id ?? null);
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
    setHeaderMenuOpen(false);
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

  const draggedCell = dragState ? cells.find((cell) => cell.id === dragState.cellId) ?? null : null;
  const draggedCellLabel = draggedCell
    ? draggedCell.type === 'markdown'
      ? 'Text'
      : draggedCell.type.charAt(0).toUpperCase() + draggedCell.type.slice(1)
    : 'Code';
  const draggedCellSummary = (() => {
    if (!draggedCell) return '';
    const raw =
      draggedCell.type === 'stoich'
        ? draggedCell.stoichState?.reaction ?? draggedCell.source
        : draggedCell.type === 'regression'
          ? draggedCell.regressionOutput?.equation_text ?? `${draggedCell.regressionState?.model ?? 'auto'} fit`
        : draggedCell.source;
    return raw.replace(/\s+/g, ' ').trim();
  })();

  return (
    <ErrorBoundary>
      <div
        className={`app${touchUiEnabled ? ' touch-ui' : ''}${wideTouchRailEnabled ? ' touch-rail-enabled' : ''}${
          isDraggingCells ? ' is-dragging' : ''
        }`}
      >
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
                onClick={() => setAddCellMenuOpen((prev) => !prev)}
                aria-label="Add cell below selected"
              >
                ＋
              </button>
              {addCellMenuOpen ? (
                <div className="header-menu add-cell-menu">
                  <div className="menu-section-label">Add below selected</div>
                  {PRIMARY_INSERT_CELL_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      className="menu-item"
                      onClick={() => insertCellBelowActive(option.type)}
                    >
                      {option.label}
                    </button>
                  ))}
                  <div className="menu-section-label">More blocks</div>
                  {SECONDARY_INSERT_CELL_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      className="menu-item menu-item-secondary"
                      onClick={() => insertCellBelowActive(option.type)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className={`button header-action-button${hasRunningCells ? ' danger is-stop' : ''}`}
              data-testid="runtime-toggle-button"
              aria-label={hasRunningCells ? 'Stop Runtime' : 'Run All'}
              onClick={() => {
                if (hasRunningCells) {
                  void stopNotebookRuntimeExecution();
                  return;
                }
                void runAllCells();
              }}
              disabled={status === 'connecting'}
            >
              <span className="header-action-icon" aria-hidden="true">
                {hasRunningCells ? <StopIcon /> : <RunAllIcon />}
              </span>
              <span className="header-action-label">{hasRunningCells ? 'Stop Runtime' : 'Run All'}</span>
            </button>
            <button
              ref={assistantToggleRef}
              className="button assistant-entry-button header-action-button"
              data-testid="assistant-photo-entry"
              aria-label="Import from photo"
              onClick={() => {
            if (assistantOpen && assistantEntryMode === 'photo-import') {
              setAssistantOpen(false);
              return;
            }
            openAssistantDrawer('photo-import');
              }}
            >
              <span className="header-action-icon" aria-hidden="true"><PhotoImportIcon /></span>
              <span className="header-action-label">Import from photo</span>
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
                  <button className="menu-item" onClick={() => {
                    setHeaderMenuOpen(false);
                    void connectBackend();
                  }}>
                    {activeKernel ? 'Restricted Runtime Ready' : 'Reconnect Backend'}
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      void stopNotebookRuntimeExecution();
                    }}
                    disabled={!hasRunningCells}
                  >
                    Stop Runtime
                  </button>
                  <button className="menu-item" onClick={() => {
                    setHeaderMenuOpen(false);
                    void handleRestartNotebookRuntime();
                  }}>
                    Restart Notebook Runtime
                  </button>
                  <button className="menu-item" onClick={() => {
                    setHeaderMenuOpen(false);
                    void handleDeleteNotebookRuntime();
                  }}>
                    Delete Notebook Runtime
                  </button>
                  <button className="menu-item" onClick={() => {
                    setHeaderMenuOpen(false);
                    setTrigMode((prev) => (prev === 'deg' ? 'rad' : 'deg'));
                  }}>
                    Default Math Angle Mode: {trigMode === 'deg' ? 'Degrees' : 'Radians'}
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      setDefaultMathRenderMode((prev) => (prev === 'decimal' ? 'exact' : 'decimal'));
                    }}
                  >
                    Default Math Display: {defaultMathRenderMode === 'decimal' ? 'Decimal' : 'Exact'}
                  </button>
                  <button className="menu-item" onClick={clearNotebookOutputs}>Clear Outputs</button>
                  <div className="menu-section-label">File</div>
                  <button className="menu-item" onClick={handleSaveToServer}>Save to Server</button>
                  <button className="menu-item" onClick={handleExportPdf}>Export PDF</button>
                  <button className="menu-item" onClick={handleDownloadIpynb}>Download .ipynb</button>
                  <button className="menu-item" onClick={handleDownloadSugarPy}>Download .sugarpy</button>
                  <button className="menu-item" onClick={handleImportClick}>Import notebook</button>
                  <button className="menu-item" onClick={handleNewNotebook}>New Notebook</button>
                  <div className="menu-section-label">Reference</div>
                  <a className="menu-item" href="/wiki" target="_blank" rel="noreferrer" onClick={() => setHeaderMenuOpen(false)}>
                    Open Wiki
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="workspace">
          {activeCoachmarkStep === 'add' ? (
            <OnboardingCoachmark
              testId="onboarding-coachmark-add"
              targetSelector='[data-testid="add-cell-button"]'
              title="Add your next block"
              body="Use + to add a new block. Start with Math when the task is CAS-first, symbolic, or equation-based."
              placement="bottom"
              primaryLabel="Next"
              secondaryLabel="Dismiss"
              onPrimary={advanceCoachmark}
              onSecondary={dismissCoachmarks}
            />
          ) : null}
          {activeCoachmarkStep === 'menu' ? (
            <OnboardingCoachmark
              testId="onboarding-coachmark-menu"
              targetSelector='button[aria-label="More actions"]'
              title="Start a fresh notebook"
              body="Use the ⋮ menu when you want commands like New Notebook, Import, Save, or the CAS wiki link."
              placement="bottom"
              primaryLabel="Next"
              secondaryLabel="Dismiss"
              onPrimary={advanceCoachmark}
              onSecondary={dismissCoachmarks}
            />
          ) : null}
          {activeCoachmarkStep === 'drag' ? (
            <OnboardingCoachmark
              testId="onboarding-coachmark-drag"
              targetSelector={dragCoachmarkTargetSelector}
              title="Reorder by dragging"
              body={
                dragCoachmarkUsesCellShell
                  ? 'Long press a cell, then drag to reorder it on touch devices.'
                  : 'Use the left drag handle to reorder cells. On mobile, long press a cell first and then drag.'
              }
              placement={dragCoachmarkUsesCellShell ? 'bottom' : 'right'}
              primaryLabel="Next"
              secondaryLabel="Dismiss"
              onPrimary={advanceCoachmark}
              onSecondary={dismissCoachmarks}
            />
          ) : null}
          {activeCoachmarkStep === 'math' ? (
            <OnboardingCoachmark
              testId="onboarding-coachmark-math"
              targetSelector='[data-testid="math-output"]'
              title="Rendered Math stays editable"
              body="Click the rendered Math card to reopen the raw CAS input and continue editing."
              placement="bottom"
              primaryLabel="Got it"
              secondaryLabel="Dismiss"
              onPrimary={dismissCoachmarks}
              onSecondary={dismissCoachmarks}
            />
          ) : null}
          {status === 'error' ? (
            <div className="output">
              {errorMsg}
            </div>
          ) : null}
          {runtimeNotice ? (
            <div className="runtime-notice" role="status">
              {runtimeNotice}
            </div>
          ) : null}

          <div className="notebook-stack" ref={notebookStackRef}>
            {cells.length === 0 ? (
              <div className="cell-empty">
                <div className="cell-empty-title">Start with a cell.</div>
                <div className="cell-empty-actions">
                  {PRIMARY_INSERT_CELL_OPTIONS.map((option) => (
                    <button key={option.type} className="button secondary" onClick={() => insertCellAt(0, option.type)}>
                      {option.label}
                    </button>
                  ))}
                  <div className="cell-empty-more-wrap" ref={emptyMoreBlocksRef}>
                    <button
                      type="button"
                      className="button secondary subtle"
                      aria-label="More blocks"
                      onClick={() => setEmptyMoreBlocksOpen((prev) => !prev)}
                    >
                      More blocks
                    </button>
                    {emptyMoreBlocksOpen ? (
                      <div className="cell-empty-more-menu" data-testid="cell-empty-more-menu">
                        {SECONDARY_INSERT_CELL_OPTIONS.map((option) => (
                          <button
                            key={option.type}
                            type="button"
                            className="menu-item"
                            onClick={() => {
                              setEmptyMoreBlocksOpen(false);
                              insertCellAt(0, option.type);
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {cells.length > 0 ? (
              <>
                {cells.map((cell, index) => (
                  <React.Fragment key={cell.id}>
                    {dragState?.insertionIndex === index ? (
                      <div className="cell-drop-indicator" data-testid="cell-drop-indicator" />
                    ) : null}
                    {!touchUiEnabled ? (
                      <div className="cell-divider" data-testid={`cell-divider-${index}`}>
                        <div className="cell-divider-line" />
                        <div className="divider-menu" role="menu" aria-label="Insert cell type">
                          {PRIMARY_INSERT_CELL_OPTIONS.map((option) => (
                            <button
                              key={option.type}
                              className="divider-btn"
                              onClick={() => insertCellAt(index, option.type)}
                            >
                              {option.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="divider-btn divider-btn-secondary"
                            aria-label="More blocks"
                            onClick={() => openCellInsertMenu(cell.id, 'above')}
                          >
                            ⋮
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div
                      className={`cell-row-shell${
                        cell.id === activeCellId ? ' is-active' : ''
                      }${cell.id === lastActiveCellId && cell.id !== activeCellId ? ' is-last-active' : ''}${
                        cellInsertMenu?.cellId === cell.id ? ' is-insertion-menu-open' : ''
                      }${dragState?.cellId === cell.id ? ' is-drag-source' : ''}`}
                      ref={cellInsertMenu?.cellId === cell.id ? cellInsertMenuShellRef : null}
                      data-cell-id={cell.id}
                      onClickCapture={(event) => {
                        if (dragClickSuppressedCellIdRef.current !== cell.id) return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onPointerDownCapture={(event) => {
                        if (event.pointerType !== 'touch') return;
                        if (isInteractiveDragTarget(event.target)) return;
                        beginTouchDragPending(cell.id, event);
                      }}
                    >
                      {!touchUiEnabled || wideTouchRailEnabled ? (
                        <div className="cell-row-rail">
                          <button
                            type="button"
                            className="cell-row-add-btn"
                            aria-label="Insert block"
                            onClick={(event) => {
                              event.stopPropagation();
                              const placement = event.altKey ? 'above' : 'below';
                              if (cellInsertMenu?.cellId === cell.id && cellInsertMenu.placement === placement) {
                                closeCellInsertMenu();
                              } else {
                                openCellInsertMenu(cell.id, placement);
                              }
                            }}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="cell-row-drag-btn"
                            aria-label="Drag to reorder"
                            onPointerDown={(event) => beginHandleDrag(cell.id, event)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                          >
                            ⋮⋮
                          </button>
                        </div>
                      ) : null}
                      <NotebookCell
                        cell={cell}
                        isActive={cell.id === activeCellId}
                        isLastActive={cell.id === lastActiveCellId}
                        onActivate={() => activateCell(cell.id)}
                        onAddAbove={() => insertSiblingCell(cell.id, 'above')}
                        onAddBelow={() => insertSiblingCell(cell.id, 'below')}
                        onChange={(value) => updateCell(cell.id, value)}
                        onRun={(value) => runCell(cell.id, value)}
                        onStop={() => {
                          void stopNotebookRuntimeExecution();
                        }}
                        onRunMath={(value) =>
                          runMathCell(
                            cell.id,
                            value,
                            cell.mathRenderMode ?? defaultMathRenderMode,
                            cell.mathTrigMode ?? trigMode
                          )
                        }
                        onRunStoich={(state) => runStoichCell(cell.id, state)}
                        onChangeStoich={(state) => updateStoichState(cell.id, state)}
                        onRunRegression={(state) => runRegressionCell(cell.id, state)}
                        onChangeRegression={(state) => updateRegressionState(cell.id, state)}
                        onMoveUp={() => setCells((prev) => moveCellUp(prev, cell.id))}
                        onMoveDown={() => setCells((prev) => moveCellDown(prev, cell.id))}
                        onDelete={() => setCells((prev) => deleteCell(prev, cell.id))}
                        onToggleOutput={() => toggleCellOutputCollapsed(cell.id)}
                        onClearOutput={() => clearCellOutput(cell.id)}
                        onToggleMathView={() => toggleMathView(cell.id)}
                        onShowMathRendered={() => showMathRenderedView(cell.id)}
                        suggestions={getCodeSuggestions(cell.id)}
                        slashCommands={slashCommands}
                        onSlashCommand={(command) => handleSlashCommand(cell.id, command)}
                        mathSuggestions={getMathSuggestions(cell.id)}
                        trigMode={trigMode}
                        kernelReady={!!activeKernel}
                        onSetMathRenderMode={(mode) => {
                          setCells((prev) =>
                            prev.map((entry) => (entry.id === cell.id ? { ...entry, mathRenderMode: mode } : entry))
                          );
                        }}
                        onSetMathTrigMode={(mode) => {
                          setCells((prev) =>
                            prev.map((entry) => (entry.id === cell.id ? { ...entry, mathTrigMode: mode } : entry))
                          );
                          if (cell.source.trim()) {
                            void runMathCell(
                              cell.id,
                              cell.source,
                              cell.mathRenderMode ?? defaultMathRenderMode,
                              mode,
                              true
                            );
                          }
                        }}
                      />
                      {cellInsertMenu?.cellId === cell.id ? (
                        <div className="cell-insert-menu" ref={cellInsertMenuRef}>
                          <input
                            className="input slim cell-insert-search"
                            value={cellInsertMenuQuery}
                            onChange={(event) => setCellInsertMenuQuery(event.target.value)}
                            placeholder="Search blocks"
                            aria-label="Search blocks"
                            autoFocus
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          />
                          <div className="cell-insert-menu-list" role="menu" aria-label="Insert block type">
                            {filteredPrimaryInsertOptions.length > 0 ? (
                              <div className="cell-insert-menu-group">
                                <div className="cell-insert-menu-label">Core blocks</div>
                                {filteredPrimaryInsertOptions.map((option) => (
                                  <button
                                    key={option.type}
                                    type="button"
                                    className="cell-insert-menu-item"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      insertCellFromMenu(cell.id, option.type);
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {filteredSecondaryInsertOptions.length > 0 ? (
                              <div className="cell-insert-menu-group">
                                <div className="cell-insert-menu-label">More blocks</div>
                                {filteredSecondaryInsertOptions.map((option) => (
                                  <button
                                    key={option.type}
                                    type="button"
                                    className="cell-insert-menu-item cell-insert-menu-item-secondary"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      insertCellFromMenu(cell.id, option.type);
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {filteredCellInsertOptions.length === 0 ? (
                              <div className="cell-insert-menu-empty">No matching blocks.</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </React.Fragment>
                ))}
                {dragState?.insertionIndex === cells.length ? (
                  <div className="cell-drop-indicator" data-testid="cell-drop-indicator" />
                ) : null}
                {!touchUiEnabled ? (
                  <div className="cell-divider" data-testid={`cell-divider-${cells.length}`}>
                    <div className="cell-divider-line" />
                    <div className="divider-menu" role="menu" aria-label="Insert cell type">
                      {PRIMARY_INSERT_CELL_OPTIONS.map((option) => (
                        <button
                          key={option.type}
                          className="divider-btn"
                          onClick={() => insertCellAt(cells.length, option.type)}
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="divider-btn divider-btn-secondary"
                        aria-label="More blocks"
                        onClick={() => {
                          const lastCell = cells[cells.length - 1];
                          if (lastCell) openCellInsertMenu(lastCell.id, 'below');
                        }}
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {dragState && draggedCell ? (
            <div
              className="cell-drag-ghost"
              data-testid="cell-drag-ghost"
              style={{
                left: `${dragState.clientX}px`,
                top: `${dragState.clientY}px`
              }}
            >
              <div className="cell-drag-ghost-head">
                <span className="cell-drag-ghost-type">{draggedCellLabel}</span>
                <span className="cell-drag-ghost-index">{dragState.insertionIndex + 1}</span>
              </div>
              {draggedCellSummary ? <div className="cell-drag-ghost-text">{draggedCellSummary}</div> : null}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ipynb,.sugarpy,.sugarpy.json,application/json"
            onChange={handleImportFile}
            className="file-input"
          />
        </main>
        <div ref={assistantDrawerRef}>
          <AssistantDrawer
            open={assistantOpen}
            entryMode={assistantEntryMode}
            activeSection={assistantDrawerSection}
            apiKey={assistantApiKey}
            hasDefaultApiKey={assistantDefaultProviderAvailable}
            model={assistantModel}
            thinkingLevel={assistantThinkingLevel}
            draft={assistantDraft}
            loading={assistantLoading}
            error={assistantError}
            chats={assistantChats}
            activeChatId={assistantActiveChatId}
            photoImportPreparing={assistantPhotoImportPreparing}
            photoImport={
              assistantPhotoImport
                ? {
                    items: assistantPhotoImport.items.map((item) => ({
                      id: item.id,
                      kind: item.kind,
                      fileName: item.sourceFileName,
                      displayName: item.displayName,
                      mimeType: item.mimeType,
                      previewUrl: item.dataUrl,
                      width: item.width,
                      height: item.height,
                      pageNumber: item.pageNumber
                    })),
                    instructions: assistantPhotoImport.instructions
                  }
                : null
            }
            onClose={() => setAssistantOpen(false)}
            onChangeSection={setAssistantDrawerSection}
            onChangeApiKey={setAssistantApiKey}
            onChangeModel={setAssistantModel}
            onChangeThinkingLevel={setAssistantThinkingLevel}
            onChangeDraft={setAssistantDraft}
            onSelectPhotoFiles={(files) => {
              void handleSelectAssistantPhotos(files);
            }}
            onRemovePhotoItem={(id) => {
              setAssistantPhotoImport((prev) => {
                if (!prev) return prev;
                const items = prev.items.filter((item) => item.id !== id);
                if (items.length === 0) {
                  setAssistantDrawerSection('hub');
                  return null;
                }
                return { ...prev, items };
              });
            }}
            onExtractPhoto={() => {
              void runAssistantPhotoImport({ instructionOverride: assistantDraft });
            }}
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
            onSelectChat={(chatId) => {
              setAssistantActiveChatId(chatId);
              setAssistantDrawerSection('hub');
            }}
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
