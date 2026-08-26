import type { ColorTheme } from './types';

export const DEFAULT_COLOR_THEME: ColorTheme = 'dark';

export function normalizeColorTheme(value: unknown): ColorTheme {
  return value === 'light' ? 'light' : DEFAULT_COLOR_THEME;
}

export function getPreloadedColorTheme(): ColorTheme {
  if (typeof window === 'undefined') return DEFAULT_COLOR_THEME;
  return normalizeColorTheme(window.electronAPI?.initialTheme);
}

export function applyDocumentTheme(value: unknown): ColorTheme {
  const theme = normalizeColorTheme(value);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
}
