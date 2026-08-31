const DEFAULT_COLOR_THEME = 'dark';
const THEME_ARGUMENT_PREFIX = '--videocull-theme=';

function normalizeColorTheme(value) {
  return value === 'light' ? 'light' : DEFAULT_COLOR_THEME;
}

function getThemeBackgroundColor(value) {
  return normalizeColorTheme(value) === 'light' ? '#e6e7ec' : '#08080d';
}

module.exports = {
  DEFAULT_COLOR_THEME,
  THEME_ARGUMENT_PREFIX,
  getThemeBackgroundColor,
  normalizeColorTheme,
};
