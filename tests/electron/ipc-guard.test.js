const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedAppUrl, isTrustedIpcSender, guardIpcMain, lockWebContents } = require('../../electron/ipc-guard');

const rendererIndexPath = path.join(__dirname, 'renderer', 'index.html');
const prod = { isDev: false, devPort: 5173, rendererIndexPath };
const dev = { isDev: true, devPort: 5173, rendererIndexPath };

test('isTrustedAppUrl accepts only the built page in production', () => {
  assert.equal(isTrustedAppUrl(pathToFileURL(rendererIndexPath).href, prod), true);
  assert.equal(isTrustedAppUrl(`${pathToFileURL(rendererIndexPath).href}#/x?y=1`, prod), true);
  assert.equal(isTrustedAppUrl(pathToFileURL(path.join(__dirname, 'other.html')).href, prod), false);
  assert.equal(isTrustedAppUrl('https://example.com/', prod), false);
  assert.equal(isTrustedAppUrl('http://localhost:5173/', prod), false);
  assert.equal(isTrustedAppUrl('not a url', prod), false);
});

test('isTrustedAppUrl accepts only the dev server origin in development', () => {
  assert.equal(isTrustedAppUrl('http://localhost:5173/', dev), true);
  assert.equal(isTrustedAppUrl('http://localhost:5174/', dev), false);
  assert.equal(isTrustedAppUrl('http://evil.test:5173/', dev), false);
  assert.equal(isTrustedAppUrl(pathToFileURL(rendererIndexPath).href, dev), false);
});

test('isTrustedIpcSender requires our window, its main frame and our page', () => {
  const mainFrame = { url: pathToFileURL(rendererIndexPath).href };
  const webContents = { isDestroyed: () => false, mainFrame };
  const win = { webContents };
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, win, prod), true);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: { url: mainFrame.url } }, win, prod), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: { ...mainFrame, url: 'https://example.com/' }, }, { webContents: { ...webContents, mainFrame: { url: 'https://example.com/' } } }, prod), false);
  assert.equal(isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, win, prod), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: null }, win, prod), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, null, prod), false);
});

test('guardIpcMain runs listeners for trusted senders and rejects the rest', async () => {
  const registered = {};
  const ipcMain = {
    handle: (channel, fn) => { registered[`handle:${channel}`] = fn; },
    on: (channel, fn) => { registered[`on:${channel}`] = fn; },
  };
  const rejected = [];
  guardIpcMain(ipcMain, (event) => event.trusted, (channel) => rejected.push(channel));
  const calls = [];
  ipcMain.handle('ask', (_event, value) => { calls.push(value); return value * 2; });
  ipcMain.on('tell', (_event, value) => { calls.push(value); });

  assert.equal(await registered['handle:ask']({ trusted: true }, 21), 42);
  registered['on:tell']({ trusted: true }, 1);
  await assert.rejects(async () => registered['handle:ask']({ trusted: false }, 5), /untrusted sender/);
  registered['on:tell']({ trusted: false }, 2);

  assert.deepEqual(calls, [21, 1]);
  assert.deepEqual(rejected, ['ask', 'tell']);
});

test('lockWebContents blocks foreign navigation and denies new windows', () => {
  const handlers = {};
  let openHandler;
  const webContents = {
    on: (name, fn) => { handlers[name] = fn; },
    setWindowOpenHandler: (fn) => { openHandler = fn; },
  };
  const blocked = [];
  lockWebContents(webContents, (url) => url === 'ok', (url) => blocked.push(url));

  const allowed = { preventDefault: () => { throw new Error('should not block'); } };
  handlers['will-navigate'](allowed, 'ok');
  let prevented = 0;
  handlers['will-navigate']({ preventDefault: () => { prevented += 1; } }, 'https://example.com/');
  handlers['will-redirect']({ preventDefault: () => { prevented += 1; } }, 'https://example.com/');
  handlers['will-attach-webview']({ preventDefault: () => { prevented += 1; } });

  assert.equal(prevented, 3);
  assert.deepEqual(openHandler({ url: 'https://example.com/' }), { action: 'deny' });
  assert.deepEqual(blocked, ['https://example.com/', 'https://example.com/', 'https://example.com/']);
});
