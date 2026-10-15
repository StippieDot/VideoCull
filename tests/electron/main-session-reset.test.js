const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// main.js registers its IPC handlers at load and cannot be required without Electron, so the
// handlers are checked as text.
const mainSource = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8').replace(/\r\n/g, '\n');

function handlerBody(channel) {
  const start = mainSource.indexOf(`ipcMain.handle('${channel}'`);
  assert.notEqual(start, -1, `${channel} handler not found`);
  const next = mainSource.indexOf('\nipcMain.handle(', start + 1);
  return mainSource.slice(start, next === -1 ? undefined : next);
}

describe('handlers that throw away the loaded session also stop duplicate detection', () => {
  for (const channel of ['reset-loaded-directories', 'clear-cache', 'migrate-cache-settings']) {
    test(channel, () => {
      assert.match(handlerBody(channel), /\bcancelActiveDuplicateRun\(\)/);
    });
  }
});

test('stopping duplicate detection cancels the run and forgets it', () => {
  const body = mainSource.match(/function cancelActiveDuplicateRun\(\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /activeDuplicateRun\.cancel\(\)/);
  assert.match(body, /activeDuplicateRun = null/);
  assert.doesNotMatch(body, /resume/);
});
