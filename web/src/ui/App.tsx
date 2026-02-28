import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ContentsManager, KernelManager, ServerConnection } from '@jupyterlab/services';

import { FunctionEntry, useFunctionLibrary } from './hooks/useFunctionLibrary';
import { NotebookCell } from './components/NotebookCell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildSuggestions } from './utils/suggestUtils';
import { extractFunctionNames } from './utils/functionParse';
import { insertCellAbove, insertCellBelow, moveCellDown, moveCellUp, deleteCell } from './utils/cellOps';
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

export type CellModel = {
  id: string;
  source: string;
  output?: CellOutput;
  type?: 'code' | 'markdown' | 'math' | 'stoich';
  execCount?: number;
  isRunning?: boolean;
  mathOutput?: {
    steps: string[];
    value?: string;
    error?: string;
    mode: 'deg' | 'rad';
  };
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
  type: 'code'
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

function App() {
  const [serverUrl, setServerUrl] = useState(import.meta.env.VITE_JUPYTER_URL || 'http://localhost:8888');
  const [token, setToken] = useState(import.meta.env.VITE_JUPYTER_TOKEN || 'sugarpy');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [kernel, setKernel] = useState<any>(null);
  const [cells, setCells] = useState<CellModel[]>([defaultCell]);
  const { functions, allFunctions, subjects, search, setSearch, subject, setSubject } = useFunctionLibrary();
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false);
  const [userFunctions, setUserFunctions] = useState<string[]>([]);
  const [execCounter, setExecCounter] = useState(0);
  const [trigMode, setTrigMode] = useState<'deg' | 'rad'>('deg');
  const [notebookId, setNotebookId] = useState(createNotebookId());
  const [notebookName, setNotebookName] = useState('Untitled');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
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
    ],
    []
  );
  const connectOnce = useRef(false);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const hydrated = useRef(false);
  const lastSnapshot = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
      ...buildSuggestions(functions),
      ...userFunctions.map((name) => ({ label: name, detail: 'user function' }))
    ],
    [functions, userFunctions]
  );

  const connectKernel = async () => {
    if (status === 'connecting' || status === 'connected') return;
    setStatus('connecting');
    setErrorMsg('');
    try {
      const settings = ServerConnection.makeSettings({
        baseUrl: serverUrl,
        token,
        wsUrl: serverUrl.replace(/^http/, 'ws'),
        appendToken: true
      });
      const manager = new KernelManager({ serverSettings: settings });
      const newKernel = await manager.startNew({ name: 'python3' });
      setKernel(newKernel);
      setBootstrapLoaded(false);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to connect.');
    }
  };

  const activeKernel = kernel;

  const buildSnapshot = (nextCells: CellModel[], nextTrigMode: 'deg' | 'rad', nextName: string, nextId: string) =>
    JSON.stringify({
      id: nextId,
      name: nextName,
      trigMode: nextTrigMode,
      cells: nextCells.map(({ isRunning, ...rest }) => rest)
    });

  useEffect(() => {
    if (connectOnce.current) return;
    connectOnce.current = true;
    connectKernel().catch(() => {
      // handled in connectKernel
    });
  }, []);

  useEffect(() => {
    const lastId = loadLastOpenId();
    if (lastId) {
      const stored = loadFromLocalStorage(lastId);
      if (stored) {
        const decoded = deserializeSugarPy(stored);
        const nextCells = decoded.cells.length > 0 ? decoded.cells : [defaultCell];
        setNotebookId(decoded.id);
        setNotebookName(decoded.name);
        setTrigMode(decoded.trigMode);
        setCells(nextCells);
        setLastSavedAt(stored.updatedAt ?? null);
        lastSnapshot.current = buildSnapshot(nextCells, decoded.trigMode, decoded.name, decoded.id);
      }
    }
    hydrated.current = true;
  }, []);

  const runCell = async (cellId: string, code: string, showOutput = true, countExecution = true) => {
    if (!activeKernel) return;
    if (showOutput) {
      setCells((prev) => {
        const exists = prev.some((c) => c.id === cellId);
        if (exists) return prev;
        return [...prev, { id: cellId, source: code, type: 'code' }];
      });
    }
    const future = activeKernel.requestExecute({ code, stop_on_error: true });
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
    const reply = await future.done;
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

  const runMathCell = async (cellId: string, source: string) => {
    if (!activeKernel) return;
    const payload = JSON.stringify({ source, mode: trigMode });
    const code = [
      'import json',
      'from sugarpy.math_cell import render_math_cell',
      `_payload = json.loads(${JSON.stringify(payload)})`,
      "_result = render_math_cell(_payload['source'], _payload['mode'])",
      "print('__SUGARPY_MATH__' + json.dumps(_result))"
    ].join('\n');

    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, isRunning: true, mathOutput: undefined } : c))
    );
    const future = activeKernel.requestExecute({ code, stop_on_error: true });
    const marker = '__SUGARPY_MATH__';
    let buffer = '';
    let parsed: CellModel['mathOutput'] | null = null;

    future.onIOPub = (msg) => {
      if (msg.header.msg_type === 'stream') {
        // @ts-ignore
        buffer += msg.content.text ?? '';
      }
      if (msg.header.msg_type === 'execute_result' || msg.header.msg_type === 'display_data') {
        // @ts-ignore
        buffer += msg.content.data?.['text/plain'] ?? '';
      }
      if (msg.header.msg_type === 'error') {
        // @ts-ignore
        const err = (msg.content.ename ?? 'Error') + ': ' + (msg.content.evalue ?? '');
        parsed = { steps: [], error: err, mode: trigMode };
      }
      const idx = buffer.lastIndexOf(marker);
      if (idx >= 0) {
        const jsonText = buffer.slice(idx + marker.length).trim();
        try {
          parsed = JSON.parse(jsonText);
        } catch (err) {
          parsed = { steps: [], error: 'Failed to parse math output.', mode: trigMode };
        }
      }
      if (parsed) {
        setCells((prev) => prev.map((c) => (c.id === cellId ? { ...c, mathOutput: parsed } : c)));
      }
    };
    await future.done;
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
      'from sugarpy.stoichiometry import render_stoichiometry',
      `_payload = json.loads(${JSON.stringify(payload)})`,
      "_result = render_stoichiometry(_payload.get('reaction', ''), _payload.get('inputs'))",
      "print('__SUGARPY_STOICH__' + json.dumps(_result))"
    ].join('\n');

    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, isRunning: true } : c))
    );

    const future = activeKernel.requestExecute({ code, stop_on_error: true });
    const marker = '__SUGARPY_STOICH__';
    let buffer = '';

    future.onIOPub = (msg) => {
      if (msg.header.msg_type === 'stream') {
        // @ts-ignore
        buffer += msg.content.text ?? '';
      }
      if (msg.header.msg_type === 'execute_result' || msg.header.msg_type === 'display_data') {
        // @ts-ignore
        buffer += msg.content.data?.['text/plain'] ?? '';
      }
    };

    await future.done;
    let parsed: StoichOutput | null = null;
    const idx = buffer.lastIndexOf(marker);
    if (idx !== -1) {
      const raw = buffer.slice(idx + marker.length).trim();
      try {
        parsed = JSON.parse(raw) as StoichOutput;
      } catch {
        parsed = { ok: false, error: 'Failed to parse stoichiometry output.', species: [] };
      }
    } else if (buffer.trim()) {
      parsed = { ok: false, error: buffer.trim(), species: [] };
    } else {
      parsed = { ok: false, error: 'No output received.', species: [] };
    }

    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId ? { ...c, stoichOutput: parsed ?? undefined, isRunning: false } : c
      )
    );
  };

  const addCell = (source = '', type: 'code' | 'markdown' | 'math' | 'stoich' = 'code') => {
    setCells((prev) => [...prev, createCell(type, source, prev.length + 1)]);
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
      type
    };
  };

  const createInitialCell = () => createCell('code');

  const blurActiveElement = () => {
    const active = document.activeElement;
    if (active && active instanceof HTMLElement) {
      active.blur();
    }
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

  const insertFunction = (snippet: string) => {
    addCell(snippet);
  };

  const insertStoichCell = () => {
    addCell('', 'stoich');
  };

  useEffect(() => {
    const bootstrap = async () => {
      if (!activeKernel || bootstrapLoaded) return;
      await runCell(`bootstrap-math-${Date.now()}`, 'import math', false, false);
      const defs = functions
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
      await runCell(`bootstrap-${Date.now()}`, defs, false, false);
      setBootstrapLoaded(true);
    };
    bootstrap();
  }, [activeKernel, bootstrapLoaded, functions]);

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
    const filename = `${notebookName || 'Untitled'}.sugarpy.json`;
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
    const settings = ServerConnection.makeSettings({
      baseUrl: serverUrl,
      token,
      wsUrl: serverUrl.replace(/^http/, 'ws'),
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
    window.print();
  };

  return (
    <ErrorBoundary>
    <div className="app">
      <aside className="panel">
        <h1 className="brand">SugarPy</h1>

        <div className="section-title">Connection</div>
        <input className="input" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
        <details>
          <summary className="subtitle">Advanced</summary>
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} />
        </details>
        <div className="connection-row">
          <button className="button" onClick={connectKernel} disabled={status === 'connecting'}>
            {activeKernel ? 'Kernel Connected' : 'Connect Kernel'}
          </button>
          <span className={`status-pill status-${status}`}>{status}</span>
        </div>
        {status === 'error' ? (
          <div className="output">
            {errorMsg}
            {'\n'}
            Check that Jupyter Server is running on {serverUrl} and the token is correct.
          </div>
        ) : null}

        <div className="section-title">Function Library</div>
        <input
          className="input"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="all">All subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {functions.map((fn) => (
          <div className="function-card" key={fn.id}>
            <h4>{fn.title}</h4>
            <div className="subtitle function-desc">{fn.description}</div>
            <div className="badges">
              <span className="badge">{fn.subject}</span>
              {fn.tags.map((tag) => (
                <span className="badge" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <button
              className="button secondary"
              onClick={() => {
                if (fn.id === 'chem.stoichiometry_table') {
                  insertStoichCell();
                } else {
                  insertFunction(fn.snippet);
                }
              }}
            >
              Insert
            </button>
          </div>
        ))}
      </aside>

      <main className="workspace">
        <div className="panel notebook-panel">
        <div className="section-title">Notebook</div>
        <div className="notebook-actions">
          <div className="notebook-meta">
            <input
              className="input"
              value={notebookName}
              onChange={(e) => setNotebookName(e.target.value)}
              placeholder="Notebook name"
            />
            <div className="subtitle">
              {lastSavedAt ? `Autosaved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved yet'}
              {dirty ? ' · editing…' : ''}
            </div>
          </div>
          <div className="notebook-buttons">
            <button className="button secondary" onClick={handleNewNotebook}>New</button>
            <button className="button" onClick={handleDownloadSugarPy}>Download .sugarpy.json</button>
            <button className="button" onClick={handleDownloadIpynb}>Download .ipynb</button>
            <button className="button" onClick={handleSaveToServer}>Save to Server</button>
            <button className="button secondary" onClick={handleImportClick}>Import</button>
            <button className="button secondary" onClick={handleExportPdf}>Export PDF</button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ipynb,.sugarpy.json"
            onChange={handleImportFile}
            className="file-input"
          />
        </div>
        <div className="trig-row">
          <span className="label-muted">Trig</span>
          <select className="select" value={trigMode} onChange={(e) => setTrigMode(e.target.value as 'deg' | 'rad')}>
            <option value="deg">Degrees</option>
            <option value="rad">Radians</option>
          </select>
        </div>
        <div className="notebook-stack">
            {cells.length > 0 ? (
              <div className="cell-insert-divider">
                <div className="cell-insert-pop" role="group" aria-label="Insert cell">
                  <button className="cell-insert-toggle" type="button" aria-label="Insert cell">+</button>
                  <div className="cell-insert-actions">
                    <button
                      className="cell-insert-btn"
                      onClick={() => {
                        setCells((prev) => insertCellAbove(prev, cells[0].id, createCell('code')));
                        blurActiveElement();
                      }}
                    >
                      + Code
                    </button>
                    <button
                      className="cell-insert-btn"
                      onClick={() => {
                        setCells((prev) => insertCellAbove(prev, cells[0].id, createCell('markdown')));
                        blurActiveElement();
                      }}
                    >
                      + Text
                    </button>
                    <button
                      className="cell-insert-btn"
                      onClick={() => {
                        setCells((prev) => insertCellAbove(prev, cells[0].id, createCell('math')));
                        blurActiveElement();
                      }}
                    >
                      + Math
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="cell-empty">
                <div className="subtitle">Your notebook is empty.</div>
                <div className="cell-insert-actions inline">
                  <button className="cell-insert-btn" onClick={() => setCells([createCell('code')])}>
                    + Code
                  </button>
                  <button className="cell-insert-btn" onClick={() => setCells([createCell('markdown')])}>
                    + Text
                  </button>
                  <button className="cell-insert-btn" onClick={() => setCells([createCell('math')])}>
                    + Math
                  </button>
                </div>
              </div>
            )}
            {cells.map((cell) => (
              <div className="notebook-item" key={cell.id}>
                <NotebookCell
                  cell={cell}
                  onChange={(value) => updateCell(cell.id, value)}
                  onRun={(value) => runCell(cell.id, value)}
                  onRunMath={(value) => runMathCell(cell.id, value)}
                  onRunStoich={(state) => runStoichCell(cell.id, state)}
                  onChangeStoich={(state) => updateStoichState(cell.id, state)}
                  onMoveUp={() => setCells((prev) => moveCellUp(prev, cell.id))}
                  onMoveDown={() => setCells((prev) => moveCellDown(prev, cell.id))}
                  onDelete={() => setCells((prev) => deleteCell(prev, cell.id))}
                  suggestions={codeSuggestions}
                  slashCommands={slashCommands}
                  onSlashCommand={(command) => handleSlashCommand(cell.id, command)}
                  mathSuggestions={mathSuggestions}
                  trigMode={trigMode}
                  kernelReady={!!activeKernel}
                />
                <div className="cell-insert-divider">
                  <div className="cell-insert-pop" role="group" aria-label="Insert cell">
                    <button className="cell-insert-toggle" type="button" aria-label="Insert cell">+</button>
                    <div className="cell-insert-actions">
                      <button
                        className="cell-insert-btn"
                        onClick={() => {
                          setCells((prev) => insertCellBelow(prev, cell.id, createCell('code')));
                          blurActiveElement();
                        }}
                      >
                        + Code
                      </button>
                      <button
                        className="cell-insert-btn"
                        onClick={() => {
                          setCells((prev) => insertCellBelow(prev, cell.id, createCell('markdown')));
                          blurActiveElement();
                        }}
                      >
                        + Text
                      </button>
                      <button
                        className="cell-insert-btn"
                        onClick={() => {
                          setCells((prev) => insertCellBelow(prev, cell.id, createCell('math')));
                          blurActiveElement();
                        }}
                      >
                        + Math
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

    </div>
    </ErrorBoundary>
  );
}

export default App;
