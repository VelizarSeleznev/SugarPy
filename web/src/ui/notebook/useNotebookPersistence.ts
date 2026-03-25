import { useEffect, type ChangeEvent, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { CellRecord } from '../cells/types';
import {
  loadServerAutosave as loadServerAutosaveRequest,
  saveNotebookDocument,
  saveServerAutosave as saveServerAutosaveRequest
} from '../utils/backendApi';
import {
  createNotebookId,
  deserializeIpynb,
  deserializeSugarPy,
  downloadBlob,
  loadFromLocalStorage,
  loadLastOpenId,
  pruneLocalNotebookSnapshots,
  readFileAsText,
  saveToLocalStorage,
  serializeIpynb,
  serializeSugarPy
} from '../utils/notebookIO';
import {
  FIRST_RUN_NOTEBOOK_NAME,
  getFirstRunNotebookCells,
  hasSeenOnboarding,
  loadCoachmarksDismissed,
  markOnboardingSeen,
  saveTutorialNotebookId
} from '../utils/onboarding';

type NotebookPersistenceCellType = 'code' | 'markdown' | 'math' | 'stoich' | 'regression';

type NotebookPersistenceState = {
  notebookId: string;
  notebookName: string;
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  cells: CellRecord[];
};

type UseNotebookPersistenceOptions = NotebookPersistenceState & {
  createCell: (type: NotebookPersistenceCellType, source?: string, indexSeed?: number) => CellRecord;
  activateCell: (cellId: string | null) => void;
  setNotebookId: (value: string) => void;
  setNotebookName: (value: string) => void;
  setTrigMode: (value: 'deg' | 'rad') => void;
  setDefaultMathRenderMode: (value: 'exact' | 'decimal') => void;
  setCells: Dispatch<SetStateAction<CellRecord[]>>;
  setExecCounter: (value: number) => void;
  setLastSavedAt: (value: string | null) => void;
  setDirty: (value: boolean) => void;
  setSyncMessage: (value: string) => void;
  confirmDiscard: () => boolean;
  closeMenus: () => void;
  hydratedRef: MutableRefObject<boolean>;
  lastSnapshotRef: MutableRefObject<string>;
  localAutosaveWarningShownRef: MutableRefObject<boolean>;
  autosaveTimerRef: MutableRefObject<number | undefined>;
  autosaveServerTimerRef: MutableRefObject<number | undefined>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onTutorialNotebookSeeded: (id: string) => void;
  onShowCoachmarks: () => void;
};

const getNotebookExecCounter = (cells: CellRecord[]) =>
  cells.reduce((max, cell) => {
    if (typeof cell.execCount !== 'number' || Number.isNaN(cell.execCount)) return max;
    return Math.max(max, cell.execCount);
  }, 0);

export const buildNotebookSnapshot = (state: NotebookPersistenceState) =>
  JSON.stringify({
    id: state.notebookId,
    name: state.notebookName,
    trigMode: state.trigMode,
    defaultMathRenderMode: state.defaultMathRenderMode,
    cells: state.cells.map(({ isRunning, ...rest }) => rest)
  });

const serializeNotebookState = (state: NotebookPersistenceState) =>
  serializeSugarPy({
    id: state.notebookId,
    name: state.notebookName,
    trigMode: state.trigMode,
    defaultMathRenderMode: state.defaultMathRenderMode,
    cells: state.cells
  });

const loadServerAutosave = async (id: string) => {
  try {
    const parsed = await loadServerAutosaveRequest(id);
    return parsed && (parsed as any).version === 1 ? parsed : null;
  } catch (_err) {
    return null;
  }
};

const warnLocalAutosaveFailure = (
  result: ReturnType<typeof saveToLocalStorage>,
  warningShownRef: MutableRefObject<boolean>,
  prefix: string
) => {
  if (result.ok) {
    warningShownRef.current = false;
    return;
  }
  if (warningShownRef.current) return;
  console.warn(`${prefix}: ${result.reason}`);
  warningShownRef.current = true;
};

const saveServerAutosave = async (
  state: NotebookPersistenceState,
  setSyncMessage: (value: string) => void,
  silent = false
) => {
  try {
    if (!silent) {
      setSyncMessage('Saving to server...');
    }
    const payload = serializeNotebookState(state);
    await saveServerAutosaveRequest(payload as unknown as Record<string, unknown>);
    if (!silent) {
      setSyncMessage('Saved to server autosave.');
    }
    return payload;
  } catch (_err) {
    setSyncMessage('Server autosave failed.');
    return null;
  }
};

export const useNotebookPersistence = ({
  notebookId,
  notebookName,
  trigMode,
  defaultMathRenderMode,
  cells,
  createCell,
  activateCell,
  setNotebookId,
  setNotebookName,
  setTrigMode,
  setDefaultMathRenderMode,
  setCells,
  setExecCounter,
  setLastSavedAt,
  setDirty,
  setSyncMessage,
  confirmDiscard,
  closeMenus,
  hydratedRef,
  lastSnapshotRef,
  localAutosaveWarningShownRef,
  autosaveTimerRef,
  autosaveServerTimerRef,
  fileInputRef,
  onTutorialNotebookSeeded,
  onShowCoachmarks
}: UseNotebookPersistenceOptions) => {
  const currentState: NotebookPersistenceState = {
    notebookId,
    notebookName,
    trigMode,
    defaultMathRenderMode,
    cells
  };

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const lastId = loadLastOpenId();
      pruneLocalNotebookSnapshots(lastId);
      let selected: ReturnType<typeof loadFromLocalStorage> | Awaited<ReturnType<typeof loadServerAutosave>> = null;

      if (lastId) {
        const localStored = loadFromLocalStorage(lastId);
        const serverStored = await loadServerAutosave(lastId);
        if (localStored && serverStored) {
          const localTs = Date.parse(localStored.updatedAt ?? '') || 0;
          const serverTs = Date.parse(serverStored.updatedAt ?? '') || 0;
          selected = serverTs > localTs ? serverStored : localStored;
        } else {
          selected = serverStored ?? localStored ?? null;
        }
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
        onTutorialNotebookSeeded(nextId);
        if (!loadCoachmarksDismissed()) {
          onShowCoachmarks();
        }
        selected = seeded;
      }

      if (!selected || cancelled) {
        hydratedRef.current = true;
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
      lastSnapshotRef.current = buildNotebookSnapshot({
        notebookId: decoded.id,
        notebookName: decoded.name,
        trigMode: decoded.trigMode,
        defaultMathRenderMode: decoded.defaultMathRenderMode,
        cells: nextCells
      });
      hydratedRef.current = true;
    };

    hydrate().catch(() => {
      hydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const snapshot = buildNotebookSnapshot(currentState);
    if (snapshot === lastSnapshotRef.current) return;
    setDirty(true);

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      const payload = serializeNotebookState(currentState);
      const saved = saveToLocalStorage(payload);
      warnLocalAutosaveFailure(saved, localAutosaveWarningShownRef, 'Local autosave skipped');
      setLastSavedAt(payload.updatedAt);
      lastSnapshotRef.current = snapshot;
      setDirty(false);
    }, 800);

    if (autosaveServerTimerRef.current) {
      window.clearTimeout(autosaveServerTimerRef.current);
    }
    autosaveServerTimerRef.current = window.setTimeout(() => {
      saveServerAutosave(currentState, setSyncMessage, true).then((saved) => {
        if (!saved) return;
        setLastSavedAt(saved.updatedAt);
      });
    }, 1500);
  }, [notebookId, notebookName, trigMode, defaultMathRenderMode, cells]);

  useEffect(() => {
    const flush = () => {
      if (!hydratedRef.current) return;
      const payload = serializeNotebookState(currentState);
      const saved = saveToLocalStorage(payload);
      warnLocalAutosaveFailure(saved, localAutosaveWarningShownRef, 'Local autosave skipped during flush');
      setLastSavedAt(payload.updatedAt);
      saveServerAutosave(currentState, setSyncMessage, true).then(() => undefined);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };

    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [notebookId, notebookName, trigMode, defaultMathRenderMode, cells]);

  const handleNewNotebook = () => {
    if (!confirmDiscard()) return;
    closeMenus();
    const nextId = createNotebookId();
    const nextCells: CellRecord[] = [];
    setNotebookId(nextId);
    setNotebookName('Untitled');
    setTrigMode('deg');
    setDefaultMathRenderMode('exact');
    setCells(nextCells);
    setExecCounter(0);
    activateCell(null);
    setLastSavedAt(null);
    lastSnapshotRef.current = buildNotebookSnapshot({
      notebookId: nextId,
      notebookName: 'Untitled',
      trigMode: 'deg',
      defaultMathRenderMode: 'exact',
      cells: nextCells
    });
    setDirty(false);
  };

  const handleDownloadSugarPy = () => {
    closeMenus();
    const payload = serializeNotebookState(currentState);
    const rawName = (notebookName || 'Untitled').trim();
    const normalizedName = rawName.replace(/\.sugarpy(?:\.json)?$/i, '');
    downloadBlob(
      `${normalizedName}.sugarpy`,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    );
  };

  const handleDownloadIpynb = () => {
    closeMenus();
    const payload = serializeIpynb({
      id: notebookId,
      name: notebookName,
      trigMode,
      defaultMathRenderMode,
      cells
    });
    downloadBlob(`${notebookName || 'Untitled'}.ipynb`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  };

  const handleSaveToServer = async () => {
    closeMenus();
    const payload = serializeNotebookState(currentState);
    try {
      await saveNotebookDocument(payload as unknown as Record<string, unknown>);
      await saveServerAutosave(currentState, setSyncMessage, true);
      lastSnapshotRef.current = buildNotebookSnapshot(currentState);
      setLastSavedAt(new Date().toISOString());
      setDirty(false);
    } catch (_err) {
      window.alert('Failed to save to the server.');
    }
  };

  const handleImportClick = () => {
    closeMenus();
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
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
        cells: CellRecord[];
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
      warnLocalAutosaveFailure(saved, localAutosaveWarningShownRef, 'Local autosave skipped after import');
      setLastSavedAt(payload.updatedAt);
      lastSnapshotRef.current = buildNotebookSnapshot({
        notebookId: next.id,
        notebookName: next.name || 'Untitled',
        trigMode: next.trigMode,
        defaultMathRenderMode: next.defaultMathRenderMode,
        cells: safeCells
      });
      setDirty(false);
    } catch (_err) {
      window.alert('Failed to import notebook.');
    } finally {
      event.target.value = '';
    }
  };

  const handleExportPdf = () => {
    closeMenus();
    const body = document.body;
    body.classList.add('print-mode');

    const cleanup = () => {
      body.classList.remove('print-mode');
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(() => {
      window.print();
    }, 50);
  };

  return {
    handleNewNotebook,
    handleDownloadSugarPy,
    handleDownloadIpynb,
    handleSaveToServer,
    handleImportClick,
    handleImportFile,
    handleExportPdf
  };
};
