const DEFAULT_COLOR_THEME = 'dark';
const THEME_ARGUMENT_PREFIX = '--video-cull-theme=';

function normalizeColorTheme(value) {
  return value === 'light' ? 'light' : DEFAULT_COLOR_THEME;
}

function getThemeBackgroundColor(value) {
  return normalizeColorTheme(value) === 'light' ? '#e6e7ec' : '#08080d';
}

// Must match the title bar height in src/components/TitleBar.css.
const TITLE_BAR_HEIGHT = 32;

/**
 * Windows 11 22H2 (build 22621) and newer draw the Mica material behind a window; older versions
 * ignore it, so the title bar keeps its own colour there.
 * @param {string} release os.release(), such as "10.0.22631"
 */
function supportsMica(release) {
  const [major, , build] = String(release).split('.').map(Number);
  return major === 10 && build >= 22621;
}

/**
 * Colours of the Windows minimise, maximise and close buttons drawn over the app's title bar. The
 * background must match --bg-surface in src/index.css, the title bar's background, or be
 * transparent when the title bar shows Mica.
 */
function getTitleBarOverlay(value, mica = false) {
  const light = normalizeColorTheme(value) === 'light';
  return {
    color: mica ? '#00000000' : light ? '#f8f8fa' : '#100f1c',
    symbolColor: light ? '#211e31' : '#e8e6f5',
    height: TITLE_BAR_HEIGHT,
  };
}

module.exports = {
  DEFAULT_COLOR_THEME,
  THEME_ARGUMENT_PREFIX,
  getThemeBackgroundColor,
  getTitleBarOverlay,
  supportsMica,
  normalizeColorTheme,
};
