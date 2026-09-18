const assert = require('node:assert/strict');
const path = require('node:path');
const { test: nodeTest } = require('node:test');
const {
  afterPack,
  beforeBuild,
  runPackagedSqliteSmoke,
} = require('../../scripts/electron-builder-hooks');
const test = globalThis.test || nodeTest;

test('beforeBuild force-rebuilds better-sqlite3 for the exact Electron target and preserves dependency collection', async () => {
  let rebuildOptions = null;
  const result = await beforeBuild({
    appDir: 'D:\\VideoCull',
    electronVersion: '41.10.7',
    arch: 'x64',
  }, {
    rebuild: async (options) => { rebuildOptions = options; },
  });

  assert.deepEqual(rebuildOptions, {
    buildPath: 'D:\\VideoCull',
    electronVersion: '41.10.7',
    arch: 'x64',
    force: true,
    onlyModules: ['better-sqlite3'],
  });
  assert.equal(result, true);
});

test('afterPack validates the Windows executable and resources from appOutDir', async () => {
  let received = null;
  await afterPack({
    electronPlatformName: 'win32',
    appOutDir: 'D:\\release\\win-unpacked',
    packager: { appInfo: { productFilename: 'VideoCull' } },
  }, {
    runSmoke: (executablePath, resourcesPath) => { received = { executablePath, resourcesPath }; },
  });

  assert.deepEqual(received, {
    executablePath: path.join('D:\\release\\win-unpacked', 'VideoCull.exe'),
    resourcesPath: path.join('D:\\release\\win-unpacked', 'resources'),
  });
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
