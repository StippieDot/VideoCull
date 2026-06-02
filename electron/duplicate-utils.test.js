const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSamplingTimestamps,
  calculateDctPHash,
  flipGrayBytes,
  parsePHashHex,
  popcountBigInt,
  pHashSimilarity,
  rawGraySimilarity,
  average,
  normalizeDuplicateSettings,
  durationsWithinTolerance,
  chooseSuggestedKeeper,
} = require('./duplicate-utils');

test('even sampling uses N+1 spacing', () => {
  assert.deepEqual(getSamplingTimestamps(60, 5, { samplingWindow: 'even' }), [10, 20, 30, 40, 50]);
});

test('center sampling avoids edges', () => {
  assert.deepEqual(getSamplingTimestamps(100, 3, { samplingWindow: '25-75' }), [37.5, 50, 62.5]);
});

test('pHash is deterministic for the same grayscale bytes', () => {
  const bytes = Buffer.alloc(1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 255;
  assert.equal(calculateDctPHash(bytes), calculateDctPHash(bytes));
});

test('BigInt pHash parsing and popcount work', () => {
  assert.equal(parsePHashHex('0f'), 15n);
  assert.equal(popcountBigInt(15n), 4);
  assert.equal(pHashSimilarity('ffff000000000000', 'ffff000000000000'), 100);
});

test('raw grayscale similarity averages pixel differences', () => {
  assert.equal(rawGraySimilarity(Buffer.from([0, 255]), Buffer.from([0, 255])), 100);
  assert.ok(rawGraySimilarity(Buffer.from([0, 255]), Buffer.from([255, 0])) < 1);
});

test('default settings follow the simplified VDF-style model', () => {
  const settings = normalizeDuplicateSettings({});
  assert.equal(settings.finalSimilarityThreshold, 95);
  assert.equal(settings.sampleCount, 3);
  assert.equal(settings.comparisonMode, 'visual');
  assert.equal(settings.durationTolerancePercent, 20);
  assert.equal(settings.checkpointIntervalMinutes, 5);
  assert.equal(settings.requireEverySample, true);
  assert.deepEqual(settings.keeperOrder, ['resolution', 'videoBitrate', 'duration', 'fps', 'size']);
});

test('duration tolerance uses the shorter video as the percentage base', () => {
  const settings = normalizeDuplicateSettings({ durationTolerancePercent: 20 });
  assert.equal(
    durationsWithinTolerance({ durationSecs: 60 }, { durationSecs: 48 }, settings),
    false,
  );
  assert.equal(
    durationsWithinTolerance({ durationSecs: 60 }, { durationSecs: 50 }, settings),
    true,
  );
});

test('users can choose comparison method and similarity directly', () => {
  const settings = normalizeDuplicateSettings({ comparisonMode: 'phash', finalSimilarityThreshold: 92 });
  assert.equal(settings.comparisonMode, 'phash');
  assert.equal(settings.finalSimilarityThreshold, 92);
});

test('two and four samples are valid duplicate settings', () => {
  assert.equal(normalizeDuplicateSettings({ sampleCount: 2 }).sampleCount, 2);
  assert.equal(normalizeDuplicateSettings({ sampleCount: 4 }).sampleCount, 4);
});

test('average ignores non-finite values', () => {
  assert.equal(average([100, Number.NaN, 90]), 95);
});

test('flipGrayBytes mirrors rows horizontally', () => {
  assert.deepEqual([...flipGrayBytes(Buffer.from([1, 2, 3, 4]), 2, 2)], [2, 1, 4, 3]);
});

test('keeper ordering prefers higher quality by default', () => {
  const low = {
    id: 'low',
    filename: 'low.mp4',
    path: 'P:\\low.mp4',
    width: 1280,
    height: 720,
    videoBitrate: 2011000,
    durationSecs: 1508,
    fps: 23.98,
    sizeBytes: 392300000,
  };
  const high = {
    id: 'high',
    filename: 'high.mp4',
    path: 'P:\\high.mp4',
    width: 1920,
    height: 1080,
    videoBitrate: 2358000,
    durationSecs: 1508,
    fps: 25,
    sizeBytes: 448200000,
  };
  assert.equal(chooseSuggestedKeeper([low, high], normalizeDuplicateSettings({}))?.id, 'high');
});

test('keeper ordering follows user priority order', () => {
  const largeLowerBitrate = {
    id: 'large',
    filename: 'large.mp4',
    path: 'P:\\large.mp4',
    width: 1280,
    height: 720,
    videoBitrate: 1700000,
    durationSecs: 100,
    fps: 30,
    sizeBytes: 900,
  };
  const smallHigherBitrate = {
    id: 'bitrate',
    filename: 'bitrate.mp4',
    path: 'P:\\bitrate.mp4',
    width: 1280,
    height: 720,
    videoBitrate: 3000000,
    durationSecs: 100,
    fps: 30,
    sizeBytes: 700,
  };
  const settings = normalizeDuplicateSettings({ keeperOrder: ['size', 'videoBitrate', 'resolution'] });
  assert.equal(chooseSuggestedKeeper([smallHigherBitrate, largeLowerBitrate], settings)?.id, 'large');
});

test('keeper ordering normalization removes legacy metadata and filename rules', () => {
  const settings = normalizeDuplicateSettings({
    keeperOrder: ['metadataDate', 'size', 'filename', 'fps'],
  });
  assert.deepEqual(settings.keeperOrder, ['size', 'fps', 'resolution', 'videoBitrate', 'duration']);
});
