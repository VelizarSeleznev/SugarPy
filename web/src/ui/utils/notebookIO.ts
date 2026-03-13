import { CellModel, CellOutput } from '../App';

export type SugarPyNotebookV1 = {
  version: 1;
  id: string;
  name: string;
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode?: 'exact' | 'decimal';
  cells: Array<Omit<CellModel, 'isRunning'>>;
  updatedAt: string;
};

const STORAGE_PREFIX = 'sugarpy:notebook:v1:';
const LAST_OPEN_KEY = 'sugarpy:last-open';

export type LocalStorageSaveResult =
  | {
      ok: true;
      stored: 'local-autosave';
    }
  | {
      ok: false;
      stored: 'none';
      reason: 'storage-unavailable' | 'quota-exceeded' | 'write-failed';
    };

const normalizeCells = (cells: CellModel[]): Array<Omit<CellModel, 'isRunning'>> =>
  cells.map(({ isRunning, ...rest }) => rest);

const asText = (value: unknown) => {
  if (Array.isArray(value)) return value.join('');
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeOutput = (output: unknown): CellOutput | undefined => {
  if (!output) return undefined;
  if (typeof output === 'string') {
    return { type: 'mime', data: { 'text/plain': output } };
  }
  if (typeof output !== 'object') return undefined;
  const raw = output as any;
  if (raw.type === 'error') {
    return {
      type: 'error',
      ename: String(raw.ename ?? 'Error'),
      evalue: String(raw.evalue ?? ''),
    };
  }
  if (raw.type === 'mime' && raw.data && typeof raw.data === 'object') {
    return { type: 'mime', data: raw.data as Record<string, unknown> };
  }
  return undefined;
};

export const createNotebookId = () => `nb-${Date.now()}`;

export const getStorageKey = (id: string) => `${STORAGE_PREFIX}${id}`;

const readStorageItem = (key: string): string | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
};

export const writeStorageItem = (key: string, value: string): LocalStorageSaveResult => {
  if (typeof localStorage === 'undefined') {
    return { ok: false, stored: 'none', reason: 'storage-unavailable' };
  }
  try {
    localStorage.setItem(key, value);
    return { ok: true, stored: 'local-autosave' };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    const isQuotaExceeded =
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      message.toLowerCase().includes('exceeded the quota');
    return {
      ok: false,
      stored: 'none',
      reason: isQuotaExceeded ? 'quota-exceeded' : 'write-failed'
    };
  }
};

export const removeStorageItem = (key: string) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch (_err) {
    // Ignore storage failures so UI state persistence never becomes fatal.
  }
};

export const loadLastOpenId = (): string | null => {
  return readStorageItem(LAST_OPEN_KEY);
};

export const saveLastOpenId = (id: string) => {
  return writeStorageItem(LAST_OPEN_KEY, id);
};

const listNotebookStorageKeys = () => {
  if (typeof localStorage === 'undefined') return [] as string[];
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keys.push(key);
      }
    }
    return keys;
  } catch (_err) {
    return [] as string[];
  }
};

export const pruneLocalNotebookSnapshots = (keepId?: string | null) => {
  const keepKey = keepId ? getStorageKey(keepId) : null;
  for (const key of listNotebookStorageKeys()) {
    if (keepKey && key === keepKey) continue;
    removeStorageItem(key);
  }
};

export const serializeSugarPy = (params: {
  id: string;
  name: string;
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  cells: CellModel[];
}): SugarPyNotebookV1 => ({
  version: 1,
  id: params.id,
  name: params.name,
  trigMode: params.trigMode,
  defaultMathRenderMode: params.defaultMathRenderMode,
  cells: normalizeCells(params.cells),
  updatedAt: new Date().toISOString()
});

export const deserializeSugarPy = (data: SugarPyNotebookV1) => ({
  id: data.id,
  name: data.name,
  trigMode: data.trigMode,
  defaultMathRenderMode: data.defaultMathRenderMode === 'decimal' ? 'decimal' : 'exact',
  cells: data.cells.map((cell) => ({
    ...cell,
    output: normalizeOutput((cell as any).output),
    ui: {
      outputCollapsed: cell.ui?.outputCollapsed ?? false,
      ...(cell.type === 'math'
        ? {
            mathView:
              cell.ui?.mathView === 'rendered' || cell.mathOutput
                ? 'rendered'
                : 'source'
          }
        : {})
    },
    isRunning: false
  }))
});

