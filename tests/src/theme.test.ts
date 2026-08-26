// @vitest-environment jsdom

import {
  applyDocumentTheme,
  getPreloadedColorTheme,
  normalizeColorTheme,
} from '../../src/theme';

describe('color theme helpers', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
  });

  test('normalizes unsupported values to dark', () => {
    expect(normalizeColorTheme('light')).toBe('light');
    expect(normalizeColorTheme('dark')).toBe('dark');
    expect(normalizeColorTheme('system')).toBe('dark');
    expect(normalizeColorTheme(undefined)).toBe('dark');
  });

  test('reads the preload theme and applies it to the document root', () => {
    Object.assign(window, {
      electronAPI: {
        ...window.electronAPI,
        initialTheme: 'light',
      },
    });

    const theme = getPreloadedColorTheme();
    applyDocumentTheme(theme);

    expect(theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
