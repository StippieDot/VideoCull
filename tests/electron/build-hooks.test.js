const assert = require('node:assert/strict');
const path = require('node:path');
const { test: nodeTest } = require('node:test');
const {
  afterPack,
  assertLegalFilesPresent,
  runPackagedSqliteSmoke,
} = require('../../scripts/electron-builder-hooks');
const test = globalThis.test || nodeTest;

test('afterPack writes notices, checks legal files, then smoke-tests the executable from appOutDir', async () => {
  const calls = [];
  await afterPack({
    electronPlatformName: 'win32',
    appOutDir: 'D:\\release\\win-unpacked',
    packager: { appInfo: { productFilename: 'VideoCull' } },
  }, {
    writeNotices: (resourcesPath) => calls.push(['notices', resourcesPath]),
    checkLegalFiles: (resourcesPath) => calls.push(['legal', resourcesPath]),
    runSmoke: (executablePath, resourcesPath) => calls.push(['smoke', executablePath, resourcesPath]),
  });

  const resourcesPath = path.join('D:\\release\\win-unpacked', 'resources');
  assert.deepEqual(calls, [
    ['notices', resourcesPath],
    ['legal', resourcesPath],
    ['smoke', path.join('D:\\release\\win-unpacked', 'VideoCull.exe'), resourcesPath],
  ]);
});

test('packaging fails when a legal file is missing from resources', () => {
  const resourcesPath = 'D:\\release\\resources';
  const present = new Set([
    path.join(resourcesPath, 'LICENSE.txt'),
    path.join(resourcesPath, 'THIRD_PARTY_NOTICES.txt'),
  ]);
  assert.doesNotThrow(() => assertLegalFilesPresent(resourcesPath, (filePath) => present.has(filePath)));
  assert.throws(
    () => assertLegalFilesPresent(resourcesPath, (filePath) => filePath.endsWith('LICENSE.txt')),
    /missing legal files: THIRD_PARTY_NOTICES\.txt/,
  );
});

test('packaged smoke runner isolates module resolution and fails the build on a non-zero result', () => {
  let invocation = null;
  const spawn = (executablePath, args, options) => {
    invocation = { executablePath, args, options };
    return { status: 0 };
  };
  runPackagedSqliteSmoke('D:\\release\\VideoCull.exe', 'D:\\release\\resources', spawn);

  assert.equal(invocation.options.cwd, 'D:\\release');
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(invocation.options.env.NODE_PATH, undefined);
  assert.equal(invocation.options.env.NODE_OPTIONS, undefined);
  assert.deepEqual(invocation.args.slice(1), ['D:\\release\\resources']);
  assert.throws(
    () => runPackagedSqliteSmoke('D:\\release\\VideoCull.exe', 'D:\\release\\resources', () => ({ status: 7 })),
    /exit code 7/,
  );
});
