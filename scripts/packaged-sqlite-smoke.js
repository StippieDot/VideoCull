const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
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

assert.ok(process.versions.electron, 'Smoke test must run under the packaged Electron executable.');
assert.ok(fs.existsSync(path.join(resourcesPath, 'app.asar')), 'Packaged app.asar was not found.');
assert.ok(fs.existsSync(physicalNativePath), 'Packaged better_sqlite3.node was not found in app.asar.unpacked.');

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

assert.equal(
  loadedNativePath?.toLowerCase(),
  expectedNativePath.toLowerCase(),
  'better-sqlite3 resolved a native binary outside the packaged app.asar payload.',
);

console.log([
  '[packaged-sqlite-smoke] OK',
  `Electron ${process.versions.electron}`,
  `Node ${process.versions.node}`,
  `ABI ${process.versions.modules}`,
  `native ${loadedNativePath}`,
  'query SELECT 42 => 42',
].join('; '));
