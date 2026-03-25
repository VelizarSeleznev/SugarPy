import { useEffect, useMemo, useState } from 'react';

import { applyTheme } from '../theme/applyTheme';
import { resolveThemePreset } from '../theme/presets';
import type { ThemePreset, ThemeTokenOverrides } from '../theme/types';
import { DEFAULT_USER_PREFERENCES } from './defaults';
import { clearUserPreferences, normalizeUserPreferences, readUserPreferences, writeUserPreferences } from './storage';
import type {
  AssistantUiPreferences,
  NotebookPresentationPreferences,
  PanelVisibilityPreferences,
  UserDensity,
  UserPreferences
} from './types';

const updateTimestamp = (preferences: UserPreferences) => ({
  ...preferences,
  updatedAt: new Date().toISOString()
});

export type UseUserPreferencesResult = {
  preferences: UserPreferences;
  resolvedTheme: ReturnType<typeof resolveThemePreset>;
  setThemeId: (themeId: string) => void;
  setThemeOverrides: (overrides: ThemeTokenOverrides) => void;
  setCustomThemes: (customThemes: ThemePreset[]) => void;
  setDensity: (density: UserDensity) => void;
  setFontScale: (fontScale: number) => void;
  setPanelVisibility: (panelVisibility: PanelVisibilityPreferences) => void;
  setAssistantUi: (assistantUi: AssistantUiPreferences) => void;
  setNotebookPresentation: (notebookPresentation: NotebookPresentationPreferences) => void;
  patchPreferences: (patch: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
};

export const useUserPreferences = (): UseUserPreferencesResult => {
  const [preferences, setPreferences] = useState<UserPreferences>(() => readUserPreferences());

  const resolvedTheme = useMemo(
    () =>
      resolveThemePreset({
        themeId: preferences.themeId,
        customThemes: preferences.customThemes,
        overrides: preferences.themeOverrides
      }),
    [preferences.customThemes, preferences.themeId, preferences.themeOverrides]
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyTheme({
      root: document.documentElement,
      themeId: preferences.themeId,
      customThemes: preferences.customThemes,
      overrides: preferences.themeOverrides
    });
  }, [preferences.customThemes, preferences.themeId, preferences.themeOverrides]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.sugarpyDensity = preferences.density;
    root.style.setProperty('--sugarpy-font-scale', String(preferences.fontScale));
  }, [preferences.density, preferences.fontScale]);

  useEffect(() => {
    writeUserPreferences(normalizeUserPreferences(updateTimestamp(preferences)));
  }, [preferences]);

  const patchPreferences = (patch: Partial<UserPreferences>) => {
    setPreferences((current) =>
      normalizeUserPreferences(
        updateTimestamp({
          ...current,
          ...patch,
          themeOverrides: patch.themeOverrides ?? current.themeOverrides,
          customThemes: patch.customThemes ?? current.customThemes,
          panelVisibility: patch.panelVisibility ?? current.panelVisibility,
          assistantUi: patch.assistantUi ?? current.assistantUi,
          notebookPresentation: patch.notebookPresentation ?? current.notebookPresentation
        })
      )
    );
  };

  const resetPreferences = () => {
    const next = { ...DEFAULT_USER_PREFERENCES, updatedAt: new Date().toISOString() };
    setPreferences(next);
    clearUserPreferences();
  };

  return {
    preferences,
    resolvedTheme,
    setThemeId: (themeId) => patchPreferences({ themeId }),
    setThemeOverrides: (themeOverrides) => patchPreferences({ themeOverrides }),
    setCustomThemes: (customThemes) => patchPreferences({ customThemes }),
    setDensity: (density) => patchPreferences({ density }),
    setFontScale: (fontScale) => patchPreferences({ fontScale }),
    setPanelVisibility: (panelVisibility) => patchPreferences({ panelVisibility }),
    setAssistantUi: (assistantUi) => patchPreferences({ assistantUi }),
    setNotebookPresentation: (notebookPresentation) => patchPreferences({ notebookPresentation }),
    patchPreferences,
    resetPreferences
  };
};
