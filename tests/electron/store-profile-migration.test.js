const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  MARKER_FILE,
  MINIMUM_HEADROOM_BYTES,
  createStoreProfileMigration,
} = require('../../electron/store-profile-migration');

const roots = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-store-migration-'));
  roots.push(root);
  const sourceProfile = path.join(root, 'source');
  const targetProfile = path.join(root, 'LocalState', 'profile');
  const targetCache = path.join(root, 'LocalCache', 'video-cache');
  await fs.mkdir(path.join(sourceProfile, 'video-cache', 'thumbs'), { recursive: true });
  await fs.mkdir(targetProfile, { recursive: true });
  await fs.mkdir(path.dirname(targetCache), { recursive: true });
  return { root, sourceProfile, targetProfile, targetCache };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

test('durable state succeeds before cache choice and excludes updater/session files', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), '{"theme":"dark"}');
  await fs.writeFile(path.join(paths.sourceProfile, 'distributed-index.json'), '{"knownDistributedPaths":["D:\\\\Media"]}');
  await fs.writeFile(path.join(paths.sourceProfile, '.updaterId'), 'private');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');

  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
  });
  const status = await migration.prepare();

  assert.equal(status.durable, 'complete');
  assert.equal(status.stage, 'awaiting-cache-choice');
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  await assert.rejects(fs.stat(path.join(paths.targetProfile, '.updaterId')), /ENOENT/);
  assert.equal(JSON.parse(await fs.readFile(path.join(paths.targetProfile, MARKER_FILE), 'utf8')).cacheOutcome, null);
});

test('durable migration completes without waiting for delayed cache inspection', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), '{"theme":"dark"}');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  let cacheInspectionStarted = false;
  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    collectCacheFiles: async () => {
      cacheInspectionStarted = true;
      return new Promise(() => {});
    },
  });

  const status = await migration.prepareDurable();

  assert.equal(status.durable, 'complete');
  assert.equal(status.stage, 'pending');
  assert.equal(cacheInspectionStarted, false);
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'settings.json'), 'utf8'), '{"theme":"dark"}');
});

test('cache preflight publishes inspection progress', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'thumbs', 'one.jpg'), 'image');
  const statuses = [];
  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
    onStatus: (status) => statuses.push(status),
  });

  await migration.prepareDurable();
  const status = await migration.prepareCache();

  assert.equal(status.stage, 'awaiting-cache-choice');
  assert.deepEqual(status.preflightProgress, {
    filesScanned: 2,
    directoriesScanned: 2,
    bytesScanned: 13,
  });
  assert.ok(statuses.some((item) => item.stage === 'cache-preflight' && item.preflightProgress));
});

test('preflight includes required headroom and permits a rebuild choice', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    availableBytes: async () => 1,
  });
  const preflight = await migration.prepare();
  assert.equal(preflight.preflight.headroomBytes, MINIMUM_HEADROOM_BYTES);
  assert.equal(preflight.preflight.canCopy, false);
  const complete = await migration.chooseCache('rebuild');
  assert.equal(complete.cacheOutcome, 'rebuild');
  assert.equal(complete.durable, 'complete');
});

test('copies cache and matching index after successful preflight', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'thumbs', 'one.jpg'), 'image');
  await fs.writeFile(path.join(paths.sourceProfile, 'cache-index.json'), '{"knownFolders":["D:\\\\Media"]}');
  const statuses = [];
  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
    onStatus: (status) => statuses.push(status),
  });
  await migration.prepare();
  const complete = await migration.chooseCache('copy');

  assert.equal(complete.cacheOutcome, 'copied');
  assert.equal(await fs.readFile(path.join(paths.targetCache, 'library.db'), 'utf8'), 'database');
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'cache-index.json'), 'utf8'), '{"knownFolders":["D:\\\\Media"]}');
  assert.ok(statuses.some((status) => status.stage === 'cache-copy' && status.progress));
});

test('copies cache files with bounded concurrency', async () => {
  const paths = await fixture();
  const cacheRoot = path.join(paths.sourceProfile, 'video-cache');
  await Promise.all(Array.from({ length: 8 }, (_, index) => (
    fs.writeFile(path.join(cacheRoot, `cache-${index}.db`), `database-${index}`)
  )));
  let activeCopies = 0;
  let maximumActiveCopies = 0;
  const fsImpl = Object.create(fs);
  fsImpl.copyFile = async (source, target) => {
    if (!source.startsWith(cacheRoot)) return fs.copyFile(source, target);
    activeCopies += 1;
    maximumActiveCopies = Math.max(maximumActiveCopies, activeCopies);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return await fs.copyFile(source, target);
    } finally {
      activeCopies -= 1;
    }
  };
  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    fsImpl,
    cacheCopyConcurrency: 3,
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
  });

  await migration.prepare();
  const complete = await migration.chooseCache('copy');

  assert.equal(complete.cacheOutcome, 'copied');
  assert.equal(maximumActiveCopies, 3);
});

