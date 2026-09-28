const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const resourcesPath = path.resolve(process.argv[2] || '');
const packagedModulePath = path.join(resourcesPath, 'app.asar', 'node_modules', 'better-sqlite3');
const expectedNativePath = path.join(packagedModulePath, 'build', 'Release', 'better_sqlite3.node');
const physicalNativePath = path.join(
  resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
const packagedCacheServicePath = path.join(resourcesPath, 'app.asar', 'electron', 'cache-service.js');

assert.ok(process.versions.electron, 'Smoke test must run under the packaged Electron executable.');
assert.ok(fs.existsSync(path.join(resourcesPath, 'app.asar')), 'Packaged app.asar was not found.');
assert.ok(fs.existsSync(physicalNativePath), 'Packaged better_sqlite3.node was not found in app.asar.unpacked.');
assert.ok(fs.existsSync(packagedCacheServicePath), 'Packaged cache worker service was not found in app.asar.');

let loadedNativePath = null;
const originalNativeLoader = Module._extensions['.node'];
Module._extensions['.node'] = (module, filename) => {
  loadedNativePath = path.resolve(filename);
  return originalNativeLoader(module, filename);
};

let database;
try {
  // This is an absolute app.asar path. It cannot fall back to the repository's node_modules.
  const Database = require(packagedModulePath);
  database = new Database(':memory:');
  const row = database.prepare('SELECT 42 AS value').get();
  assert.equal(row.value, 42, 'Packaged SQLite query returned an unexpected result.');
} finally {
  Module._extensions['.node'] = originalNativeLoader;
  database?.close();
}

async function main() {
  assert.equal(
    loadedNativePath?.toLowerCase(),
    expectedNativePath.toLowerCase(),
    'better-sqlite3 resolved a native binary outside the packaged app.asar payload.',
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-packaged-smoke-'));
  const libraryPath = path.join(tempRoot, 'library');
  fs.mkdirSync(libraryPath, { recursive: true });
  fs.writeFileSync(path.join(libraryPath, 'smoke.mp4'), Buffer.alloc(42));
  const cacheOptions = { mode: 'centralised', centralCachePath: path.join(tempRoot, 'cache') };
  const { createCacheService } = require(packagedCacheServicePath);
  const packagedCache = require(path.join(resourcesPath, 'app.asar', 'electron', 'cache.js'));
  const { scanDirectory } = require(path.join(resourcesPath, 'app.asar', 'electron', 'scanner.js'));
  const cacheService = createCacheService();
  try {
    const [scanned] = await scanDirectory(libraryPath, false);
    assert.equal(scanned.sizeBytes, 42);
    const cachePaths = packagedCache.resolveCachePaths(libraryPath, cacheOptions);
    await cacheService.reconcileScannedFolder(libraryPath, cacheOptions, [scanned], {
      cacheRootDir: cachePaths.cacheRootDir,
      updatedAt: Date.now(),
      prune: false,
    });
    await cacheService.updateReviewState(libraryPath, cacheOptions, [{
      id: scanned.id,
      changes: { status: 'keep', rating: 4, favorite: true, bookmarks: [1.25] },
    }]);
    const [loaded] = await cacheService.loadVideos(libraryPath, cacheOptions);
    assert.equal(loaded.status, 'keep');
    assert.equal(loaded.rating, 4);
    assert.equal(loaded.favorite, true);
    assert.deepEqual(loaded.bookmarks, [1.25]);
  } finally {
    await cacheService.shutdown();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log([
    '[packaged-sqlite-smoke] OK',
    `Electron ${process.versions.electron}`,
    `Node ${process.versions.node}`,
    `ABI ${process.versions.modules}`,
    `native ${loadedNativePath}`,
    'worker read/write/shutdown => OK',
  ].join('; '));
}

main().catch((error) => {
  console.error('[packaged-sqlite-smoke] FAILED', error);
  process.exitCode = 1;
});
