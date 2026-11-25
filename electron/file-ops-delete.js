// @ts-check
const path = require('node:path');

/**
 * @typedef {{ id: string, filePath: string, folderPath: string }} CacheTarget
 * @typedef {{ path: string, success: boolean, error?: string, method?: string, removedFolder?: string }} DeleteResult
 */

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
 * @param {Function} deps.matchesFileIdentityAtPath
 * @param {(filePath: string) => Promise<boolean>} deps.isValidLoadedPath
 * @param {(ids: string[]) => void} deps.forgetDuplicateVideos
 * @param {{ warn: (...args: any[]) => void }} deps.log
 */
function createFileOpsDelete(deps) {
  const {
    libraryRegistry, fs, shell, cacheService, getCacheOptions, getCachePaths, mapWithConcurrency,
    cacheIoConcurrency, shouldRemoveEmptyFoldersAfterDelete, removeEmptyDeletedVideoFolders,
    isPathWithinAnyDir, filterLoadedDeletionPaths, matchesFileIdentityAtPath, isValidLoadedPath,
    forgetDuplicateVideos, log,
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

  /** @param {string[]} filePaths @returns {Promise<DeleteResult[]>} */
  async function batchDelete(filePaths) {
    /** @type {DeleteResult[]} */
    const results = [];

    const validPaths = await filterLoadedDeletionPaths({
      filePaths,
      isValidLoadedPath,
      onReject: (/** @type {string} */ filePath) => {
        log.warn(`[batch-delete] Rejected path outside loaded directory: ${filePath}`);
        results.push({ path: filePath, success: false, error: 'Path is outside the loaded directory scope.' });
      },
    });

    if (validPaths.length === 0) return results;
    const cacheTargets = await collectDeletionCacheTargets(validPaths);

    const trashResults = await mapWithConcurrency(validPaths, 5, async (filePath) => {
      // Trashing a file link only trashes the link; the video itself must go to the Recycle Bin.
      const realPath = libraryRegistry.scannedRealPathFor(filePath) ?? filePath;
      const identityMatches = await matchesFileIdentityAtPath({
        filePath: realPath,
        expectedIdentity: libraryRegistry.identityFor(filePath),
        statPath: fs.stat,
      });
      if (!identityMatches) {
        return { path: filePath, success: false, error: 'File changed since it was scanned. Scan again before deleting.', method: 'trash' };
      }
      try {
        await shell.trashItem(realPath);
        return { path: filePath, success: true, method: 'trash' };
      } catch (err) {
        return { path: filePath, success: false, error: /** @type {Error} */ (err).message, method: 'trash' };
      }
    });
    results.push(...trashResults);

    return finalizeDeletedFiles(results, cacheTargets);
  }

  /** @param {string[]} filePaths @returns {Promise<DeleteResult[]>} */
  async function permanentlyDelete(filePaths) {
    /** @type {DeleteResult[]} */
    const results = [];
    const validPaths = await filterLoadedDeletionPaths({
      filePaths,
      isValidLoadedPath,
      onReject: (/** @type {string} */ filePath) => {
        log.warn(`[permanently-delete] Rejected path outside loaded directory: ${filePath}`);
        results.push({
          path: filePath,
          success: false,
          error: 'Path is outside the loaded directory scope.',
          method: 'permanent',
        });
      },
    });
    if (validPaths.length === 0) return results;
    const cacheTargets = await collectDeletionCacheTargets(validPaths);
    const permanentResults = await mapWithConcurrency(validPaths, 5, async (filePath) => {
      // Unlinking a file link only removes the link; the video itself is what was reviewed.
      const realPath = libraryRegistry.scannedRealPathFor(filePath) ?? filePath;
      const identityMatches = await matchesFileIdentityAtPath({
        filePath: realPath,
        expectedIdentity: libraryRegistry.identityFor(filePath),
        statPath: fs.stat,
      });
      if (!identityMatches) {
        return { path: filePath, success: false, error: 'File changed since it was scanned. Scan again before deleting.', method: 'permanent' };
      }
      try {
        await fs.unlink(realPath);
        return { path: filePath, success: true, method: 'permanent' };
      } catch (err) {
        return { path: filePath, success: false, error: /** @type {Error} */ (err).message, method: 'permanent' };
      }
    });

    results.push(...permanentResults);
    return finalizeDeletedFiles(results, cacheTargets);
  }

  return { batchDelete, permanentlyDelete };
}

module.exports = { createFileOpsDelete };
