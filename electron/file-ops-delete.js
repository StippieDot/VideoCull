// @ts-check
const path = require('node:path');

/**
 * @typedef {{ id: string, filePath: string, folderPath: string }} CacheTarget
 * @typedef {'changed'|'unverifiable'|'out-of-scope'|'in-use'|'permission'|'not-found'|'trash-unavailable'|'unknown'} DeleteFailureReason
 * @typedef {{ path: string, success: boolean, error?: string, reason?: DeleteFailureReason, code?: string, method?: 'trash'|'permanent', removedFolder?: string }} DeleteResult
 */

// How long a delete waits for thumbnail or metadata work already running on a file.
const IN_USE_WAIT_MS = 10_000;

const IDENTITY_FAILURE_MESSAGES = {
  changed: 'File changed since it was scanned. Scan again before deleting.',
  'not-found': 'File no longer exists.',
  unverifiable: 'File could not be verified before deleting.',
};

/**
 * Maps a failed trash or unlink to a reason. Only 'trash-unavailable' may lead to the permanent
 * delete prompt, so anything unrecognised is 'unknown'.
 *
 * Windows `shell.trashItem` rejects with a message only, no code. Recorded on Windows 11:
 *   locked file          -> "Operation was aborted"
 *   delete denied (ACL)  -> "Failed to perform delete operation"
 *   missing file         -> "Failed to parse path"
 * A denied delete and a drive without a Recycle Bin cannot be told apart from the message, so
 * "Failed to perform delete operation" counts as trash-unavailable; the permanent delete that
 * follows reports 'permission' from the unlink error code if the cause was permissions.
 *
 * @param {any} err
 * @param {'trash'|'permanent'} method
 * @returns {{ reason: DeleteFailureReason, code?: string }}
 */
function classifyDeleteError(err, method) {
  const code = typeof err?.code === 'string' ? err.code : undefined;
  const message = String(err?.message ?? '');
  const withCode = (/** @type {DeleteFailureReason} */ reason) => (code ? { reason, code } : { reason });
  if (code === 'ENOENT') return withCode('not-found');
  if (code === 'EACCES' || code === 'EPERM') return withCode('permission');
  if (code === 'EBUSY' || code === 'ETXTBSY') return withCode('in-use');
  if (method === 'trash') {
    if (/operation was aborted/i.test(message)) return withCode('in-use');
    if (/failed to parse path/i.test(message)) return withCode('not-found');
    if (/failed to perform delete operation|trash/i.test(message)) return withCode('trash-unavailable');
  }
  return withCode('unknown');
}

/**
 * The delete workflow: the Recycle Bin first, a permanent delete only when the renderer asks for
 * it after review. Every file is checked against the loaded session and its scan-time identity
 * before it is touched, and a deleted video's cache artifacts go with it.
 *
 * All I/O is injected, so the workflow is unit-tested with fakes (see tests/electron/file-ops-delete.test.js).
 *
 * @param {object} deps
 * @param {ReturnType<typeof import('./library-registry').createLibraryRegistry>} deps.libraryRegistry
 * @param {{ stat: Function, access: Function, rm: Function, unlink: Function, lstat: Function, rmdir: Function }} deps.fs
 * @param {{ trashItem: (filePath: string) => Promise<void> }} deps.shell
 * @param {{ deleteVideos: Function }} deps.cacheService
 * @param {() => Promise<any>} deps.getCacheOptions
 * @param {(folderPath: string, cacheOptions: any) => { thumbRootDir: string, dbPath: string }} deps.getCachePaths
 * @param {(items: any[], limit: number, worker: (item: any, index: number) => Promise<any>) => Promise<any[]>} deps.mapWithConcurrency
 * @param {number} deps.cacheIoConcurrency
 * @param {() => Promise<boolean>} deps.shouldRemoveEmptyFoldersAfterDelete
 * @param {Function} deps.removeEmptyDeletedVideoFolders
 * @param {Function} deps.isPathWithinAnyDir
 * @param {Function} deps.filterLoadedDeletionPaths
 * @param {(options: { filePath: string, expectedIdentity: any, statPath: Function }) => Promise<{ ok: boolean, reason?: 'changed'|'not-found'|'unverifiable', code?: string, message?: string }>} deps.checkFileIdentityAtPath
 * @param {(filePath: string) => Promise<boolean>} deps.isValidLoadedPath
 * @param {(ids: string[]) => void} deps.forgetDuplicateVideos
 * @param {{ skipFiles: (paths: string[]) => void, waitUntilIdle: (paths: string[], timeoutMs: number) => Promise<string[]> }} deps.processingRuns
 * @param {{ warn: (...args: any[]) => void }} deps.log
 * @param {number} [deps.inUseWaitMs]
 */
