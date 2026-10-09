// @ts-check

/**
 * What the renderer reports about the session, so menu items are only enabled when they do
 * something. Comes from the renderer, so it is normalised before use.
 * @typedef {{
 *   hasSession: boolean,
 *   videoCount: number,
 *   markedCount: number,
 *   canUndo: boolean,
 *   canExport: boolean,
 *   canFindDuplicates: boolean,
 *   canPauseProcessing: boolean,
 *   activeVideoCount: number,
 *   canRegenerateThumbnails: boolean,
 *   sortBy: string,
 *   sortOrder: 'asc' | 'desc',
 *   sortOptions: string[],
 *   groupByFolder: boolean,
 *   filtersActive: boolean,
 *   muteAvailable: boolean,
 *   muted: boolean,
 *   isPrivate: boolean,
 *   recentFolders: string[],
 *   folders: string[],
 * }} RendererMenuState
 */

/**
 * @typedef {RendererMenuState & {
 *   isDev: boolean,
 *   updatesEnabled: boolean,
 *   processing: boolean,
 *   paused: boolean,
 *   finishAction: 'none' | 'sleep' | 'shutdown',
 * }} MenuState
 */

/**
 * @typedef {{
 *   send: (action: string) => void,
 *   setFinishAction: (action: 'none' | 'sleep' | 'shutdown') => void,
 *   setPaused: (paused: boolean) => void,
 *   openReleaseNotes: () => void,
 *   reportProblem: () => void,
 *   openLogFolder: () => void,
 *   openHelpWebsite: () => void,
 *   openSponsors: () => void,
 *   openPayPal: () => void,
 * }} MenuActions
 */

/** @type {RendererMenuState} */
const EMPTY_RENDERER_MENU_STATE = {
  hasSession: false,
  videoCount: 0,
  markedCount: 0,
  canUndo: false,
  canExport: false,
  canFindDuplicates: false,
  canPauseProcessing: false,
  activeVideoCount: 0,
  canRegenerateThumbnails: false,
  sortBy: 'name',
  sortOrder: 'asc',
  sortOptions: ['name'],
  groupByFolder: false,
  filtersActive: false,
  muteAvailable: false,
  muted: false,
  isPrivate: false,
  recentFolders: [],
  folders: [],
};

/** Sort fields the renderer may offer, with their menu labels. */
const SORT_LABELS = {
  name: 'Name',
  size: 'Size',
  duration: 'Duration',
  date: 'Date',
  rating: 'Rating',
  resolution: 'Resolution',
  fps: 'FPS',
};
/** @param {unknown} value @returns {value is keyof typeof SORT_LABELS} */
const isSortField = (value) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(SORT_LABELS, value);

const MAX_RECENT_FOLDERS = 8;

/** @param {unknown} value @returns {string[]} */
function folderList(value) {
  return Array.isArray(value) ? value.filter((folder) => typeof folder === 'string' && folder.length > 0) : [];
}

/**
 * @param {unknown} input
 * @returns {RendererMenuState}
 */
function normalizeRendererMenuState(input) {
  const raw = input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {};
  const count = (/** @type {unknown} */ value) => (Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 0);
  return {
    hasSession: raw.hasSession === true,
    videoCount: count(raw.videoCount),
    markedCount: count(raw.markedCount),
    canUndo: raw.canUndo === true,
    canExport: raw.canExport === true,
    canFindDuplicates: raw.canFindDuplicates === true,
    canPauseProcessing: raw.canPauseProcessing === true,
    activeVideoCount: count(raw.activeVideoCount),
    canRegenerateThumbnails: raw.canRegenerateThumbnails === true,
    sortBy: isSortField(raw.sortBy) ? raw.sortBy : 'name',
    sortOrder: raw.sortOrder === 'desc' ? 'desc' : 'asc',
    sortOptions: Array.isArray(raw.sortOptions) ? raw.sortOptions.filter(isSortField) : ['name'],
    groupByFolder: raw.groupByFolder === true,
    filtersActive: raw.filtersActive === true,
    muteAvailable: raw.muteAvailable === true,
    muted: raw.muted === true,
    isPrivate: raw.isPrivate === true,
    recentFolders: folderList(raw.recentFolders).slice(0, MAX_RECENT_FOLDERS),
    folders: folderList(raw.folders),
  };
}

