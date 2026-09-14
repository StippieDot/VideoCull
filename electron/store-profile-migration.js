const fs = require('node:fs/promises');
const path = require('node:path');

const DURABLE_FILES = ['settings.json', 'library-state.json', 'distributed-index.json'];
const CACHE_INDEX_FILE = 'cache-index.json';
const MARKER_FILE = '.store-profile-migration.json';
const MINIMUM_HEADROOM_BYTES = 256 * 1024 * 1024;
const DEFAULT_CACHE_COPY_CONCURRENCY = 4;
const CACHE_COPY_PROGRESS_INTERVAL_MS = 250;

function appendWarning(current, next) {
  if (!next) return current ?? null;
  return current ? `${current} ${next}` : next;
}

function isMissing(error) {
  return error?.code === 'ENOENT';
}

async function isRegularFile(filePath, fsImpl = fs) {
  try {
    const stats = await fsImpl.lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isDirectory(directoryPath, fsImpl = fs) {
  try {
    const stats = await fsImpl.lstat(directoryPath);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function atomicCopyFile(source, target, fsImpl = fs) {
  const temporary = `${target}.migration-${process.pid}.tmp`;
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await fsImpl.copyFile(source, temporary);
  try {
    await fsImpl.rename(temporary, target);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
    await fsImpl.rm(target, { force: true });
    await fsImpl.rename(temporary, target);
  } finally {
    await fsImpl.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readMarker(markerPath, fsImpl = fs) {
  try {
    return JSON.parse(await fsImpl.readFile(markerPath, 'utf8'));
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeMarker(markerPath, marker, fsImpl = fs) {
  const temporary = `${markerPath}.${process.pid}.tmp`;
  await fsImpl.writeFile(temporary, JSON.stringify(marker, null, 2), 'utf8');
  try {
    await fsImpl.rename(temporary, markerPath);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
    await fsImpl.rm(markerPath, { force: true });
    await fsImpl.rename(temporary, markerPath);
  } finally {
    await fsImpl.rm(temporary, { force: true }).catch(() => {});
  }
}

function isThumbnail(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  return normalized.split('/').includes('thumbs') || /\.(jpe?g|png|webp)$/.test(normalized);
}

async function collectCacheFiles(root, fsImpl = fs, onProgress = null) {
  const files = [];
  let directoriesScanned = 0;
  let bytesScanned = 0;
  let lastProgressAt = 0;

  function reportProgress(force = false) {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    onProgress({ filesScanned: files.length, directoriesScanned, bytesScanned });
  }

  async function walk(current, relativeRoot = '') {
    const entries = await fsImpl.readdir(current, { withFileTypes: true });
    directoriesScanned += 1;
    reportProgress();
    for (const entry of entries) {
      const relativePath = path.join(relativeRoot, entry.name);
      const sourcePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(sourcePath, relativePath);
      } else if (entry.isFile()) {
        const stats = await fsImpl.stat(sourcePath);
        files.push({ sourcePath, relativePath, size: stats.size, thumbnail: isThumbnail(relativePath) });
        bytesScanned += stats.size;
        reportProgress();
      }
    }
  }
  await walk(root);
  reportProgress(true);
  return files;
}

async function defaultAvailableBytes(targetPath, fsImpl = fs) {
  const stats = await fsImpl.statfs(targetPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

async function validateExternalCacheLocations(profilePath, fsImpl = fs) {
  const configuredPaths = [];
  const warnings = [];
  try {
    const settings = JSON.parse(await fsImpl.readFile(path.join(profilePath, 'settings.json'), 'utf8'));
    if (typeof settings.centralCachePath === 'string' && settings.centralCachePath.trim()) {
      configuredPaths.push(settings.centralCachePath);
    }
    if (settings.perDriveCachePaths && typeof settings.perDriveCachePaths === 'object' && !Array.isArray(settings.perDriveCachePaths)) {
      configuredPaths.push(...Object.values(settings.perDriveCachePaths).filter((value) => typeof value === 'string' && value.trim()));
    }
  } catch (error) {
    if (!isMissing(error)) warnings.push(`Imported cache settings could not be validated: ${error.message}`);
  }
  try {
    const distributed = JSON.parse(await fsImpl.readFile(path.join(profilePath, 'distributed-index.json'), 'utf8'));
    configuredPaths.push(...(Array.isArray(distributed.knownDistributedPaths) ? distributed.knownDistributedPaths : []));
  } catch (error) {
    if (!isMissing(error)) warnings.push(`Imported distributed cache settings could not be validated: ${error.message}`);
  }

  const seen = new Set();
  for (const configuredPath of configuredPaths) {
    if (typeof configuredPath !== 'string' || !path.isAbsolute(configuredPath)) {
      warnings.push(`An imported external cache path is invalid: ${String(configuredPath)}`);
      continue;
    }
    const resolved = path.resolve(configuredPath);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const stats = await fsImpl.lstat(resolved);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        warnings.push(`An imported external cache location is unavailable: ${resolved}`);
      }
    } catch {
      warnings.push(`An imported external cache location is unavailable: ${resolved}`);
    }
  }
  return warnings;
}

function createInitialStatus(enabled) {
  return {
    stage: enabled ? 'pending' : 'not-needed',
    durable: enabled ? 'pending' : 'not-needed',
    cacheOutcome: enabled ? null : 'not-needed',
    preflight: null,
    preflightProgress: null,
    progress: null,
    warning: null,
    errors: [],
  };
}

function createStoreProfileMigration(options) {
  const fsImpl = options.fsImpl ?? fs;
  const availableBytes = options.availableBytes ?? ((target) => defaultAvailableBytes(target, fsImpl));
  const collectFiles = options.collectCacheFiles ?? ((root, onProgress) => collectCacheFiles(root, fsImpl, onProgress));
  const cacheCopyConcurrency = Math.max(1, Math.min(16, Number(options.cacheCopyConcurrency) || DEFAULT_CACHE_COPY_CONCURRENCY));
  const enabled = Boolean(options.enabled);
  let status = createInitialStatus(enabled);
  let cacheFiles = [];
  let marker = null;
  const markerPath = path.join(options.targetProfile, MARKER_FILE);
  const cacheStage = `${options.targetCache}.migration-staging`;
  const durableStage = path.join(path.dirname(options.targetProfile), '.profile-migration-staging');

  function publish(patch) {
    status = { ...status, ...patch };
    options.onStatus?.(status);
    return status;
  }

  async function persist(cacheOutcome = marker?.cacheOutcome ?? null) {
    marker = {
      version: 1,
      sourceProfile: options.sourceProfile,
      durableComplete: true,
      cacheOutcome,
      completedAt: cacheOutcome ? new Date().toISOString() : null,
    };
    await writeMarker(markerPath, marker, fsImpl);
  }

  async function migrateDurableState() {
    publish({ stage: 'durable-copy', durable: 'pending' });
    await fsImpl.rm(durableStage, { recursive: true, force: true });
    await fsImpl.mkdir(durableStage, { recursive: true });
    for (const fileName of DURABLE_FILES) {
      const source = path.join(options.sourceProfile, fileName);
      if (await isRegularFile(source, fsImpl)) {
        await fsImpl.copyFile(source, path.join(durableStage, fileName));
      }
    }
    for (const fileName of DURABLE_FILES) {
      const staged = path.join(durableStage, fileName);
      if (await isRegularFile(staged, fsImpl)) {
        await atomicCopyFile(staged, path.join(options.targetProfile, fileName), fsImpl);
      }
    }
    await fsImpl.rm(durableStage, { recursive: true, force: true });
    await persist(null);
    const externalWarnings = await validateExternalCacheLocations(options.targetProfile, fsImpl);
    publish({
      stage: 'pending',
      durable: 'complete',
      warning: appendWarning(status.warning, externalWarnings.join(' ')),
    });
  }

  async function prepareCache() {
    if (!enabled || status.stage === 'complete') return status;
    if (status.durable === 'pending') throw new Error('Durable profile migration must complete before cache preflight.');
    try {
      const sourceCache = path.join(options.sourceProfile, 'video-cache');
      if (!await isDirectory(sourceCache, fsImpl)) {
        await persist('not-needed');
        return publish({ stage: 'complete', cacheOutcome: 'not-needed' });
      }

      publish({
        stage: 'cache-preflight',
        preflightProgress: { filesScanned: 0, directoriesScanned: 0, bytesScanned: 0 },
      });
      await fsImpl.rm(cacheStage, { recursive: true, force: true }).catch(() => {});
      await fsImpl.rm(`${cacheStage}.index.json`, { force: true }).catch(() => {});
      cacheFiles = await collectFiles(sourceCache, (preflightProgress) => publish({ preflightProgress }));
      const sourceBytes = cacheFiles.reduce((sum, file) => sum + file.size, 0);
      const headroomBytes = Math.max(Math.ceil(sourceBytes * 0.1), MINIMUM_HEADROOM_BYTES);
      const freeBytes = await availableBytes(path.dirname(options.targetCache));
      const requiredBytes = sourceBytes + headroomBytes;
      return publish({
        stage: 'awaiting-cache-choice',
        preflight: {
          sourceBytes,
          fileCount: cacheFiles.length,
          freeBytes,
          requiredBytes,
          headroomBytes,
          canCopy: freeBytes >= requiredBytes,
        },
      });
    } catch (error) {
      let markerWarning = '';
      try {
        await persist('rebuild');
      } catch (markerError) {
        markerWarning = ` The migration result could not be saved and will be checked again next launch: ${markerError.message}`;
      }
      return publish({
        stage: 'complete',
        cacheOutcome: 'rebuild',
        warning: appendWarning(status.warning, `Existing cache could not be inspected and will be rebuilt: ${error.message}${markerWarning}`),
        errors: [...status.errors, error.message],
      });
    }
  }

  async function prepareDurable() {
    if (!enabled) return status;
    try {
      await fsImpl.mkdir(options.targetProfile, { recursive: true });
      marker = await readMarker(markerPath, fsImpl);
      if (marker?.durableComplete && marker.cacheOutcome) {
        return publish({ stage: 'complete', durable: 'complete', cacheOutcome: marker.cacheOutcome });
      }
      if (!await isDirectory(options.sourceProfile, fsImpl)) {
        await persist('not-needed');
        return publish({ stage: 'complete', durable: 'not-needed', cacheOutcome: 'not-needed' });
      }
      if (!marker?.durableComplete) await migrateDurableState();
      else publish({ stage: 'pending', durable: 'complete' });
      return status;
    } catch (error) {
      publish({ stage: 'fatal-error', warning: error.message, errors: [...status.errors, error.message] });
      throw error;
    }
  }

  async function prepare() {
    const durableStatus = await prepareDurable();
    if (durableStatus.stage === 'complete') return durableStatus;
    return prepareCache();
  }

  async function chooseCache(action) {
    if (status.stage !== 'awaiting-cache-choice') {
      throw new Error('Cache migration is not waiting for a choice.');
    }
    if (action !== 'copy' && action !== 'rebuild') throw new Error('Unknown cache migration choice.');
    if (action === 'rebuild' || !status.preflight?.canCopy) {
      await fsImpl.rm(cacheStage, { recursive: true, force: true }).catch(() => {});
      await persist('rebuild');
      return publish({
        stage: 'complete',
        cacheOutcome: 'rebuild',
        warning: appendWarning(status.warning, action === 'copy' ? 'There is not enough free space to copy the existing cache.' : null),
      });
    }

    const indexStage = `${cacheStage}.index.json`;
    let cachePromoted = false;
    try {
      await fsImpl.rm(cacheStage, { recursive: true, force: true });
      await fsImpl.rm(indexStage, { force: true });
      await fsImpl.mkdir(cacheStage, { recursive: true });
      let bytesCopied = 0;
      let filesCopied = 0;
      let skippedFiles = 0;
      const essentialErrors = [];
      const directoryPromises = new Map();
      let lastProgressAt = 0;
      const publishCopyProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < CACHE_COPY_PROGRESS_INTERVAL_MS) return;
        lastProgressAt = now;
        publish({
          progress: { bytesCopied, totalBytes: status.preflight.sourceBytes, filesCopied, totalFiles: cacheFiles.length, skippedFiles },
        });
      };
      const ensureDirectory = (directoryPath) => {
        let pending = directoryPromises.get(directoryPath);
        if (!pending) {
          pending = fsImpl.mkdir(directoryPath, { recursive: true });
          directoryPromises.set(directoryPath, pending);
        }
        return pending;
      };
      publish({
        stage: 'cache-copy',
        progress: { bytesCopied, totalBytes: status.preflight.sourceBytes, filesCopied, totalFiles: cacheFiles.length, skippedFiles },
      });

      await mapWithConcurrency(cacheFiles, cacheCopyConcurrency, async (file) => {
        if (essentialErrors.length > 0) return;
        const target = path.join(cacheStage, file.relativePath);
        try {
          await ensureDirectory(path.dirname(target));
          await fsImpl.copyFile(file.sourcePath, target);
          const targetStats = await fsImpl.stat(target);
          if (!targetStats.isFile() || targetStats.size !== file.size) {
            throw new Error('Copied file size did not match the source.');
          }
          bytesCopied += targetStats.size;
          filesCopied += 1;
        } catch (error) {
          if (file.thumbnail) skippedFiles += 1;
          else essentialErrors.push(`${file.relativePath}: ${error.message}`);
          await fsImpl.rm(target, { force: true }).catch(() => {});
        }
        publishCopyProgress();
      });
      publishCopyProgress(true);

      if (essentialErrors.length > 0) throw new Error(essentialErrors[0]);
      if (filesCopied + skippedFiles !== cacheFiles.length) {
        throw new Error('Staged cache validation did not match the copied files.');
      }

      const sourceIndex = path.join(options.sourceProfile, CACHE_INDEX_FILE);
      const hasIndex = await isRegularFile(sourceIndex, fsImpl);
      if (hasIndex) {
        await fsImpl.copyFile(sourceIndex, indexStage);
        const parsedIndex = JSON.parse(await fsImpl.readFile(indexStage, 'utf8'));
        if (!parsedIndex || typeof parsedIndex !== 'object' || (parsedIndex.knownFolders && !Array.isArray(parsedIndex.knownFolders))) {
          throw new Error('The existing cache index is invalid.');
        }
      }

      await fsImpl.rm(options.targetCache, { recursive: true, force: true });
      await fsImpl.rename(cacheStage, options.targetCache);
      cachePromoted = true;
      if (hasIndex) await atomicCopyFile(indexStage, path.join(options.targetProfile, CACHE_INDEX_FILE), fsImpl);

      const outcome = skippedFiles > 0 ? 'copied-with-skips' : 'copied';
      await persist(outcome);
      await fsImpl.rm(indexStage, { force: true }).catch(() => {});
      return publish({
        stage: 'complete',
        cacheOutcome: outcome,
        warning: appendWarning(status.warning, skippedFiles > 0 ? `${skippedFiles} cache item(s) could not be copied and will be regenerated.` : null),
        progress: { bytesCopied, totalBytes: status.preflight.sourceBytes, filesCopied, totalFiles: cacheFiles.length, skippedFiles },
      });
    } catch (error) {
      await fsImpl.rm(cacheStage, { recursive: true, force: true }).catch(() => {});
      await fsImpl.rm(indexStage, { force: true }).catch(() => {});
      if (cachePromoted) await fsImpl.rm(options.targetCache, { recursive: true, force: true }).catch(() => {});
      let markerWarning = null;
      try {
        await persist('rebuild');
      } catch (markerError) {
        markerWarning = ` The migration result could not be saved and will be checked again next launch: ${markerError.message}`;
      }
      return publish({
        stage: 'complete',
        cacheOutcome: 'rebuild',
        warning: appendWarning(status.warning, `Existing cache could not be copied and will be rebuilt: ${error.message}${markerWarning ?? ''}`),
        errors: [...status.errors, error.message],
      });
    }
  }

  return {
    chooseCache,
    getStatus: () => status,
    markerPath,
    prepare,
    prepareCache,
    prepareDurable,
  };
}

module.exports = {
  DEFAULT_CACHE_COPY_CONCURRENCY,
  CACHE_INDEX_FILE,
  DURABLE_FILES,
  MARKER_FILE,
  MINIMUM_HEADROOM_BYTES,
  atomicCopyFile,
  collectCacheFiles,
  createStoreProfileMigration,
  isThumbnail,
  validateExternalCacheLocations,
};
