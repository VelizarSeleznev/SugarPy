import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export type AssistantImportItem = {
  id: string;
  kind: 'image' | 'pdf-page';
  sourceKey: string;
  sourceFileName: string;
  displayName: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  pageNumber?: number;
  sourceSizeBytes: number;
};

export type PreparedAssistantImport =
  | {
      ok: true;
      items: AssistantImportItem[];
    }
  | {
      ok: false;
      error: string;
    };

const createImportId = () => `assistant-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const readImageDimensions = (dataUrl: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error('Failed to load image preview.'));
    image.src = dataUrl;
  });

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });

const getFileLabel = (file: File, fallback: string) => file.name?.trim() || fallback;

const toDataUrlByteLength = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] ?? '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const renderPdfPageToDataUrl = async (page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>>['promise']['getPage']>>) => {
  const baseViewport = page.getViewport({ scale: 1 });
  const maxDimension = 1600;
  const scale = Math.min(2, maxDimension / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale: Math.max(scale, 0.9) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Failed to create PDF preview canvas.');
  }
  await page.render({ canvasContext: context, viewport }).promise;
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: canvas.width,
    height: canvas.height
  };
};

export const buildFileDedupKey = (file: File) => [file.name || 'unnamed', file.size, file.lastModified, file.type || 'unknown'].join('::');

export const prepareAssistantImportFile = async (file: File, limits: {
  maxImageBytes: number;
  maxPdfPages: number;
  maxTotalBytes: number;
  currentTotalBytes: number;
}): Promise<PreparedAssistantImport> => {
  const sourceKey = buildFileDedupKey(file);
  if (file.type.startsWith('image/')) {
    if (file.size > limits.maxImageBytes) {
      return { ok: false, error: `Image "${getFileLabel(file, 'image')}" is larger than 10 MB.` };
    }
    const dataUrl = await readFileAsDataUrl(file);
    const previewBytes = toDataUrlByteLength(dataUrl);
    if (limits.currentTotalBytes + previewBytes > limits.maxTotalBytes) {
      return { ok: false, error: 'This import set is too large. Remove some pages or files before adding more.' };
    }
    const dimensions = await readImageDimensions(dataUrl);
    return {
      ok: true,
      items: [
        {
          id: createImportId(),
          kind: 'image',
          sourceKey,
          sourceFileName: getFileLabel(file, 'image'),
          displayName: getFileLabel(file, 'image'),
          mimeType: file.type || 'image/*',
          dataUrl,
          width: dimensions.width,
          height: dimensions.height,
          sourceSizeBytes: previewBytes
        }
      ]
    };
  }

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return { ok: false, error: `Unsupported file type for "${getFileLabel(file, 'file')}". Use images or PDF files.` };
  }

  const pdfBytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  if (pdf.numPages > limits.maxPdfPages) {
    await loadingTask.destroy();
    return { ok: false, error: `PDF "${getFileLabel(file, 'document')}" has ${pdf.numPages} pages. The current limit is ${limits.maxPdfPages}.` };
  }

  let totalBytes = limits.currentTotalBytes;
  const items: AssistantImportItem[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const rendered = await renderPdfPageToDataUrl(page);
      const previewBytes = toDataUrlByteLength(rendered.dataUrl);
      totalBytes += previewBytes;
      if (totalBytes > limits.maxTotalBytes) {
        return { ok: false, error: 'This import set is too large. Remove some pages or files before adding more.' };
      }
      items.push({
        id: createImportId(),
        kind: 'pdf-page',
        sourceKey,
        sourceFileName: getFileLabel(file, 'document.pdf'),
        displayName: `${getFileLabel(file, 'document.pdf')} · page ${pageNumber}`,
        mimeType: 'image/jpeg',
        dataUrl: rendered.dataUrl,
        width: rendered.width,
        height: rendered.height,
        pageNumber,
        sourceSizeBytes: previewBytes
      });
    }
    return { ok: true, items };
  } finally {
    await loadingTask.destroy();
  }
};
