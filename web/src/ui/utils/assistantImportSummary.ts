export type AssistantImportSummaryItem = {
  kind: 'image' | 'pdf-page';
  sourceFileName: string;
  displayName: string;
  pageNumber?: number;
};

export const buildAssistantImportSummary = (items: AssistantImportSummaryItem[]) => {
  const grouped = new Map<string, number[]>();
  const plainFiles = new Set<string>();
  for (const item of items) {
    if (item.kind === 'pdf-page') {
      const pages = grouped.get(item.sourceFileName) ?? [];
      if (typeof item.pageNumber === 'number') pages.push(item.pageNumber);
      grouped.set(item.sourceFileName, pages);
      continue;
    }
    plainFiles.add(item.displayName);
  }
  const labels: string[] = [...plainFiles];
  for (const [fileName, pages] of grouped.entries()) {
    const sortedPages = [...pages].sort((left, right) => left - right);
    labels.push(`${fileName} (pages ${sortedPages.join(', ')})`);
  }
  return labels.join(', ');
};
