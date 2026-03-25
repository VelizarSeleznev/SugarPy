import { DEFAULT_THEME_TOKENS, mergeThemeTokens, THEME_TOKEN_KEYS } from './tokens';
import type { ResolvedTheme, ThemeMode, ThemePreset, ThemeTokenOverrides, ThemeTokens } from './types';

const createTheme = (
  id: string,
  name: string,
  description: string,
  mode: ThemeMode,
  tokens: ThemeTokens
): ThemePreset => ({
  id,
  name,
  description,
  mode,
  tokens
});

export const BUILT_IN_THEME_PRESETS: ThemePreset[] = [
  createTheme('paper', 'Paper', 'Current SugarPy light theme.', 'light', DEFAULT_THEME_TOKENS),
  createTheme(
    'studio',
    'Studio',
    'A warmer light theme with softer surfaces and a more editorial feel.',
    'light',
    mergeThemeTokens(DEFAULT_THEME_TOKENS, {
      appBackground: '#FAF7F1',
      pageBackgroundStart: '#FFFDF8',
      pageBackgroundMid: '#F4EBDD',
      pageBackgroundEnd: '#FAF7F1',
      surface: '#FFFDF9',
      surfaceRaised: '#FFFFFF',
      surfaceMuted: '#F2E9DD',
      surfaceOverlay: 'rgba(255, 253, 249, 0.98)',
      headerBackground: 'rgba(250, 247, 241, 0.92)',
      drawerBackground: 'rgba(255, 253, 249, 0.98)',
      panelBackground: '#FFFDF9',
      menuBackground: '#FFFDF9',
      cellBackground: '#FFFFFF',
      textPrimary: '#1F2937',
      textSecondary: '#6B7280',
      textTertiary: '#7C6F61',
      border: '#E3D8CA',
      borderStrong: '#D4C5B3',
      accent: '#1D4ED8',
      accentStrong: '#1E40AF',
      accentSoft: '#E8F0FF',
      shadow: 'rgba(92, 77, 55, 0.14)',
      shadowSoft: 'rgba(92, 77, 55, 0.06)'
    })
  ),
  createTheme(
    'ink',
    'Ink',
    'A high-contrast dark theme for reduced glare.',
    'dark',
    {
      appBackground: '#0B1120',
      pageBackgroundStart: '#111827',
      pageBackgroundMid: '#0F172A',
      pageBackgroundEnd: '#0B1120',
      surface: '#111827',
      surfaceRaised: '#172033',
      surfaceMuted: '#1F2937',
      surfaceOverlay: 'rgba(17, 24, 39, 0.98)',
      headerBackground: 'rgba(15, 23, 42, 0.92)',
      drawerBackground: 'rgba(17, 24, 39, 0.98)',
      panelBackground: '#111827',
      menuBackground: '#111827',
      cellBackground: '#111827',
      textPrimary: '#F9FAFB',
      textSecondary: '#CBD5E1',
      textTertiary: '#94A3B8',
      border: '#334155',
      borderStrong: '#475569',
      accent: '#60A5FA',
      accentStrong: '#93C5FD',
      accentSoft: '#172554',
      danger: '#F87171',
      warning: '#FBBF24',
      success: '#4ADE80',
      info: '#38BDF8',
      shadow: 'rgba(2, 6, 23, 0.5)',
      shadowSoft: 'rgba(2, 6, 23, 0.28)',
      selection: '#1E3A8A',
      focus: '#60A5FA',
      fontSans: "'Work Sans', sans-serif",
      fontSerif: "'Newsreader', serif",
      fontMono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      radiusSm: '8px',
      radiusMd: '10px',
      radiusLg: '14px',
      radiusPill: '999px',
      spacingXs: '4px',
      spacingSm: '8px',
      spacingMd: '12px',
      spacingLg: '16px',
      lineHeight: '1.45'
    }
  )
];

export const BUILT_IN_THEME_PRESET_MAP = Object.fromEntries(
  BUILT_IN_THEME_PRESETS.map((preset) => [preset.id, preset])
) as Record<string, ThemePreset>;

export const resolveThemePreset = (params: {
  themeId?: string | null;
  customThemes?: ThemePreset[];
  overrides?: ThemeTokenOverrides | null;
}): ResolvedTheme => {
  const themeId = params.themeId?.trim() || 'paper';
  const customThemes = params.customThemes ?? [];
  const customTheme = customThemes.find((preset) => preset.id === themeId);
  const basePreset = customTheme ?? BUILT_IN_THEME_PRESET_MAP[themeId] ?? BUILT_IN_THEME_PRESET_MAP.paper;
  const tokens = mergeThemeTokens(basePreset.tokens, params.overrides);
  return {
    ...basePreset,
    sourceId: basePreset.id,
    custom: !!customTheme,
    tokens
  };
};

export const normalizeThemePreset = (value: unknown): ThemePreset | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const mode = raw.mode === 'dark' ? 'dark' : 'light';
  const rawTokens = raw.tokens && typeof raw.tokens === 'object' ? (raw.tokens as Record<string, unknown>) : {};
  const tokenOverrides = THEME_TOKEN_KEYS.reduce((acc, key) => {
    const candidate = rawTokens[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      acc[key] = candidate.trim();
    }
    return acc;
  }, {} as Partial<ThemeTokens>);
  return createTheme(id, name, description, mode, mergeThemeTokens(DEFAULT_THEME_TOKENS, tokenOverrides));
};
