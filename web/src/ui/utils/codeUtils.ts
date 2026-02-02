export function findCurrentToken(text: string, cursor: number) {
  const left = text.slice(0, cursor);
  const match = left.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if (!match) {
    return { token: '', start: cursor, end: cursor };
  }
  const token = match[0];
  return { token, start: cursor - token.length, end: cursor };
}

export function insertAt(text: string, insert: string, start: number, end: number) {
  return text.slice(0, start) + insert + text.slice(end);
}
