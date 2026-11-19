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
  matchConfidence,
  minimumComparedSamples,
  grayCorrelation,
  average,
  combineSampleScores,
  normalizeDuplicateSettings,
  getDuplicateFingerprintKey,
  durationsWithinTolerance,
  chooseSuggestedKeeper,
  rankKeeperCandidates,
  DEFAULT_DUPLICATE_SETTINGS,
  getDuplicateResultsSettingsKey,
  MATCHING_SETTING_KEYS,
  NON_MATCHING_SETTING_KEYS,
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

test('gray correlation scores where light and dark lie, not how bright the frames are', () => {
  const frame = (fn) => Buffer.from(Array.from({ length: 1024 }, (_, i) => fn(i % 32, Math.floor(i / 32))));
  const scene = frame((x, y) => (x * 7 + y * 3) % 200);
  assert.equal(grayCorrelation(scene, scene), 100);
  assert.equal(grayCorrelation(Buffer.from([0, 255]), Buffer.from([255, 0])), 0, 'inverted pictures count as 0');
  // A dimmed, lower-contrast copy is still the same picture.
  assert.ok(grayCorrelation(scene, frame((x, y) => Math.round(((x * 7 + y * 3) % 200) / 4) + 5)) > 99);
  // Two different dim scenes differ by a few levels everywhere: a match by brightness, not by correlation.
  const dimA = frame((x) => 10 + (x < 16 ? 8 : 0));
  const dimB = frame((x, y) => 10 + (y < 16 ? 8 : 0));
  assert.ok(grayCorrelation(dimA, dimB) < 10);
  assert.equal(grayCorrelation(frame(() => 128), scene), null, 'a flat frame is no evidence');
});

test('the outline check fails a sample whose pHash stays below its limit', () => {
  const frame = (fn) => Buffer.from(Array.from({ length: 1024 }, (_, i) => fn(i % 32, Math.floor(i / 32))));
  const a = { bytes: frame((x, y) => ((x < 16) !== (y < 16) ? 200 : 20)) };
  // Correlates partly with A (one corner changed) but has other outlines.
  const b = { bytes: frame((x, y) => ((x < 16) !== (y < 16) || (x >= 16 && y >= 24) ? 200 : 20)) };
  const on = graySampleScore(normalizeDuplicateSettings({ comparisonMode: 'visual' }));
  const off = graySampleScore(normalizeDuplicateSettings({ comparisonMode: 'visual', visualOutlineCheck: 'off' }));
  const strict = graySampleScore(normalizeDuplicateSettings({ comparisonMode: 'visual', visualOutlineCheck: 90 }));
  assert.ok(off(a, b, false) > 0);
  const outline = pHashSimilarity(calculateDctPHash(a.bytes), calculateDctPHash(b.bytes));
  assert.ok(outline < 90, 'the test frames must fail the strict limit');
  assert.equal(on(a, b, false), outline >= 75 ? off(a, b, false) : 0);
  assert.equal(strict(a, b, false), 0);
  assert.equal(on(a, a, false), 100, 'a copy passes');
  assert.equal(normalizeDuplicateSettings({}).visualOutlineCheck, 75);
  assert.equal(normalizeDuplicateSettings({ visualOutlineCheck: 'off' }).visualOutlineCheck, 'off');
  assert.equal(normalizeDuplicateSettings({ visualOutlineCheck: 72 }).visualOutlineCheck, 75);
});

test('default settings follow the simplified VDF-style model', () => {
  const settings = normalizeDuplicateSettings({});
  assert.equal(settings.finalSimilarityThreshold, 95);
  assert.equal(settings.sampleCount, 3);
  assert.equal(settings.comparisonMode, 'phash');
  assert.equal(settings.durationTolerancePercent, 20);
  assert.equal(settings.checkpointIntervalMinutes, 5);
  assert.equal(settings.requireEverySample, false);
  assert.deepEqual(settings.keeperOrder, ['health', 'resolution', 'videoBitrate', 'duration', 'fps', 'size', 'codec', 'audio']);
});

