const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { selectProfile } = require('../../electron/profile-bootstrap');
const {
  STORAGE_FORMAT_FILE,
  ensureProfileStorageCompatibility,
} = require('../../electron/storage-compatibility');

const tempRoots = [];

function createProfile(name = 'VideoCull') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-storage-format-'));
  tempRoots.push(root);
  const profilePath = path.join(root, name);
  fs.mkdirSync(profilePath, { recursive: true });
  return { profilePath, root };
}

function writeMarker(profilePath, value) {
  fs.writeFileSync(path.join(profilePath, STORAGE_FORMAT_FILE), value, 'utf8');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('initializes an unversioned existing profile as legacy storage format 1', () => {
  const { profilePath } = createProfile();
  fs.writeFileSync(path.join(profilePath, 'settings.json'), '{"theme":"dark"}');

  const result = ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 1 });

  assert.equal(result.initialized, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.markerPath, 'utf8')), { formatVersion: 1 });
  assert.equal(fs.readFileSync(path.join(profilePath, 'settings.json'), 'utf8'), '{"theme":"dark"}');
});

test('never stamps an unversioned legacy profile with a newer supported format', () => {
  const { profilePath } = createProfile();

  assert.throws(
    () => ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 2 }),
    (error) => error.code === 'VIDEOCULL_STORAGE_FORMAT_OLDER',
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(profilePath, STORAGE_FORMAT_FILE), 'utf8')),
    { formatVersion: 1 },
  );
});

test('publishes the marker atomically and removes an interrupted temporary file', () => {
  const { profilePath } = createProfile();
  const fsImpl = Object.create(fs);
  fsImpl.writeFileSync = (descriptor) => {
    fs.writeFileSync(descriptor, '{"formatVersion":', 'utf8');
    throw new Error('simulated interruption');
  };

  assert.throws(
    () => ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 1, fsImpl }),
    /simulated interruption/,
  );
  assert.equal(fs.existsSync(path.join(profilePath, STORAGE_FORMAT_FILE)), false);
  assert.deepEqual(fs.readdirSync(profilePath), []);
});

test('accepts matching formats without rewriting the marker', () => {
  const { profilePath } = createProfile();
  writeMarker(profilePath, '{\n  "formatVersion": 1,\n  "futureField": true\n}\n');
  const markerPath = path.join(profilePath, STORAGE_FORMAT_FILE);
  const original = fs.readFileSync(markerPath, 'utf8');

  const result = ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 1 });

  assert.equal(result.initialized, false);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), original);
});

test('rejects a newer format before changing shared profile data', () => {
  const { profilePath } = createProfile();
  const settingsPath = path.join(profilePath, 'settings.json');
  const indexPath = path.join(profilePath, 'cache-index.json');
  const cachePath = path.join(profilePath, 'video-cache', 'library.db');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(settingsPath, '{"theme":"dark"}');
  fs.writeFileSync(indexPath, '{"knownFolders":["D:\\\\Media"]}');
  fs.writeFileSync(cachePath, 'sqlite-bytes');
  writeMarker(profilePath, '{"formatVersion":2}');

  assert.throws(
    () => ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 1 }),
    (error) => error.code === 'VIDEOCULL_STORAGE_FORMAT_NEWER'
      && /newer incompatible version/i.test(error.userMessage),
  );
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{"theme":"dark"}');
  assert.equal(fs.readFileSync(indexPath, 'utf8'), '{"knownFolders":["D:\\\\Media"]}');
  assert.equal(fs.readFileSync(cachePath, 'utf8'), 'sqlite-bytes');
});

test('fails closed for older unsupported or malformed markers', () => {
  const { profilePath } = createProfile();
  writeMarker(profilePath, '{"formatVersion":1}');
  assert.throws(
    () => ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 2 }),
    (error) => error.code === 'VIDEOCULL_STORAGE_FORMAT_OLDER',
  );

  writeMarker(profilePath, '{not-json');
  assert.throws(
    () => ensureProfileStorageCompatibility(profilePath, { supportedFormatVersion: 1 }),
    (error) => error.code === 'VIDEOCULL_STORAGE_FORMAT_INVALID',
  );
});

test('places the marker in the safely selected profile for every 2.2.x rename outcome', () => {
  const renamed = createProfile('video-cull');
  const renamedSelection = selectProfile({
    appDataPath: renamed.root,
    legacyName: 'video-cull',
    canonicalName: 'VideoCull',
  });
  ensureProfileStorageCompatibility(renamedSelection.selectedPath, { supportedFormatVersion: 1 });
  assert.equal(renamedSelection.status, 'renamed');
  assert.ok(fs.existsSync(path.join(renamed.root, 'VideoCull', STORAGE_FORMAT_FILE)));

  const dual = createProfile('video-cull');
  fs.mkdirSync(path.join(dual.root, 'VideoCull'));
  const dualSelection = selectProfile({
    appDataPath: dual.root,
    legacyName: 'video-cull',
    canonicalName: 'VideoCull',
  });
  ensureProfileStorageCompatibility(dualSelection.selectedPath, { supportedFormatVersion: 1 });
  assert.equal(dualSelection.status, 'both-canonical');
  assert.ok(fs.existsSync(path.join(dual.root, 'VideoCull', STORAGE_FORMAT_FILE)));
  assert.equal(fs.existsSync(path.join(dual.root, 'video-cull', STORAGE_FORMAT_FILE)), false);

  const fallback = createProfile('video-cull');
  const fsImpl = Object.create(fs);
  fsImpl.renameSync = () => { throw new Error('locked'); };
  const fallbackSelection = selectProfile({
    appDataPath: fallback.root,
    legacyName: 'video-cull',
    canonicalName: 'VideoCull',
    fsImpl,
  });
  ensureProfileStorageCompatibility(fallbackSelection.selectedPath, { supportedFormatVersion: 1 });
  assert.equal(fallbackSelection.status, 'rename-fallback');
  assert.ok(fs.existsSync(path.join(fallback.root, 'video-cull', STORAGE_FORMAT_FILE)));
});
