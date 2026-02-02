export function extractFunctionNames(code: string) {
  const names = new Set<string>();
  const regex = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(code))) {
    names.add(match[1]);
  }
  return Array.from(names);
}