const stripRuntimeOutputs = (cell: Omit<CellModel, 'isRunning'>): Omit<CellModel, 'isRunning'> => {
  const nextCell: Omit<CellModel, 'isRunning'> = { ...cell };
  delete nextCell.output;
  delete nextCell.mathOutput;
  delete nextCell.stoichOutput;
  return nextCell;
};

const createLocalAutosaveSnapshot = (notebook: SugarPyNotebookV1): SugarPyNotebookV1 => ({
  ...notebook,
  cells: notebook.cells.map(stripRuntimeOutputs)
});

export const saveToLocalStorage = (notebook: SugarPyNotebookV1): LocalStorageSaveResult => {
  const snapshot = createLocalAutosaveSnapshot(notebook);
  const writeResult = writeStorageItem(getStorageKey(notebook.id), JSON.stringify(snapshot));
  if (!writeResult.ok) {
    return writeResult;
  }
  pruneLocalNotebookSnapshots(notebook.id);
  const lastOpenResult = saveLastOpenId(notebook.id);
  return lastOpenResult.ok ? writeResult : lastOpenResult;
};

export const loadFromLocalStorage = (id: string): SugarPyNotebookV1 | null => {
  const raw = readStorageItem(getStorageKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SugarPyNotebookV1;
  } catch (err) {
    return null;
  }
};

const toLines = (text: string) => {
  if (!text) return [];
  const lines = text.split('\n');
  return lines.map((line, idx) => (idx === lines.length - 1 ? line : `${line}\n`));
};

const fromLines = (source: string[] | string) => {
  if (Array.isArray(source)) return source.join('');
  return source ?? '';
};

const formatSig = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (value === 0) return '0';
  const formatted = Number(value).toPrecision(4);
  return formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const formatCoeffLabel = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  if (Math.abs(value - 1) < 1e-9) return '';
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return formatSig(value);
};

const stoichToMarkdown = (cell: CellModel) => {
  const output = cell.stoichOutput;
  const reaction = output?.balanced ?? cell.stoichState?.reaction ?? '';
  const lines = ['### Stoichiometry Table', '', reaction, ''];
  if (!output?.species?.length) {
    lines.push('_No data._');
    return lines.join('\n');
  }
  const headers = output.species.map(
    (row) => `${formatCoeffLabel(row.coeff)}${row.name}`
  );
  const separator = headers.map(() => '---');
  const pickValue = (input?: number | null, calc?: number | null) =>
    input !== null && input !== undefined ? input : calc;

  lines.push(`|  | ${headers.join(' | ')} |`);
  lines.push(`| --- | ${separator.join(' | ')} |`);
  lines.push(
    `| m (g) | ${output.species
      .map((row) => formatSig(pickValue(row.input_m ?? null, row.calc_m ?? null)))
      .join(' | ')} |`
  );
  lines.push(
    `| M (g/mol) | ${output.species
      .map((row) => formatSig(row.molar_mass ?? null))
      .join(' | ')} |`
  );
  lines.push(
    `| n (mol) | ${output.species
      .map((row) => formatSig(pickValue(row.input_n ?? null, row.calc_n ?? null)))
      .join(' | ')} |`
  );
  return lines.join('\n');
};

export const serializeIpynb = (params: {
  id: string;
  name: string;
  trigMode: 'deg' | 'rad';
  defaultMathRenderMode: 'exact' | 'decimal';
  cells: CellModel[];
}) => {
  const cells = params.cells.map((cell) => {
    if (cell.type === 'stoich') {
      return {
        cell_type: 'markdown',
        metadata: {
          sugarpy: {
            type: 'stoich',
            stoichState: cell.stoichState ?? null,
            stoichOutput: cell.stoichOutput ?? null
          }
        },
        source: toLines(stoichToMarkdown(cell))
      };
    }
    if (cell.type === 'markdown') {
      return {
        cell_type: 'markdown',
        metadata: {},
        source: toLines(cell.source)
      };
    }
    if (cell.type === 'math') {
      return {
        cell_type: 'markdown',
        metadata: {
          sugarpy: {
            type: 'math',
            mathOutput: cell.mathOutput ?? null,
            mathRenderMode: cell.mathRenderMode ?? 'exact',
            mathTrigMode: cell.mathTrigMode ?? params.trigMode
          }
        },
        source: toLines(cell.source)
      };
    }
    const outputs = (() => {
      if (!cell.output) return [];
      if (cell.output.type === 'error') {
        return [
          {
            output_type: 'error',
            ename: cell.output.ename,
            evalue: cell.output.evalue,
            traceback: []
          }
        ];
      }
      return [
        {
          output_type: 'display_data',
          data: cell.output.data,
          metadata: {}
        }
      ];
    })();
    return {
      cell_type: 'code',
      metadata: {},
      source: toLines(cell.source),
      outputs,
      execution_count: cell.execCount ?? null
    };
  });

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      sugarpy: {
        version: 1,
        id: params.id,
        name: params.name,
        trigMode: params.trigMode,
        defaultMathRenderMode: params.defaultMathRenderMode
      }
    },
    cells
  };
};

