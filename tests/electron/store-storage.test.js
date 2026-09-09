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

test('resolves durable and disposable paths beneath the installed PFN root', () => {
  const root = tempRoot();
  const storage = resolveStoreStorage({
    env: { LOCALAPPDATA: root },
    platform: 'win32',
    packageFamilyName: product.microsoftStore.packageFamilyName,
  });

  assert.equal(storage.userData, path.join(root, 'Packages', product.microsoftStore.packageFamilyName, 'LocalState', 'profile'));
  assert.equal(storage.defaultCentralCacheRoot, path.join(root, 'Packages', product.microsoftStore.packageFamilyName, 'LocalCache', 'video-cache'));
  assert.equal(storage.sessionData, path.join(root, 'Packages', product.microsoftStore.packageFamilyName, 'LocalCache', 'session'));
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
  assert.equal(result.status, 'store-package');
  assert.ok(calls.some(([name, key, pathValue]) => name === 'setPath' && key === 'sessionData' && pathValue === result.storage.sessionData));
  assert.ok(calls.some(([name, key, pathValue]) => name === 'setPath' && key === 'crashDumps' && pathValue === result.storage.crashDumps));
  assert.ok(calls.some(([name, pathValue]) => name === 'setAppLogsPath' && pathValue === result.storage.logs));
  assert.equal(calls.some(([name]) => name === 'setAppUserModelId'), false);
});
