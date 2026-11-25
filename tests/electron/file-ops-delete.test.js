const assert = require('node:assert/strict');
const path = require('node:path');
const { createFileOpsDelete, classifyDeleteError } = require('../../electron/file-ops-delete');
const { createLibraryRegistry } = require('../../electron/library-registry');
const {
  checkFileIdentityAtPath,
  filterLoadedDeletionPaths,
  removeEmptyDeletedVideoFolders,
} = require('../../electron/main-helpers');

const root = path.resolve('/lib');
const filePath = path.join(root, 'a.mp4');
const identity = { sizeBytes: 10, mtimeMs: 1000, birthtimeMs: null, dev: null, ino: null };
const statsFor = { size: 10, mtimeMs: 1000 };
const failure = (message, code) => Object.assign(new Error(message), code ? { code } : {});

function setup({ stat = async () => statsFor, trashItem = async () => {}, unlink = async () => {}, busy = [], scanned } = {}) {
  const registry = createLibraryRegistry();
  registry.addRoot(root);
  const [videos, realPaths] = scanned ?? [[{ path: filePath, id: 'id-a', fileIdentity: identity }], new Map()];
  registry.recordScanned(videos, realPaths);
  const calls = { trashed: [], unlinked: [], deletedFromCache: [], forgotten: [], rm: [], skipped: [], waited: [] };
  const ops = createFileOpsDelete({
    libraryRegistry: registry,
    fs: {
      stat,
      access: async () => {},
      rm: async (target) => { calls.rm.push(target); },
      unlink: async (target) => { await unlink(target); calls.unlinked.push(target); },
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
    checkFileIdentityAtPath,
    isValidLoadedPath: async (candidate) => registry.isKnownPath(candidate),
    forgetDuplicateVideos: (ids) => calls.forgotten.push(...ids),
    processingRuns: {
      skipFiles: (paths) => calls.skipped.push(...paths),
      waitUntilIdle: async (paths, timeoutMs) => { calls.waited.push(timeoutMs); return paths.filter((p) => busy.includes(p)); },
    },
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

test('a path outside the loaded session is rejected as out-of-scope and nothing is touched', async () => {
  const { ops, calls } = setup();
  const stranger = path.join(root, 'other.mp4');
  const message = 'Path is outside the loaded directory scope.';
  assert.deepEqual(await ops.batchDelete([stranger]), [{ path: stranger, success: false, error: message, reason: 'out-of-scope', method: 'trash' }]);
  assert.deepEqual(await ops.permanentlyDelete([stranger]), [{ path: stranger, success: false, error: message, reason: 'out-of-scope', method: 'permanent' }]);
  assert.deepEqual([...calls.trashed, ...calls.unlinked, ...calls.skipped], []);
});

for (const [name, method] of [['batchDelete', 'trash'], ['permanentlyDelete', 'permanent']]) {
  test(`${name} refuses a file that changed since the scan`, async () => {
    const { ops, calls, registry } = setup({ stat: async () => ({ size: 11, mtimeMs: 1000 }) });
    const results = await ops[name]([filePath]);
    assert.deepEqual(results, [{ path: filePath, success: false, error: 'File changed since it was scanned. Scan again before deleting.', reason: 'changed', method }]);
    assert.deepEqual([...calls.trashed, ...calls.unlinked], []);
    assert.equal(registry.isKnownPath(filePath), true);
  });

  test(`${name} refuses a file that cannot be checked and keeps the cause`, async () => {
    const { ops, calls } = setup({ stat: async () => { throw failure('device not ready', 'EIO'); } });
    const [result] = await ops[name]([filePath]);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'unverifiable');
    assert.equal(result.code, 'EIO');
    assert.match(result.error, /device not ready/);
    assert.deepEqual([...calls.trashed, ...calls.unlinked], []);
  });

  test(`${name} reports a file that vanished as not-found`, async () => {
    const { ops } = setup({ stat: async () => { throw failure('gone', 'ENOENT'); } });
    const [result] = await ops[name]([filePath]);
    assert.deepEqual([result.reason, result.code], ['not-found', 'ENOENT']);
  });

  test(`${name} stands processing down, then reports files still busy as in-use without touching them`, async () => {
    const { ops, calls, registry } = setup({ busy: [filePath] });
    const [result] = await ops[name]([filePath]);
    assert.deepEqual(calls.skipped, [filePath]);
    assert.deepEqual(calls.waited, [10_000]);
    assert.deepEqual(result, { path: filePath, success: false, error: 'File is still being processed.', reason: 'in-use', method });
    assert.deepEqual([...calls.trashed, ...calls.unlinked], []);
    assert.equal(registry.isKnownPath(filePath), true);
  });
}

test('a file replaced between attempts (same path and size) is refused as changed on the retry', async () => {
  let mtimeMs = 1000;
  const { ops, calls } = setup({
    stat: async () => ({ size: 10, mtimeMs }),
    trashItem: async () => { throw failure('Operation was aborted'); },
  });
  assert.equal((await ops.batchDelete([filePath]))[0].reason, 'in-use');
  mtimeMs = 2000;
  const [retry] = await ops.batchDelete([filePath]);
  assert.equal(retry.reason, 'changed');
  assert.deepEqual(calls.trashed, []);
});

test('a retry touches only the files it is given', async () => {
  const other = path.join(root, 'b.mp4');
  const { ops, calls } = setup({
    scanned: [[{ path: filePath, id: 'id-a', fileIdentity: identity }, { path: other, id: 'id-b', fileIdentity: identity }], new Map()],
  });
  const results = await ops.batchDelete([filePath]);
  assert.deepEqual(results.map((r) => r.path), [filePath]);
  assert.deepEqual(calls.trashed, [filePath]);
  assert.deepEqual(calls.skipped, [filePath]);
});

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

test('a failed trash reports the error message and reason, and keeps the video in the session', async () => {
  const { ops, registry, calls } = setup({ trashItem: async () => { throw failure('Failed to perform delete operation'); } });
  const [result] = await ops.batchDelete([filePath]);
  assert.deepEqual(result, { path: filePath, success: false, error: 'Failed to perform delete operation', reason: 'trash-unavailable', method: 'trash' });
  assert.equal(registry.isKnownPath(filePath), true);
  assert.deepEqual(calls.deletedFromCache, []);
});

describe('classifyDeleteError', () => {
  const cases = [
    // Messages recorded from Electron's shell.trashItem on Windows 11.
    ['trash', 'Operation was aborted', undefined, 'in-use'],
    ['trash', 'Failed to perform delete operation', undefined, 'trash-unavailable'],
    ['trash', 'Failed to parse path', undefined, 'not-found'],
    ['trash', 'Failed to move item to trash', undefined, 'trash-unavailable'],
    ['trash', 'something unexpected', undefined, 'unknown'],
    ['trash', 'denied', 'EACCES', 'permission'],
    ['trash', 'denied', 'EPERM', 'permission'],
    ['trash', 'busy', 'EBUSY', 'in-use'],
    ['trash', 'missing', 'ENOENT', 'not-found'],
    // A failed unlink never means the Recycle Bin is unavailable.
    ['permanent', 'Failed to perform delete operation', undefined, 'unknown'],
    ['permanent', 'denied', 'EPERM', 'permission'],
    ['permanent', 'busy', 'EBUSY', 'in-use'],
  ];
  for (const [method, message, code, reason] of cases) {
    test(`${method}: ${code ?? message} -> ${reason}`, () => {
      assert.deepEqual(classifyDeleteError(failure(message, code), method), code ? { reason, code } : { reason });
    });
  }
});
