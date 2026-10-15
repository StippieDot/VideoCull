const path = require('path');
const { fileURLToPath } = require('url');

/**
 * True only for the app's own renderer page: the Vite dev server in development, the built
 * index.html otherwise. Query and hash are ignored.
 */
function isTrustedAppUrl(rawUrl, { isDev, devPort, rendererIndexPath }) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (isDev) return url.protocol === 'http:' && url.hostname === 'localhost' && url.port === String(devPort);
  if (url.protocol !== 'file:') return false;
  const normalize = (filePath) => (process.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath));
  try {
    return normalize(fileURLToPath(url)) === normalize(rendererIndexPath);
  } catch {
    return false;
  }
}

/** The sender must be the main frame of our own window, showing our own page. */
function isTrustedIpcSender(event, mainWindow, trust) {
  const contents = mainWindow?.webContents;
  if (!contents || contents.isDestroyed() || event?.sender !== contents) return false;
  const frame = event.senderFrame;
  return Boolean(frame) && frame === contents.mainFrame && isTrustedAppUrl(frame.url, trust);
}

/**
 * Wraps ipcMain.handle / ipcMain.on so every channel registered afterwards ignores untrusted
 * senders. Registration stays in main.js; the check lives here once.
 */
function guardIpcMain(ipcMain, isTrusted, onReject = () => {}) {
  const handle = ipcMain.handle.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    if (!isTrusted(event)) {
      onReject(channel, event);
      throw new Error(`Rejected IPC call on "${channel}" from an untrusted sender.`);
    }
    return listener(event, ...args);
  });
  ipcMain.on = (channel, listener) => on(channel, (event, ...args) => {
    if (!isTrusted(event)) {
      onReject(channel, event);
      return;
    }
    listener(event, ...args);
  });
}

/** Keeps the window on the app page: blocks navigation away from it and every new window. */
function lockWebContents(webContents, isTrustedUrl, onBlocked = () => {}) {
  const blockUntrusted = (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    onBlocked(url);
  };
  webContents.on('will-navigate', blockUntrusted);
  webContents.on('will-redirect', blockUntrusted);
  webContents.setWindowOpenHandler(({ url }) => {
    onBlocked(url);
    return { action: 'deny' };
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());
}

module.exports = { isTrustedAppUrl, isTrustedIpcSender, guardIpcMain, lockWebContents };
