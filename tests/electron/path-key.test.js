const assert = require('node:assert/strict');
const path = require('path');
const { pathKey } = require('../../electron/path-key');

test('pathKey ignores letter case only on Windows', () => {
  const folder = path.resolve('Media', 'Trips');
  assert.equal(pathKey(folder, 'win32'), pathKey(folder.toLowerCase(), 'win32'));
  assert.notEqual(pathKey(folder, 'linux'), pathKey(folder.toLowerCase(), 'linux'));
  assert.notEqual(pathKey(folder, 'darwin'), pathKey(folder.toLowerCase(), 'darwin'));
});
