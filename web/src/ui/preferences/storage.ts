import { DEFAULT_THEME_TOKENS } from '../theme/tokens';
import { normalizeThemePreset } from '../theme/presets';
import { DEFAULT_USER_PREFERENCES } from './defaults';
import type { AssistantUiPreferences, NotebookPresentationPreferences, PanelVisibilityPreferences, UserDensity, UserPreferences } from './types';
import type { ThemePreset, ThemeTokenOverrides, ThemeTokens } from '../theme/types';

export const USER_PREFERENCES_STORAGE_KEY = 'sugarpy:user-preferences:v1';

const readStorageItem = (key: string): string | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
};

const writeStorageItem = (key: string, value: string) => {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_error) {
    return false;
  }
};

const removeStorageItem = (key: string) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage failures so preferences never become fatal.
  }
};

const clampFontScale = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_USER_PREFERENCES.fontScale;
  return Math.min(Math.max(parsed, 0.75), 1.5);
};

const normalizeDensity = (value: unknown): UserDensity =>
  value === 'compact' ? 'compact' : DEFAULT_USER_PREFERENCES.density;

const normalizePanelVisibility = (value: unknown): PanelVisibilityPreferences => ({
  assistant:
    typeof (value as PanelVisibilityPreferences | null)?.assistant === 'boolean'
      ? (value as PanelVisibilityPreferences).assistant
      : DEFAULT_USER_PREFERENCES.panelVisibility.assistant,
  headerMenu:
    typeof (value as PanelVisibilityPreferences | null)?.headerMenu === 'boolean'
      ? (value as PanelVisibilityPreferences).headerMenu
      : DEFAULT_USER_PREFERENCES.panelVisibility.headerMenu,
  notebookSidebar:
    typeof (value as PanelVisibilityPreferences | null)?.notebookSidebar === 'boolean'
      ? (value as PanelVisibilityPreferences).notebookSidebar
      : DEFAULT_USER_PREFERENCES.panelVisibility.notebookSidebar,
  coachmarks:
    typeof (value as PanelVisibilityPreferences | null)?.coachmarks === 'boolean'
      ? (value as PanelVisibilityPreferences).coachmarks
      : DEFAULT_USER_PREFERENCES.panelVisibility.coachmarks
});

const normalizeAssistantUi = (value: unknown): AssistantUiPreferences => ({
  compactDraftPreview:
    typeof (value as AssistantUiPreferences | null)?.compactDraftPreview === 'boolean'
      ? (value as AssistantUiPreferences).compactDraftPreview
      : DEFAULT_USER_PREFERENCES.assistantUi.compactDraftPreview,
  compactTrace:
    typeof (value as AssistantUiPreferences | null)?.compactTrace === 'boolean'
      ? (value as AssistantUiPreferences).compactTrace
      : DEFAULT_USER_PREFERENCES.assistantUi.compactTrace,
  stagedDraftOpen:
    typeof (value as AssistantUiPreferences | null)?.stagedDraftOpen === 'boolean'
      ? (value as AssistantUiPreferences).stagedDraftOpen
      : DEFAULT_USER_PREFERENCES.assistantUi.stagedDraftOpen
});

const normalizeNotebookPresentation = (value: unknown): NotebookPresentationPreferences => ({
  cellOutputCollapsedByDefault:
    typeof (value as NotebookPresentationPreferences | null)?.cellOutputCollapsedByDefault === 'boolean'
      ? (value as NotebookPresentationPreferences).cellOutputCollapsedByDefault
      : DEFAULT_USER_PREFERENCES.notebookPresentation.cellOutputCollapsedByDefault,
  compactCells:
    typeof (value as NotebookPresentationPreferences | null)?.compactCells === 'boolean'
      ? (value as NotebookPresentationPreferences).compactCells
      : DEFAULT_USER_PREFERENCES.notebookPresentation.compactCells,
  showInsertHints:
    typeof (value as NotebookPresentationPreferences | null)?.showInsertHints === 'boolean'
      ? (value as NotebookPresentationPreferences).showInsertHints
      : DEFAULT_USER_PREFERENCES.notebookPresentation.showInsertHints
});

const normalizeThemeOverrides = (value: unknown): ThemeTokenOverrides => {
  if (!value || typeof value !== 'object') return {};
  const overrides: ThemeTokenOverrides = {};
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_THEME_TOKENS) as Array<keyof ThemeTokens>) {
    const raw = candidate[key];
    if (typeof raw === 'string' && raw.trim()) {
      overrides[key] = raw.trim();
    }
  }
  return overrides;
};

const normalizeCustomThemes = (value: unknown): ThemePreset[] => {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeThemePreset).filter((entry): entry is ThemePreset => !!entry);
};

export const normalizeUserPreferences = (value: unknown): UserPreferences => {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    version: 1,
    themeId: typeof raw.themeId === 'string' && raw.themeId.trim() ? raw.themeId.trim() : DEFAULT_USER_PREFERENCES.themeId,
    themeOverrides: normalizeThemeOverrides(raw.themeOverrides),
    customThemes: normalizeCustomThemes(raw.customThemes),
    density: normalizeDensity(raw.density),
    fontScale: clampFontScale(raw.fontScale),
    panelVisibility: normalizePanelVisibility(raw.panelVisibility),
    assistantUi: normalizeAssistantUi(raw.assistantUi),
    notebookPresentation: normalizeNotebookPresentation(raw.notebookPresentation),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : DEFAULT_USER_PREFERENCES.updatedAt
  };
};

export const readUserPreferences = (): UserPreferences => {
  const raw = readStorageItem(USER_PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_USER_PREFERENCES, themeOverrides: {}, customThemes: [] };
  try {
    return normalizeUserPreferences(JSON.parse(raw));
  } catch (_error) {
    return { ...DEFAULT_USER_PREFERENCES, themeOverrides: {}, customThemes: [] };
  }
};

export const writeUserPreferences = (preferences: UserPreferences) =>
  writeStorageItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));

export const clearUserPreferences = () => removeStorageItem(USER_PREFERENCES_STORAGE_KEY);
