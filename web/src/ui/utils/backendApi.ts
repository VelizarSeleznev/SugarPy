import type { AssistantSandboxNotebookCell, AssistantSandboxRequest, AssistantSandboxResult } from './assistantSandbox';

export type SugarPyRuntimeConfig = {
  mode?: string;
  model?: string;
  assistantTracesEnabled?: boolean;
  providers?: {
    openai?: boolean;
    gemini?: boolean;
    groq?: boolean;
  };
  execution?: {
    ephemeral?: boolean;
    networkEnabled?: boolean;
    directBrowserKernelAccess?: boolean;
    codeCellsRestricted?: boolean;
    assistantSandboxEphemeral?: boolean;
    assistantSandboxCodeCellsRestricted?: boolean;
    assistantSandboxAvailable?: boolean;
    assistantSandboxDockerOnly?: boolean;
    coldStartReplay?: boolean;
    runtimeBackend?: string;
  };
};

export type SugarPyExecutionRequest = {
  notebookId: string;
  cells: Array<Record<string, unknown>>;
  targetCellId: string;
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  timeoutMs?: number;
};

export type SugarPyExecutionResponse = {
  cellId: string;
  cellType: string;
  status: 'ok' | 'error';
  output?: {
    type: 'mime' | 'error';
    data?: Record<string, unknown>;
    ename?: string;
    evalue?: string;
  };
  mathOutput?: Record<string, unknown>;
  stoichOutput?: Record<string, unknown>;
  regressionOutput?: Record<string, unknown>;
  freshRuntime?: boolean;
  execCountIncrement?: boolean;
  replayedCellIds?: string[];
  securityProfile?: string;
  runtime?: Record<string, unknown>;
};

export type SugarPyNotebookRuntime = {
  notebookId: string;
  status: string;
  backend: string;
  containerName: string;
  workspacePath: string;
  connectionFilePath: string;
  createdAt?: string | null;
  lastActivityAt?: string | null;
  image: string;
  error?: string | null;
  interrupted?: boolean;
  freshRuntime?: boolean;
  sessionState?: string;
};

const resolveApiRoot = () => {
  const configured = (import.meta.env?.VITE_SUGARPY_API_URL || '').trim();
  if (configured) {
    return configured.replace(/\/?$/, '/');
  }
  return '/api/';
};

const API_ROOT = resolveApiRoot();

const apiUrl = (path: string) => `${API_ROOT}${path.replace(/^\/+/, '')}`;

const readCookie = (name: string) => {
  if (typeof document === 'undefined') return '';
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
};

const buildApiHeaders = (headers?: HeadersInit) => {
  const next = new Headers(headers);
  if (!next.has('Content-Type')) {
    next.set('Content-Type', 'application/json');
  }
  const xsrfToken = readCookie('_xsrf');
  if (xsrfToken && !next.has('X-XSRFToken')) {
    next.set('X-XSRFToken', xsrfToken);
  }
  return next;
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'same-origin',
    headers: buildApiHeaders(init?.headers)
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export const fetchRuntimeConfig = () => apiRequest<SugarPyRuntimeConfig>('config');

export const loadServerAutosave = (notebookId: string) =>
  apiRequest<Record<string, unknown>>(`autosave/${encodeURIComponent(notebookId)}`);

export const saveServerAutosave = (payload: Record<string, unknown>) =>
  apiRequest<Record<string, unknown>>('autosave', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const loadNotebookDocument = (notebookId: string) =>
  apiRequest<Record<string, unknown>>(`notebooks/${encodeURIComponent(notebookId)}`);

export const saveNotebookDocument = (payload: Record<string, unknown>) =>
  apiRequest<Record<string, unknown>>(`notebooks/${encodeURIComponent(String(payload.id || 'notebook'))}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const executeNotebookCell = (payload: SugarPyExecutionRequest) =>
  apiRequest<SugarPyExecutionResponse>('execute', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const getNotebookRuntimeStatus = (notebookId: string) =>
  apiRequest<SugarPyNotebookRuntime>(`runtime/${encodeURIComponent(notebookId)}`);

export const interruptNotebookRuntime = (notebookId: string) =>
  apiRequest<SugarPyNotebookRuntime>(`runtime/${encodeURIComponent(notebookId)}/interrupt`, {
    method: 'POST'
  });

export const restartNotebookRuntime = (notebookId: string) =>
  apiRequest<SugarPyNotebookRuntime>(`runtime/${encodeURIComponent(notebookId)}/restart`, {
    method: 'POST'
  });

export const deleteNotebookRuntime = (notebookId: string) =>
  apiRequest<SugarPyNotebookRuntime>(`runtime/${encodeURIComponent(notebookId)}/delete`, {
    method: 'POST'
  });

export const runAssistantSandboxRequest = (params: {
  request: AssistantSandboxRequest;
  notebookCells: AssistantSandboxNotebookCell[];
  bootstrapCode: string;
}) =>
  apiRequest<AssistantSandboxResult>('sandbox', {
    method: 'POST',
    body: JSON.stringify(params)
  });

export const persistAssistantTraceToServer = (payload: Record<string, unknown>) =>
  apiRequest<{ stored: boolean; reason?: string }>('traces', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const buildAssistantProxyBaseUrl = () => apiUrl('assistant/');
