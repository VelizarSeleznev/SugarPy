export const CODE_LANGUAGES = ['python', 'c', 'go', 'php'] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export const DEFAULT_CODE_LANGUAGE: CodeLanguage = 'python';

export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  python: 'Python',
  c: 'C',
  go: 'Go',
  php: 'PHP'
};

export const normalizeCodeLanguage = (value: unknown): CodeLanguage => {
  if (typeof value !== 'string') return DEFAULT_CODE_LANGUAGE;
  const normalized = value.trim().toLowerCase();
  if ((CODE_LANGUAGES as readonly string[]).includes(normalized)) {
    return normalized as CodeLanguage;
  }
  return DEFAULT_CODE_LANGUAGE;
};

export const isExecutableCodeLanguage = (language: CodeLanguage) =>
  language === 'python' || language === 'php';
