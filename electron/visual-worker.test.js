const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'visual-worker.js'), { workerData });
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

test('dark visual samples are skipped when enough usable samples remain', async () => {
  const bright = Buffer.alloc(4, 120);
  const result = await runWorker({
    videos: [
      { id: 'a', durationSecs: 100 },
      { id: 'b', durationSecs: 100 },
    ],
    grayRows: [
      { video_id: 'a', sample_index: 0, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'a', sample_index: 1, gray_bytes: Buffer.alloc(4, 0), frame_dark_ratio: 0.9 },
      { video_id: 'a', sample_index: 2, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 0, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 1, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 2, gray_bytes: bright, frame_dark_ratio: 0.1 },
    ],
    settings: {
      sampleCount: 3,
      comparisonMode: 'visual',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 20,
      requireEverySample: true,
    },
  });

  assert.equal(result.pairs.length, 1, 'dark sample should be ignored instead of forcing a mismatch');
});

test('visual match fails when dark-sample filtering leaves fewer than two usable samples', async () => {
  const bright = Buffer.alloc(4, 120);
  const result = await runWorker({
    videos: [
      { id: 'a', durationSecs: 100 },
      { id: 'b', durationSecs: 100 },
    ],
    grayRows: [
      { video_id: 'a', sample_index: 0, gray_bytes: Buffer.alloc(4, 0), frame_dark_ratio: 0.9 },
      { video_id: 'a', sample_index: 1, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'a', sample_index: 2, gray_bytes: Buffer.alloc(4, 0), frame_dark_ratio: 0.9 },
      { video_id: 'b', sample_index: 0, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 1, gray_bytes: bright, frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 2, gray_bytes: bright, frame_dark_ratio: 0.1 },
    ],
    settings: {
      sampleCount: 3,
      comparisonMode: 'visual',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 20,
      requireEverySample: true,
    },
  });

  assert.equal(result.pairs.length, 0, 'matching should fail when only one usable sample remains');
});