/**
 * Electron menu template for the app menu. Items that cannot do anything in the current state are
 * disabled instead of silently doing nothing. Shortcuts the renderer already handles itself, or
 * that the user can rebind, are not registered here.
 *
 * @param {MenuState} state
 * @param {MenuActions} actions
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildMenuTemplate(state, actions) {
  // Disabled submenus still display their labels, so private paths must be omitted entirely.
  if (state.isPrivate) state = { ...state, folders: [], recentFolders: [] };

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    fileMenu(state, actions),
    actionsMenu(state, actions),
    viewMenu(state, actions),
    videoMenu(state, actions),
    helpMenu(state, actions),
  ];

  const withIds = addCommandIds(template, []);
  return state.isPrivate ? withIds.map(disableForPrivacy) : withIds;
}

/** @param {MenuState} state @param {MenuActions} actions @returns {Electron.MenuItemConstructorOptions} */
function fileMenu(state, actions) {
  const { send } = actions;
  return {
    label: 'File',
    submenu: [
      { label: 'Open Folder...', accelerator: 'CmdOrCtrl+O', click: () => send('open-directory') },
      { label: 'Add Folder to Session...', enabled: state.hasSession, click: () => send('add-folder') },
      openRecentItem(state, send),
      { type: 'separator' },
      { label: 'Rescan', accelerator: 'F5', enabled: state.hasSession, click: () => send('rescan-directory') },
      revealFolderItem(state, send, 'Reveal Folder in Explorer'),
      { label: 'Close Session', enabled: state.hasSession, click: () => send('close-session') },
      { type: 'separator' },
      { label: 'Export Report...', accelerator: 'CmdOrCtrl+Shift+E', enabled: state.canExport, click: () => send('export-report') },
      { type: 'separator' },
      { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => send('open-settings') },
      { type: 'separator' },
      {
        // No shortcut: it discards every review decision, and Ctrl+Shift+R is "hard refresh" muscle memory.
        label: 'Clear Cache and Reload...',
        enabled: state.hasSession,
        click: () => send('clear-cache'),
      },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' },
    ],
  };
}

/** @param {MenuState} state @param {MenuActions} actions @returns {Electron.MenuItemConstructorOptions} */
function actionsMenu(state, actions) {
  const { send } = actions;
  return {
    label: 'Actions',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: state.canUndo, click: () => send('undo') },
      { type: 'separator' },
      { label: 'Find Duplicates', enabled: state.canFindDuplicates, click: () => send('find-duplicates') },
      {
        label: 'Pause Processing',
        type: 'checkbox',
        checked: state.paused,
        enabled: state.canPauseProcessing,
        click: (item) => actions.setPaused(item.checked),
      },
      {
        label: 'When Processing Finishes',
        enabled: state.processing,
        submenu: /** @type {const} */ ([['none', 'Do Nothing'], ['sleep', 'Sleep'], ['shutdown', 'Shut Down']]).map(([action, label]) => ({
          label,
          type: /** @type {const} */ ('radio'),
          checked: state.finishAction === action,
          click: () => actions.setFinishAction(action),
        })),
      },
      { type: 'separator' },
      {
        label: state.markedCount > 0 ? `Delete Marked Videos (${state.markedCount})...` : 'Delete Marked Videos...',
        accelerator: 'CmdOrCtrl+Backspace',
        enabled: state.markedCount > 0,
        click: () => send('delete-all'),
      },
    ],
  };
}

