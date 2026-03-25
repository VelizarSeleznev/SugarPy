import { useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { CellRecord } from '../cells/types';
import { createRegressionState, type RegressionState } from '../utils/regressionTypes';
import { extractCodeSymbols } from '../utils/editorSymbols';
import type { StoichState } from '../utils/stoichTypes';
import {
  deleteNotebookRuntime,
  executeNotebookCell,
  fetchRuntimeConfig,
  interruptNotebookRuntime,
  restartNotebookRuntime,
  type SugarPyExecutionResponse,
  type SugarPyRuntimeConfig
} from '../utils/backendApi';

const CELL_EXECUTION_TIMEOUT_MS = 20_000;

const isCanceledFutureError = (error: unknown) => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Canceled future for execute_request message before replies were done');
};

type UseNotebookRuntimeOptions = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  notebookId: string;
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  cells: CellRecord[];
  execCounter: number;
  setCells: Dispatch<SetStateAction<CellRecord[]>>;
  setExecCounter: Dispatch<SetStateAction<number>>;
  setUserFunctions: Dispatch<SetStateAction<string[]>>;
  setStatus: (value: 'idle' | 'connecting' | 'connected' | 'error') => void;
  setStatusDetail: (value: string) => void;
  setErrorMsg: (value: string) => void;
  setSyncMessage: (value: string) => void;
  setIsRunningAll: (value: boolean) => void;
  isRunningAll: boolean;
  setRuntimeConfig: (value: SugarPyRuntimeConfig | null) => void;
  cellsRef: MutableRefObject<CellRecord[]>;
  trigModeRef: MutableRefObject<'deg' | 'rad'>;
  renderModeRef: MutableRefObject<'exact' | 'decimal'>;
  connectingRef: MutableRefObject<boolean>;
  connectOnceRef: MutableRefObject<boolean>;
  stopRunAllRequestedRef: MutableRefObject<boolean>;
  executionGenerationRef: MutableRefObject<number>;
  closeMenus: () => void;
  activateCell: (cellId: string | null) => void;
};

export const useNotebookRuntime = ({
  status,
  notebookId,
  trigMode,
  defaultMathRenderMode,
  cells,
  execCounter,
  setCells,
  setExecCounter,
  setUserFunctions,
  setStatus,
  setStatusDetail,
  setErrorMsg,
  setSyncMessage,
  setIsRunningAll,
  isRunningAll,
  setRuntimeConfig,
  cellsRef,
  trigModeRef,
  renderModeRef,
  connectingRef,
  connectOnceRef,
  stopRunAllRequestedRef,
  executionGenerationRef,
  closeMenus,
  activateCell
}: UseNotebookRuntimeOptions) => {
  const [runtimeNotice, setRuntimeNotice] = useState('');

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

  useEffect(() => {
    if (connectOnceRef.current) return;
    connectOnceRef.current = true;
    connectBackend().catch(() => undefined);
  }, []);

  const clearRunningState = (message: string) => {
    setCells((prev) =>
      prev.map((cell) => {
        if (!cell.isRunning) return cell;
        const nextCell: CellRecord = { ...cell, isRunning: false };
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
          nextCell.stoichOutput = { ok: false, error: message, species: [] };
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
        setRuntimeNotice('Runtime restarted after interrupt. Previous outputs may be stale; rerun setup cells or use Run All.');
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
    closeMenus();
    try {
      await restartNotebookRuntime(notebookId);
      clearRunningState('Runtime restarted. Rerun setup cells or use Run All.');
      setRuntimeNotice('Runtime restarted. Previous outputs belong to the old kernel; rerun setup cells or use Run All.');
      setSyncMessage('Runtime restarted.');
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Failed to restart runtime.');
    }
  };

  const handleDeleteNotebookRuntime = async () => {
    invalidateActiveExecutions();
    closeMenus();
    try {
      await deleteNotebookRuntime(notebookId);
      clearRunningState('Runtime deleted. The next execution will start a fresh runtime.');
      setRuntimeNotice('Runtime deleted. The next run will start a fresh kernel, so existing outputs may be stale.');
      setSyncMessage('Runtime deleted.');
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Failed to delete runtime.');
    }
  };

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
              ui: { ...cell.ui, outputCollapsed: false, mathView: 'rendered' }
            };
          }
          if (response.cellType === 'stoich') {
            return {
              ...cell,
              isRunning: false,
              execCount: nextExecCount ?? cell.execCount,
              stoichOutput: response.stoichOutput as any,
              ui: { ...cell.ui, outputCollapsed: false }
            };
          }
          if (response.cellType === 'regression') {
            return {
              ...cell,
              isRunning: false,
              execCount: nextExecCount ?? cell.execCount,
              regressionOutput: response.regressionOutput as any,
              output: response.output as any,
              ui: { ...cell.ui, outputCollapsed: false }
            };
          }
          return {
            ...cell,
            isRunning: false,
            execCount: nextExecCount ?? cell.execCount,
            output: response.output as any,
            ui: { ...cell.ui, outputCollapsed: false }
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
      setRuntimeNotice('Fresh runtime started. Kernel state was reset, so rerun setup cells or use Run All.');
    }
  };

  const runCell = async (cellId: string, code: string, showOutput = true, countExecution = true) => {
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
              ui: { ...cell.ui, outputCollapsed: false }
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
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
    const cell = cells.find((entry) => entry.id === cellId);
    const renderMode = renderModeOverride ?? (cell?.mathRenderMode === 'decimal' ? 'decimal' : defaultMathRenderMode);
    const mode = trigModeOverride ?? cell?.mathTrigMode ?? trigMode;
    setCells((prev) =>
      prev.map((c) =>
        c.id === cellId
          ? {
              ...c,
              isRunning: true,
              ...(preserveOutput ? {} : { mathOutput: undefined, output: undefined }),
              ui: { ...c.ui, outputCollapsed: false }
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
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, isRunning: true, ui: { ...c.ui, outputCollapsed: false } } : c))
    );
    try {
      const nextCells = cellsRef.current.map((cell) =>
        cell.id === cellId ? { ...cell, type: 'stoich', stoichState: state } : cell
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
          c.id === cellId ? { ...c, isRunning: false, stoichOutput: { ok: false, error: String(error), species: [] } } : c
        )
      );
    }
  };

  const runRegressionCell = async (cellId: string, state: RegressionState) => {
    const executionGeneration = executionGenerationRef.current;
    setRuntimeNotice('');
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, isRunning: true, ui: { ...c.ui, outputCollapsed: false } } : c))
    );
    try {
      const nextCells = cellsRef.current.map((cell) =>
        cell.id === cellId ? { ...cell, type: 'regression', regressionState: state } : cell
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
    if (status !== 'connected') {
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
          await runMathCell(cell.id, cell.source, cell.mathRenderMode ?? defaultMathRenderMode, cell.mathTrigMode ?? trigMode);
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

  return {
    runtimeNotice,
    connectBackend,
    activeKernel: status === 'connected',
    hasRunningCells: cells.some((cell) => !!cell.isRunning),
    stopNotebookRuntimeExecution,
    handleRestartNotebookRuntime,
    handleDeleteNotebookRuntime,
    runCell,
    runMathCell,
    runStoichCell,
    runRegressionCell,
    runAllCells
  };
};
