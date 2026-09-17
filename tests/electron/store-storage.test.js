const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const product = require('../../product.json');
const {
  assertPathInside,
  configureAppProfile,
  resolveStoreStorage,
} = require('../../electron/profile-bootstrap');

const tempRoots = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-store-storage-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('resolves only Store runtime paths beneath the installed PFN root', () => {
  const root = tempRoot();
  const storage = resolveStoreStorage({
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    packageFamilyName: product.microsoftStore.packageFamilyName,
  });

  assert.equal(storage.runtimeState, path.join(root, 'Packages', product.microsoftStore.packageFamilyName, 'LocalState', 'runtime'));
  assert.equal(storage.sessionData, path.join(root, 'Packages', product.microsoftStore.packageFamilyName, 'LocalCache', 'session'));
  assert.equal('userData' in storage, false);
  assert.equal('defaultCentralCacheRoot' in storage, false);
});

test('rejects missing, relative, or non-Windows Store storage', () => {
  const input = { platform: 'win32', packageFamilyName: product.microsoftStore.packageFamilyName };
  assert.throws(() => resolveStoreStorage({ ...input, env: {} }), /LOCALAPPDATA/);
  assert.throws(() => resolveStoreStorage({ ...input, env: { LOCALAPPDATA: 'relative' } }), /absolute/);
  assert.throws(() => resolveStoreStorage({ ...input, env: { LOCALAPPDATA: tempRoot() }, platform: 'linux' }), /only supported on Windows/);
  assert.throws(
    () => resolveStoreStorage({ ...input, env: { LOCALAPPDATA: tempRoot() }, packageFamilyName: 'Unexpected.Package_123' }),
    /identity mismatch/,
  );
  assert.throws(() => assertPathInside('C:\\Package', 'C:\\Outside', path.win32), /descendant/);
  assert.equal(assertPathInside('C:\\Package', 'c:\\PACKAGE\\LocalState', path.win32), 'c:\\PACKAGE\\LocalState');
});

test('configures Electron Store paths before startup without overriding the package AUMID', () => {
  const root = tempRoot();
  const roaming = path.join(root, 'Roaming');
  fs.mkdirSync(roaming, { recursive: true });
  const calls = [];
  const app = {
    isPackaged: true,
    getPath(name) {
      assert.equal(name, 'appData');
      return roaming;
    },
    setName(value) { calls.push(['setName', value]); },
    setPath(name, value) {
      assert.ok(fs.statSync(value).isDirectory());
      calls.push(['setPath', name, value]);
    },
    setAppLogsPath(value) { calls.push(['setAppLogsPath', value]); },
    setAppUserModelId(value) { calls.push(['setAppUserModelId', value]); },
  };

  const result = configureAppProfile(app, {
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    isWindowsStore: true,
  });

  assert.equal(result.distributionChannel, 'microsoft-store');
  assert.equal(result.status, 'store-shared-profile');
  assert.equal(result.sharedPersistentProfile, true);
  assert.equal(result.selectedPath, path.join(roaming, product.displayName));
  assert.equal(result.defaultCentralCacheRoot, path.join(roaming, product.displayName, 'video-cache'));
  assert.ok(calls.some(([name, key, pathValue]) => name === 'setPath' && key === 'userData' && pathValue === result.selectedPath));
  assert.ok(calls.some(([name, key, pathValue]) => name === 'setPath' && key === 'sessionData' && pathValue === result.storage.sessionData));
  assert.ok(calls.some(([name, key, pathValue]) => name === 'setPath' && key === 'crashDumps' && pathValue === result.storage.crashDumps));
  assert.ok(calls.some(([name, pathValue]) => name === 'setAppLogsPath' && pathValue === result.storage.logs));
  assert.equal(calls.some(([name]) => name === 'setAppUserModelId'), false);
  assert.equal(fs.existsSync(path.join(result.storage.localState, 'profile')), false);
  assert.equal(fs.existsSync(path.join(result.storage.localCache, 'video-cache')), false);
});

test('Store and direct packaged builds select the same existing persistent profile', () => {
  const root = tempRoot();
  const roaming = path.join(root, 'Roaming');
  const existingProfile = path.join(roaming, product.displayName);
  const existingCache = path.join(existingProfile, 'video-cache');
  fs.mkdirSync(existingCache, { recursive: true });
  fs.writeFileSync(path.join(existingProfile, 'settings.json'), '{"shared":true}');
  fs.writeFileSync(path.join(existingCache, 'shared.db'), 'same-file');

  function createApp() {
    return {
      isPackaged: true,
      getPath(name) {
        assert.equal(name, 'appData');
        return roaming;
      },
      setName() {},
      setPath() {},
      setAppLogsPath() {},
      setAppUserModelId() {},
    };
  }

  const store = configureAppProfile(createApp(), {
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    isWindowsStore: true,
  });
  const direct = configureAppProfile(createApp(), {
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    isWindowsStore: false,
  });

  assert.equal(store.selectedPath, direct.selectedPath);
  assert.equal(store.defaultCentralCacheRoot, path.join(direct.selectedPath, 'video-cache'));
  assert.equal(fs.readFileSync(path.join(store.selectedPath, 'settings.json'), 'utf8'), '{"shared":true}');
  assert.equal(fs.readFileSync(path.join(store.defaultCentralCacheRoot, 'shared.db'), 'utf8'), 'same-file');
});

test('a Store-first profile is created where a later direct build can use it', () => {
  const root = tempRoot();
  const roaming = path.join(root, 'Roaming');
  fs.mkdirSync(roaming, { recursive: true });

  function createApp() {
    return {
      isPackaged: true,
      getPath: () => roaming,
      setName() {},
      setPath() {},
      setAppLogsPath() {},
      setAppUserModelId() {},
    };
  }

  const store = configureAppProfile(createApp(), {
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    isWindowsStore: true,
  });
  fs.mkdirSync(store.defaultCentralCacheRoot, { recursive: true });
  fs.writeFileSync(path.join(store.selectedPath, 'settings.json'), '{"createdBy":"store"}');
  fs.writeFileSync(path.join(store.defaultCentralCacheRoot, 'new.db'), 'created-by-store');

  const direct = configureAppProfile(createApp(), {
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    isWindowsStore: false,
  });
  assert.equal(direct.selectedPath, store.selectedPath);
  assert.equal(fs.readFileSync(path.join(direct.selectedPath, 'settings.json'), 'utf8'), '{"createdBy":"store"}');
  assert.equal(fs.readFileSync(path.join(direct.selectedPath, 'video-cache', 'new.db'), 'utf8'), 'created-by-store');

  fs.writeFileSync(path.join(direct.selectedPath, 'settings.json'), '{"updatedBy":"direct"}');
  assert.equal(fs.readFileSync(path.join(store.selectedPath, 'settings.json'), 'utf8'), '{"updatedBy":"direct"}');
});
