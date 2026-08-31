const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const vm = require('node:vm');
const {
  configureAppProfile,
  expectedChildPath,
  selectProfile,
} = require('../../electron/profile-bootstrap');

const tempRoots = [];

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-profile-test-'));
  tempRoots.push(root);
  return root;
}

function createProfile(root, name, withData = false) {
  const profilePath = path.join(root, name);
  fs.mkdirSync(profilePath, { recursive: true });
  if (withData) {
    fs.writeFileSync(path.join(profilePath, 'settings.json'), '{"theme":"dark"}');
    fs.mkdirSync(path.join(profilePath, 'video-cache', 'thumbs'), { recursive: true });
    fs.writeFileSync(path.join(profilePath, 'video-cache', 'library.db'), 'database-state');
    fs.writeFileSync(path.join(profilePath, 'video-cache', 'thumbs', 'thumb.jpg'), 'thumbnail');
  }
  return profilePath;
}

function createApp(root, options = {}) {
  const calls = [];
  const app = {
    isPackaged: options.isPackaged ?? true,
    getPath(name) {
      assert.equal(name, 'appData');
      calls.push(['getPath', name]);
      return root;
    },
    setName(value) {
      calls.push(['setName', value]);
    },
    setPath(name, value) {
      assert.ok(fs.existsSync(value), `${name} must exist before setPath`);
      calls.push(['setPath', name, value]);
    },
    setAppUserModelId(value) {
      calls.push(['setAppUserModelId', value]);
    },
  };
  return { app, calls };
}

function executeBootstrap({ profileError = null, mainError = null } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'bootstrap.js'), 'utf8');
  const calls = [];
  const errors = [];
  const app = { exit: () => calls.push('exit') };
  const context = {
    globalThis: {},
    console: { error: (...args) => errors.push(args) },
    require(specifier) {
      if (specifier === 'electron') return { app };
      if (specifier === './profile-bootstrap') {
        return {
          configureAppProfile(receivedApp) {
            assert.equal(receivedApp, app);
            calls.push('configure');
            if (profileError) throw profileError;
            return { selectedPath: 'C:\\AppData\\VideoCull' };
          },
        };
      }
      if (specifier === './main') {
        calls.push('main');
        if (mainError) throw mainError;
        return {};
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };
  vm.runInNewContext(source, context, { filename: 'electron/bootstrap.js' });
  return { calls, context, errors };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('entrypoint configures the profile before importing the application', () => {
  const { calls, context } = executeBootstrap();
  assert.deepEqual(calls, ['configure', 'main']);
  assert.equal(context.globalThis.__VIDEOCULL_PROFILE_BOOTSTRAP__.selectedPath, 'C:\\AppData\\VideoCull');
});

test('application import errors are not reported as profile initialization errors', () => {
  assert.throws(() => executeBootstrap({ mainError: new Error('main import failed') }), /main import failed/);
});

test('profile initialization failure exits before importing the application', () => {
  const { calls, errors } = executeBootstrap({ profileError: new Error('profile failed') });
  assert.deepEqual(calls, ['configure', 'exit']);
  assert.equal(errors.length, 1);
});

test('fresh production bootstrap creates and selects VideoCull', () => {
  const root = createTempRoot();
  const { app, calls } = createApp(root);
  const result = configureAppProfile(app, { env: {} });
  const expected = path.join(root, 'VideoCull');

  assert.equal(result.status, 'fresh');
  assert.ok(fs.statSync(expected).isDirectory());
  assert.deepEqual(calls.slice(-4), [
    ['setName', 'VideoCull'],
    ['setPath', 'userData', expected],
    ['setPath', 'sessionData', expected],
    ['setAppUserModelId', 'com.videocull.app'],
  ]);
});

test('fresh development bootstrap uses an isolated VideoCull-dev profile', () => {
  const root = createTempRoot();
  const { app, calls } = createApp(root, { isPackaged: false });
  const result = configureAppProfile(app, { env: {} });
  const expected = path.join(root, 'VideoCull-dev');

  assert.equal(result.isDev, true);
  assert.deepEqual(calls.filter(([kind]) => kind === 'setPath'), [
    ['setPath', 'userData', expected],
    ['setPath', 'sessionData', expected],
  ]);
});

test('legacy profile is atomically renamed with its data intact', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull', true);
  fs.writeFileSync(path.join(legacy, '.updaterId'), 'existing-id');

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  const canonical = path.join(root, 'VideoCull');

  assert.equal(result.status, 'renamed');
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(path.join(canonical, '.updaterId'), 'utf8'), 'existing-id');
  assert.equal(fs.readFileSync(path.join(canonical, 'video-cache', 'library.db'), 'utf8'), 'database-state');
});

test('rename failure leaves and selects the legacy profile', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull', true);
  const fsImpl = Object.create(fs);
  fsImpl.renameSync = () => { throw new Error('locked'); };

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull', fsImpl });

  assert.equal(result.status, 'rename-fallback');
  assert.equal(result.selectedPath, legacy);
  assert.ok(result.warning);
  assert.equal(fs.existsSync(path.join(root, 'VideoCull')), false);
});

test('an existing canonical profile is selected without inspecting its contents', () => {
  const root = createTempRoot();
  const canonical = createProfile(root, 'VideoCull');
  fs.writeFileSync(path.join(canonical, 'settings.json'), '{invalid');

  const first = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  const second = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(first.status, 'canonical');
  assert.equal(second.selectedPath, canonical);
});

test('dual profiles use canonical and retain both with a warning', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull');
  const canonical = createProfile(root, 'VideoCull');

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(result.status, 'both-canonical');
  assert.equal(result.selectedPath, canonical);
  assert.ok(result.warning);
  assert.ok(fs.existsSync(legacy));
  assert.ok(fs.existsSync(canonical));
});

test('profile roots must be direct child directories', () => {
  const root = createTempRoot();
  fs.writeFileSync(path.join(root, 'VideoCull'), 'not-a-directory');

  assert.throws(
    () => selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' }),
    /not a regular directory/,
  );
  assert.throws(() => expectedChildPath(root, '..'), /direct child/);
});

test('E2E bootstrap creates its isolated profile and bypasses migration', () => {
  const root = createTempRoot();
  createProfile(root, 'video-cull');
  const e2e = path.join(root, 'e2e', 'profile');
  const { app, calls } = createApp(root, { isPackaged: false });

  const result = configureAppProfile(app, { env: { VC_E2E_USE_DIST: '1', VC_E2E_USER_DATA_DIR: e2e } });

  assert.equal(result.status, 'e2e');
  assert.ok(fs.statSync(e2e).isDirectory());
  assert.ok(fs.existsSync(path.join(root, 'video-cull')));
  assert.deepEqual(calls.filter(([kind]) => kind === 'setPath'), [
    ['setPath', 'userData', e2e],
    ['setPath', 'sessionData', e2e],
  ]);
  assert.throws(
    () => configureAppProfile(app, { env: { VC_E2E_USE_DIST: '1' } }),
    /VC_E2E_USER_DATA_DIR is required/,
  );
});
