const LATEX_LIKE_RE = /[\\_^{}]/;

const stripWrappingMath = (value: string) => value.replace(/\$/g, '');

const normalizeLatexArrows = (value: string) =>
  value
    .replace(/<->/g, '\\leftrightarrow')
    .replace(/<-+>/g, '\\leftrightarrow')
    .replace(/<-+/g, '\\leftarrow')
    .replace(/->/g, '\\rightarrow')
    .replace(/\\to\b/g, '\\rightarrow')
    .replace(/\\Rightarrow\b/g, '\\rightarrow')
    .replace(/\\Longrightarrow\b/g, '\\rightarrow')
    .replace(/\\leftrightarrow\b/g, '\\leftrightarrow');

export const looksLikeLatex = (value: string) => LATEX_LIKE_RE.test(value);

export const reactionToLatex = (value: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (looksLikeLatex(trimmed)) {
    return normalizeLatexArrows(stripWrappingMath(trimmed));
  }
  return normalizeLatexArrows(plainToLatex(trimmed));
};

const plainToLatex = (text: string) => {
  let result = '';
  let i = 0;
  let expectCoeff = true;

  const isDigit = (ch: string) => ch >= '0' && ch <= '9';

  while (i < text.length) {
    if (text.startsWith('<->', i)) {
      result += '\\leftrightarrow';
      i += 3;
      expectCoeff = true;
      continue;
    }
    if (text.startsWith('->', i)) {
      result += '\\rightarrow';
      i += 2;
      expectCoeff = true;
      continue;
    }
    if (text.startsWith('<-', i)) {
      result += '\\leftarrow';
      i += 2;
      expectCoeff = true;
      continue;
    }

    const ch = text[i];

    if (ch === '+' || ch === '=') {
      result += ch;
      i += 1;
      expectCoeff = true;
      continue;
    }

    if (expectCoeff && isDigit(ch)) {
      let j = i + 1;
      while (j < text.length && isDigit(text[j])) j += 1;
      if (j < text.length && text[j] === '.') {
        j += 1;
        while (j < text.length && isDigit(text[j])) j += 1;
      }
      result += text.slice(i, j);
      i = j;
      expectCoeff = false;
      continue;
    }

    if (!expectCoeff && isDigit(ch)) {
      let j = i + 1;
      while (j < text.length && isDigit(text[j])) j += 1;
      result += `_{${text.slice(i, j)}}`;
      i = j;
      continue;
    }

    result += ch;
    if (ch.trim()) {
      expectCoeff = false;
    }
    i += 1;
  }

  return result;
};

export const reactionToPlain = (value: string) => {
  if (!value) return '';
  let plain = stripWrappingMath(value);

  plain = plain
    .replace(/\\ce\s*\{([^}]*)\}/g, '$1')
    .replace(/\\mathrm\s*\{([^}]*)\}/g, '$1')
    .replace(/\\text\s*\{([^}]*)\}/g, '$1')
    .replace(/\\left\b/g, '')
    .replace(/\\right\b/g, '');

  plain = plain
    .replace(/\\leftrightarrow\b/g, '->')
    .replace(/\\rightleftharpoons\b/g, '->')
    .replace(/\\leftharpoons\b/g, '->')
    .replace(/\\rightarrow\b/g, '->')
    .replace(/\\to\b/g, '->')
    .replace(/\\Rightarrow\b/g, '->')
    .replace(/\\Longrightarrow\b/g, '->')
    .replace(/<->/g, '->')
    .replace(/<-+/g, '->')
    .replace(/[→⟶⟵]/g, '->');

  plain = plain
    .replace(/_\{?([0-9]+)\}?/g, '$1')
    .replace(/\^\{[^}]*\}/g, '')
    .replace(/\^[+-]?\d+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\[,;!]/g, '')
    .replace(/\\[a-zA-Z]+/g, '');

  return plain.replace(/\s+/g, ' ').trim();
};