export const deserializeIpynb = (data: any) => {
  const metadata = data?.metadata?.sugarpy ?? {};
  const cells: CellModel[] = (data?.cells ?? []).map((cell: any, idx: number) => {
    const sugarpy = cell?.metadata?.sugarpy;
    if (sugarpy?.type === 'stoich') {
      return {
        id: `cell-${Date.now()}-${idx}`,
        source: fromLines(cell?.source ?? ''),
        type: 'stoich',
        stoichState: sugarpy.stoichState ?? { reaction: '', inputs: {} },
        stoichOutput: sugarpy.stoichOutput ?? undefined,
        ui: {
          outputCollapsed: false
        },
        isRunning: false
      };
    }
    if (sugarpy?.type === 'math') {
      return {
        id: `cell-${Date.now()}-${idx}`,
        source: fromLines(cell?.source ?? ''),
        type: 'math',
        mathOutput: sugarpy.mathOutput ?? undefined,
        mathRenderMode:
          sugarpy.mathRenderMode === 'decimal'
            ? 'decimal'
            : metadata.defaultMathRenderMode === 'decimal'
              ? 'decimal'
              : 'exact',
        mathTrigMode: sugarpy.mathTrigMode === 'rad' ? 'rad' : metadata.trigMode === 'rad' ? 'rad' : 'deg',
        ui: {
          outputCollapsed: false,
          mathView: sugarpy.mathOutput ? 'rendered' : 'source'
        },
        isRunning: false
      };
    }
    if (cell?.cell_type === 'markdown') {
      return {
        id: `cell-${Date.now()}-${idx}`,
        source: fromLines(cell?.source ?? ''),
        type: 'markdown',
        ui: {
          outputCollapsed: false
        },
        isRunning: false
      };
    }
    const outputs = cell?.outputs ?? [];
    let parsedOutput: CellOutput | undefined = undefined;
    const mimeData: Record<string, unknown> = {};
    for (const out of outputs) {
      if (out?.output_type === 'error') {
        parsedOutput = {
          type: 'error',
          ename: String(out?.ename ?? 'Error'),
          evalue: String(out?.evalue ?? '')
        };
        break;
      }
      if (out?.output_type === 'stream') {
        const existing = asText(mimeData['text/plain']);
        mimeData['text/plain'] = `${existing}${fromLines(out.text ?? '')}`;
      }
      if (out?.output_type === 'display_data' || out?.output_type === 'execute_result') {
        const data = out?.data ?? {};
        Object.entries(data).forEach(([mime, value]) => {
          if (mime === 'text/plain') {
            const existing = asText(mimeData['text/plain']);
            mimeData['text/plain'] = `${existing}${asText(value)}`;
          } else {
            mimeData[mime] = value as unknown;
          }
        });
      }
    }
    if (!parsedOutput && Object.keys(mimeData).length > 0) {
      parsedOutput = { type: 'mime', data: mimeData };
    }
    return {
      id: `cell-${Date.now()}-${idx}`,
      source: fromLines(cell?.source ?? ''),
      type: 'code',
      output: parsedOutput,
      execCount: cell?.execution_count ?? undefined,
      ui: {
        outputCollapsed: false
      },
      isRunning: false
    };
  });

  return {
    id: metadata.id ?? createNotebookId(),
    name: metadata.name ?? 'Untitled',
    trigMode: metadata.trigMode === 'rad' ? 'rad' : 'deg',
    defaultMathRenderMode: metadata.defaultMathRenderMode === 'decimal' ? 'decimal' : 'exact',
    cells
  };
};

export const downloadBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsText(file);
  });