/** @param {MenuState} state @param {MenuActions} actions @returns {Electron.MenuItemConstructorOptions} */
function viewMenu(state, actions) {
  const { send } = actions;
  return {
    label: 'View',
    submenu: [
      { label: 'Command Palette...', accelerator: 'CmdOrCtrl+K', click: () => send('open-command-palette') },
      { label: 'Go to Folder...', accelerator: 'CmdOrCtrl+G', enabled: state.hasSession, click: () => send('go-to-folder') },
      { type: 'separator' },
      {
        label: 'Sort By',
        enabled: state.hasSession,
        submenu: [
          ...state.sortOptions.map((field) => ({
            label: SORT_LABELS[/** @type {keyof typeof SORT_LABELS} */ (field)],
            type: /** @type {const} */ ('radio'),
            checked: state.sortBy === field,
            click: () => send(`sort:${field}`),
          })),
          { type: 'separator' },
          { label: 'Ascending', type: 'radio', checked: state.sortOrder === 'asc', click: () => send('sort-order:asc') },
          { label: 'Descending', type: 'radio', checked: state.sortOrder === 'desc', click: () => send('sort-order:desc') },
        ],
      },
      {
        label: 'Group by Folder',
        type: 'checkbox',
        checked: state.groupByFolder,
        enabled: state.hasSession,
        click: () => send('toggle-group-by-folder'),
      },
      { label: 'Clear All Filters', enabled: state.filtersActive, click: () => send('clear-filters') },
      { type: 'separator' },
      { label: 'Larger Cards', accelerator: 'CmdOrCtrl+Plus', enabled: state.hasSession, click: () => send('zoom-in') },
      { label: 'Larger Cards', accelerator: 'CmdOrCtrl+=', visible: false, enabled: state.hasSession, click: () => send('zoom-in') },
      { label: 'Smaller Cards', accelerator: 'CmdOrCtrl+-', enabled: state.hasSession, click: () => send('zoom-out') },
      { type: 'separator' },
      {
        label: 'Privacy Screen',
        type: 'checkbox',
        checked: state.isPrivate,
        // Shift+Esc is handled by the renderer, which also works while the privacy screen is up.
        accelerator: 'Shift+Escape',
        registerAccelerator: false,
        click: () => send('toggle-privacy'),
      },
      ...(state.muteAvailable ? [{
        label: 'Mute In-App Playback',
        type: /** @type {const} */ ('checkbox'),
        checked: state.muted,
        click: () => send('toggle-mute'),
      }] : []),
      { label: 'Toggle Dark / Light Theme', click: () => send('toggle-theme') },
      { role: 'togglefullscreen', label: 'Full Screen' },
      // Reloading drops the open session and review position, so it is a development tool only.
      ...(state.isDev ? /** @type {Electron.MenuItemConstructorOptions[]} */ ([
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ]) : []),
    ],
  };
}

/** @param {MenuState} state @param {MenuActions} actions @returns {Electron.MenuItemConstructorOptions} */
function videoMenu(state, actions) {
  const { send } = actions;
  return {
    label: 'Video',
    submenu: [
      { label: 'Play Externally', accelerator: 'CmdOrCtrl+P', enabled: state.activeVideoCount === 1, click: () => send('play-external') },
      { label: 'Reveal in Explorer', accelerator: 'CmdOrCtrl+E', enabled: state.activeVideoCount === 1, click: () => send('reveal-video') },
      {
        label: state.activeVideoCount > 1 ? `Copy Paths (${state.activeVideoCount})` : 'Copy Path',
        enabled: state.activeVideoCount > 0,
        click: () => send('copy-path'),
      },
      { type: 'separator' },
      {
        label: state.activeVideoCount > 1 ? `Regenerate Thumbnails (${state.activeVideoCount})` : 'Regenerate Thumbnails',
        enabled: state.activeVideoCount > 0 && state.canRegenerateThumbnails,
        click: () => send('regenerate-thumbnails'),
      },
    ],
  };
}

/** @param {MenuState} state @param {MenuActions} actions @returns {Electron.MenuItemConstructorOptions} */
function helpMenu(state, actions) {
  const { send } = actions;
  return {
    label: 'Help',
    submenu: [
      { label: 'Documentation', accelerator: 'F1', click: () => send('open-documentation') },
      { label: 'Online Help', click: actions.openHelpWebsite },
      { label: 'Keyboard Shortcuts', click: () => send('show-shortcuts') },
      { type: 'separator' },
      { label: 'Release Notes', click: actions.openReleaseNotes },
      { label: 'Report a Problem...', click: actions.reportProblem },
      { label: 'Open Log Folder', click: actions.openLogFolder },
      { type: 'separator' },
      ...(state.updatesEnabled ? [{ label: 'Check for Updates...', click: () => send('check-updates') }] : []),
      {
        label: 'Support VideoCull',
        submenu: [
          { label: 'GitHub Sponsors', click: actions.openSponsors },
          { label: 'PayPal', click: actions.openPayPal },
        ],
      },
      { label: 'About VideoCull', click: () => send('open-about') },
    ],
  };
}

