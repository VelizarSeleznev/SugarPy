import type { ThemePreset, ThemeTokenOverrides } from '../theme/types';

export type UserDensity = 'comfortable' | 'compact';

export type AssistantUiPreferences = {
  compactDraftPreview: boolean;
  compactTrace: boolean;
  stagedDraftOpen: boolean;
};

export type NotebookPresentationPreferences = {
  cellOutputCollapsedByDefault: boolean;
  compactCells: boolean;
  showInsertHints: boolean;
};

export type PanelVisibilityPreferences = {
  assistant: boolean;
  headerMenu: boolean;
  notebookSidebar: boolean;
  coachmarks: boolean;
};

export type UserPreferences = {
  version: 1;
  themeId: string;
  themeOverrides: ThemeTokenOverrides;
  customThemes: ThemePreset[];
  density: UserDensity;
  fontScale: number;
  panelVisibility: PanelVisibilityPreferences;
  assistantUi: AssistantUiPreferences;
  notebookPresentation: NotebookPresentationPreferences;
  updatedAt: string;
};
