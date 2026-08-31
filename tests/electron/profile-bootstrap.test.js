const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const vm = require('node:vm');
const {
  MAX_CONTROL_JSON_BYTES,
  configureAppProfile,
  expectedChildPath,
  selectProfile,
  validateProfile,
} = require('../../electron/profile-bootstrap');

const tempRoots = [];

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-profile-test-'));
  tempRoots.push(root);
  return root;
}

function createProfile(root, name, options = {}) {
  const profilePath = path.join(root, name);
  fs.mkdirSync(profilePath, { recursive: true });
  if (options.settings !== false) {
    fs.writeFileSync(path.join(profilePath, 'settings.json'), JSON.stringify(options.settings ?? { theme: 'dark' }));
  }
  if (options.withCache) {
    fs.mkdirSync(path.join(profilePath, 'video-cache', 'thumbs', 'folder', 'video'), { recursive: true });
    fs.writeFileSync(path.join(profilePath, 'video-cache', 'library.db'), 'database-state');
    fs.writeFileSync(path.join(profilePath, 'video-cache', 'library.db-wal'), 'wal-state');
    fs.writeFileSync(path.join(profilePath, 'video-cache', 'thumbs', 'folder', 'video', 'thumb_1.jpg'), 'thumbnail');
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

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('entrypoint completes profile configuration before importing the application', () => {
  const bootstrapSource = fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'bootstrap.js'), 'utf8');
  const calls = [];
  const app = { exit: () => calls.push('exit') };
  const context = {
    console,
    globalThis: {},
    require(specifier) {
      if (specifier === 'electron') return { app };
      if (specifier === './profile-bootstrap') {
        return {
          configureAppProfile(receivedApp) {
            assert.equal(receivedApp, app);
            calls.push('configure');
            return { selectedPath: 'C:\\AppData\\VideoCull' };
          },
        };
      }
      if (specifier === './main') {
        calls.push('main');
        return {};
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };

  vm.runInNewContext(bootstrapSource, context, { filename: 'electron/bootstrap.js' });

  assert.deepEqual(calls, ['configure', 'main']);
  assert.equal(context.globalThis.__VIDEOCULL_PROFILE_BOOTSTRAP__.selectedPath, 'C:\\AppData\\VideoCull');
});

test('fresh production bootstrap creates VideoCull before setting userData and sessionData', () => {
  const root = createTempRoot();
  const { app, calls } = createApp(root);

  const result = configureAppProfile(app, { env: {} });
  const expected = path.join(root, 'VideoCull');

  assert.equal(result.status, 'fresh');
  assert.equal(result.selectedPath, expected);
  assert.ok(fs.statSync(expected).isDirectory());
  assert.deepEqual(calls.slice(-4), [
    ['setName', 'VideoCull'],
    ['setPath', 'userData', expected],
    ['setPath', 'sessionData', expected],
    ['setAppUserModelId', 'com.videocull.app'],
  ]);
});

test('fresh development bootstrap creates an isolated VideoCull-dev profile', () => {
  const root = createTempRoot();
  const { app, calls } = createApp(root, { isPackaged: false });

  const result = configureAppProfile(app, { env: {} });
  const expected = path.join(root, 'VideoCull-dev');

  assert.equal(result.status, 'fresh');
  assert.equal(result.isDev, true);
  assert.ok(fs.statSync(expected).isDirectory());
  assert.deepEqual(calls.filter(([kind]) => kind === 'setPath'), [
    ['setPath', 'userData', expected],
    ['setPath', 'sessionData', expected],
  ]);
});

test('legacy production profile is atomically renamed without copying its cache', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull', { withCache: true });
  fs.writeFileSync(path.join(legacy, '.updaterId'), '00000000-0000-4000-8000-000000000000');

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  const canonical = path.join(root, 'VideoCull');

  assert.equal(result.status, 'renamed');
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(path.join(canonical, '.updaterId'), 'utf8'), '00000000-0000-4000-8000-000000000000');
  assert.equal(fs.readFileSync(path.join(canonical, 'video-cache', 'library.db'), 'utf8'), 'database-state');
  assert.equal(fs.readFileSync(path.join(canonical, 'video-cache', 'library.db-wal'), 'utf8'), 'wal-state');
  assert.equal(fs.readFileSync(path.join(canonical, 'video-cache', 'thumbs', 'folder', 'video', 'thumb_1.jpg'), 'utf8'), 'thumbnail');
});

test('rename failure leaves legacy untouched and selects it for the session', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull', { withCache: true });
  const fsImpl = Object.create(fs);
  fsImpl.renameSync = () => {
    const error = new Error('locked');
    error.code = 'EPERM';
    throw error;
  };

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull', fsImpl });

  assert.equal(result.status, 'rename-fallback');
  assert.equal(result.selectedPath, legacy);
  assert.ok(fs.existsSync(path.join(legacy, 'video-cache', 'thumbs', 'folder', 'video', 'thumb_1.jpg')));
  assert.equal(fs.existsSync(path.join(root, 'VideoCull')), false);
});

