export function buildSuggestions(list: { id: string; title: string; signature?: string }[]) {
  return list.map((fn) => {
    const name = fn.signature ? fn.signature.split('(')[0] : fn.title;
    return { label: name, detail: fn.signature };
  });
}
