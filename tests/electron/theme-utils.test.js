import { expect, test } from 'vitest';

const {
  getThemeBackgroundColor,
  normalizeColorTheme,
} = require('../../electron/theme-utils');

test('normalizes color themes to the supported light and dark values', () => {
  expect(normalizeColorTheme('light')).toBe('light');
  expect(normalizeColorTheme('dark')).toBe('dark');
  expect(normalizeColorTheme('system')).toBe('dark');
  expect(normalizeColorTheme(undefined)).toBe('dark');
});

test('provides a matching opaque window background', () => {
  expect(getThemeBackgroundColor('dark')).toBe('#08080d');
  expect(getThemeBackgroundColor('light')).toBe('#e6e7ec');
});
