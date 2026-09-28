const cache = require('./cache');
const log = require('./logger');
const {
  isSqliteCorruptionError,
  mergeScannedVideoWithCache,
  thumbAbsolute,
  videoForDb,
} = require('./main-helpers');

async function run(folderPath, cacheOptions, operation, priority = 'foreground') {
  const db = await cache.acquireDb(folderPath, cacheOptions, { priority });
  try {
    return await operation(db);
  } finally {
    cache.releaseDb(folderPath, cacheOptions);
  }
}

async function executeCacheOperation(operation, args) {
  const { folderPath, cacheOptions } = args ?? {};
  switch (operation) {
    case 'closeAll':
      cache.closeDb();
      return true;
    case 'closeFolder':
      return cache.closeDbForFolder(folderPath, cacheOptions, args.options);
    case 'deleteDb':
      return cache.deleteDb(folderPath, cacheOptions, args.options);
    case 'getStats':
      return cache.getDbConnectionStats();
    case 'ensureFolder':
      return run(folderPath, cacheOptions, () => true);
    case 'migrateJson':
      return run(folderPath, cacheOptions, (db) => cache.migrateJsonIfNeeded(folderPath, db));
    case 'loadVideos':
      return run(folderPath, cacheOptions, (db) => cache.loadCacheVideos(db, args.videoIds));
    case 'saveVideos':
      return run(folderPath, cacheOptions, async (db) => {
        const options = args.options ?? {};
        const writeStats = options.atomic && args.videos.length <= options.atomicLimit
          ? cache.saveCache(db, args.videos, { updatedAt: options.updatedAt })
          : await cache.saveCacheChunked(db, args.videos, null, { updatedAt: options.updatedAt });
        const staleVideos = Number.isFinite(options.pruneBefore)
          ? cache.pruneStaleVideosBefore(db, options.pruneBefore, { details: true })
          : [];
        return { writeStats, staleVideos };
      }, args.priority);
    case 'reconcileScannedFolder':
      return run(folderPath, cacheOptions, async (db) => {
        const options = args.options;
        const loadStartedAt = performance.now();
        const cachedMap = cache.loadCacheMap(db, args.videos.map((video) => video.id));
        for (const cached of cachedMap.values()) {
          cached.thumbnails = cached.thumbnails.map((thumb) => thumbAbsolute(thumb, options.cacheRootDir));
        }
        const mergedVideos = args.videos.map((video) => mergeScannedVideoWithCache(video, cachedMap.get(video.id)));
        const loadDurationMs = performance.now() - loadStartedAt;
        const saveStartedAt = performance.now();
        const payload = mergedVideos.map((video) => videoForDb(video, options.cacheRootDir));
        const writeStats = await cache.saveCacheChunked(db, payload, null, { updatedAt: options.updatedAt });
        const signatureRows = cache.loadSignatureRows(db, args.videos.map((video) => video.id));
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
      });
    case 'pruneStale':
      return run(folderPath, cacheOptions, (db) => (
        cache.pruneStaleVideosBefore(db, args.updatedAt, { details: true })
      ));
    case 'updateReviewState':
      return run(folderPath, cacheOptions, (db) => (
        cache.updateVideoReviewStateBatch(db, args.updates)
      ), 'interactive');
    case 'deleteVideos':
      return run(folderPath, cacheOptions, (db) => cache.deleteVideosByIds(db, args.videoIds), 'interactive');
    case 'moveVideos':
      return run(args.parentFolder, cacheOptions, (parentDb) => (
        run(args.targetFolder, cacheOptions, (targetDb) => {
          cache.saveCache(targetDb, args.targetVideos);
          cache.deleteVideosByIds(parentDb, args.parentVideoIds);
        })
      ));
    case 'loadRecentMetadataFailureIds':
      return run(folderPath, cacheOptions, (db) => Array.from(
        cache.loadRecentMetadataFailureIds(db, args.videoIds, args.retryAfterMs),
      ));
    case 'saveMetadata':
      return run(folderPath, cacheOptions, (db) => {
        try {
          if (args.successes.length > 0) cache.updateVideoMetadataBatch(db, args.successes);
          if (args.failures.length > 0) cache.markMetadataFailuresBatch(db, args.failures);
        } catch (err) {
          if (isSqliteCorruptionError(err)) throw err;
          log.warn('[cache] Metadata batch write failed; retrying row-by-row', {
            folderPath,
            successes: args.successes.length,
            failures: args.failures.length,
            error: err?.message || String(err),
          });
          for (const metadata of args.successes) cache.updateVideoMetadata(db, metadata.videoId, metadata);
          for (const failure of args.failures) cache.markMetadataFailure(db, failure.videoId, failure.reason);
        }
      }, 'background');
    case 'saveThumbnails':
      return run(folderPath, cacheOptions, (db) => (
        cache.updateVideoThumbnailMetadataBatch(db, args.updates)
      ), 'background');
    case 'loadDuplicateFolderState':
      return run(folderPath, cacheOptions, (db) => {
        const { videoIds, settings } = args;
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
      });
    case 'updateVideoSignatures':
      return run(folderPath, cacheOptions, (db) => (
        cache.updateVideoSignatures(db, args.videoId, args.signatures)
      ));
    case 'saveVideoFingerprints':
      return run(folderPath, cacheOptions, (db) => (
        cache.saveVideoFingerprints(db, args.videoId, args.fingerprints, { fingerprintKey: args.fingerprintKey })
      ));
    case 'markFingerprintFailure':
      return run(folderPath, cacheOptions, (db) => (
        cache.markFingerprintFailure(db, args.videoId, { fingerprintKey: args.fingerprintKey })
      ));
    default:
      throw new Error(`Unknown cache operation: ${operation}`);
  }
}

module.exports = { executeCacheOperation };
