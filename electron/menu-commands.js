// Handlers behind the title bar's menu buttons, the command palette and the taskbar progress, kept
// free of the electron module so the guards can be tested with plain fakes.

/**
 * @typedef {{ id?: string, enabled: boolean, visible: boolean, submenu?: { items: MenuItemLike[], popup: (options: object) => void }, click: (...args: unknown[]) => void }} MenuItemLike
 * @typedef {{ items: MenuItemLike[], getMenuItemById: (id: string) => MenuItemLike | null }} MenuLike
 */

/**
 * The first item with this id, and whether it can be used: its own state and that of every
 * submenu above it. Electron leaves the children of a disabled submenu enabled themselves.
 * @param {MenuItemLike[]} items @param {string} id @param {boolean} [ancestorsUsable]
 * @returns {{ item: MenuItemLike, usable: boolean } | null}
 */
function findMenuItem(items, id, ancestorsUsable = true) {
  for (const item of items) {
    if (item.id === id) return { item, usable: ancestorsUsable && item.enabled && item.visible };
    const found = item.submenu && findMenuItem(item.submenu.items, id, ancestorsUsable && item.enabled && item.visible);
    if (found) return found;
  }
  return null;
}

function liveWindow(/** @type {any} */ window) {
  return window && !window.isDestroyed() ? window : null;
}

/**
 * Runs an item of the application menu. Only enabled, visible items without a submenu run, because
 * the palette can be showing a menu state that changed a moment ago.
 * @param {MenuLike | null | undefined} menu @param {unknown} id @param {any} window
 * @returns {boolean} whether the item ran
 */
function runMenuCommand(menu, id, window) {
  const target = liveWindow(window);
  const found = typeof id === 'string' && menu ? findMenuItem(menu.items, id) : null;
  if (!found || !target || !found.usable || found.item.submenu) return false;
  found.item.click(undefined, target, target.webContents);
  return true;
}

/**
 * Pops up a submenu of the application menu at a window position.
 * @param {MenuLike | null | undefined} menu @param {unknown} id @param {any} window @param {unknown} x @param {unknown} y
 * @returns {Promise<boolean>} resolves true when the menu closes, false when it could not open
 */
function openMenuAt(menu, id, window, x, y) {
  return new Promise((resolve) => {
    const target = liveWindow(window);
    const item = typeof id === 'string' ? menu?.getMenuItemById(id) : null;
    if (!item?.submenu || !target || !Number.isFinite(x) || !Number.isFinite(y)) {
      resolve(false);
      return;
    }
    item.submenu.popup({ window: target, x: Math.round(Number(x)), y: Math.round(Number(y)), callback: () => resolve(true) });
  });
}

/**
 * Shows processing progress on the taskbar button.
 * @param {any} window @param {unknown} progress
 */
function applyTaskbarProgress(window, progress) {
  const target = liveWindow(window);
  if (!target || !progress || typeof progress !== 'object') return;
  const { mode, fraction } = /** @type {{ mode?: unknown, fraction?: unknown }} */ (progress);
  if (mode === 'normal' || mode === 'paused') {
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return;
    target.setProgressBar(Math.min(1, Math.max(0, fraction)), { mode });
  } else if (mode === 'indeterminate') {
    // Windows shows the moving bar for any value above 1 in this mode.
    target.setProgressBar(2, { mode: 'indeterminate' });
  } else {
    target.setProgressBar(-1);
  }
}

module.exports = { runMenuCommand, openMenuAt, applyTaskbarProgress };
