// Runs the shared-sound search off the main thread, with the same pause signal as the duplicate workers.
const { parentPort, workerData } = require('worker_threads');
const { findSharedSound } = require('./sound-search');

const pauseView = workerData.pauseSignal ? new Int32Array(workerData.pauseSignal) : null;

function pauseCheckpoint() {
  if (!pauseView || Atomics.load(pauseView, 0) !== 1) return;
  Atomics.store(pauseView, 1, 1);
  parentPort.postMessage({ type: 'paused' });
  while (Atomics.load(pauseView, 0) === 1) Atomics.wait(pauseView, 0, 1);
  Atomics.store(pauseView, 1, 0);
}

try {
  const tracks = workerData.tracks.map((track) => ({ id: track.id, words: new Uint32Array(track.words) }));
  const relations = findSharedSound(tracks, {
    skipPairKeys: new Set(workerData.skipPairKeys ?? []),
    onProgress: (current, total) => {
      pauseCheckpoint();
      if (current % 50 === 0 || current === total) parentPort.postMessage({ type: 'progress', current, total });
    },
  });
  parentPort.postMessage({ type: 'done', relations });
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err?.message || String(err) });
}
