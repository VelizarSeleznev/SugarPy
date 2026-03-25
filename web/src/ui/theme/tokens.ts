import type { ThemeTokenName, ThemeTokens, ThemeTokenOverrides } from './types';

export const THEME_TOKEN_VARIABLES: Record<ThemeTokenName, string> = {
  appBackground: '--theme-app-background',
  pageBackgroundStart: '--theme-page-background-start',
  pageBackgroundMid: '--theme-page-background-mid',
  pageBackgroundEnd: '--theme-page-background-end',
  surface: '--theme-surface',
  surfaceRaised: '--theme-surface-raised',
  surfaceMuted: '--theme-surface-muted',
  surfaceOverlay: '--theme-surface-overlay',
  headerBackground: '--theme-header-background',
  drawerBackground: '--theme-drawer-background',
  panelBackground: '--theme-panel-background',
  menuBackground: '--theme-menu-background',
  cellBackground: '--theme-cell-background',
  textPrimary: '--theme-text-primary',
  textSecondary: '--theme-text-secondary',
  textTertiary: '--theme-text-tertiary',
  border: '--theme-border',
  borderStrong: '--theme-border-strong',
  accent: '--theme-accent',
  accentStrong: '--theme-accent-strong',
  accentSoft: '--theme-accent-soft',
  danger: '--theme-danger',
  warning: '--theme-warning',
  success: '--theme-success',
  info: '--theme-info',
  shadow: '--theme-shadow',
  shadowSoft: '--theme-shadow-soft',
  selection: '--theme-selection',
  focus: '--theme-focus',
  fontSans: '--theme-font-sans',
  fontSerif: '--theme-font-serif',
  fontMono: '--theme-font-mono',
  radiusSm: '--theme-radius-sm',
  radiusMd: '--theme-radius-md',
  radiusLg: '--theme-radius-lg',
  radiusPill: '--theme-radius-pill',
  spacingXs: '--theme-spacing-xs',
  spacingSm: '--theme-spacing-sm',
  spacingMd: '--theme-spacing-md',
  spacingLg: '--theme-spacing-lg',
  lineHeight: '--theme-line-height'
};

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  appBackground: '#F9FAFB',
  pageBackgroundStart: '#FFFFFF',
  pageBackgroundMid: '#F3F4F6',
  pageBackgroundEnd: '#F9FAFB',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F3F4F6',
  surfaceOverlay: 'rgba(255, 255, 255, 0.98)',
  headerBackground: 'rgba(249, 250, 251, 0.92)',
  drawerBackground: 'rgba(255, 255, 255, 0.98)',
  panelBackground: '#FFFFFF',
  menuBackground: '#FFFFFF',
  cellBackground: '#FFFFFF',
  textPrimary: '#111827',
  textSecondary: '#9CA3AF',
  textTertiary: '#6B7280',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  accent: '#2563EB',
  accentStrong: '#1D4ED8',
  accentSoft: '#EFF6FF',
  danger: '#EF4444',
  warning: '#F59E0B',
  success: '#22C55E',
  info: '#3B82F6',
  shadow: 'rgba(15, 23, 42, 0.12)',
  shadowSoft: 'rgba(15, 23, 42, 0.05)',
  selection: '#DBEAFE',
  focus: '#93C5FD',
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
};

export const THEME_TOKEN_KEYS = Object.keys(DEFAULT_THEME_TOKENS) as ThemeTokenName[];

export const mergeThemeTokens = (
  base: ThemeTokens,
  overrides?: ThemeTokenOverrides | null
): ThemeTokens => {
  if (!overrides) return { ...base };
  const next: ThemeTokens = { ...base };
  for (const key of THEME_TOKEN_KEYS) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim()) {
      next[key] = value;
    }
  }
  return next;
};

export const themeTokensToCssVariables = (tokens: ThemeTokens): Record<string, string> => {
  const cssVariables: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) {
    cssVariables[THEME_TOKEN_VARIABLES[key]] = tokens[key];
  }
  return cssVariables;
};

export const applyThemeTokensToElement = (element: HTMLElement, tokens: ThemeTokens) => {
  const cssVariables = themeTokensToCssVariables(tokens);
  Object.entries(cssVariables).forEach(([name, value]) => {
    element.style.setProperty(name, value);
  });
};
