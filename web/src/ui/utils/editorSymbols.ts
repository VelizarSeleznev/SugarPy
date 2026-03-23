export type EditorCompletionItem = {
  label: string;
  detail?: string;
  type?: 'function' | 'variable' | 'class' | 'module' | 'keyword' | 'constant';
  snippet?: string;
  boost?: number;
};

const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
]);

const MATH_RESERVED = new Set([
  'Eq',
  'N',
  'and',
  'abs',
  'acos',
  'asin',
  'atan',
  'cos',
  'e',
  'exp',
  'expand',
  'factor',
  'or',
  'ln',
  'log',
  'not',
  'pi',
  'plot',
  'render_decimal',
  'render_exact',
  'set_decimal_places',
  'simplify',
  'sin',
  'solve',
  'sqrt',
  'subs',
  'tan',
  'True',
  'False',
  'None'
]);

const addCompletion = (
  items: Map<string, EditorCompletionItem>,
  item: EditorCompletionItem | null | undefined
) => {
  if (!item?.label) return;
  const current = items.get(item.label);
  if (!current) {
    items.set(item.label, item);
    return;
  }
  items.set(item.label, {
    ...current,
    ...item,
    boost: Math.max(current.boost ?? 0, item.boost ?? 0)
  });
};

const addTargetNames = (
  rawTarget: string,
  items: Map<string, EditorCompletionItem>,
  boost: number,
  detail: string,
  type: EditorCompletionItem['type'] = 'variable'
) => {
  const matches = rawTarget.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  matches.forEach((name) => {
    if (PYTHON_KEYWORDS.has(name) || MATH_RESERVED.has(name)) return;
    addCompletion(items, { label: name, detail, type, boost });
  });
};

export function extractCodeSymbols(source: string, boost = 500): EditorCompletionItem[] {
  const items = new Map<string, EditorCompletionItem>();

  source.replace(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/gm, (_match, name, args) => {
    addCompletion(items, {
      label: name,
      detail: 'function',
      type: 'function',
      snippet: `${name}(\${})`,
      boost: boost + 40
    });
    return _match;
  });

  source.replace(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm, (_match, name) => {
    addCompletion(items, {
      label: name,
      detail: 'class',
      type: 'class',
      boost: boost + 20
    });
    return _match;
  });

  source.replace(/^\s*(?:from\s+[A-Za-z0-9_.,\s]+\s+import\s+)(.+)$/gm, (_match, clause) => {
    clause
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const aliasMatch = entry.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
        if (!aliasMatch) return;
        addCompletion(items, {
          label: aliasMatch[2] || aliasMatch[1],
          detail: 'import',
          type: 'module',
          boost: boost + 10
        });
      });
    return _match;
  });

  source.replace(/^\s*import\s+(.+)$/gm, (_match, clause) => {
    clause
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const aliasMatch = entry.match(/^([A-Za-z_][A-Za-z0-9_.]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
        if (!aliasMatch) return;
        const moduleName = aliasMatch[2] || aliasMatch[1].split('.')[0];
        addCompletion(items, {
          label: moduleName,
          detail: 'module',
          type: 'module',
          boost: boost + 10
        });
      });
    return _match;
  });

  source.replace(/^\s*for\s+(.+?)\s+in\s+/gm, (_match, target) => {
    addTargetNames(target, items, boost, 'loop variable');
    return _match;
  });

  source.replace(/^\s*([A-Za-z_][A-Za-z0-9_,()[\] \t]*)\s*=\s*(?!=)/gm, (_match, target) => {
    addTargetNames(target, items, boost, 'variable');
    return _match;
  });

  return Array.from(items.values());
}

const splitMathTargets = (lhs: string) => lhs.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

export function extractMathSymbols(source: string, boost = 500): EditorCompletionItem[] {
  const items = new Map<string, EditorCompletionItem>();

  source.replace(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:=/gm, (_match, name) => {
    addCompletion(items, {
      label: name,
      detail: 'math function',
      type: 'function',
      snippet: `${name}(\${})`,
      boost: boost + 40
    });
    return _match;
  });

  source.replace(/^\s*(.+?)\s*:=/gm, (_match, lhs) => {
    splitMathTargets(lhs).forEach((name) => {
      if (MATH_RESERVED.has(name)) return;
      addCompletion(items, {
        label: name,
        detail: 'math symbol',
        type: 'variable',
        boost: boost + 20
      });
    });
    return _match;
  });

  const seen = new Set<string>();
  const identifierMatches = source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  identifierMatches.forEach((name) => {
    if (MATH_RESERVED.has(name) || seen.has(name)) return;
    seen.add(name);
    addCompletion(items, {
      label: name,
      detail: 'identifier',
      type: 'variable',
      boost
    });
  });

  return Array.from(items.values());
}

const sortItems = (items: Iterable<EditorCompletionItem>) =>
  Array.from(items).sort((a, b) => {
    const boostDelta = (b.boost ?? 0) - (a.boost ?? 0);
    if (boostDelta !== 0) return boostDelta;
    return a.label.localeCompare(b.label);
  });

export function mergeEditorCompletions(...groups: EditorCompletionItem[][]): EditorCompletionItem[] {
  const merged = new Map<string, EditorCompletionItem>();
  groups.flat().forEach((item) => addCompletion(merged, item));
  return sortItems(merged.values());
}
