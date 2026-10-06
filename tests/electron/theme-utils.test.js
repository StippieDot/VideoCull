import { expect, test } from 'vitest';

const fs = require('node:fs');
const path = require('node:path');
const {
  getThemeBackgroundColor,
  getTitleBarOverlay,
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

test('the window buttons blend into the title bar in both themes', () => {
  // The title bar uses --bg-surface; the window buttons Windows draws over it must use the same colour.
  const css = fs.readFileSync(path.join(__dirname, '../../src/index.css'), 'utf8');
  const [dark, light] = Array.from(css.matchAll(/--bg-surface:\s*(#[0-9a-f]{6})/gi), (match) => match[1]);
  expect(getTitleBarOverlay('dark').color).toBe(dark);
  expect(getTitleBarOverlay('light').color).toBe(light);
  expect(getTitleBarOverlay('dark').height).toBe(32);
});