test('skips failed thumbnails while keeping the durable migration successful', async () => {
  const paths = await fixture();
  const thumbnail = path.join(paths.sourceProfile, 'video-cache', 'thumbs', 'one.jpg');
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), '{"theme":"light"}');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  await fs.writeFile(thumbnail, 'image');
  const fsImpl = Object.create(fs);
  fsImpl.copyFile = async (source, target) => {
    if (source === thumbnail) throw Object.assign(new Error('thumbnail locked'), { code: 'EACCES' });
    return fs.copyFile(source, target);
  };
  const migration = createStoreProfileMigration({ enabled: true, ...paths, fsImpl, availableBytes: async () => Number.MAX_SAFE_INTEGER });
  await migration.prepare();
  const complete = await migration.chooseCache('copy');
  assert.equal(complete.durable, 'complete');
  assert.equal(complete.cacheOutcome, 'copied-with-skips');
  assert.equal(complete.progress.skippedFiles, 1);
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'settings.json'), 'utf8'), '{"theme":"light"}');
});

test('falls back to rebuild when an essential cache file cannot be copied', async () => {
  const paths = await fixture();
  const database = path.join(paths.sourceProfile, 'video-cache', 'library.db');
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), '{"theme":"dark"}');
  await fs.writeFile(database, 'database');
  const fsImpl = Object.create(fs);
  fsImpl.copyFile = async (source, target) => {
    if (source === database) throw Object.assign(new Error('database locked'), { code: 'EACCES' });
    return fs.copyFile(source, target);
  };
  const migration = createStoreProfileMigration({ enabled: true, ...paths, fsImpl, availableBytes: async () => Number.MAX_SAFE_INTEGER });
  await migration.prepare();
  const complete = await migration.chooseCache('copy');
  assert.equal(complete.durable, 'complete');
  assert.equal(complete.cacheOutcome, 'rebuild');
  assert.match(complete.warning, /database locked/);
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'settings.json'), 'utf8'), '{"theme":"dark"}');
});

test('falls back to rebuild when staged cache promotion fails', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), '{"theme":"dark"}');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  const fsImpl = Object.create(fs);
  fsImpl.rename = async (source, target) => {
    if (source === `${paths.targetCache}.migration-staging` && target === paths.targetCache) {
      throw Object.assign(new Error('promotion interrupted'), { code: 'EACCES' });
    }
    return fs.rename(source, target);
  };
  const migration = createStoreProfileMigration({ enabled: true, ...paths, fsImpl, availableBytes: async () => Number.MAX_SAFE_INTEGER });
  await migration.prepare();
  const complete = await migration.chooseCache('copy');
  assert.equal(complete.durable, 'complete');
  assert.equal(complete.cacheOutcome, 'rebuild');
  assert.match(complete.warning, /promotion interrupted/);
  assert.deepEqual(complete.errors, ['promotion interrupted']);
  await assert.rejects(fs.stat(`${paths.targetCache}.migration-staging`), /ENOENT/);
});

test('reports unavailable imported external caches without failing durable migration', async () => {
  const paths = await fixture();
  const missing = path.join(paths.root, 'disconnected-cache');
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), JSON.stringify({ centralCachePath: missing }));
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  const migration = createStoreProfileMigration({ enabled: true, ...paths, availableBytes: async () => Number.MAX_SAFE_INTEGER });
  const status = await migration.prepare();
  assert.equal(status.durable, 'complete');
  assert.equal(status.stage, 'awaiting-cache-choice');
  assert.match(status.warning, /external cache location is unavailable/);
});

test('an interrupted staging directory is discarded on the next preflight', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  const staging = `${paths.targetCache}.migration-staging`;
  await fs.mkdir(staging, { recursive: true });
  await fs.writeFile(path.join(staging, 'partial.db'), 'partial');
  const migration = createStoreProfileMigration({
    enabled: true,
    ...paths,
    availableBytes: async () => Number.MAX_SAFE_INTEGER,
  });
  await migration.prepare();
  await assert.rejects(fs.stat(path.join(staging, 'partial.db')), /ENOENT/);
});

test('missing source completes without touching an existing Store profile', async () => {
  const paths = await fixture();
  await fs.rm(paths.sourceProfile, { recursive: true, force: true });
  await fs.writeFile(path.join(paths.targetProfile, 'settings.json'), 'store-state');
  const migration = createStoreProfileMigration({ enabled: true, ...paths });
  const status = await migration.prepare();
  assert.equal(status.stage, 'complete');
  assert.equal(status.durable, 'not-needed');
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'settings.json'), 'utf8'), 'store-state');
});

test('repeated launches use the completion marker without copying the source again', async () => {
  const paths = await fixture();
  await fs.writeFile(path.join(paths.sourceProfile, 'settings.json'), '{"theme":"dark"}');
  await fs.writeFile(path.join(paths.sourceProfile, 'video-cache', 'library.db'), 'database');
  const first = createStoreProfileMigration({ enabled: true, ...paths, availableBytes: async () => Number.MAX_SAFE_INTEGER });
  await first.prepare();
  await first.chooseCache('rebuild');
  await fs.writeFile(path.join(paths.targetProfile, 'settings.json'), '{"theme":"store-change"}');

  const second = createStoreProfileMigration({ enabled: true, ...paths, availableBytes: async () => Number.MAX_SAFE_INTEGER });
  const status = await second.prepare();
  assert.equal(status.stage, 'complete');
  assert.equal(status.cacheOutcome, 'rebuild');
  assert.equal(await fs.readFile(path.join(paths.targetProfile, 'settings.json'), 'utf8'), '{"theme":"store-change"}');
});