function createFileOpsDelete(deps) {
  const {
    libraryRegistry, fs, shell, cacheService, getCacheOptions, getCachePaths, mapWithConcurrency,
    cacheIoConcurrency, shouldRemoveEmptyFoldersAfterDelete, removeEmptyDeletedVideoFolders,
    isPathWithinAnyDir, filterLoadedDeletionPaths, checkFileIdentityAtPath, isValidLoadedPath,
    forgetDuplicateVideos, processingRuns, log, inUseWaitMs = IN_USE_WAIT_MS,
  } = deps;

  /** @param {string[]} filePaths @returns {Promise<CacheTarget[]>} */
  async function collectDeletionCacheTargets(filePaths) {
    /** @type {CacheTarget[]} */
    const targets = [];
    for (const filePath of filePaths) {
      const knownId = libraryRegistry.idFor(filePath);
      if (!knownId) continue;
      targets.push({
        id: knownId,
        filePath,
        folderPath: path.dirname(filePath),
      });
    }
    return targets;
  }

  /** @param {CacheTarget[]} targets */
  async function removeDeletedVideoCacheArtifacts(targets) {
    if (targets.length === 0) return;
    const cacheOptions = await getCacheOptions();
    const byFolder = new Map();
    for (const target of targets) {
      const group = byFolder.get(target.folderPath) ?? [];
      group.push(target.id);
      byFolder.set(target.folderPath, group);
    }

    const thumbnailDirs = [];
    for (const [folderPath, ids] of byFolder) {
      const uniqueIds = Array.from(new Set(ids));
      const cachePaths = getCachePaths(folderPath, cacheOptions);
      thumbnailDirs.push(...uniqueIds.map((id) => path.join(cachePaths.thumbRootDir, id)));
      try {
        const dbExists = await fs.access(cachePaths.dbPath).then(() => true).catch(() => false);
        if (dbExists) await cacheService.deleteVideos(folderPath, cacheOptions, uniqueIds);
      } catch (err) {
        log.warn(`[batch-delete] Failed to remove deleted-video cache for ${folderPath}:`, err);
      }
    }

    await mapWithConcurrency(thumbnailDirs, cacheIoConcurrency, async (thumbDir) => {
      try {
        await fs.rm(thumbDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (err) {
        log.warn(`[batch-delete] Failed to remove generated thumbnail cache: ${thumbDir}`, err);
      }
    });
  }

  /** @param {string[]} deletedFilePaths */
  async function maybeRemoveEmptyDeletedVideoFolders(deletedFilePaths) {
    if (!await shouldRemoveEmptyFoldersAfterDelete()) return new Set();
    return removeEmptyDeletedVideoFolders({
      deletedFilePaths,
      loadedDirectories: libraryRegistry.loadedRoots(),
      // Never a folder outside the loaded folders, even inside a followed link target.
      isPathWithinAnyDir: (/** @type {string} */ folderPath, /** @type {Set<string>} */ dirs) => isPathWithinAnyDir(folderPath, dirs, false),
      isLink: (/** @type {string} */ folderPath) => fs.lstat(folderPath).then((/** @type {any} */ stats) => stats.isSymbolicLink(), () => false),
      removeDir: (/** @type {string} */ folderPath) => fs.rmdir(folderPath),
      onWarn: (/** @type {string} */ message) => log.warn(message),
    });
  }

  /** @param {DeleteResult[]} results @param {CacheTarget[]} cacheTargets @returns {Promise<DeleteResult[]>} */
  async function finalizeDeletedFiles(results, cacheTargets) {
    const successfulPaths = new Set(results.filter((result) => result.success).map((result) => result.path));
    const successfulTargets = cacheTargets.filter((target) => successfulPaths.has(target.filePath));
    await removeDeletedVideoCacheArtifacts(successfulTargets);
    forgetDuplicateVideos(successfulTargets.map((target) => target.id));
    for (const filePath of successfulPaths) libraryRegistry.forget(filePath);
    const removedFolders = await maybeRemoveEmptyDeletedVideoFolders(Array.from(successfulPaths));
    if (removedFolders.size === 0) return results;
    return results.map((result) => {
      if (!result.success) return result;
      const folder = path.resolve(path.dirname(result.path));
      return removedFolders.has(folder) ? { ...result, removedFolder: folder } : result;
    });
  }

  /**
   * The shared delete flow: scope check, stand processing down, identity check, then `remove`.
   * A retry is just another call, so scope and identity are re-checked every time.
   * @param {string[]} filePaths
   * @param {'trash'|'permanent'} method
   * @param {(realPath: string) => Promise<void>} remove
   * @returns {Promise<DeleteResult[]>}
   */
  async function deleteFiles(filePaths, method, remove) {
    /** @type {DeleteResult[]} */
    const results = [];
    const validPaths = await filterLoadedDeletionPaths({
      filePaths,
      isValidLoadedPath,
      onReject: (/** @type {string} */ filePath) => {
        log.warn(`[delete:${method}] Rejected path outside loaded directory: ${filePath}`);
        results.push({ path: filePath, success: false, error: 'Path is outside the loaded directory scope.', reason: 'out-of-scope', method });
      },
    });
    if (validPaths.length === 0) return results;

    // Queued thumbnail and metadata work for these files is dropped; work already running gets a
    // moment to finish. Whatever is still busy is reported, not killed, so it can be retried.
    processingRuns.skipFiles(validPaths);
    const busy = new Set(await processingRuns.waitUntilIdle(validPaths, inUseWaitMs));
    for (const filePath of busy) {
      results.push({ path: filePath, success: false, error: 'File is still being processed.', reason: 'in-use', method });
    }
    const ready = validPaths.filter((/** @type {string} */ filePath) => !busy.has(filePath));
    const cacheTargets = await collectDeletionCacheTargets(ready);

    const outcomes = await mapWithConcurrency(ready, 5, async (/** @type {string} */ filePath) => {
      // A file link only removes the link; the video that was reviewed is the real file.
      const realPath = libraryRegistry.scannedRealPathFor(filePath) ?? filePath;
      const identity = await checkFileIdentityAtPath({
        filePath: realPath,
        expectedIdentity: libraryRegistry.identityFor(filePath),
        statPath: fs.stat,
      });
      if (!identity.ok) {
        const reason = identity.reason ?? 'unverifiable';
        const detail = reason === 'unverifiable' && identity.message ? ` (${identity.message})` : '';
        return {
          path: filePath, success: false, error: `${IDENTITY_FAILURE_MESSAGES[reason]}${detail}`, reason, method,
          ...(identity.code ? { code: identity.code } : {}),
        };
      }
      try {
        await remove(realPath);
        return { path: filePath, success: true, method };
      } catch (err) {
        return { path: filePath, success: false, error: /** @type {Error} */ (err).message, method, ...classifyDeleteError(err, method) };
      }
    });
    results.push(...outcomes);
    return finalizeDeletedFiles(results, cacheTargets);
  }

  /** @param {string[]} filePaths */
  const batchDelete = (filePaths) => deleteFiles(filePaths, 'trash', (realPath) => shell.trashItem(realPath));

  /** @param {string[]} filePaths */
  const permanentlyDelete = (filePaths) => deleteFiles(filePaths, 'permanent', (realPath) => fs.unlink(realPath));

  return { batchDelete, permanentlyDelete };
}

module.exports = { createFileOpsDelete, classifyDeleteError };
