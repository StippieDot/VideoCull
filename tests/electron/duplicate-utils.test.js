const assert = require('node:assert/strict');
const {
  getSamplingTimestamps,
  calculateDctPHash,
  flipGrayBytes,
  parsePHashWords,
  popcount32,
  pHashSimilarity,
  pHashSamplesByVideo,
  graySamplesByVideo,
  pHashSampleScore,
  graySampleScore,
  scoreSamples,
  isUsableSample,
  movementClass,
  rawGraySimilarity,
  average,
  combineSampleScores,
  normalizeDuplicateSettings,
  getDuplicateFingerprintKey,
  durationsWithinTolerance,
  chooseSuggestedKeeper,
} = require('../../electron/duplicate-utils');

test('even sampling uses N+1 spacing', () => {
  assert.deepEqual(getSamplingTimestamps(60, 5, { samplingWindow: 'even' }), [10, 20, 30, 40, 50]);
});

test('center sampling avoids edges', () => {
  assert.deepEqual(getSamplingTimestamps(100, 3, { samplingWindow: '25-75' }), [37.5, 50, 62.5]);
});

test('sample times sit a quarter frame before a frame boundary when the frame rate is known', () => {
  // 5.22 s at 24 fps is between frames 125 and 126; the nearest is 125.
  assert.deepEqual(getSamplingTimestamps(52.2, 9, { samplingWindow: 'even' }, 24).slice(0, 1), [(125 - 0.25) / 24].map((t) => Math.round(t * 1e6) / 1e6));
  // 23.98 stands for 24000/1001; at 1000 s the rounded rate would be four frames off.
  const [ntsc] = getSamplingTimestamps(2000, 1, { samplingWindow: 'even' }, 23.98);
  const frames = ntsc * 24000 / 1001;
  assert.ok(Math.abs(frames - Math.round(frames) + 0.25) < 1e-3, `frame offset ${frames}`);
  // No frame rate: unchanged.
  assert.deepEqual(getSamplingTimestamps(60, 5, { samplingWindow: 'even' }, null), [10, 20, 30, 40, 50]);
});