test('canonical-only profile is selected idempotently', () => {
  const root = createTempRoot();
  const canonical = createProfile(root, 'VideoCull');

  const first = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  const second = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(first.status, 'canonical');
  assert.equal(second.status, 'canonical');
  assert.equal(second.selectedPath, canonical);
});

test('restart after a completed rename uses the canonical profile', () => {
  const root = createTempRoot();
  createProfile(root, 'video-cull');

  const migrated = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  const restarted = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(migrated.status, 'renamed');
  assert.equal(restarted.status, 'canonical');
});

test('dual profiles prefer a valid canonical profile without merging or deleting', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull', { settings: { theme: 'light' } });
  const canonical = createProfile(root, 'VideoCull', { settings: { theme: 'dark' } });

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(result.status, 'both-canonical');
  assert.equal(result.selectedPath, canonical);
  assert.ok(result.warning);
  assert.ok(fs.existsSync(legacy));
  assert.ok(fs.existsSync(canonical));
});

test('dual profiles fall back to valid legacy when canonical validation fails', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull');
  const canonical = createProfile(root, 'VideoCull', { settings: false });
  fs.writeFileSync(path.join(canonical, 'settings.json'), '{invalid');

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(result.status, 'both-legacy');
  assert.equal(result.selectedPath, legacy);
  assert.ok(fs.existsSync(canonical));
});

test('invalid legacy profile is retained and used instead of being renamed', () => {
  const root = createTempRoot();
  const legacy = createProfile(root, 'video-cull');
  fs.writeFileSync(path.join(legacy, 'video-cache'), 'unexpected-file');

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });

  assert.equal(result.status, 'legacy-validation-fallback');
  assert.equal(result.selectedPath, legacy);
  assert.equal(fs.existsSync(path.join(root, 'VideoCull')), false);
});

test('bounded validation rejects oversized control JSON without traversing thumbnail trees', () => {
  const root = createTempRoot();
  const profile = createProfile(root, 'VideoCull', { settings: false, withCache: true });
  fs.writeFileSync(path.join(profile, 'settings.json'), Buffer.alloc(MAX_CONTROL_JSON_BYTES + 1, 32));
  let thumbnailTraversal = false;
  const fsImpl = Object.create(fs);
  fsImpl.readdirSync = (candidatePath, ...args) => {
    if (String(candidatePath).includes('thumbs')) thumbnailTraversal = true;
    return fs.readdirSync(candidatePath, ...args);
  };

  const result = validateProfile(profile, fsImpl);

  assert.equal(result.valid, false);
  assert.equal(thumbnailTraversal, false);
  assert.ok(result.errors.some((message) => message.includes('bounded startup validation limit')));
});

test('profile roots cannot escape appData', () => {
  const root = createTempRoot();
  assert.throws(() => expectedChildPath(root, '..'), /direct child/);
});

test('profile roots cannot be symbolic links or junctions', (t) => {
  const root = createTempRoot();
  const target = createProfile(root, 'target');
  const linked = path.join(root, 'video-cull');
  try {
    fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating a test junction is not permitted on this runner.');
      return;
    }
    throw error;
  }

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  assert.equal(result.status, 'legacy-validation-fallback');
  assert.equal(fs.existsSync(path.join(root, 'VideoCull')), false);
});

test('unexpected profile entries cannot be symbolic links or junctions', (t) => {
  const root = createTempRoot();
  const profile = createProfile(root, 'video-cull');
  const target = createProfile(root, 'outside-target');
  try {
    fs.symlinkSync(target, path.join(profile, 'unexpected-link'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Creating a test junction is not permitted on this runner.');
      return;
    }
    throw error;
  }

  const result = selectProfile({ appDataPath: root, legacyName: 'video-cull', canonicalName: 'VideoCull' });
  assert.equal(result.status, 'legacy-validation-fallback');
  assert.equal(fs.existsSync(path.join(root, 'VideoCull')), false);
});

test('E2E bootstrap creates and isolates its requested profile while bypassing migration', () => {
  const root = createTempRoot();
  createProfile(root, 'video-cull');
  const e2e = path.join(root, 'e2e', 'profile');
  const { app, calls } = createApp(root, { isPackaged: false });

  const result = configureAppProfile(app, {
    env: { VC_E2E_USE_DIST: '1', VC_E2E_USER_DATA_DIR: e2e },
  });

  assert.equal(result.status, 'e2e');
  assert.equal(result.isE2E, true);
  assert.ok(fs.statSync(e2e).isDirectory());
  assert.ok(fs.existsSync(path.join(root, 'video-cull')));
  assert.deepEqual(calls.filter(([kind]) => kind === 'setPath'), [
    ['setPath', 'userData', e2e],
    ['setPath', 'sessionData', e2e],
  ]);
});

test('E2E bootstrap requires an explicit isolated profile path', () => {
  const root = createTempRoot();
  const { app } = createApp(root, { isPackaged: false });
  assert.throws(
    () => configureAppProfile(app, { env: { VC_E2E_USE_DIST: '1' } }),
    /VC_E2E_USER_DATA_DIR is required/,
  );
});
