import { applyThemeTokensToElement } from './tokens';
import { resolveThemePreset } from './presets';
import type { ThemePreset, ThemeTokenOverrides } from './types';

export type ApplyThemeOptions = {
  root?: HTMLElement | Document;
  themeId?: string | null;
  customThemes?: ThemePreset[];
  overrides?: ThemeTokenOverrides | null;
};

export const applyTheme = (options: ApplyThemeOptions) => {
  const resolved = resolveThemePreset({
    themeId: options.themeId,
    customThemes: options.customThemes,
    overrides: options.overrides
  });

  const rootElement =
    options.root instanceof Document
      ? options.root.documentElement
      : options.root ?? (typeof document !== 'undefined' ? document.documentElement : null);

  if (!rootElement) {
    return resolved;
  }

  applyThemeTokensToElement(rootElement, resolved.tokens);
  rootElement.dataset.sugarpyTheme = resolved.id;
  rootElement.dataset.sugarpyThemeMode = resolved.mode;
  rootElement.style.colorScheme = resolved.mode;

  return resolved;
};
