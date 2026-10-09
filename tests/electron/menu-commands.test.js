const assert = require('node:assert/strict');
const { runMenuCommand, openMenuAt, applyTaskbarProgress } = require('../../electron/menu-commands');

function fakeWindow({ destroyed = false } = {}) {
  const calls = [];
  return {
    calls,
    webContents: { id: 'contents' },
    isDestroyed: () => destroyed,
    setProgressBar: (...args) => calls.push(args),
  };
}

function fakeMenu(items) {
  return {
    items: Object.entries(items).map(([id, item]) => Object.assign(item, { id })),
    getMenuItemById: (id) => items[id] ?? null,
  };
}

function fakeItem(overrides = {}) {
  const clicks = [];
  return { clicks, enabled: true, visible: true, click: (...args) => clicks.push(args), ...overrides };
}

test('run-command runs an enabled, visible item with the window', () => {
  const item = fakeItem();
  const window = fakeWindow();
  assert.equal(runMenuCommand(fakeMenu({ 'File > Open Folder': item }), 'File > Open Folder', window), true);
  assert.deepEqual(item.clicks, [[undefined, window, window.webContents]]);
});

test('run-command refuses what the menu would not let the user click', () => {
  const window = fakeWindow();
  const cases = {
    disabled: fakeItem({ enabled: false }),
    hidden: fakeItem({ visible: false }),
    submenu: fakeItem({ submenu: { items: [], popup() {} } }),
  };
  for (const [name, item] of Object.entries(cases)) {
    assert.equal(runMenuCommand(fakeMenu({ id: item }), 'id', window), false, name);
    assert.equal(item.clicks.length, 0, name);
  }
  const item = fakeItem();
  assert.equal(runMenuCommand(fakeMenu({ id: item }), 42, window), false, 'non-string id');
  assert.equal(runMenuCommand(fakeMenu({ id: item }), 'unknown', window), false, 'unknown id');
  assert.equal(runMenuCommand(fakeMenu({ id: item }), 'id', fakeWindow({ destroyed: true })), false, 'destroyed window');
  assert.equal(runMenuCommand(fakeMenu({ id: item }), 'id', null), false, 'no window');
  assert.equal(runMenuCommand(null, 'id', window), false, 'no menu');
  assert.equal(item.clicks.length, 0);
});

test('open-app-menu pops a submenu up at rounded coordinates and resolves when it closes', async () => {
  const popups = [];
  const item = fakeItem({ submenu: { popup: (options) => popups.push(options) } });
  const window = fakeWindow();
  const closed = openMenuAt(fakeMenu({ File: item }), 'File', window, 10.4, 20.6);
  assert.equal(popups.length, 1);
  assert.deepEqual({ x: popups[0].x, y: popups[0].y, window: popups[0].window }, { x: 10, y: 21, window });
  popups[0].callback();
  assert.equal(await closed, true);
});

test('open-app-menu resolves false instead of opening something unusable', async () => {
  const withSubmenu = fakeItem({ submenu: { popup() { assert.fail('must not open'); } } });
  const plain = fakeItem();
  const window = fakeWindow();
  const menu = fakeMenu({ File: withSubmenu, Plain: plain });
  assert.equal(await openMenuAt(menu, 'Plain', window, 1, 1), false, 'item without a submenu');
  assert.equal(await openMenuAt(menu, 'Missing', window, 1, 1), false, 'unknown id');
  assert.equal(await openMenuAt(menu, 7, window, 1, 1), false, 'non-string id');
  assert.equal(await openMenuAt(menu, 'File', window, Number.NaN, 1), false, 'non-finite x');
  assert.equal(await openMenuAt(menu, 'File', window, 1, Infinity), false, 'non-finite y');
  assert.equal(await openMenuAt(menu, 'File', fakeWindow({ destroyed: true }), 1, 1), false, 'destroyed window');
});

test('taskbar progress clamps the fraction and keeps the paused and normal modes', () => {
  const window = fakeWindow();
  applyTaskbarProgress(window, { mode: 'normal', fraction: 1.7 });
  applyTaskbarProgress(window, { mode: 'paused', fraction: -0.2 });
  applyTaskbarProgress(window, { mode: 'normal', fraction: 0.25 });
  assert.deepEqual(window.calls, [[1, { mode: 'normal' }], [0, { mode: 'paused' }], [0.25, { mode: 'normal' }]]);
});

test('taskbar progress ignores a missing fraction, shows the moving bar and clears otherwise', () => {
  const window = fakeWindow();
  applyTaskbarProgress(window, { mode: 'normal', fraction: Number.NaN });
  applyTaskbarProgress(window, { mode: 'normal' });
  applyTaskbarProgress(window, { mode: 'normal', fraction: '0.5' });
  assert.deepEqual(window.calls, []);
  applyTaskbarProgress(window, { mode: 'indeterminate' });
  applyTaskbarProgress(window, { mode: 'none' });
  applyTaskbarProgress(window, null);
  applyTaskbarProgress(fakeWindow({ destroyed: true }), { mode: 'none' });
  assert.deepEqual(window.calls, [[2, { mode: 'indeterminate' }], [-1]]);
});

test('run-command refuses an enabled item below a disabled submenu', () => {
  const window = fakeWindow();
  const child = fakeItem({ id: 'Actions > When Processing Finishes > Sleep' });
  const parent = fakeItem({ id: 'Actions > When Processing Finishes', enabled: false, submenu: { items: [child], popup() {} } });
  const menu = { items: [{ id: 'Actions', enabled: true, visible: true, submenu: { items: [parent], popup() {} } }] };
  assert.equal(runMenuCommand(menu, child.id, window), false);
  assert.equal(child.clicks.length, 0);

  parent.enabled = true;
  assert.equal(runMenuCommand(menu, child.id, window), true);
  assert.equal(child.clicks.length, 1);
});
