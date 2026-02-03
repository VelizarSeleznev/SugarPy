import { CellModel } from '../App';

export type SugarPyNotebookV1 = {
  version: 1;
  id: string;
  name: string;
  trigMode: 'deg' | 'rad';
  cells: Array<Omit<CellModel, 'isRunning'>>;
  updatedAt: string;
};

const STORAGE_PREFIX = 'sugarpy:notebook:v1:';
const LAST_OPEN_KEY = 'sugarpy:last-open';

const normalizeCells = (cells: CellModel[]): Array<Omit<CellModel, 'isRunning'>> =>
  cells.map(({ isRunning, ...rest }) => rest);

export const createNotebookId = () => `nb-${Date.now()}`;

export const getStorageKey = (id: string) => `${STORAGE_PREFIX}${id}`;

export const loadLastOpenId = (): string | null => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LAST_OPEN_KEY);
};

export const saveLastOpenId = (id: string) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_OPEN_KEY, id);
};

export const serializeSugarPy = (params: {
  id: string;
  name: string;
  trigMode: 'deg' | 'rad';
  cells: CellModel[];
}): SugarPyNotebookV1 => ({
  version: 1,
  id: params.id,
  name: params.name,
  trigMode: params.trigMode,
  cells: normalizeCells(params.cells),
  updatedAt: new Date().toISOString()
});

export const deserializeSugarPy = (data: SugarPyNotebookV1) => ({
  id: data.id,
  name: data.name,
  trigMode: data.trigMode,
  cells: data.cells.map((cell) => ({ ...cell, isRunning: false }))
});

export const saveToLocalStorage = (notebook: SugarPyNotebookV1) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(getStorageKey(notebook.id), JSON.stringify(notebook));
  saveLastOpenId(notebook.id);
};

export const loadFromLocalStorage = (id: string): SugarPyNotebookV1 | null => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(getStorageKey(id));
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
            mathOutput: cell.mathOutput ?? null
          }
        },
        source: toLines(cell.source)
      };
    }
    const outputs = cell.output
      ? [
          {
            name: 'stdout',
            output_type: 'stream',
            text: toLines(cell.output)
          }
        ]
      : [];
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
        trigMode: params.trigMode
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
        isRunning: false
      };
    }
    if (sugarpy?.type === 'math') {
      return {
        id: `cell-${Date.now()}-${idx}`,
        source: fromLines(cell?.source ?? ''),
        type: 'math',
        mathOutput: sugarpy.mathOutput ?? undefined,
        isRunning: false
      };
    }
    if (cell?.cell_type === 'markdown') {
      return {
        id: `cell-${Date.now()}-${idx}`,
        source: fromLines(cell?.source ?? ''),
        type: 'markdown',
        isRunning: false
      };
    }
    const outputs = cell?.outputs ?? [];
    const textOutput = outputs
      .map((out: any) => {
        if (out?.output_type === 'stream') return fromLines(out.text ?? '');
        if (out?.data?.['text/plain']) return fromLines(out.data['text/plain']);
        return '';
      })
      .join('');
    return {
      id: `cell-${Date.now()}-${idx}`,
      source: fromLines(cell?.source ?? ''),
      type: 'code',
      output: textOutput || undefined,
      execCount: cell?.execution_count ?? undefined,
      isRunning: false
    };
  });

  return {
    id: metadata.id ?? createNotebookId(),
    name: metadata.name ?? 'Untitled',
    trigMode: metadata.trigMode === 'rad' ? 'rad' : 'deg',
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
