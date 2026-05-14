const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'duplicate-worker.js'), { workerData });
    worker.on('message', (message) => {
      if (message.type === 'done') resolve(message);
      if (message.type === 'error') reject(new Error(message.message));
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with ${code}`));
    });
  });
}

test('pHash worker compares unknown-duration videos even when they appear after known-duration videos', async () => {
  const result = await runWorker({
    videos: [
      { id: 'known', durationSecs: 100 },
      { id: 'unknown', durationSecs: null },
    ],
    phashRows: [
      { video_id: 'known', sample_index: 0, timestamp_secs: 50, phash_hex: 'ffff000000000000' },
      { video_id: 'unknown', sample_index: 0, timestamp_secs: 0, phash_hex: 'ffff000000000000' },
    ],
    settings: {
      sampleCount: 1,
      comparisonMode: 'phash',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 20,
    },
  });

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].aId, 'known');
  assert.equal(result.pairs[0].bId, 'unknown');
});