/**
 * With several loaded folders, a submenu lists them.
 * @param {MenuState} state @param {(action: string) => void} send @param {string} label
 * @returns {Electron.MenuItemConstructorOptions}
 */
function revealFolderItem(state, send, label) {
  if (state.folders.length > 1) {
    return {
      label,
      submenu: state.folders.map((folder) => ({
        id: `File > ${label} > ${folder}`,
        label: escapeMenuLabel(folder),
        click: () => send(`reveal-folder:${folder}`),
      })),
    };
  }
  return { label, enabled: state.folders.length === 1, click: () => send(`reveal-folder:${state.folders[0]}`) };
}

/** @param {MenuState} state @param {(action: string) => void} send @returns {Electron.MenuItemConstructorOptions} */
function openRecentItem(state, send) {
  return {
    label: 'Open Recent',
    enabled: state.recentFolders.length > 0,
    submenu: state.recentFolders.length > 0
      ? state.recentFolders.map((folder) => ({
        // The full path: the id made from the label drops "(2)", which would merge "Clips (2)" into "Clips".
        id: `File > Open Recent > ${folder}`,
        label: escapeMenuLabel(folder),
        click: () => send(`open-recent:${folder}`),
      }))
      : [{ label: 'No recent folders', enabled: false }],
  };
}

const COMMAND_PALETTE_ID = 'View > Command Palette';

/**
 * Gives every labelled item an id from its menu path, so the command palette can list and run
 * them. Counts such as "(3)" and trailing dots are left out, so the id survives a menu rebuild.
 * @param {Electron.MenuItemConstructorOptions[]} items @param {string[]} parents
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function addCommandIds(items, parents) {
  return items.map((item) => {
    if (!item.label) return item;
    const path = [...parents, item.label.replace(/\s*\(\d+\)/, '').replace(/\.+$/, '').replace(/&&/g, '&')];
    return {
      ...item,
      id: item.id ?? path.join(' > '),
      ...(Array.isArray(item.submenu) ? { submenu: addCommandIds(item.submenu, path) } : {}),
    };
  });
}

/**
 * @typedef {{ id: string, path: string[], accelerator: string | null, enabled: boolean, checked: boolean | null }} AppCommand
 */

/**
 * Every runnable item of a built menu, for the command palette.
 * @param {Electron.MenuItem[]} items @param {string[]} [parents]
 * @returns {AppCommand[]}
 */
function listCommands(items, parents = []) {
  return items.flatMap((item) => {
    if (item.type === 'separator' || !item.visible || !item.label || !item.id) return [];
    const path = [...parents, item.label.replace(/&&/g, '&')];
    if (item.submenu) return listCommands(item.submenu.items, path);
    if (item.id === COMMAND_PALETTE_ID) return [];
    return [{
      id: item.id,
      path,
      accelerator: typeof item.accelerator === 'string' ? item.accelerator : null,
      enabled: item.enabled,
      checked: item.type === 'checkbox' || item.type === 'radio' ? item.checked : null,
    }];
  });
}

/** Only the privacy screen itself, full screen and Exit stay usable behind the privacy screen. */
function disableForPrivacy(/** @type {Electron.MenuItemConstructorOptions} */ item) {
  /** @type {Electron.MenuItemConstructorOptions} */
  const copy = { ...item };
  if (Array.isArray(item.submenu)) {
    copy.submenu = item.submenu.map(disableForPrivacy);
    return copy;
  }
  const stays = item.type === 'separator' || item.label === 'Privacy Screen' || item.role === 'quit' || item.role === 'togglefullscreen';
  if (!stays) copy.enabled = false;
  return copy;
}

/** "&" marks an access key in Windows menu labels, so folder names show it doubled. */
function escapeMenuLabel(/** @type {string} */ label) {
  return label.replace(/&/g, '&&');
}

module.exports = { SORT_LABELS, buildMenuTemplate, listCommands, normalizeRendererMenuState, EMPTY_RENDERER_MENU_STATE };
