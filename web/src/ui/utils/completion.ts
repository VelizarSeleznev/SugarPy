import { CompletionContext } from '@codemirror/autocomplete';

export function buildCompletionSource(list: { label: string; detail?: string }[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (word && word.from > 0) {
      const prev = context.state.doc.sliceString(word.from - 1, word.from);
      if (prev === '/') return null;
    }
    if (!word && !context.explicit) return null;
    return {
      from: word ? word.from : context.pos,
      options: list.map((item) => ({
        label: item.label,
        detail: item.detail,
        type: 'function'
      }))
    };
  };
}

export function buildSlashCompletionSource(list: { label: string; detail?: string }[]) {
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
        type: 'function'
      }))
    };
  };
}
