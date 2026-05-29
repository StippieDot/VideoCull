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

test('unknown-duration videos are NOT compared against known-duration videos', async () => {
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

  assert.equal(result.pairs.length, 0, 'should not cross-compare known vs unknown duration');
});

test('unknown-duration videos ARE compared against each other', async () => {
  const result = await runWorker({
    videos: [
      { id: 'known', durationSecs: 100 },
      { id: 'unknownA', durationSecs: null },
      { id: 'unknownB', durationSecs: 0 },
    ],
    phashRows: [
      { video_id: 'known', sample_index: 0, timestamp_secs: 50, phash_hex: 'ffff000000000000' },
      { video_id: 'unknownA', sample_index: 0, timestamp_secs: 0, phash_hex: 'ffff000000000000' },
      { video_id: 'unknownB', sample_index: 0, timestamp_secs: 0, phash_hex: 'ffff000000000000' },
    ],
    settings: {
      sampleCount: 1,
      comparisonMode: 'phash',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 20,
    },
  });

  assert.equal(result.pairs.length, 1, 'two unknown-duration videos with same hash should match');
  assert.equal(result.pairs[0].aId, 'unknownA');
  assert.equal(result.pairs[0].bId, 'unknownB');
});

test('dark pHash samples are skipped when enough usable samples remain', async () => {
  const result = await runWorker({
    videos: [
      { id: 'a', durationSecs: 100 },
      { id: 'b', durationSecs: 100 },
    ],
    phashRows: [
      { video_id: 'a', sample_index: 0, timestamp_secs: 25, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'a', sample_index: 1, timestamp_secs: 50, phash_hex: '0000000000000000', frame_dark_ratio: 0.9 },
      { video_id: 'a', sample_index: 2, timestamp_secs: 75, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 0, timestamp_secs: 25, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 1, timestamp_secs: 50, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 2, timestamp_secs: 75, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
    ],
    settings: {
      sampleCount: 3,
      comparisonMode: 'phash',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 20,
      requireEverySample: true,
    },
  });

  assert.equal(result.pairs.length, 1, 'dark sample should be ignored instead of forcing a mismatch');
});

test('pHash match fails when dark-sample filtering leaves fewer than two usable samples', async () => {
  const result = await runWorker({
    videos: [
      { id: 'a', durationSecs: 100 },
      { id: 'b', durationSecs: 100 },
    ],
    phashRows: [
      { video_id: 'a', sample_index: 0, timestamp_secs: 25, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.9 },
      { video_id: 'a', sample_index: 1, timestamp_secs: 50, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'a', sample_index: 2, timestamp_secs: 75, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.9 },
      { video_id: 'b', sample_index: 0, timestamp_secs: 25, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 1, timestamp_secs: 50, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
      { video_id: 'b', sample_index: 2, timestamp_secs: 75, phash_hex: 'ffff000000000000', frame_dark_ratio: 0.1 },
    ],
    settings: {
      sampleCount: 3,
      comparisonMode: 'phash',
      finalSimilarityThreshold: 95,
      durationTolerancePercent: 20,
      requireEverySample: true,
    },
  });

  assert.equal(result.pairs.length, 0, 'matching should fail when only one usable sample remains');
});
