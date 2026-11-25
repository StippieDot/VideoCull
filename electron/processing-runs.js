// @ts-check
const { createProducerTracker } = require('./graceful-shutdown');

/**
 * @typedef {object} RunSpec
 * @property {string} kind           'metadata' | 'thumbnails' | 'duplicate' (one run per kind at a time)
 * @property {() => void} cancel
 * @property {(paths: string[]) => void} [skipFiles]   leave these files alone for the rest of the run
 * @property {(filePath: string) => boolean} [isFileActive]
 */

/**
 * The one owner of running pipeline work and of the scan generation: every way of throwing the
 * session away goes through `invalidateSession()`, and shutdown drains through `drain()`.
 * Handlers stay registered in main.js.
 *
 * @param {{ liftPause: () => void, sleep?: (ms: number) => Promise<void>, now?: () => number }} deps
 *   liftPause: a user's pause must not outlive the session it was set in.
 */
function createProcessingRuns({ liftPause, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  /** @type {Set<RunSpec>} */
  const runs = new Set();
  const producers = createProducerTracker();
  let generation = 0;
  let shuttingDown = false;

  /**
   * @param {...string} kinds
   * @returns {boolean} whether a run was cancelled
   */
  function cancelKinds(...kinds) {
    let cancelled = false;
    for (const run of [...runs]) {
      if (!kinds.includes(run.kind)) continue;
      runs.delete(run);
      run.cancel();
      cancelled = true;
    }
    return cancelled;
  }

  function invalidateSession() {
    generation += 1;
    cancelKinds(...[...runs].map((run) => run.kind));
    liftPause();
  }

  return {
    /** Starts a scan: any scan holding an older token is superseded. */
    beginScan: () => ++generation,
    /** @param {number} token */
    isScanCurrent: (token) => token === generation,
    /**
     * Registers a run, cancelling the previous run of the same kind.
     * @param {RunSpec} spec
     */
    register(spec) {
      cancelKinds(spec.kind);
      runs.add(spec);
      return { finish: () => { runs.delete(spec); } };
    },
    /** Only cancels; a user's pause is lifted by invalidateSession(). */
    cancelKinds,
    /** @param {string} kind */
    isRunning: (kind) => [...runs].some((run) => run.kind === kind),
    /** Opening or closing a folder, clearing or moving the cache, and a renderer reload end here. */
    invalidateSession,
    /** Marks quitting, stops all work and refuses new cache producers. */
    beginShutdown() {
      shuttingDown = true;
      invalidateSession();
    },
    isShuttingDown: () => shuttingDown,
    /**
     * Runs a cache write; resolves false without running once shutdown has begun.
     * @param {() => Promise<any>} operation
     * @returns {Promise<any>}
     */
    trackProducer(operation) {
      return shuttingDown ? Promise.resolve(false) : producers.track(operation);
    },
    /** Same, for work that checks for shutdown itself. */
    trackWork: producers.track,
    drain: producers.drain,
    /**
     * Running pipelines skip these files from now on. Never lifts a pause or cancels a run.
     * @param {string[]} paths
     */
    skipFiles(paths) {
      for (const run of runs) run.skipFiles?.(paths);
    },
    /**
     * Waits until no run is working on any of the files, up to `timeoutMs`.
     * @param {string[]} paths
     * @param {number} timeoutMs
     * @returns {Promise<string[]>} the files still being worked on after the wait
     */
    async waitUntilIdle(paths, timeoutMs, pollMs = 50) {
      const busy = () => paths.filter((filePath) => [...runs].some((run) => run.isFileActive?.(filePath)));
      const deadline = now() + timeoutMs;
      let remaining = busy();
      while (remaining.length > 0 && now() < deadline) {
        await sleep(pollMs);
        remaining = busy();
      }
      return remaining;
    },
  };
}

module.exports = { createProcessingRuns };
