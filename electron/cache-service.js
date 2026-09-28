const cache = require('./cache');
const { createKeyedOperationQueue } = require('./keyed-operation-queue');
const log = require('./logger');
const {
  isSqliteCorruptionError,
  mergeScannedVideoWithCache,
  thumbAbsolute,
  videoForDb,
} = require('./main-helpers');

function createCacheService() {
  const operationQueue = createKeyedOperationQueue();

  async function run(folderPath, cacheOptions, operation, priority = 'foreground') {
    const dbPath = cache.resolveCachePath(folderPath, cacheOptions);
    return operationQueue.run(dbPath, async () => {
      const db = await cache.acquireDb(folderPath, cacheOptions, { priority });
      try {
        return await operation(db);
      } finally {
        cache.releaseDb(folderPath, cacheOptions);
      }
    }, priority);
  }

  return {
    closeAll: () => cache.closeDb(),
    closeFolder: (folderPath, cacheOptions, options) => cache.closeDbForFolder(folderPath, cacheOptions, options),
    deleteDb: (folderPath, cacheOptions, options) => cache.deleteDb(folderPath, cacheOptions, options),
    getStats: () => cache.getDbConnectionStats(),

    ensureFolder: (folderPath, cacheOptions) => run(folderPath, cacheOptions, () => true),
    migrateJson: (folderPath, cacheOptions) => run(
      folderPath,
      cacheOptions,
      (db) => cache.migrateJsonIfNeeded(folderPath, db),
    ),
    loadVideos: (folderPath, cacheOptions, videoIds = null) => run(
      folderPath,
      cacheOptions,
      (db) => cache.loadCacheVideos(db, videoIds),
    ),
    saveVideos: (folderPath, cacheOptions, videos, options = {}) => run(
      folderPath,
      cacheOptions,
      async (db) => {
        const writeStats = options.atomic && videos.length <= options.atomicLimit
          ? cache.saveCache(db, videos, { updatedAt: options.updatedAt })
          : await cache.saveCacheChunked(db, videos, null, { updatedAt: options.updatedAt });
        const staleVideos = Number.isFinite(options.pruneBefore)
          ? cache.pruneStaleVideosBefore(db, options.pruneBefore, { details: true })
          : [];
        return { writeStats, staleVideos };
      },
      options.priority,
    ),
    reconcileScannedFolder: (folderPath, cacheOptions, videos, options) => run(
      folderPath,
      cacheOptions,
      async (db) => {
        const loadStartedAt = performance.now();
        const cachedMap = cache.loadCacheMap(db, videos.map((video) => video.id));
        for (const cached of cachedMap.values()) {
          cached.thumbnails = cached.thumbnails.map((thumb) => thumbAbsolute(thumb, options.cacheRootDir));
        }
        const mergedVideos = videos.map((video) => mergeScannedVideoWithCache(video, cachedMap.get(video.id)));
        const loadDurationMs = performance.now() - loadStartedAt;
        const saveStartedAt = performance.now();
        const payload = mergedVideos.map((video) => videoForDb(video, options.cacheRootDir));
        const writeStats = await cache.saveCacheChunked(db, payload, null, { updatedAt: options.updatedAt });
        const signatureRows = cache.loadSignatureRows(db, videos.map((video) => video.id));
        const staleVideos = options.prune
          ? cache.pruneStaleVideosBefore(db, options.updatedAt, { details: true })
          : [];
        return {
          mergedVideos,
          staleVideos,
          signatureRows,
          writeStats,
          loadedVideoCount: cachedMap.size,
          loadedThumbnailCount: Array.from(cachedMap.values()).reduce(
            (sum, video) => sum + video.thumbnails.length,
            0,
          ),
          loadDurationMs,
          saveDurationMs: performance.now() - saveStartedAt,
        };
      },
    ),
    pruneStale: (folderPath, cacheOptions, updatedAt) => run(
      folderPath,
      cacheOptions,
      (db) => cache.pruneStaleVideosBefore(db, updatedAt, { details: true }),
    ),
    updateReviewState: (folderPath, cacheOptions, updates) => run(
      folderPath,
      cacheOptions,
      (db) => cache.updateVideoReviewStateBatch(db, updates),
      'interactive',
    ),
    deleteVideos: (folderPath, cacheOptions, videoIds) => run(
      folderPath,
      cacheOptions,
      (db) => cache.deleteVideosByIds(db, videoIds),
      'interactive',
    ),
    moveVideos: (parentFolder, targetFolder, cacheOptions, targetVideos, parentVideoIds) => run(
      parentFolder,
      cacheOptions,
      (parentDb) => run(targetFolder, cacheOptions, (targetDb) => {
        cache.saveCache(targetDb, targetVideos);
        cache.deleteVideosByIds(parentDb, parentVideoIds);
      }),
    ),
    loadRecentMetadataFailureIds: (folderPath, cacheOptions, videoIds, retryAfterMs) => run(
      folderPath,
      cacheOptions,
      (db) => Array.from(cache.loadRecentMetadataFailureIds(db, videoIds, retryAfterMs)),
    ),
    saveMetadata: (folderPath, cacheOptions, successes, failures) => run(
      folderPath,
      cacheOptions,
      (db) => {
        try {
          if (successes.length > 0) cache.updateVideoMetadataBatch(db, successes);
          if (failures.length > 0) cache.markMetadataFailuresBatch(db, failures);
        } catch (err) {
          if (isSqliteCorruptionError(err)) throw err;
          log.warn('[cache] Metadata batch write failed; retrying row-by-row', {
            folderPath,
            successes: successes.length,
            failures: failures.length,
            error: err?.message || String(err),
          });
          for (const metadata of successes) cache.updateVideoMetadata(db, metadata.videoId, metadata);
          for (const failure of failures) cache.markMetadataFailure(db, failure.videoId, failure.reason);
        }
      },
      'background',
    ),
    saveThumbnails: (folderPath, cacheOptions, updates) => run(
      folderPath,
      cacheOptions,
      (db) => cache.updateVideoThumbnailMetadataBatch(db, updates),
      'background',
    ),
    loadDuplicateFolderState: (folderPath, cacheOptions, videoIds, settings) => run(
      folderPath,
      cacheOptions,
      (db) => {
        const fingerprintKey = settings.fingerprintKey;
        return {
          videoIds,
          signatureRows: cache.loadSignatureRows(db, videoIds),
          completeEntries: Array.from(cache.getFingerprintCounts(db, videoIds, settings.sampleCount, {
            requireFlipped: settings.compareFlipped,
            fingerprintKey,
          })),
          failedIds: cache.loadFingerprintFailureIds(db, videoIds, { fingerprintKey }),
          mode: settings.comparisonMode,
          comparisonRows: settings.comparisonMode === 'phash'
            ? cache.loadPHashRows(db, videoIds, settings.sampleCount, { fingerprintKey })
            : cache.loadGraySampleRows(db, videoIds, settings.sampleCount, { fingerprintKey }),
        };
      },
    ),
    updateVideoSignatures: (folderPath, cacheOptions, videoId, signatures) => run(
      folderPath,
      cacheOptions,
      (db) => cache.updateVideoSignatures(db, videoId, signatures),
      'foreground',
    ),
    saveVideoFingerprints: (folderPath, cacheOptions, videoId, fingerprints, fingerprintKey) => run(
      folderPath,
      cacheOptions,
      (db) => cache.saveVideoFingerprints(db, videoId, fingerprints, { fingerprintKey }),
      'background',
    ),
    markFingerprintFailure: (folderPath, cacheOptions, videoId, fingerprintKey) => run(
      folderPath,
      cacheOptions,
      (db) => cache.markFingerprintFailure(db, videoId, { fingerprintKey }),
      'background',
    ),
  };
}

module.exports = { createCacheService };
