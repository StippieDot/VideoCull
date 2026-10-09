const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SORT_LABELS, buildMenuTemplate, listCommands, normalizeRendererMenuState, EMPTY_RENDERER_MENU_STATE } = require('../../electron/app-menu');

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

test('scan-only processing allows finish actions but cannot be paused', () => {
  const scan = menu({ processing: true });
  assert.equal(item(scan, 'Actions', 'Pause Processing').enabled, false);
  assert.equal(item(scan, 'Actions', 'When Processing Finishes').enabled, true);
  assert.equal(item(menu({ processing: true, canPauseProcessing: true }), 'Actions', 'Pause Processing').enabled, true);
  assert.equal(normalizeRendererMenuState({ canPauseProcessing: 'yes' }).canPauseProcessing, false);
  assert.equal(normalizeRendererMenuState({ canPauseProcessing: true }).canPauseProcessing, true);
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
  const folders = ['D:\\Private Clips', 'E:\\Private Trips'];
  const recentFolders = ['P:\\Private Recent'];
  const template = menu({ hasSession: true, videoCount: 3, isPrivate: true, folders, recentFolders });
  assert.equal(item(template, 'File', 'Open Folder...').enabled, false);
  assert.equal(item(template, 'File', 'quit').enabled, undefined);
  assert.equal(item(template, 'View', 'Privacy Screen').enabled, undefined);
  assert.equal(item(template, 'View', 'Privacy Screen').checked, true);
  const recent = item(template, 'File', 'Open Recent');
  assert.equal(recent.enabled, false);
  assert.deepEqual(recent.submenu.map((entry) => entry.label), ['No recent folders']);
  const reveal = item(template, 'File', 'Reveal Folder in Explorer');
  assert.equal(reveal.enabled, false);
  assert.equal(reveal.submenu, undefined);
  const visible = menu({ hasSession: true, folders, recentFolders });
  assert.deepEqual(item(visible, 'File', 'Open Recent').submenu.map((entry) => entry.label), recentFolders);
  assert.deepEqual(item(visible, 'File', 'Reveal Folder in Explorer').submenu.map((entry) => entry.label), folders);
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

test('File > Reveal Folder in Explorer offers each loaded folder', () => {
  const sent = [];
  const reveal = (folders) => item(
    buildMenuTemplate({ ...EMPTY_RENDERER_MENU_STATE, hasSession: true, folders }, { ...actions, send: (action) => sent.push(action) }),
    'File',
    'Reveal Folder in Explorer',
  );
  reveal(['D:\\Clips', 'E:\\Trips']).submenu[1].click();
  assert.deepEqual(sent, ['reveal-folder:E:\\Trips']);
  reveal(['D:\\Clips']).click();
  assert.deepEqual(sent.at(-1), 'reveal-folder:D:\\Clips');
});

test('menu items get ids from their path that survive changing counts', () => {
  const marked = item(menu({ hasSession: true, markedCount: 3 }), 'Actions', 'Delete Marked Videos (3)...');
  assert.equal(marked.id, 'Actions > Delete Marked Videos');
  assert.equal(item(menu(), 'View', 'Sort By').submenu.find((entry) => entry.label === 'Name').id, 'View > Sort By > Name');
  // The title bar's finish-action menu runs these by id (TitleBar.tsx).
  assert.deepEqual(item(menu(), 'Actions', 'When Processing Finishes').submenu.map((entry) => entry.id), [
    'Actions > When Processing Finishes > Do Nothing',
    'Actions > When Processing Finishes > Sleep',
    'Actions > When Processing Finishes > Shut Down',
  ]);
});

test('recent folders whose names differ only by a number keep separate ids', () => {
  const recent = item(menu({ recentFolders: ['D:\\Clips', 'D:\\Clips (2)'] }), 'File', 'Open Recent').submenu;
  assert.deepEqual(recent.map((entry) => entry.id), ['File > Open Recent > D:\\Clips', 'File > Open Recent > D:\\Clips (2)']);
});

test('reveal commands keep distinct folder ids and target the matching folder', () => {
  const folders = ['D:\\Clips', 'D:\\Clips (2)'];
  const sent = [];
  const template = buildMenuTemplate({ ...EMPTY_RENDERER_MENU_STATE, folders }, { ...actions, send: (action) => sent.push(action) });
  const reveal = item(template, 'File', 'Reveal Folder in Explorer').submenu;
  const ids = folders.map((folder) => `File > Reveal Folder in Explorer > ${folder}`);
  assert.deepEqual(reveal.map((entry) => entry.id), ids);
  ids.forEach((id) => reveal.find((entry) => entry.id === id).click());
  assert.deepEqual(sent, folders.map((folder) => `reveal-folder:${folder}`));
});

test('the hidden Ctrl+= alias of Larger Cards follows it when no folder is open', () => {
  const larger = (template) => template.find((entry) => entry.label === 'View').submenu.filter((entry) => entry.label === 'Larger Cards');
  assert.deepEqual(larger(menu()).map((entry) => entry.enabled), [false, false]);
  assert.deepEqual(larger(menu({ hasSession: true })).map((entry) => entry.enabled), [true, true]);
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

test('the ids the title bar and sidebar run exist in the menu', () => {
  const template = menu({ hasSession: true, markedCount: 3, processing: true });
  const ids = [];
  (function collect(items) {
    for (const entry of items) {
      if (entry.id) ids.push(entry.id);
      if (Array.isArray(entry.submenu)) collect(entry.submenu);
    }
  })(template);
  for (const id of [
    'File', 'Actions', 'View', 'Video', 'Help',
    'File > Add Folder to Session',
    'Actions > Delete Marked Videos',
    'Actions > When Processing Finishes > Do Nothing',
    'Actions > When Processing Finishes > Sleep',
    'Actions > When Processing Finishes > Shut Down',
  ]) assert.ok(ids.includes(id), `missing menu id: ${id}`);
});

const typesSource = fs.readFileSync(path.join(__dirname, '../../src/types.ts'), 'utf8');
const stringsOf = (text) => [...text.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

test('every sort field the grid knows has a menu label', () => {
  const fields = stringsOf(typesSource.match(/export type SortField = ([^;]+);/)[1]);
  assert.deepEqual(Object.keys(SORT_LABELS).sort(), [...fields].sort());
});

test('every plain action the menu sends is a MenuAction the window understands', () => {
  const declared = new Set(stringsOf(typesSource.match(/export type MenuAction =([^;]+);/)[1]));
  const menuSource = fs.readFileSync(path.join(__dirname, '../../electron/app-menu.js'), 'utf8');
  const sent = [...menuSource.matchAll(/send\('([a-z-]+)'\)/g)].map((match) => match[1]);
  assert.ok(sent.length > 20);
  for (const action of sent) assert.ok(declared.has(action), `MenuAction is missing "${action}"`);
});

test('the command palette lists items below a disabled submenu as disabled', () => {
  const toItems = (template) => template.map((entry) => ({
    type: entry.type ?? (entry.submenu ? 'submenu' : 'normal'),
    visible: entry.visible !== false,
    label: entry.label ?? '',
    id: entry.id,
    enabled: entry.enabled !== false,
    checked: entry.checked ?? false,
    submenu: Array.isArray(entry.submenu) ? { items: toItems(entry.submenu) } : null,
  }));
  const commands = listCommands(toItems(menu({ hasSession: false, processing: false })));
  const byId = (id) => commands.find((command) => command.id === id);
  assert.equal(byId('View > Sort By > Name').enabled, false);
  assert.equal(byId('Actions > When Processing Finishes > Sleep').enabled, false);
  assert.equal(byId('View > Toggle Dark / Light Theme').enabled, true);
});
