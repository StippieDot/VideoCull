const assert = require('node:assert/strict');
const path = require('path');
const { Worker } = require('worker_threads');

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../../electron/visual-worker.js'), { workerData });
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

test('bucketed visual progress total reflects only eligible candidate pairs', async () => {
  const bright = Buffer.alloc(4, 120);
  const videos = Array.from({ length: 5001 }, (_, index) => ({
    id: `v${index}`,
    durationSecs: index < 2 ? 100 : 1000 + index,
  }));
  const grayRows = videos.map((video) => ({
    video_id: video.id,
    sample_index: 0,
    gray_bytes: bright,
    frame_dark_ratio: 0.1,
  }));

  const result = await runWorker({
    videos,
    grayRows,
    settings: {
      sampleCount: 1,
      comparisonMode: 'visual',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 0,
      requireEverySample: true,
    },
  });

  assert.equal(result.bucketed, true, 'large candidate sets should use the bucketed path');
  assert.equal(result.total, 1, 'progress total should count only the one eligible same-duration pair');
  assert.equal(result.compared, 1, 'the worker should only compare the one eligible pair');
  assert.equal(result.pairs.length, 1, 'the single eligible pair should match');
});
