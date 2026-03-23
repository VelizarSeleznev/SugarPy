import { CompletionContext, snippet } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

import { type EditorCompletionItem, mergeEditorCompletions } from './editorSymbols';

const toSnippetTemplate = (value: string) => value.replace('__CURSOR__', '${}');

const applyCompletion = (
  view: EditorView,
  item: EditorCompletionItem,
  from: number,
  to: number
) => {
  if (item.snippet) {
    snippet(toSnippetTemplate(item.snippet))(view, null, from, to);
    return;
  }
  view.dispatch({
    changes: { from, to, insert: item.label },
    selection: { anchor: from + item.label.length }
  });
};

export function buildCompletionSource(
  list: EditorCompletionItem[],
  extractSymbols?: (source: string) => EditorCompletionItem[]
) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (word && word.from > 0) {
      const prev = context.state.doc.sliceString(word.from - 1, word.from);
      if (prev === '/') return null;
    }
    if (!word && !context.explicit) return null;
    const currentSource = context.state.doc.sliceString(0, context.pos);
    const dynamicItems = extractSymbols ? extractSymbols(currentSource) : [];
    const items = mergeEditorCompletions(dynamicItems, list);
    return {
      from: word ? word.from : context.pos,
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: item.type ?? 'function',
        boost: item.boost ?? 0,
        apply: item.snippet
          ? (view: EditorView, _completion: unknown, from: number, to: number) =>
              applyCompletion(view, item, from, to)
          : undefined
      }))
    };
  };
}

export function buildSlashCompletionSource(list: EditorCompletionItem[]) {
  return (context: CompletionContext) => {
    const doc = context.state.doc.toString();
    const trimmed = doc.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return null;
    }
    if (!/^\/[A-Za-z0-9_]*$/.test(trimmed)) {
      return null;
    }
    const word = context.matchBefore(/\/[A-Za-z0-9_]*$/);
    if (!word && !context.explicit) return null;
    if (!word) return null;
    return {
      from: word.from + 1,
      options: list.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: item.type ?? 'function',
        boost: item.boost ?? 0
      }))
    };
  };
}