test('similarity threshold accepts any value from 0 to 100 percent', () => {
  const shared = (value) => normalizeDuplicateSettings({ separateSimilarityThresholds: false, finalSimilarityThreshold: value }).finalSimilarityThreshold;
  assert.equal(shared(10), 10);
  assert.equal(shared(-5), 0);
  assert.equal(shared(120), 100);
});

test('by default each method has its own value: pHash 95, Visual similarity 90', () => {
  assert.equal(normalizeDuplicateSettings({}).finalSimilarityThreshold, 95);
  assert.equal(normalizeDuplicateSettings({ comparisonMode: 'visual' }).finalSimilarityThreshold, 90);
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
  const settings = normalizeDuplicateSettings({ comparisonMode: 'phash', separateSimilarityThresholds: false, finalSimilarityThreshold: 92 });
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

test('a copy with black bars counts with the picture inside them', () => {
  const { pictureSizeInsideBars, rankKeeperCandidates } = require('../../electron/duplicate-utils');
  // A 640-high frame with 80 of its 640 lines black at top and bottom (8 of 64 analysis lines each).
  assert.deepEqual(pictureSizeInsideBars(1138, 640, '0,8,0,8'), { width: 1138, height: 480 });
  assert.equal(pictureSizeInsideBars(1138, 640, null), null);
  assert.equal(pictureSizeInsideBars(1138, 640, '0,40,0,40'), null);
  assert.equal(pictureSizeInsideBars(null, 640, '0,8,0,8'), null);

  const original = { id: 'original', path: 'P:\a.mp4', width: 854, height: 480, videoBitrate: 900_000 };
  const letterbox = { id: 'letterbox', path: 'P:\b.mp4', width: 1138, height: 640, videoBitrate: 700_000 };
  const order = normalizeDuplicateSettings({}).keeperOrder;
  // On the frame size alone the letterboxed copy wins.
  assert.equal(rankKeeperCandidates([original, letterbox], order).keeper.id, 'letterbox');
  const ranking = rankKeeperCandidates([original, letterbox], order, undefined, {}, { letterbox: { width: 1138, height: 480 } });
  assert.equal(ranking.keeper.id, 'original');
  assert.equal(ranking.rule, 'videoBitrate');
  // A larger picture still wins; it only loses by its picture, never by its bars.
  const sharper = { ...letterbox, width: 2276, height: 1280 };
  const bigger = rankKeeperCandidates([original, sharper], order, undefined, {}, { letterbox: { width: 2276, height: 960 } });
  assert.equal(bigger.keeper.id, 'letterbox');
  const smaller = rankKeeperCandidates([{ ...original, width: 1920, height: 1080 }, letterbox], order, undefined, {}, { letterbox: { width: 1138, height: 480 } });
  assert.equal(smaller.reasons.letterbox, 'smaller picture inside black bars');
  // Bars are measured to about 2 lines, so 375 against 380 lines is no difference: bitrate decides.
  const measured = rankKeeperCandidates([original, letterbox], order, undefined, {}, {
    original: { width: 854, height: 375 },
    letterbox: { width: 1138, height: 380 },
  });
  assert.equal(measured.keeper.id, 'original');
  assert.equal(measured.rule, 'videoBitrate');
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
  assert.deepEqual(settings.keeperOrder, ['health', 'size', 'fps', 'resolution', 'videoBitrate', 'duration', 'codec', 'audio']);
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
    const normalScore = grayCorrelation(sampleA.bytes, sampleB.bytes, settings);
    const flippedScore = settings.compareFlipped
      ? grayCorrelation(flipGrayBytes(sampleA.bytes, 4, 4), sampleB.bytes, settings)
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
  assert.deepEqual(result, { similarity: (100 + (63 / 64) * 100) / 2, scores: [100, (63 / 64) * 100], compared: 2, flipped: false, borderAdjusted: false });
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
  assert.deepEqual(score(a, b), { similarity: 100, scores: [100, 100], compared: 2, flipped: false, borderAdjusted: false });
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

test('the minimum of compared samples follows the setting, and auto keeps the earlier rule', () => {
  const minimum = (input, firstSampleOnly = false) => minimumComparedSamples(normalizeDuplicateSettings(input), firstSampleOnly);
  for (const sampleCount of [1, 2, 3, 4, 5, 7, 9]) {
    assert.equal(minimum({ sampleCount }), sampleCount > 1 ? 2 : 1, `auto at ${sampleCount}`);
    assert.equal(minimum({ sampleCount }, true), 1, `first sample at ${sampleCount}`);
  }
  assert.equal(minimum({ sampleCount: 9, minComparedSamples: 1 }), 1);
  assert.equal(minimum({ sampleCount: 5, minComparedSamples: 3 }), 3);
  assert.equal(minimum({ sampleCount: 2, minComparedSamples: 3 }), 2, 'capped at the sample count');
  assert.equal(minimum({ sampleCount: 5, minComparedSamples: 3 }, true), 1, 'first-sample scoring decides on one');
  assert.equal(normalizeDuplicateSettings({ minComparedSamples: '2' }).minComparedSamples, 2);
  assert.equal(normalizeDuplicateSettings({ minComparedSamples: 7 }).minComparedSamples, 'auto');
});

test('confidence is low for a single-sample match or a static pair', () => {
  assert.equal(matchConfidence(2, false), 'normal');
  assert.equal(matchConfidence(1, false), 'low');
  assert.equal(matchConfidence(3, true), 'low');
});

function unreadableRows(videoId, samples) {
  return samples.map((hash, index) => ({
    video_id: videoId,
    sample_index: index,
    phash_hex: hash ?? '',
    flipped_phash_hex: hash,
    frame_dark_ratio: hash ? 0 : null,
    luma_range: hash ? 100 : null,
    sample_state: hash ? null : 'unreadable',
  }));
}

function unreadableScore(samplesA, samplesB, input = {}) {
  const settings = normalizeDuplicateSettings({ sampleCount: samplesA.length, finalSimilarityThreshold: 90, ...input });
  const grouped = pHashSamplesByVideo(
    [...unreadableRows('a', samplesA), ...unreadableRows('b', samplesB)],
    settings.sampleCount,
    settings.matchPartlyUnreadable,
  );
  if (!grouped.has('a') || !grouped.has('b')) return 'left out';
  const result = scoreSamples(grouped.get('a'), grouped.get('b'), settings, pHashSampleScore, {
    firstSampleOnly: settings.phashFirstSampleOnly,
  });
  return result ? result.compared : null;
}

test('a partly unreadable video is compared on the samples that could be read', () => {
  const h = ['00000000000000ff', '000000000000ff00', '0000000000ff0000', '00000000ff000000', '000000ff00000000'];
  const r = (count, readable) => h.slice(0, count).map((hash, index) => (index < readable ? hash : null));
  // Configured 1, decoded 1: compared on 1, as before.
  assert.equal(unreadableScore(r(1, 1), r(1, 1)), 1);
  // Configured 3 or 5, decoded 2: compared on 2 by default.
  assert.equal(unreadableScore(r(3, 2), r(3, 3)), 2);
  assert.equal(unreadableScore(r(5, 2), r(5, 5)), 2);
  // Configured 3, decoded 1: only with the minimum at 1.
  assert.equal(unreadableScore(r(3, 1), r(3, 3)), null);
  assert.equal(unreadableScore(r(3, 1), r(3, 3), { minComparedSamples: 1 }), 1);
  // With the minimum at 3, two readable samples are not enough.
  assert.equal(unreadableScore(r(3, 2), r(3, 3), { minComparedSamples: 3 }), null);
  // Setting off: the video is not compared at all, as before.
  assert.equal(unreadableScore(r(3, 2), r(3, 3), { matchPartlyUnreadable: false }), 'left out');
  // Every compared sample must still reach the threshold with weakest-sample scoring.
  assert.equal(unreadableScore(r(3, 2), r(3, 3), { requireEverySample: true }), 2);
  // First-sample scoring takes the first sample readable in both.
  assert.equal(unreadableScore([null, h[1], h[2]], [h[0], h[1], h[2]], { phashFirstSampleOnly: true }), 1);
});

test('scoreSamples reports when a mirrored sample or the picture inside black bars decided the match', () => {
  const settings = normalizeDuplicateSettings({ sampleCount: 2, finalSimilarityThreshold: 90, compareFlipped: true });
  const sample = (hash, flippedHash, cropHash) => ({
    darkRatio: 0,
    lumaRange: 100,
    full: { hash: parsePHashWords(hash), flippedHash: parsePHashWords(flippedHash) },
    crop: cropHash ? { hash: parsePHashWords(cropHash), flippedHash: parsePHashWords(cropHash) } : null,
  });
  const plain = [sample('00000000000000ff', 'ff00000000000000'), sample('000000000000ff00', '00ff000000000000')];
  const mirrored = [sample('ff00000000000000', '00000000000000ff'), sample('00ff000000000000', '000000000000ff00')];
  assert.deepEqual(
    (({ flipped, borderAdjusted }) => ({ flipped, borderAdjusted }))(scoreSamples(mirrored, plain, settings, pHashSampleScore)),
    { flipped: true, borderAdjusted: false },
  );
  assert.equal(scoreSamples(plain, plain, settings, pHashSampleScore).flipped, false);
  const barred = [sample('ffffffff00000000', 'ffffffff00000000', '00000000000000ff'), sample('ffff0000ffff0000', 'ffff0000ffff0000', '000000000000ff00')];
  assert.deepEqual(
    (({ similarity, borderAdjusted }) => ({ similarity, borderAdjusted }))(scoreSamples(barred, plain, settings, pHashSampleScore)),
    { similarity: 100, borderAdjusted: true },
  );
});

// The strict comparison the cascade replaced, kept verbatim as the reference.
function previousResolutionTier(video) {
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  if (width <= 0 || height <= 0) return 0;
  const longestEdge = Math.max(width, height);
  if (longestEdge >= 7680) return 8000;
  if (longestEdge >= 5120) return 5000;
  if (longestEdge >= 3840) return 4000;
  if (longestEdge >= 2560) return 1440;
  if (longestEdge >= 1920) return 1080;
  if (longestEdge >= 1280) return 720;
  return Math.min(width, height);
}

function previousCompareKeeper(a, b, order, codecOrder) {
  const codec = (video) => {
    const index = codecOrder.indexOf(String(video.videoCodec ?? '').toLowerCase());
    return index === -1 ? 0 : codecOrder.length - index;
  };
  const value = (video, rule) => ({
    resolution: () => previousResolutionTier(video),
    videoBitrate: () => Number(video.videoBitrate ?? video.totalBitrate) || 0,
    duration: () => Number(video.durationSecs) || 0,
    fps: () => Number(video.fps) || 0,
    size: () => Number(video.sizeBytes) || 0,
    codec: () => codec(video),
    // Without unreadable samples or probed metadata these two rules tie for every member.
    health: () => 0,
    audio: () => 1,
  }[rule]());
  for (const rule of order) {
    const diff = value(a, rule) - value(b, rule);
    if (diff !== 0) return diff;
  }
  return String(b.path ?? '').localeCompare(String(a.path ?? ''));
}

test('the keeper cascade gives the strict ranking when only the duration margin is new', () => {
  const random = seededRandom(23);
  const pick = (values) => values[Math.floor(random() * values.length)];
  const orders = [
    DEFAULT_DUPLICATE_SETTINGS.keeperOrder,
    ['size', 'codec', 'resolution', 'videoBitrate', 'fps', 'duration'],
    ['codec', 'fps', 'videoBitrate'],
  ];
  for (let groupIndex = 0; groupIndex < 300; groupIndex++) {
    const videos = Array.from({ length: 2 + Math.floor(random() * 4) }, (_, index) => ({
      id: `v${index}`,
      path: `${pick(['a', 'b', 'c'])}${index}.mp4`,
      width: pick([1280, 1920, 3840]),
      height: pick([720, 1080, 2160]),
      videoBitrate: pick([1000, 2000, 3000]),
      // Equal durations, so the new margin never applies here.
      durationSecs: 120,
      fps: pick([24, 30]),
      sizeBytes: pick([10, 20]),
      videoCodec: pick(['h264', 'hevc', 'vp9', 'mpeg4']),
    }));
    for (const order of orders) {
      const settings = normalizeDuplicateSettings({ keeperOrder: order });
      const expected = [...videos].sort((a, b) => -previousCompareKeeper(a, b, settings.keeperOrder, settings.codecOrder))[0];
      assert.equal(chooseSuggestedKeeper(videos, settings).id, expected.id);
    }
  }
});

test('a copy shorter by less than the duration margin is not demoted for its length', () => {
  const settings = normalizeDuplicateSettings({ keeperOrder: ['duration', 'videoBitrate'] });
  const base = { width: 1920, height: 1080, path: 'a.mp4' };
  const long = { ...base, id: 'long', durationSecs: 600, videoBitrate: 1000, path: 'b.mp4' };
  // 1 % of 600 s is 6 s: 5.9 s shorter is inside the margin, so bitrate decides.
  const inside = { ...base, id: 'inside', durationSecs: 594.1, videoBitrate: 2000 };
  const outside = { ...base, id: 'outside', durationSecs: 593.9, videoBitrate: 2000 };
  assert.equal(chooseSuggestedKeeper([long, inside], settings).id, 'inside');
  const ranked = rankKeeperCandidates([long, outside], settings.keeperOrder, settings.codecOrder);
  assert.deepEqual(ranked, { keeper: long, rule: 'duration', tieBreak: false, reasons: { outside: 'shorter by 6.1 s' } });
  // Short videos use the 2-second floor.
  const shortLong = { ...long, durationSecs: 30 };
  const shortCopy = { ...inside, durationSecs: 28.1 };
  assert.equal(chooseSuggestedKeeper([shortLong, shortCopy], settings).id, 'inside');
});

test('each member that is not the keeper gets the phrase for the rule it lost at', () => {
  const order = ['resolution', 'videoBitrate', 'duration', 'fps', 'size', 'codec'];
  const best = { id: 'best', path: 'a.mp4', width: 1920, height: 1080, videoBitrate: 3000, durationSecs: 100, fps: 30, sizeBytes: 50, videoCodec: 'hevc' };
  const ranked = rankKeeperCandidates([
    best,
    { ...best, id: 'small', width: 1280, height: 720 },
    { ...best, id: 'bitrate', videoBitrate: 1000 },
    { ...best, id: 'short', durationSecs: 80 },
    { ...best, id: 'fps', fps: 24 },
    { ...best, id: 'size', sizeBytes: 40 },
    { ...best, id: 'codec', videoCodec: 'h264' },
    { ...best, id: 'twin', path: 'b.mp4' },
  ], order);
  assert.equal(ranked.keeper.id, 'best');
  assert.deepEqual([ranked.rule, ranked.tieBreak], ['path', true]);
  assert.deepEqual(ranked.reasons, {
    small: 'lower resolution',
    bitrate: 'lower bitrate',
    short: 'shorter by 20 s',
    fps: '24 fps instead of 30',
    size: 'smaller file',
    codec: 'less preferred codec',
    twin: 'no difference found; chosen by file name',
  });
  const byResolution = rankKeeperCandidates([best, { ...best, id: 'small', width: 1280, height: 720 }], order);
  assert.deepEqual([byResolution.rule, byResolution.tieBreak], ['resolution', false]);
});

test('missing keeper rules join with health first and the others at the end', () => {
  assert.deepEqual(normalizeDuplicateSettings({ keeperOrder: ['size', 'resolution'] }).keeperOrder,
    ['health', 'size', 'resolution', 'videoBitrate', 'duration', 'fps', 'codec', 'audio']);
  const moved = ['audio', 'resolution', 'health', 'videoBitrate', 'duration', 'fps', 'size', 'codec'];
  assert.deepEqual(normalizeDuplicateSettings({ keeperOrder: moved }).keeperOrder, moved, 'a chosen order is kept');
});

test('the health rule demotes only positions another member could read', () => {
  const order = ['health', 'resolution'];
  const member = (id, width) => ({ id, path: `${id}.mp4`, width, height: width * 9 / 16 });
  const full = member('full', 1280);
  const damaged = member('damaged', 1920);
  const unknown = member('unknown', 1920);
  // 'damaged' could not read position 2, which 'full' read: confirmed, so it loses despite its resolution.
  const confirmed = rankKeeperCandidates([full, damaged], order, undefined, { full: [], damaged: [{ index: 2, percent: 75 }] });
  assert.equal(confirmed.keeper.id, 'full');
  assert.deepEqual([confirmed.rule, confirmed.reasons], ['health', { damaged: 'could not be read at 75 %' }]);
  // Every member failed there: no finding, resolution decides.
  assert.equal(rankKeeperCandidates([full, damaged], order, undefined, {
    full: [{ index: 2, percent: 75 }], damaged: [{ index: 2, percent: 75 }],
  }).keeper.id, 'damaged');
  // A member without fingerprint data neither confirms nor counts against itself.
  assert.equal(rankKeeperCandidates([unknown, damaged], order, undefined, { damaged: [{ index: 2, percent: 75 }] }).rule, 'path');
  const two = rankKeeperCandidates([full, damaged], order, undefined, { full: [], damaged: [{ index: 1, percent: 50 }, { index: 2, percent: null }] });
  assert.equal(two.reasons.damaged, 'could not be read at 50 % and sample 3');
});

test('the audio rule demotes a copy without sound only when its details were read', () => {
  const order = ['audio', 'resolution'];
  const withSound = { id: 'sound', path: 'a.mp4', width: 1280, height: 720, audioCodec: 'aac', metadataVersion: 2 };
  const silent = { id: 'silent', path: 'b.mp4', width: 1920, height: 1080, audioCodec: null, metadataVersion: 2 };
  const ranked = rankKeeperCandidates([withSound, silent], order);
  assert.deepEqual([ranked.keeper.id, ranked.rule, ranked.reasons], ['sound', 'audio', { silent: 'has no audio track' }]);
  assert.equal(rankKeeperCandidates([withSound, { ...silent, metadataVersion: null }], order).keeper.id, 'silent', 'unprobed ties');
  assert.equal(rankKeeperCandidates([withSound, { ...silent, metadataFailedAt: 1 }], order).keeper.id, 'silent', 'failed probe ties');
});

test('every duplicate setting is listed as matching or not matching, once', () => {
  const listed = [...MATCHING_SETTING_KEYS, ...NON_MATCHING_SETTING_KEYS];
  assert.deepEqual([...listed].sort(), Object.keys(DEFAULT_DUPLICATE_SETTINGS).sort());
  assert.equal(new Set(listed).size, listed.length);
});

test('the stored-results key changes with matching settings only', () => {
  const base = getDuplicateResultsSettingsKey({});
  assert.equal(getDuplicateResultsSettingsKey({ keeperOrder: ['size'], ignoredDuplicatePairs: ['0123456789abcdef|fedcba9876543210'] }), base);
  assert.notEqual(getDuplicateResultsSettingsKey({ phashSimilarityThreshold: 90 }), base);
  assert.notEqual(getDuplicateResultsSettingsKey({ sampleCount: 5 }), base);
  assert.notEqual(getDuplicateResultsSettingsKey({ skipBlankFrames: false }), base);
  // Separate thresholds count by the value they resolve to.
  assert.equal(getDuplicateResultsSettingsKey({ separateSimilarityThresholds: true, phashSimilarityThreshold: 95 }), base);
});

describe('gray frames in shared memory', () => {
  const { flipGrayBytes, graySampleScore, normalizeDuplicateSettings, packGrayRows, grayCorrelation } = require('../../electron/duplicate-utils');

  function randomFrame(seed) {
    let state = seed >>> 0;
    return Buffer.from(Array.from({ length: 1024 }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      // Many pure blacks and whites, so the ignore options matter.
      const value = state >>> 24;
      return value < 20 ? 0 : value > 235 ? 255 : value;
    }));
  }

  test('the mirrored comparison reads the frame backwards with the same result as a mirrored copy', () => {
    for (const ignoreBlackPixels of [false, true]) {
      for (const ignoreWhitePixels of [false, true]) {
        const options = { ignoreBlackPixels, ignoreWhitePixels };
        for (let seed = 1; seed <= 20; seed++) {
          const a = randomFrame(seed);
          const b = seed % 2 ? flipGrayBytes(a) : randomFrame(seed + 100);
          expect(grayCorrelation(a, b, options, true)).toBe(grayCorrelation(flipGrayBytes(a), b, options));
        }
      }
    }
    const score = graySampleScore(normalizeDuplicateSettings({ comparisonMode: 'visual' }));
    const variant = { bytes: randomFrame(5) };
    expect(score(variant, { bytes: flipGrayBytes(variant.bytes) }, true)).toBe(100);
    // No mirrored copy is kept on the sample.
    expect(Object.keys(variant)).toEqual(['bytes']);
  });

  test('packing moves every frame into one shared block, keeps the bytes and leaves packed frames alone', () => {
    const rows = [1, 2, 3].map((seed) => ({
      video_id: `v${seed}`, gray_bytes: randomFrame(seed), crop_gray_bytes: seed === 2 ? randomFrame(50) : null,
    }));
    const copies = rows.map((row) => [Buffer.from(row.gray_bytes), row.crop_gray_bytes && Buffer.from(row.crop_gray_bytes)]);
    expect(packGrayRows(rows)).toBe(4 * 1024);
    const shared = rows[0].gray_bytes.buffer;
    expect(shared).toBeInstanceOf(SharedArrayBuffer);
    rows.forEach((row, i) => {
      expect(row.gray_bytes.buffer).toBe(shared);
      expect(Buffer.compare(row.gray_bytes, copies[i][0])).toBe(0);
    });
    expect(Buffer.compare(rows[1].crop_gray_bytes, copies[1][1])).toBe(0);
    expect(rows[0].crop_gray_bytes).toBeNull();
    // A second run packs only frames that are not shared yet.
    rows.push({ video_id: 'v4', gray_bytes: randomFrame(4) });
    expect(packGrayRows(rows)).toBe(1024);
    expect(rows[0].gray_bytes.buffer).toBe(shared);
  });
});

test('black bars are matched when the first sample could not be read', () => {
  const settings = normalizeDuplicateSettings({ sampleCount: 3 });
  const variant = (hex) => ({ hash: parsePHashWords(hex), flippedHash: parsePHashWords(hex) });
  const PICTURE = ['00000000000000ff', '000000000000ff00', '0000000000ff0000'];
  const BARRED = ['ffffffff00000000', 'ffff0000ffff0000', 'ff00ff00ff00ff00'];
  const plain = PICTURE.map((hex, index) => ({ index, darkRatio: 0, lumaRange: 100, full: variant(hex), crop: null }));
  const letterboxed = PICTURE.map((hex, index) => (index === 0
    ? { index, unreadable: true, full: null, crop: null }
    : { index, darkRatio: 0, lumaRange: 100, full: variant(BARRED[index]), crop: variant(hex) }));
  assert.equal(scoreSamples(letterboxed, plain, settings, pHashSampleScore)?.similarity, 100);
  assert.equal(scoreSamples(plain, letterboxed, settings, pHashSampleScore)?.similarity, 100);
});
