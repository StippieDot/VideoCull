const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { resolveCachePath } = require('./cache');

function createCacheService({
  WorkerClass = Worker,
  workerPath = path.join(__dirname, 'cache-worker.js'),
  shutdownTimeoutMs = 5000,
} = {}) {
  let worker = null;
  let nextRequestId = 1;
  let transitionDepth = 0;
  let shuttingDown = false;
  let shutdownPromise = null;
  const pending = new Map();
  const blockedScopes = new Set();

  function scopeKey(folderPath, cacheOptions) {
    return path.resolve(resolveCachePath(folderPath, cacheOptions)).toLowerCase();
  }

  function rejectWorkerRequests(targetWorker, error) {
    for (const [id, request] of pending) {
      if (request.worker !== targetWorker) continue;
      pending.delete(id);
      request.reject(error);
    }
  }

  function ensureWorker() {
    if (worker) return worker;
    const nextWorker = new WorkerClass(workerPath);
    nextWorker.unref?.();
    nextWorker.on('message', (message) => {
      const request = pending.get(message.id);
      if (!request || request.worker !== nextWorker) return;
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
      rejectWorkerRequests(nextWorker, error);
    });
    nextWorker.on('exit', (code) => {
      if (worker === nextWorker) worker = null;
      rejectWorkerRequests(nextWorker, new Error(`Cache worker exited with code ${code}`));
    });
    worker = nextWorker;
    return worker;
  }

  function postRequest(targetWorker, operation, args, priority) {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, worker: targetWorker });
      try {
        targetWorker.postMessage({ id, operation, args, priority });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function request(operation, args = {}, priority = 'foreground', options = {}) {
    if (!options.internal) {
      if (shuttingDown) return Promise.reject(new Error('Cache service is shutting down'));
      if (transitionDepth > 0) return Promise.reject(new Error('Cache transition is in progress'));
      if (options.scope && blockedScopes.has(options.scope)) {
        return Promise.reject(new Error('Cache folder is unavailable during a destructive transition'));
      }
    }
    return postRequest(ensureWorker(), operation, args, priority);
  }

  function blockFolder(folderPath, cacheOptions) {
    blockedScopes.add(scopeKey(folderPath, cacheOptions));
  }

  function allowFolder(folderPath, cacheOptions) {
    if (transitionDepth > 0) return;
    blockedScopes.delete(scopeKey(folderPath, cacheOptions));
  }

  async function beginTransition() {
    if (shuttingDown) throw new Error('Cache service is shutting down');
    transitionDepth += 1;
    if (transitionDepth > 1 || !worker) return;
    await request('closeAll', {}, 'background', { internal: true });
  }

  function endTransition() {
    transitionDepth = Math.max(0, transitionDepth - 1);
  }

  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    const activeWorker = worker;
    if (!activeWorker) return;
    shutdownPromise = (async () => {
      let timeout;
      try {
        await Promise.race([
          postRequest(activeWorker, 'closeAll', {}, 'background'),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Cache worker shutdown timed out')), shutdownTimeoutMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        if (worker === activeWorker) worker = null;
        rejectWorkerRequests(activeWorker, new Error('Cache worker stopped'));
        await activeWorker.terminate?.();
      }
    })();
    return shutdownPromise;
  }

  const scopedRequest = (operation, folderPath, cacheOptions, args = {}, priority = 'foreground') => request(
    operation,
    { folderPath, cacheOptions, ...args },
    priority,
    { scope: scopeKey(folderPath, cacheOptions) },
  );

  return {
    allowFolder,
    beginTransition,
    blockFolder,
    closeAll: () => worker ? request('closeAll', {}, 'background') : Promise.resolve(true),
    endTransition,
    shutdown,
    closeFolder: (folderPath, cacheOptions, options) => {
      blockFolder(folderPath, cacheOptions);
      return request('closeFolder', { folderPath, cacheOptions, options }, 'background', { internal: true });
    },
    deleteDb: (folderPath, cacheOptions, options) => {
      blockFolder(folderPath, cacheOptions);
      return request('deleteDb', { folderPath, cacheOptions, options }, 'background', { internal: true });
    },
    getStats: () => request('getStats'),
    ensureFolder: (folderPath, cacheOptions) => {
      allowFolder(folderPath, cacheOptions);
      return scopedRequest('ensureFolder', folderPath, cacheOptions);
    },
    migrateJson: (folderPath, cacheOptions) => scopedRequest('migrateJson', folderPath, cacheOptions),
    loadVideos: (folderPath, cacheOptions, videoIds = null) => scopedRequest(
      'loadVideos', folderPath, cacheOptions, { videoIds },
    ),
    saveVideos: (folderPath, cacheOptions, videos, options = {}) => scopedRequest(
      'saveVideos', folderPath, cacheOptions, { videos, options, priority: options.priority }, options.priority,
    ),
    reconcileScannedFolder: (folderPath, cacheOptions, videos, options) => scopedRequest(
      'reconcileScannedFolder', folderPath, cacheOptions, { videos, options },
    ),
    pruneStale: (folderPath, cacheOptions, updatedAt) => scopedRequest(
      'pruneStale', folderPath, cacheOptions, { updatedAt },
    ),
    updateReviewState: (folderPath, cacheOptions, updates) => scopedRequest(
      'updateReviewState', folderPath, cacheOptions, { updates }, 'interactive',
    ),
    deleteVideos: (folderPath, cacheOptions, videoIds) => scopedRequest(
      'deleteVideos', folderPath, cacheOptions, { videoIds }, 'interactive',
    ),
    moveVideos: (parentFolder, targetFolder, cacheOptions, targetVideos, parentVideoIds) => {
      const parentScope = scopeKey(parentFolder, cacheOptions);
      const targetScope = scopeKey(targetFolder, cacheOptions);
      if (blockedScopes.has(parentScope) || blockedScopes.has(targetScope)) {
        return Promise.reject(new Error('Cache folder is unavailable during a destructive transition'));
      }
      return request(
        'moveVideos',
        { parentFolder, targetFolder, cacheOptions, targetVideos, parentVideoIds },
      );
    },
    loadRecentMetadataFailureIds: (folderPath, cacheOptions, videoIds, retryAfterMs) => scopedRequest(
      'loadRecentMetadataFailureIds', folderPath, cacheOptions, { videoIds, retryAfterMs },
    ),
    saveMetadata: (folderPath, cacheOptions, successes, failures) => scopedRequest(
      'saveMetadata', folderPath, cacheOptions, { successes, failures }, 'background',
    ),
    saveThumbnails: (folderPath, cacheOptions, updates) => scopedRequest(
      'saveThumbnails', folderPath, cacheOptions, { updates }, 'background',
    ),
    loadDuplicateFolderState: (folderPath, cacheOptions, videoIds, settings) => scopedRequest(
      'loadDuplicateFolderState', folderPath, cacheOptions, { videoIds, settings },
    ),
    updateVideoSignatures: (folderPath, cacheOptions, videoId, signatures) => scopedRequest(
      'updateVideoSignatures', folderPath, cacheOptions, { videoId, signatures },
    ),
    saveVideoFingerprints: (folderPath, cacheOptions, videoId, fingerprints, fingerprintKey) => scopedRequest(
      'saveVideoFingerprints', folderPath, cacheOptions, { videoId, fingerprints, fingerprintKey },
    ),
    markFingerprintFailure: (folderPath, cacheOptions, videoId, fingerprintKey) => scopedRequest(
      'markFingerprintFailure', folderPath, cacheOptions, { videoId, fingerprintKey },
    ),
  };
}

module.exports = { createCacheService };
