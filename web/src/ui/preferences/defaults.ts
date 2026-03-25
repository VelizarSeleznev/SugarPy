import { DEFAULT_THEME_ID } from '../theme/types';
import type { UserPreferences } from './types';

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  version: 1,
  themeId: DEFAULT_THEME_ID,
  themeOverrides: {},
  customThemes: [],
  density: 'comfortable',
  fontScale: 1,
  panelVisibility: {
    assistant: true,
    headerMenu: true,
    notebookSidebar: true,
    coachmarks: true
  },
  assistantUi: {
    compactDraftPreview: false,
    compactTrace: false,
    stagedDraftOpen: true
  },
  notebookPresentation: {
    cellOutputCollapsedByDefault: false,
    compactCells: false,
    showInsertHints: true
  },
  updatedAt: '1970-01-01T00:00:00.000Z'
};
