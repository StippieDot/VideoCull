const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveLegalFilePath, openLegalFile, sourceCodeUrlForVersion } = require('../../electron/legal-files');

const packaged = { isPackaged: true, resourcesPath: 'C:\\App\\resources', appRoot: 'C:\\unused' };
const dev = { isPackaged: false, resourcesPath: 'C:\\unused', appRoot: 'D:\\repo' };

function fakeIo({ existing = [], openResult = '' } = {}) {
  const opened = [];
  return {
    opened,
    io: {
      exists: (filePath) => existing.includes(filePath),
      openPath: async (filePath) => {
        opened.push(filePath);
        return openResult;
      },
    },
  };
}

test('resolves bundled legal files inside the packaged resources folder', () => {
  assert.equal(resolveLegalFilePath('license', packaged), path.join('C:\\App\\resources', 'LICENSE.txt'));
  assert.equal(resolveLegalFilePath('notices', packaged), path.join('C:\\App\\resources', 'THIRD_PARTY_NOTICES.txt'));
});

test('uses the repository licence in development, where no notices file is generated', () => {
  assert.equal(resolveLegalFilePath('license', dev), path.join('D:\\repo', 'LICENSE'));
  assert.equal(resolveLegalFilePath('notices', dev), null);
});

test('rejects names outside the allow-list', () => {
  for (const name of ['LICENSE.txt', '../LICENSE', 'toString', '__proto__', '', null, 42, { name: 'license' }]) {
    assert.equal(resolveLegalFilePath(name, packaged), null, String(name));
  }
});

test('opens an allowed file that exists', async () => {
  const target = path.join('C:\\App\\resources', 'LICENSE.txt');
  const { io, opened } = fakeIo({ existing: [target] });

  assert.equal(await openLegalFile('license', packaged, io), true);
  assert.deepEqual(opened, [target]);
});

test('reports failure for unknown names, missing files and shell errors without opening anything else', async () => {
  const target = path.join('C:\\App\\resources', 'LICENSE.txt');

  const unknown = fakeIo({ existing: [target] });
  assert.equal(await openLegalFile('..\\..\\Windows\\win.ini', packaged, unknown.io), false);
  assert.deepEqual(unknown.opened, []);

  const missing = fakeIo();
  assert.equal(await openLegalFile('notices', packaged, missing.io), false);
  assert.deepEqual(missing.opened, []);

  const shellError = fakeIo({ existing: [target], openResult: 'No application is associated' });
  assert.equal(await openLegalFile('license', packaged, shellError.io), false);
});

test('links the source code of the running version to its release tag', () => {
  assert.equal(
    sourceCodeUrlForVersion('https://github.com/StippieDot/VideoCull', '2.4.0'),
    'https://github.com/StippieDot/VideoCull/tree/v2.4.0',
  );
});