test('pHash is deterministic for the same grayscale bytes', () => {
  const bytes = Buffer.alloc(1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 255;
  assert.equal(calculateDctPHash(bytes), calculateDctPHash(bytes));
});

test('pHash parsing and bit count work', () => {
  assert.deepEqual([...parsePHashWords('0f')], [0, 15]);
  assert.deepEqual([...parsePHashWords('ffff000000000001')], [0xffff0000, 1]);
  assert.deepEqual([...parsePHashWords('not hex')], [0, 0]);
  assert.equal(popcount32(15), 4);
  assert.equal(popcount32(-1), 32);
  assert.equal(pHashSimilarity('ffff000000000000', '7fff000000000001'), (62 / 64) * 100);
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
  assert.equal(settings.comparisonMode, 'phash');
  assert.equal(settings.durationTolerancePercent, 20);
  assert.equal(settings.checkpointIntervalMinutes, 5);
  assert.equal(settings.requireEverySample, false);
  assert.deepEqual(settings.keeperOrder, ['resolution', 'videoBitrate', 'duration', 'fps', 'size', 'codec']);
});

test('similarity threshold accepts any value from 0 to 100 percent', () => {
  assert.equal(normalizeDuplicateSettings({ finalSimilarityThreshold: 10 }).finalSimilarityThreshold, 10);
  assert.equal(normalizeDuplicateSettings({ finalSimilarityThreshold: -5 }).finalSimilarityThreshold, 0);
  assert.equal(normalizeDuplicateSettings({ finalSimilarityThreshold: 120 }).finalSimilarityThreshold, 100);
});

test('separate similarity values apply the one for the chosen method', () => {
  const base = { separateSimilarityThresholds: true, finalSimilarityThreshold: 95, phashSimilarityThreshold: 80, visualSimilarityThreshold: 90 };
  assert.equal(normalizeDuplicateSettings({ ...base, comparisonMode: 'phash' }).finalSimilarityThreshold, 80);
  assert.equal(normalizeDuplicateSettings({ ...base, comparisonMode: 'visual' }).finalSimilarityThreshold, 90);
  assert.equal(normalizeDuplicateSettings({ ...base, separateSimilarityThresholds: false }).finalSimilarityThreshold, 95);
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

test('fingerprint cache key changes only when extraction settings change', () => {
  const base = getDuplicateFingerprintKey({
    sampleCount: 3,
    samplingWindow: 'even',
    finalSimilarityThreshold: 95,
  });

  assert.notEqual(base, getDuplicateFingerprintKey({ sampleCount: 5, samplingWindow: 'even' }));
  assert.notEqual(base, getDuplicateFingerprintKey({ sampleCount: 3, samplingWindow: '25-75' }));
  assert.equal(base, getDuplicateFingerprintKey({
    sampleCount: 3,
    samplingWindow: 'even',
    finalSimilarityThreshold: 90,
    keeperOrder: ['size', 'resolution'],
  }));
});

test('average ignores non-finite values', () => {
  assert.equal(average([100, Number.NaN, 90]), 95);
});

test('pair score is the weakest sample when every sample must pass, otherwise the average', () => {
  assert.equal(combineSampleScores([96.9, 93.8, 89.1], { requireEverySample: true }), 89.1);
  assert.equal(combineSampleScores([96, 94, 92], { requireEverySample: false }), 94);
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

test('keeper ordering uses bitrate when displayed resolution tiers match', () => {
  const morePixels = {
    id: 'more-pixels',
    path: 'P:\\more-pixels.mp4',
    width: 1920,
    height: 1080,
    videoBitrate: 3586000,
  };
  const higherBitrate = {
    id: 'higher-bitrate',
    path: 'P:\\higher-bitrate.mp4',
    width: 1920,
    height: 800,
    videoBitrate: 6008000,
  };
  const lowerTier = {
    id: 'lower-tier',
    path: 'P:\\lower-tier.mp4',
    width: 1280,
    height: 720,
    videoBitrate: 12000000,
  };

  assert.equal(chooseSuggestedKeeper([morePixels, higherBitrate, lowerTier], normalizeDuplicateSettings({}))?.id, 'higher-bitrate');
});

test('keeper ordering does not assign a resolution tier to incomplete metadata', () => {
  const incomplete = { id: 'incomplete', path: 'P:\\incomplete.mp4', width: 1920, height: null, videoBitrate: 6008000 };
  const complete = { id: 'complete', path: 'P:\\complete.mp4', width: 1280, height: 720, videoBitrate: 3586000 };

  assert.equal(chooseSuggestedKeeper([incomplete, complete], normalizeDuplicateSettings({}))?.id, 'complete');
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
  assert.deepEqual(settings.keeperOrder, ['size', 'fps', 'resolution', 'videoBitrate', 'duration', 'codec']);
});

test('codec ranks above bitrate when the user puts it first, and falls back to the next rule when codecs tie', () => {
  const h264 = { id: 'h264', path: 'a.mp4', videoCodec: 'h264', videoBitrate: 10_000_000, sizeBytes: 1200 };
  const hevc = { id: 'hevc', path: 'b.mp4', videoCodec: 'HEVC', videoBitrate: 6_000_000, sizeBytes: 750 };
  const unknown = { id: 'unknown', path: 'c.mp4', videoCodec: 'mpeg4', videoBitrate: 20_000_000, sizeBytes: 50 };
  const codecFirst = normalizeDuplicateSettings({ keeperOrder: ['codec', 'videoBitrate'] });
  assert.equal(chooseSuggestedKeeper([h264, hevc], codecFirst)?.id, 'hevc');
  assert.equal(chooseSuggestedKeeper([h264, hevc], normalizeDuplicateSettings({ keeperOrder: ['videoBitrate', 'codec'] }))?.id, 'h264');
  // Unlisted codecs tie with each other and rank below every listed one.
  assert.equal(chooseSuggestedKeeper([unknown, h264], codecFirst)?.id, 'h264');
  assert.equal(chooseSuggestedKeeper([unknown, { ...unknown, id: 'other', path: 'd.mp4', videoBitrate: 1 }], codecFirst)?.id, 'unknown');
});

test('codec preference order is configurable and normalized', () => {
  const h264First = normalizeDuplicateSettings({ keeperOrder: ['codec'], codecOrder: ['h264', 'bogus', 'h264'] });
  assert.deepEqual(h264First.codecOrder, ['h264', 'av1', 'hevc', 'vp9', 'vp8', 'mpeg4', 'mpeg2video', 'vc1']);
  const hevc = { id: 'hevc', path: 'b.mp4', videoCodec: 'hevc' };
  const h264 = { id: 'h264', path: 'a.mp4', videoCodec: 'h264' };
  assert.equal(chooseSuggestedKeeper([hevc, h264], h264First)?.id, 'h264');
  assert.deepEqual(normalizeDuplicateSettings({}).codecOrder, ['av1', 'hevc', 'vp9', 'h264', 'vp8', 'mpeg4', 'mpeg2video', 'vc1']);
  // Alternative ffprobe names count as their family.
  const wmv = { id: 'wmv', path: 'w.wmv', videoCodec: 'wmv3' };
  const mpeg4 = { id: 'mpeg4', path: 'm.avi', videoCodec: 'mpeg4' };
  const hevcAlias = { id: 'h265', path: 'h.mkv', videoCodec: 'h265' };
  const codecOnly = normalizeDuplicateSettings({ keeperOrder: ['codec'] });
  assert.equal(chooseSuggestedKeeper([wmv, mpeg4], codecOnly)?.id, 'mpeg4');
  assert.equal(chooseSuggestedKeeper([mpeg4, hevcAlias], codecOnly)?.id, 'h265');
});

test('fingerprints made before frame-aligned sampling are not reused', () => {
  // Stored rows carry the key they were made with; only matching rows are loaded.
  assert.match(getDuplicateFingerprintKey({}), /^gray32-v3\|/);
});

// --- scoreSamples against the four implementations it replaced -------------------------------
// The functions below are the scoring rules as they were written before, kept as the reference.

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function previousPHashSimilarity(hexA, hexB) {
  let difference = BigInt(`0x${hexA}`) ^ BigInt(`0x${hexB}`);
  let distance = 0;
  while (difference > 0n) {
    difference &= difference - 1n;
    distance++;
  }
  return ((64 - distance) / 64) * 100;
}

const previousIsDark = (sample) => Number(sample?.darkRatio ?? 0) >= 0.8;
const previousMinimum = (sampleCount) => (sampleCount > 1 ? 2 : 1);

function previousPHashScore(samplesA, samplesB, settings, enforceThreshold) {
  const sampleScores = [];
  for (let i = 0; i < settings.sampleCount; i++) {
    const sampleA = samplesA[i];
    const sampleB = samplesB[i];
    if (!sampleA || !sampleB) return null;
    if (previousIsDark(sampleA) || previousIsDark(sampleB)) continue;
    const normalScore = previousPHashSimilarity(sampleA.hash, sampleB.hash);
    const flippedScore = settings.compareFlipped
      ? previousPHashSimilarity(sampleA.flippedHash, sampleB.hash)
      : normalScore;
    sampleScores.push(Math.max(normalScore, flippedScore));
    if (settings.phashFirstSampleOnly) break;
  }
  if (sampleScores.length < previousMinimum(settings.phashFirstSampleOnly ? 1 : settings.sampleCount)) return null;
  if (settings.requireEverySample && sampleScores.some((score) => score < settings.finalSimilarityThreshold)) return null;
  const similarity = combineSampleScores(sampleScores, settings);
  if (!enforceThreshold) return similarity;
  return similarity >= settings.finalSimilarityThreshold ? similarity : null;
}

function previousVisualScore(samplesA, samplesB, settings, enforceThreshold) {
  const scores = [];
  for (let i = 0; i < settings.sampleCount; i++) {
    const sampleA = samplesA[i];
    const sampleB = samplesB[i];
    if (previousIsDark(sampleA) || previousIsDark(sampleB)) continue;
    const normalScore = rawGraySimilarity(sampleA.bytes, sampleB.bytes, settings);
    const flippedScore = settings.compareFlipped
      ? rawGraySimilarity(flipGrayBytes(sampleA.bytes, 4, 4), sampleB.bytes, settings)
      : normalScore;
    const bestScore = Math.max(normalScore, flippedScore);
    if (settings.requireEverySample && bestScore < settings.finalSimilarityThreshold) return null;
    scores.push(bestScore);
  }
  if (scores.length < previousMinimum(settings.sampleCount)) return null;
  const similarity = combineSampleScores(scores, settings);
  if (!enforceThreshold) return similarity;
  return similarity >= settings.finalSimilarityThreshold ? similarity : null;
}

function settingCombinations() {
  const combinations = [];
  for (const sampleCount of [1, 2, 3, 5, 9]) {
    for (const finalSimilarityThreshold of [90, 95, 96.875]) {
      for (let flags = 0; flags < 8; flags++) {
        combinations.push(normalizeDuplicateSettings({
          sampleCount,
          finalSimilarityThreshold,
          compareFlipped: Boolean(flags & 1),
          requireEverySample: Boolean(flags & 2),
          phashFirstSampleOnly: Boolean(flags & 4),
          ignoreBlackPixels: Boolean(flags & 4),
          ignoreWhitePixels: Boolean(flags & 1),
        }));
      }
    }
  }
  return combinations;
}

test('32-bit bit count equals the BigInt count it replaced', () => {
  const random = seededRandom(7);
  for (let i = 0; i < 2000; i++) {
    const value = Math.floor(random() * 2 ** 32);
    let expected = 0;
    for (let n = BigInt(value); n > 0n; n &= n - 1n) expected++;
    assert.equal(popcount32(value | 0), expected);
  }
});

test('scoreSamples gives the pHash decisions and scores of the code it replaced', () => {
  const random = seededRandom(11);
  const randomHex = () => Array.from({ length: 16 }, () => Math.floor(random() * 16).toString(16)).join('');
  const withFlippedBits = (hex, count) => {
    let value = BigInt(`0x${hex}`);
    for (let i = 0; i < count; i++) value ^= 1n << BigInt(Math.floor(random() * 64));
    return value.toString(16).padStart(16, '0');
  };
  const rowsFor = (videoId, hashes) => hashes.map((sample, index) => ({
    video_id: videoId,
    sample_index: index,
    phash_hex: sample.hash,
    flipped_phash_hex: sample.flippedHash,
    frame_dark_ratio: sample.darkRatio,
  }));
  let matches = 0;
  for (const settings of settingCombinations()) {
    for (let pair = 0; pair < 60; pair++) {
      const samplesA = Array.from({ length: settings.sampleCount }, () => ({
        hash: randomHex(),
        flippedHash: randomHex(),
        darkRatio: random() < 0.2 ? 0.9 : 0.1,
      }));
      const samplesB = samplesA.map((sample) => ({
        // Close to the normal or to the mirrored hash, by a few bits either way of the threshold.
        hash: withFlippedBits(random() < 0.3 ? sample.flippedHash : sample.hash, Math.floor(random() * 7)),
        flippedHash: randomHex(),
        darkRatio: random() < 0.2 ? 0.9 : 0.1,
      }));
      const grouped = pHashSamplesByVideo([...rowsFor('a', samplesA), ...rowsFor('b', samplesB)], settings.sampleCount);
      const result = scoreSamples(grouped.get('a'), grouped.get('b'), settings, pHashSampleScore, {
        firstSampleOnly: settings.phashFirstSampleOnly,
      });
      const unenforced = result ? result.similarity : null;
      const enforced = result && result.similarity >= settings.finalSimilarityThreshold ? result.similarity : null;
      assert.equal(unenforced, previousPHashScore(samplesA, samplesB, settings, false));
      assert.equal(enforced, previousPHashScore(samplesA, samplesB, settings, true));
      // Stopping early, as the comparison worker does, may only skip pairs that would not have matched.
      const early = scoreSamples(grouped.get('a'), grouped.get('b'), settings, pHashSampleScore, {
        firstSampleOnly: settings.phashFirstSampleOnly,
        stopBelowThreshold: true,
      });
      assert.equal(early && early.similarity >= settings.finalSimilarityThreshold ? early.similarity : null, enforced);
      if (enforced !== null) matches++;
    }
  }
  assert.ok(matches > 500, `the inputs must include matches, got ${matches}`);
});

test('scoreSamples gives the Visual decisions and scores of the code it replaced', () => {
  const random = seededRandom(13);
  const rowsFor = (videoId, samples) => samples.map((sample, index) => ({
    video_id: videoId,
    sample_index: index,
    gray_bytes: sample.bytes,
    frame_dark_ratio: sample.darkRatio,
  }));
  let matches = 0;
  for (const settings of settingCombinations()) {
    const visualSettings = { ...settings, phashFirstSampleOnly: false };
    // The test frames are 4x4, so they are mirrored here; the app mirrors 32x32 frames.
    const sampleScore = (sampleA, sampleB, flipped) => graySampleScore(visualSettings)(
      flipped ? { bytes: flipGrayBytes(sampleA.bytes, 4, 4) } : sampleA,
      sampleB,
      false,
    );
    for (let pair = 0; pair < 60; pair++) {
      const samplesA = Array.from({ length: settings.sampleCount }, () => ({
        bytes: Buffer.from(Array.from({ length: 16 }, () => Math.floor(random() * 256))),
        darkRatio: random() < 0.2 ? 0.9 : 0.1,
      }));
      const noise = random() * 40;
      const samplesB = samplesA.map((sample) => ({
        bytes: Buffer.from(Array.from(
          random() < 0.3 ? flipGrayBytes(sample.bytes, 4, 4) : sample.bytes,
          (value) => Math.max(0, Math.min(255, Math.round(value + (random() - 0.5) * noise))),
        )),
        darkRatio: random() < 0.2 ? 0.9 : 0.1,
      }));
      const grouped = graySamplesByVideo([...rowsFor('a', samplesA), ...rowsFor('b', samplesB)], settings.sampleCount);
      const full = scoreSamples(grouped.get('a'), grouped.get('b'), visualSettings, sampleScore);
      const early = scoreSamples(grouped.get('a'), grouped.get('b'), visualSettings, sampleScore, { stopBelowThreshold: true });
      const enforced = (result) => (result && result.similarity >= visualSettings.finalSimilarityThreshold ? result.similarity : null);
      assert.equal(full ? full.similarity : null, previousVisualScore(samplesA, samplesB, visualSettings, false));
      assert.equal(enforced(full), previousVisualScore(samplesA, samplesB, visualSettings, true));
      // Stopping early may only skip pairs that would not have matched.
      assert.equal(enforced(early), enforced(full));
      if (enforced(full) !== null) matches++;
    }
  }
  assert.ok(matches > 100, `the inputs must include matches, got ${matches}`);
});

test('scoreSamples reports the per-sample scores and how many were compared', () => {
  const settings = normalizeDuplicateSettings({ sampleCount: 3, finalSimilarityThreshold: 90 });
  const sample = (hash, darkRatio = 0) => ({ full: { hash: parsePHashWords(hash), flippedHash: parsePHashWords(hash) }, crop: null, darkRatio });
  const result = scoreSamples(
    [sample('ffffffffffffffff'), sample('ffffffffffffffff', 0.9), sample('00000000000000ff')],
    [sample('ffffffffffffffff'), sample('ffffffffffffffff'), sample('00000000000000fe')],
    settings,
    pHashSampleScore,
  );
  assert.deepEqual(result, { similarity: (100 + (63 / 64) * 100) / 2, scores: [100, (63 / 64) * 100], compared: 2 });
  assert.equal(scoreSamples([sample('ff')], [sample('ff')], settings, pHashSampleScore), null, 'a missing sample is not comparable');
});

test('a video with an unreadable sample is left out of the comparison', () => {
  const rows = [
    { video_id: 'a', sample_index: 0, phash_hex: 'ff', gray_bytes: Buffer.from([1]), frame_dark_ratio: 0 },
    { video_id: 'b', sample_index: 0, phash_hex: 'ff', gray_bytes: Buffer.from([1]), frame_dark_ratio: 0 },
    { video_id: 'b', sample_index: 1, phash_hex: '', gray_bytes: Buffer.alloc(0), sample_state: 'unreadable' },
    { video_id: 'a', sample_index: 1, phash_hex: 'fe', gray_bytes: Buffer.from([2]), frame_dark_ratio: 0 },
  ];
  assert.deepEqual([...pHashSamplesByVideo(rows, 2).keys()], ['a']);
  assert.deepEqual([...graySamplesByVideo(rows, 2).keys()], ['a']);
});

function barRows(videoId, samples) {
  return samples.map(([full, crop], index) => ({
    video_id: videoId,
    sample_index: index,
    phash_hex: full,
    flipped_phash_hex: full,
    crop_phash_hex: crop ?? null,
    crop_flipped_phash_hex: crop ?? null,
    frame_dark_ratio: 0,
  }));
}

function barScore(samplesA, samplesB, settingsInput = {}) {
  const settings = normalizeDuplicateSettings({ sampleCount: samplesA.length, ...settingsInput });
  const grouped = pHashSamplesByVideo([...barRows('a', samplesA), ...barRows('b', samplesB)], settings.sampleCount);
  return scoreSamples(grouped.get('a'), grouped.get('b'), settings, pHashSampleScore)?.similarity ?? null;
}

test('a video is also compared without its black bars, on either side or both', () => {
  const PICTURE = ['00000000000000ff', '000000000000ff00'];
  const BARRED = ['ffffffff00000000', 'ffff0000ffff0000'];
  const OTHER_BARS = ['0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0'];
  const plain = PICTURE.map((hash) => [hash]);
  const letterboxed = PICTURE.map((hash, index) => [BARRED[index], hash]);
  const pillarboxed = PICTURE.map((hash, index) => [OTHER_BARS[index], hash]);

  assert.equal(barScore(letterboxed, plain), 100, 'cropped against full');
  assert.equal(barScore(plain, letterboxed), 100, 'full against cropped');
  assert.equal(barScore(letterboxed, pillarboxed), 100, 'cropped against cropped');
  assert.equal(barScore(plain, plain), 100);
  assert.equal(barScore(letterboxed, plain, { matchBlackBars: false }), barScore(BARRED.map((hash) => [hash]), plain));
  assert.ok(barScore(letterboxed, plain, { matchBlackBars: false }) < 80);
});

test('one choice of variants holds for every sample of a pair', () => {
  // The first sample matches without the bars and the second with them: no single choice matches both.
  const a = [['ffffffff00000000', '00000000000000ff'], ['000000000000ff00', 'ffff0000ffff0000']];
  const b = [['00000000000000ff'], ['000000000000ff00']];
  assert.equal(barScore(a, b), 68.75);
});

test('comparing without black bars never lowers a score', () => {
  const random = seededRandom(17);
  const randomHex = () => Array.from({ length: 16 }, () => Math.floor(random() * 16).toString(16)).join('');
  for (let pair = 0; pair < 200; pair++) {
    const a = [[randomHex(), random() < 0.7 ? randomHex() : undefined], [randomHex(), undefined]];
    a[1][1] = a[0][1] ? randomHex() : undefined;
    const b = a.map(([full, crop]) => [random() < 0.5 ? full : randomHex(), crop && random() < 0.5 ? crop : undefined]);
    b[1][1] = b[0][1] ? (b[1][1] ?? randomHex()) : undefined;
    for (const flags of [{}, { requireEverySample: true }, { compareFlipped: true }, { phashFirstSampleOnly: true }]) {
      const without = barScore(a, b, { ...flags, matchBlackBars: false, finalSimilarityThreshold: 0 });
      const withBars = barScore(a, b, { ...flags, finalSimilarityThreshold: 0 });
      assert.ok(withBars >= without, `${withBars} >= ${without}`);
    }
  }
});

test('Visual comparison uses the frame inside the black bars the same way', () => {
  const settings = normalizeDuplicateSettings({ sampleCount: 1, comparisonMode: 'visual' });
  const picture = Buffer.from([10, 200, 30, 180]);
  const rows = [
    { video_id: 'a', sample_index: 0, gray_bytes: Buffer.from([0, 0, 90, 90]), crop_gray_bytes: picture, frame_dark_ratio: 0 },
    { video_id: 'b', sample_index: 0, gray_bytes: picture, frame_dark_ratio: 0 },
  ];
  const grouped = graySamplesByVideo(rows, 1);
  const score = (input) => scoreSamples(grouped.get('a'), grouped.get('b'), { ...settings, ...input }, graySampleScore(settings)).similarity;
  assert.equal(score({}), 100);
  assert.ok(score({ matchBlackBars: false }) < 80);
});

test('a sample is usable when it is neither dark nor, with skipBlankFrames, blank', () => {
  const on = normalizeDuplicateSettings({});
  const off = normalizeDuplicateSettings({ skipBlankFrames: false });
  const blank = { darkRatio: 0, lumaRange: 1 };
  const dim = { darkRatio: 0.1, lumaRange: 30 };
  const lowContrast = { darkRatio: 0, lumaRange: 13 };
  const normal = { darkRatio: 0.2, lumaRange: 180 };
  const dark = { darkRatio: 0.9, lumaRange: 200 };
  const unmeasured = { darkRatio: 0, lumaRange: null };
  assert.deepEqual([blank, dim, lowContrast, normal, dark, unmeasured].map((sample) => isUsableSample(sample, on)), [false, true, true, true, false, true]);
  assert.deepEqual([blank, dark].map((sample) => isUsableSample(sample, off)), [true, false]);
  assert.equal(isUsableSample({ darkRatio: 0, lumaRange: 12 }, on), false, 'the limit itself counts as blank');
});

function blankRows(videoId, samples) {
  return samples.map(([hash, lumaRange], index) => ({
    video_id: videoId,
    sample_index: index,
    phash_hex: hash,
    flipped_phash_hex: hash,
    frame_dark_ratio: 0,
    luma_range: lumaRange,
  }));
}

test('blank frames are left out, and a pair with too few frames left does not match', () => {
  const grey = '8000000000000000';
  const score = (samplesA, samplesB, input = {}) => {
    const settings = normalizeDuplicateSettings({ sampleCount: samplesA.length, finalSimilarityThreshold: 90, ...input });
    const grouped = pHashSamplesByVideo([...blankRows('a', samplesA), ...blankRows('b', samplesB)], settings.sampleCount);
    return scoreSamples(grouped.get('a'), grouped.get('b'), settings, pHashSampleScore);
  };
  // Two flat grey videos: identical hashes, but nothing to compare once blank frames are skipped.
  const flatA = [[grey, 1], [grey, 1], [grey, 2]];
  const flatB = [[grey, 1], [grey, 0], [grey, 1]];
  assert.equal(score(flatA, flatB), null);
  assert.equal(score(flatA, flatB, { skipBlankFrames: false }).similarity, 100);
  // One blank sample of three: the other two still decide.
  const a = [['00000000000000ff', 150], [grey, 1], ['000000000000ff00', 140]];
  const b = [['00000000000000ff', 150], ['ffffffffffffffff', 160], ['000000000000ff00', 140]];
  assert.deepEqual(score(a, b), { similarity: 100, scores: [100, 100], compared: 2 });
  // Two of three blank leaves one compared sample, fewer than the two required.
  const mostlyBlank = [['00000000000000ff', 150], [grey, 1], [grey, 3]];
  assert.equal(score(mostlyBlank, b), null);
});

test('a video is static when its own usable samples barely differ', () => {
  const settings = normalizeDuplicateSettings({});
  const sample = (hash, lumaRange = 100, darkRatio = 0) => ({ motionHash: parsePHashWords(hash), lumaRange, darkRatio });
  assert.equal(movementClass([sample('ff00ff00ff00ff00'), sample('ff00ff00ff00ff1f')], settings), 'static', '5 bits apart');
  assert.equal(movementClass([sample('ff00ff00ff00ff00'), sample('ff00ff00ff00ff3f')], settings), 'moving', '6 bits apart');
  assert.equal(movementClass([sample('ff00ff00ff00ff00')], settings), 'unknown', 'one sample cannot show movement');
  // Dark and blank samples do not count, so only one usable sample is left.
  assert.equal(movementClass([sample('ff00ff00ff00ff00'), sample('0000000000000000', 200, 0.9), sample('8000000000000000', 1)], settings), 'unknown');
  assert.equal(movementClass([sample('ff00ff00ff00ff00'), sample('ff00ff00ff00ff00'), sample('00ff00ff00ff00ff')], settings), 'moving');
});
