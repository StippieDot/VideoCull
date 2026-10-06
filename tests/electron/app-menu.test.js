const assert = require('node:assert/strict');
const { buildMenuTemplate, buildFolderMenuTemplate, listCommands, normalizeRendererMenuState, EMPTY_RENDERER_MENU_STATE } = require('../../electron/app-menu');

const actions = {
  send: () => {},
  setFinishAction: () => {},
  setPaused: () => {},
  openReleaseNotes: () => {},
  reportProblem: () => {},
  openLogFolder: () => {},
  openHelpWebsite: () => {},
  openSponsors: () => {},
  openPayPal: () => {},
};

function menu(overrides = {}) {
  return buildMenuTemplate({
    ...EMPTY_RENDERER_MENU_STATE,
    isDev: false,
    updatesEnabled: true,
    processing: false,
    paused: false,
    finishAction: 'none',
    ...overrides,
  }, actions);
}

function item(template, menuLabel, itemLabel) {
  const submenu = template.find((entry) => entry.label === menuLabel).submenu;
  return submenu.find((entry) => entry.label === itemLabel || entry.role === itemLabel);
}

test('the released app has no interface reload and no clear-cache shortcut', () => {
  assert.equal(item(menu(), 'View', 'reload'), undefined);
  assert.notEqual(item(menu({ isDev: true }), 'View', 'reload'), undefined);
  assert.equal(item(menu({ hasSession: true }), 'File', 'Clear Cache and Reload...').accelerator, undefined);
});

test('no label contains a lone &, which Windows would turn into an underlined access key', () => {
  const labels = [];
  const collect = (items) => items.forEach((entry) => {
    if (entry.label) labels.push(entry.label);
    if (Array.isArray(entry.submenu)) collect(entry.submenu);
  });
  collect(menu({ hasSession: true, videoCount: 1, markedCount: 1, isDev: true }));
  assert.deepEqual(labels.filter((label) => /(^|[^&])&([^&]|$)/.test(label)), []);
});

test('items that cannot do anything are disabled', () => {
  const empty = menu();
  assert.equal(item(empty, 'File', 'Rescan').enabled, false);
  assert.equal(item(empty, 'Actions', 'Delete Marked Videos...').enabled, false);
  assert.equal(item(empty, 'Video', 'Reveal in Explorer').enabled, false);
  assert.equal(item(empty, 'Actions', 'When Processing Finishes').enabled, false);

  const session = menu({ hasSession: true, videoCount: 3, markedCount: 2, activeVideoCount: 1, processing: true });
  assert.equal(item(session, 'File', 'Rescan').enabled, true);
  assert.equal(item(session, 'Actions', 'Delete Marked Videos (2)...').enabled, true);
  assert.equal(item(session, 'Video', 'Reveal in Explorer').enabled, true);
  assert.equal(item(session, 'Actions', 'When Processing Finishes').enabled, true);
});

test('the Video menu acts on one video, or copies and regenerates for a selection', () => {
  const selection = menu({ hasSession: true, videoCount: 3, activeVideoCount: 2, canRegenerateThumbnails: true });
  assert.equal(item(selection, 'Video', 'Reveal in Explorer').enabled, false);
  assert.equal(item(selection, 'Video', 'Copy Paths (2)').enabled, true);
  assert.equal(item(selection, 'Video', 'Regenerate Thumbnails (2)').enabled, true);
  const busy = menu({ hasSession: true, videoCount: 3, activeVideoCount: 1, canRegenerateThumbnails: false });
  assert.equal(item(busy, 'Video', 'Regenerate Thumbnails').enabled, false);
});

test('sorting, grouping, filters and mute reflect the grid state', () => {
  const template = menu({
    hasSession: true, videoCount: 3, sortOptions: ['name', 'size'], sortBy: 'size', sortOrder: 'desc',
    groupByFolder: true, filtersActive: true, muteAvailable: true, muted: true,
  });
  const sort = item(template, 'View', 'Sort By').submenu;
  assert.deepEqual(sort.filter((entry) => entry.checked).map((entry) => entry.label), ['Size', 'Descending']);
  assert.equal(item(template, 'View', 'Group by Folder').checked, true);
  assert.equal(item(template, 'View', 'Clear All Filters').enabled, true);
  assert.equal(item(template, 'View', 'Mute In-App Playback').checked, true);
  assert.equal(item(menu({ hasSession: true }), 'View', 'Mute In-App Playback'), undefined);
});

