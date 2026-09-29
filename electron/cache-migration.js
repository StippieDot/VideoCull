const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');

function pathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function pathExists(filePath, access = fs.access) {
  try {
    await access(filePath);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

async function copySourceToStage(source, staging) {
  await fs.mkdir(path.dirname(staging), { recursive: true });
  const stats = await fs.stat(source);
  if (stats.isDirectory()) {
    await fs.cp(source, staging, { recursive: true, force: false, errorOnExist: true });
  } else {
    await fs.copyFile(source, staging, constants.COPYFILE_EXCL);
  }
}

async function removeCreatedPaths(paths, remove) {
  await Promise.all(Array.from(new Set(paths)).map((filePath) => (
    remove(filePath, { recursive: true, force: true }).catch(() => {})
  )));
}

async function migrateCacheMoves(moves, options = {}) {
  const transactionId = String(
    options.transactionId ?? `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`
  ).replace(/[^a-zA-Z0-9_-]/g, '-');
  const exists = options.pathExists ?? pathExists;
  const copySource = options.copySource ?? copySourceToStage;
  const rename = options.rename ?? fs.rename;
  const remove = options.remove ?? fs.rm;
  const removeSource = options.removeSource ?? remove;
  // Runs after every target is promoted but while sources still exist; a failure rolls back.
  const beforeSourceCleanup = options.beforeSourceCleanup ?? (async () => {});
  const onCleanupError = options.onCleanupError ?? ((err, move) => {
    console.warn(`[cache] Migrated cache copied but source cleanup failed for ${move.source}:`, err);
  });
  const planned = [];
  const targetKeys = new Set();

  for (const [index, move] of (Array.isArray(moves) ? moves : []).entries()) {
    if (!move?.source || !move?.target) throw new Error('Invalid cache migration move.');
    if (pathKey(move.source) === pathKey(move.target)) continue;
    const targetKey = pathKey(move.target);
    if (targetKeys.has(targetKey)) throw new Error(`Duplicate migration target: ${move.target}`);
    targetKeys.add(targetKey);
    planned.push({
      ...move,
      staging: path.join(path.dirname(move.target), `.videocull-migration-${transactionId}-${index}`),
    });
  }

  const existingMoves = [];
  for (const move of planned) {
    const sourceExists = await exists(move.source);
    if (await exists(move.target)) throw new Error(`Target cache already exists: ${move.target}`);
    if (await exists(move.staging)) throw new Error(`Migration staging path already exists: ${move.staging}`);
    if (sourceExists) existingMoves.push(move);
  }

  const stagingCreated = [];
  const promoted = [];
  try {
    for (const move of existingMoves) {
      stagingCreated.push(move.staging);
      await copySource(move.source, move.staging);
    }
    for (const move of existingMoves) {
      if (await exists(move.target)) throw new Error(`Target cache already exists: ${move.target}`);
      await rename(move.staging, move.target);
      promoted.push(move);
    }
    await beforeSourceCleanup(promoted);
  } catch (err) {
    await removeCreatedPaths([
      ...stagingCreated,
      ...promoted.map((move) => move.target),
    ], remove);
    throw err;
  }

  const cleanupErrors = [];
  for (const move of promoted) {
    try {
      await removeSource(move.source, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push({ move, error });
      try { onCleanupError(error, move); } catch { /* cleanup reporting cannot undo a committed migration */ }
    }
  }

  return { promoted, cleanupErrors };
}

module.exports = {
  migrateCacheMoves,
  __test__: {
    copySourceToStage,
    pathExists,
  },
};
