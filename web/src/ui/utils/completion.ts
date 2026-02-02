import { CompletionContext } from '@codemirror/autocomplete';

export function buildCompletionSource(list: { label: string; detail?: string }[]) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
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