test('behind the privacy screen only the privacy screen, full screen and exit stay usable', () => {
  const template = menu({ hasSession: true, videoCount: 3, isPrivate: true });
  assert.equal(item(template, 'File', 'Open Folder...').enabled, false);
  assert.equal(item(template, 'File', 'quit').enabled, undefined);
  assert.equal(item(template, 'View', 'Privacy Screen').enabled, undefined);
  assert.equal(item(template, 'View', 'Privacy Screen').checked, true);
});

test('recent folders become menu items, with & shown literally', () => {
  const sent = [];
  const template = buildMenuTemplate({
    ...EMPTY_RENDERER_MENU_STATE, isDev: false, updatesEnabled: false, processing: false, paused: false, finishAction: 'none',
    recentFolders: ['D:\Tom & Jerry'],
  }, { ...actions, send: (action) => sent.push(action) });
  const recent = item(template, 'File', 'Open Recent').submenu[0];
  assert.equal(recent.label, 'D:\Tom && Jerry');
  recent.click();
  assert.deepEqual(sent, ['open-recent:D:\Tom & Jerry']);
  assert.equal(item(template, 'Help', 'Check for Updates...'), undefined);
});

test('menu state from the renderer is normalised', () => {
  assert.deepEqual(normalizeRendererMenuState({
    hasSession: 'yes', videoCount: -4, recentFolders: ['a', 3, ''], sortBy: 'evil', sortOptions: ['size', 'evil'],
  }), {
    ...EMPTY_RENDERER_MENU_STATE,
    recentFolders: ['a'],
    sortOptions: ['size'],
  });
});

test('the title bar folder menu lists the loaded folders and reveals the chosen one', () => {
  const sent = [];
  const state = {
    ...EMPTY_RENDERER_MENU_STATE, isDev: false, updatesEnabled: false, processing: false, paused: false, finishAction: 'none',
    hasSession: true, folders: ['D:\Clips', 'E:\Trips'],
  };
  const template = buildFolderMenuTemplate(state, (action) => sent.push(action));
  assert.deepEqual(template.slice(0, 2).map((entry) => [entry.label, entry.enabled]), [['D:\Clips', false], ['E:\Trips', false]]);
  const reveal = template.find((entry) => entry.label === 'Reveal in Explorer');
  reveal.submenu[1].click();
  assert.deepEqual(sent, ['reveal-folder:E:\Trips']);

  const single = buildFolderMenuTemplate({ ...state, folders: ['D:\Clips'] }, (action) => sent.push(action));
  single.find((entry) => entry.label === 'Reveal in Explorer').click();
  assert.deepEqual(sent.at(-1), 'reveal-folder:D:\Clips');
});

test('menu items get ids from their path that survive changing counts', () => {
  const marked = item(menu({ hasSession: true, markedCount: 3 }), 'Actions', 'Delete Marked Videos (3)...');
  assert.equal(marked.id, 'Actions > Delete Marked Videos');
  assert.equal(item(menu(), 'View', 'Sort By').submenu.find((entry) => entry.label === 'Name').id, 'View > Sort By > Name');
});

test('the command palette lists runnable items, not submenus, separators, hidden items or itself', () => {
  // Shaped like Electron MenuItems.
  const toItems = (template) => template.map((entry) => ({
    type: entry.type ?? (entry.submenu ? 'submenu' : 'normal'),
    visible: entry.visible !== false,
    label: entry.label ?? '',
    id: entry.id,
    accelerator: entry.accelerator,
    enabled: entry.enabled !== false,
    checked: entry.checked ?? false,
    submenu: Array.isArray(entry.submenu) ? { items: toItems(entry.submenu) } : null,
  }));
  const commands = listCommands(toItems(menu({ hasSession: true, groupByFolder: true })));
  const ids = commands.map((command) => command.id);
  assert.ok(ids.includes('View > Sort By > Name'));
  assert.ok(!ids.includes('View > Sort By'));
  assert.ok(!ids.includes('View > Command Palette'));
  assert.equal(ids.filter((id) => id === 'View > Larger Cards').length, 1);
  assert.deepEqual(commands.find((command) => command.id === 'View > Group by Folder'), {
    id: 'View > Group by Folder', path: ['View', 'Group by Folder'], accelerator: null, enabled: true, checked: true,
  });
  assert.equal(commands.find((command) => command.id === 'File > Open Folder').accelerator, 'CmdOrCtrl+O');
});
