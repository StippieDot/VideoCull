const assert = require('node:assert/strict');
const { buildMenuTemplate, normalizeRendererMenuState, EMPTY_RENDERER_MENU_STATE } = require('../../electron/app-menu');

const actions = {
  send: () => {},
  setFinishAction: () => {},
  setPaused: () => {},
  openReleaseNotes: () => {},
  reportProblem: () => {},
  openLogFolder: () => {},
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

  const session = menu({ hasSession: true, videoCount: 3, markedCount: 2, hasActiveVideo: true, processing: true });
  assert.equal(item(session, 'File', 'Rescan').enabled, true);
  assert.equal(item(session, 'Actions', 'Delete Marked Videos (2)...').enabled, true);
  assert.equal(item(session, 'Video', 'Reveal in Explorer').enabled, true);
  assert.equal(item(session, 'Actions', 'When Processing Finishes').enabled, true);
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
  assert.deepEqual(normalizeRendererMenuState({ hasSession: 'yes', videoCount: -4, view: 'other', recentFolders: ['a', 3, ''] }), {
    ...EMPTY_RENDERER_MENU_STATE,
    recentFolders: ['a'],
  });
});
