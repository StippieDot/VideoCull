const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createCacheService({ WorkerClass = Worker, workerPath = path.join(__dirname, 'cache-worker.js') } = {}) {
  let worker = null;
  let nextRequestId = 1;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    const nextWorker = new WorkerClass(workerPath);
    nextWorker.unref?.();
    nextWorker.on('message', (message) => {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (!message.error) {
        request.resolve(message.result);
        return;
      }
      const error = new Error(message.error.message);
      error.name = message.error.name || 'Error';
      error.stack = message.error.stack || error.stack;
      if (message.error.code) error.code = message.error.code;
      request.reject(error);
    });
    nextWorker.on('error', (error) => {
      if (worker === nextWorker) worker = null;
      rejectPending(error);
    });
    nextWorker.on('exit', (code) => {
      if (worker === nextWorker) worker = null;
      if (pending.size > 0) rejectPending(new Error(`Cache worker exited with code ${code}`));
    });
    worker = nextWorker;
    return worker;
  }

  function request(operation, args = {}, priority = 'foreground') {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        ensureWorker().postMessage({ id, operation, args, priority });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function shutdown() {
    const activeWorker = worker;
    if (!activeWorker) return;
    try {
      await request('closeAll', {}, 'interactive');
    } finally {
      if (worker === activeWorker) worker = null;
      await activeWorker.terminate?.();
    }
  }

  return {
    closeAll: () => worker ? request('closeAll', {}, 'interactive') : Promise.resolve(true),
    shutdown,
    closeFolder: (folderPath, cacheOptions, options) => request(
      'closeFolder',
      { folderPath, cacheOptions, options },
      'interactive',
    ),
    deleteDb: (folderPath, cacheOptions, options) => request(
      'deleteDb',
      { folderPath, cacheOptions, options },
      'interactive',
    ),
    getStats: () => request('getStats'),
    ensureFolder: (folderPath, cacheOptions) => request('ensureFolder', { folderPath, cacheOptions }),
    migrateJson: (folderPath, cacheOptions) => request('migrateJson', { folderPath, cacheOptions }),
    loadVideos: (folderPath, cacheOptions, videoIds = null) => request(
      'loadVideos',
      { folderPath, cacheOptions, videoIds },
    ),
    saveVideos: (folderPath, cacheOptions, videos, options = {}) => request(
      'saveVideos',
      { folderPath, cacheOptions, videos, options, priority: options.priority },
      options.priority,
    ),
    reconcileScannedFolder: (folderPath, cacheOptions, videos, options) => request(
      'reconcileScannedFolder',
      { folderPath, cacheOptions, videos, options },
    ),
    pruneStale: (folderPath, cacheOptions, updatedAt) => request(
      'pruneStale',
      { folderPath, cacheOptions, updatedAt },
    ),
    updateReviewState: (folderPath, cacheOptions, updates) => request(
      'updateReviewState',
      { folderPath, cacheOptions, updates },
      'interactive',
    ),
    deleteVideos: (folderPath, cacheOptions, videoIds) => request(
      'deleteVideos',
      { folderPath, cacheOptions, videoIds },
      'interactive',
    ),
    moveVideos: (parentFolder, targetFolder, cacheOptions, targetVideos, parentVideoIds) => request(
      'moveVideos',
      { parentFolder, targetFolder, cacheOptions, targetVideos, parentVideoIds },
    ),
    loadRecentMetadataFailureIds: (folderPath, cacheOptions, videoIds, retryAfterMs) => request(
      'loadRecentMetadataFailureIds',
      { folderPath, cacheOptions, videoIds, retryAfterMs },
    ),
    saveMetadata: (folderPath, cacheOptions, successes, failures) => request(
      'saveMetadata',
      { folderPath, cacheOptions, successes, failures },
      'background',
    ),
    saveThumbnails: (folderPath, cacheOptions, updates) => request(
      'saveThumbnails',
      { folderPath, cacheOptions, updates },
      'background',
    ),
    loadDuplicateFolderState: (folderPath, cacheOptions, videoIds, settings) => request(
      'loadDuplicateFolderState',
      { folderPath, cacheOptions, videoIds, settings },
    ),
    updateVideoSignatures: (folderPath, cacheOptions, videoId, signatures) => request(
      'updateVideoSignatures',
      { folderPath, cacheOptions, videoId, signatures },
    ),
    saveVideoFingerprints: (folderPath, cacheOptions, videoId, fingerprints, fingerprintKey) => request(
      'saveVideoFingerprints',
      { folderPath, cacheOptions, videoId, fingerprints, fingerprintKey },
    ),
    markFingerprintFailure: (folderPath, cacheOptions, videoId, fingerprintKey) => request(
      'markFingerprintFailure',
      { folderPath, cacheOptions, videoId, fingerprintKey },
    ),
  };
}

module.exports = { createCacheService };
