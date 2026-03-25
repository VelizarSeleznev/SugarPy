export type ThemeMode = 'light' | 'dark';

export type ThemeTokens = {
  appBackground: string;
  pageBackgroundStart: string;
  pageBackgroundMid: string;
  pageBackgroundEnd: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  surfaceOverlay: string;
  headerBackground: string;
  drawerBackground: string;
  panelBackground: string;
  menuBackground: string;
  cellBackground: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
  shadow: string;
  shadowSoft: string;
  selection: string;
  focus: string;
  fontSans: string;
  fontSerif: string;
  fontMono: string;
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusPill: string;
  spacingXs: string;
  spacingSm: string;
  spacingMd: string;
  spacingLg: string;
  lineHeight: string;
};

export type ThemeTokenName = keyof ThemeTokens;

export type ThemeTokenOverrides = Partial<ThemeTokens>;

export type ThemePreset = {
  id: string;
  name: string;
  description: string;
  mode: ThemeMode;
  tokens: ThemeTokens;
};

export type ResolvedTheme = ThemePreset & {
  sourceId: string;
  custom: boolean;
  tokens: ThemeTokens;
};

export const DEFAULT_THEME_ID = 'paper';
