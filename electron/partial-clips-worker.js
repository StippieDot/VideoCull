// Runs one shard of the shared-sound search off the main thread, with the same pause signal as the
// duplicate workers. The words and the index are in shared memory, so every shard reads the same copy.
const { parentPort, workerData } = require('worker_threads');
const { matchingWindows, searchIndex } = require('./sound-search');

const pauseView = workerData.pauseSignal ? new Int32Array(workerData.pauseSignal) : null;

function pauseCheckpoint() {
  if (!pauseView || Atomics.load(pauseView, 0) !== 1) return;
  Atomics.store(pauseView, 1, 1);
  parentPort.postMessage({ type: 'paused' });
  while (Atomics.load(pauseView, 0) === 1) Atomics.wait(pauseView, 0, 1);
  Atomics.store(pauseView, 1, 0);
}

try {
  const words = new Uint32Array(workerData.words);
  const tracks = workerData.layout.map(({ start, length }) => ({ words: words.subarray(start, start + length) }));
  const { pairs, commonTracks } = matchingWindows(tracks, searchIndex(tracks, workerData.index), {
    shard: workerData.shard,
    commonLimit: workerData.commonLimit,
    onProgress: (done) => {
      pauseCheckpoint();
      if (done % 50 === 0) parentPort.postMessage({ type: 'progress', done });
    },
  });
  parentPort.postMessage({ type: 'done', pairs, commonTracks });
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err?.message || String(err) });
}
