const assert = require('node:assert/strict');
const path = require('node:path');
const { createFileOpsDelete } = require('../../electron/file-ops-delete');
const { createLibraryRegistry } = require('../../electron/library-registry');
const {
  filterLoadedDeletionPaths,
  matchesFileIdentityAtPath,
  removeEmptyDeletedVideoFolders,
} = require('../../electron/main-helpers');

const root = path.resolve('/lib');
const filePath = path.join(root, 'a.mp4');
const identity = { sizeBytes: 10, mtimeMs: 1000, birthtimeMs: null, dev: null, ino: null };
const statsFor = { size: 10, mtimeMs: 1000 };

function setup({ stat = async () => statsFor, trashItem = async () => {}, scanned } = {}) {
  const registry = createLibraryRegistry();
  registry.addRoot(root);
  const [videos, realPaths] = scanned ?? [[{ path: filePath, id: 'id-a', fileIdentity: identity }], new Map()];
  registry.recordScanned(videos, realPaths);
  const calls = { trashed: [], unlinked: [], deletedFromCache: [], forgotten: [], rm: [] };
  const ops = createFileOpsDelete({
    libraryRegistry: registry,
    fs: {
      stat,
      access: async () => {},
      rm: async (target) => { calls.rm.push(target); },
      unlink: async (target) => { calls.unlinked.push(target); },
      lstat: async () => ({ isSymbolicLink: () => false }),
      rmdir: async () => {},
    },
    shell: { trashItem: async (target) => { await trashItem(target); calls.trashed.push(target); } },
    cacheService: { deleteVideos: async (folder, _options, ids) => { calls.deletedFromCache.push([folder, ids]); } },
    getCacheOptions: async () => ({}),
    getCachePaths: (folder) => ({ thumbRootDir: path.join(folder, '.thumbs'), dbPath: path.join(folder, 'cache.db') }),
    mapWithConcurrency: (items, _limit, worker) => Promise.all(items.map(worker)),
    cacheIoConcurrency: 6,
    shouldRemoveEmptyFoldersAfterDelete: async () => false,
    removeEmptyDeletedVideoFolders,
    isPathWithinAnyDir: async () => true,
    filterLoadedDeletionPaths,
    matchesFileIdentityAtPath,
    isValidLoadedPath: async (candidate) => registry.isKnownPath(candidate),
    forgetDuplicateVideos: (ids) => calls.forgotten.push(...ids),
    log: { warn: () => {} },
  });
  return { ops, registry, calls };
}

test('a trashed video loses its cache rows, thumbnails and place in the session', async () => {
  const { ops, registry, calls } = setup();
  const results = await ops.batchDelete([filePath]);
  assert.deepEqual(results, [{ path: filePath, success: true, method: 'trash' }]);
  assert.deepEqual(calls.trashed, [filePath]);
  assert.deepEqual(calls.deletedFromCache, [[root, ['id-a']]]);
  assert.deepEqual(calls.rm, [path.join(root, '.thumbs', 'id-a')]);
  assert.deepEqual(calls.forgotten, ['id-a']);
  assert.equal(registry.isKnownPath(filePath), false);
});

test('a path outside the loaded session is rejected and nothing is touched', async () => {
  const { ops, calls } = setup();
  const stranger = path.join(root, 'other.mp4');
  const message = 'Path is outside the loaded directory scope.';
  assert.deepEqual(await ops.batchDelete([stranger]), [{ path: stranger, success: false, error: message }]);
  assert.deepEqual(await ops.permanentlyDelete([stranger]), [{ path: stranger, success: false, error: message, method: 'permanent' }]);
  assert.deepEqual([...calls.trashed, ...calls.unlinked], []);
});

for (const [name, method] of [['batchDelete', 'trash'], ['permanentlyDelete', 'permanent']]) {
  test(`${name} refuses a file that changed since the scan`, async () => {
    const { ops, calls, registry } = setup({ stat: async () => ({ size: 11, mtimeMs: 1000 }) });
    const results = await ops[name]([filePath]);
    assert.deepEqual(results, [{ path: filePath, success: false, error: 'File changed since it was scanned. Scan again before deleting.', method }]);
    assert.deepEqual([...calls.trashed, ...calls.unlinked], []);
    assert.equal(registry.isKnownPath(filePath), true);
  });

  test(`${name} refuses a file that cannot be checked`, async () => {
    const { ops, calls } = setup({ stat: async () => { throw new Error('EBUSY'); } });
    const [result] = await ops[name]([filePath]);
    assert.equal(result.success, false);
    assert.deepEqual([...calls.trashed, ...calls.unlinked], []);
  });
}

test('a video reached through a link is checked and removed at its real path', async () => {
  const link = path.join(root, 'link.mp4');
  const real = path.resolve('/elsewhere/real.mp4');
  const statted = [];
  const { ops, calls } = setup({
    stat: async (target) => { statted.push(target); return statsFor; },
    scanned: [[{ path: link, id: 'id-l', fileIdentity: identity }], new Map([[link, real]])],
  });
  assert.equal((await ops.batchDelete([link]))[0].success, true);
  assert.deepEqual(statted, [real]);
  assert.deepEqual(calls.trashed, [real]);
  assert.equal((await ops.permanentlyDelete([link]))[0].success, false, 'already gone from the session');
});

test('a permanent delete unlinks the real path', async () => {
  const { ops, calls } = setup();
  const [result] = await ops.permanentlyDelete([filePath]);
  assert.deepEqual(result, { path: filePath, success: true, method: 'permanent' });
  assert.deepEqual(calls.unlinked, [filePath]);
});

test('a failed trash reports the error message and keeps the video in the session', async () => {
  const { ops, registry, calls } = setup({ trashItem: async () => { throw new Error('locked'); } });
  const [result] = await ops.batchDelete([filePath]);
  assert.deepEqual(result, { path: filePath, success: false, error: 'locked', method: 'trash' });
  assert.equal(registry.isKnownPath(filePath), true);
  assert.deepEqual(calls.deletedFromCache, []);
});
