// SYNC NOTE: These defaults are duplicated in src/keybind-defaults.ts (DEFAULT_DUPLICATE_SETTINGS).
// The renderer copy is needed for instant settings UI feedback. Keep both in sync when changing defaults.
// The rankKeeperCandidates / chooseSuggestedKeeper functions below are also mirrored in src/store.ts.
const crypto = require('node:crypto');

const DEFAULT_DUPLICATE_SETTINGS = {
  enabled: true,
  runAfterScan: false,
  comparisonMode: 'phash',
  sampleCount: 3,
  defaultScope: 'all',
  protectKeep: true,
  protectSkipped: false,
  keeperOrder: ['health', 'resolution', 'videoBitrate', 'duration', 'fps', 'size', 'codec', 'audio'],
  codecOrder: ['av1', 'hevc', 'vp9', 'h264', 'vp8', 'mpeg4', 'mpeg2video', 'vc1'],
  samplingWindow: 'even',
  customStartPercent: 0,
  customEndPercent: 100,
  finalSimilarityThreshold: 95,
  separateSimilarityThresholds: false,
  phashSimilarityThreshold: 95,
  visualSimilarityThreshold: 95,
  phashFirstSampleOnly: false,
  durationTolerancePercent: 20,
  requireEverySample: false,
  ignoreBlackPixels: false,
  ignoreWhitePixels: false,
  compareFlipped: false,
  matchBlackBars: true,
  skipBlankFrames: true,
  matchPartlyUnreadable: true,
  minComparedSamples: 'auto',
  verifyNearMatches: 'auto',
  // Points below the similarity value within which a pair is double-checked. 20 catches the measured
  // half-second shifts (77–79 % at 95) and admitted 40 pairs among 14,500 videos on a real library.
  nearMissRange: 20,
  maxSamplingDuration: 0,
  retryFailedFingerprintExtraction: false,
  checkpointIntervalMinutes: 5,
  ignoredDuplicatePairs: [],
  phashDefaultApplied: true,
  averageSamplesDefaultApplied: true,
};

const SAMPLE_COUNT_OPTIONS = new Set([1, 2, 3, 4, 5, 7, 9]);
const COMPARISON_MODES = new Set(['phash', 'visual']);
const NEAR_MISS_RANGES = new Set([5, 10, 15, 20, 25, 30]);
const KEEPER_RULES = new Set(DEFAULT_DUPLICATE_SETTINGS.keeperOrder);
const CODEC_FAMILIES = new Set(DEFAULT_DUPLICATE_SETTINGS.codecOrder);

function normalizeDuplicateSettings(input = {}) {
  const sampleCount = SAMPLE_COUNT_OPTIONS.has(Number(input.sampleCount))
    ? Number(input.sampleCount)
    : DEFAULT_DUPLICATE_SETTINGS.sampleCount;
  const comparisonMode = COMPARISON_MODES.has(input.comparisonMode)
    ? input.comparisonMode
    : DEFAULT_DUPLICATE_SETTINGS.comparisonMode;
  const similarityThreshold = input.similarityThreshold ?? input.finalSimilarityThreshold ?? DEFAULT_DUPLICATE_SETTINGS.finalSimilarityThreshold;
  const phashSimilarityThreshold = clamp(input.phashSimilarityThreshold ?? DEFAULT_DUPLICATE_SETTINGS.phashSimilarityThreshold, 0, 100);
  const visualSimilarityThreshold = clamp(input.visualSimilarityThreshold ?? DEFAULT_DUPLICATE_SETTINGS.visualSimilarityThreshold, 0, 100);
  const separateSimilarityThresholds = input.separateSimilarityThresholds === true;
  const modeSimilarityThreshold = comparisonMode === 'visual' ? visualSimilarityThreshold : phashSimilarityThreshold;
  return {
    ...DEFAULT_DUPLICATE_SETTINGS,
    ...input,
    comparisonMode,
    sampleCount,
    // Everything downstream tests finalSimilarityThreshold, so the per-method value is resolved here.
    finalSimilarityThreshold: separateSimilarityThresholds ? modeSimilarityThreshold : clamp(similarityThreshold, 0, 100),
    separateSimilarityThresholds,
    phashSimilarityThreshold,
    visualSimilarityThreshold,
    phashFirstSampleOnly: input.phashFirstSampleOnly === true,
    matchBlackBars: input.matchBlackBars !== false,
    skipBlankFrames: input.skipBlankFrames !== false,
    matchPartlyUnreadable: input.matchPartlyUnreadable !== false,
    minComparedSamples: [1, 2, 3].includes(Number(input.minComparedSamples)) ? Number(input.minComparedSamples) : 'auto',
    verifyNearMatches: input.verifyNearMatches === 'off' ? 'off' : 'auto',
    nearMissRange: NEAR_MISS_RANGES.has(Number(input.nearMissRange)) ? Number(input.nearMissRange) : DEFAULT_DUPLICATE_SETTINGS.nearMissRange,
    durationTolerancePercent: clamp(input.durationTolerancePercent ?? DEFAULT_DUPLICATE_SETTINGS.durationTolerancePercent, 0, 100),
    checkpointIntervalMinutes: clamp(input.checkpointIntervalMinutes ?? DEFAULT_DUPLICATE_SETTINGS.checkpointIntervalMinutes, 0, 60),
    ignoredDuplicatePairs: normalizeIgnoredDuplicatePairs(input.ignoredDuplicatePairs),
    keeperOrder: normalizeKeeperOrder(input.keeperOrder),
    codecOrder: normalizeCodecOrder(input.codecOrder),
  };
}

function normalizeKeeperOrder(value) {
  if (!Array.isArray(value)) return DEFAULT_DUPLICATE_SETTINGS.keeperOrder;
  const normalized = value.filter((rule) => KEEPER_RULES.has(rule));
  for (const rule of DEFAULT_DUPLICATE_SETTINGS.keeperOrder) {
    if (normalized.includes(rule)) continue;
    // Missing rules join where the default has them: health first, the others (audio last) at the end.
    if (rule === 'health') normalized.unshift(rule);
    else normalized.push(rule);
  }
  return normalized.length > 0 ? normalized : DEFAULT_DUPLICATE_SETTINGS.keeperOrder;
}

function normalizeCodecOrder(value) {
  if (!Array.isArray(value)) return DEFAULT_DUPLICATE_SETTINGS.codecOrder;
  const normalized = Array.from(new Set(value.filter((family) => CODEC_FAMILIES.has(family))));
  for (const family of DEFAULT_DUPLICATE_SETTINGS.codecOrder) {
    if (!normalized.includes(family)) normalized.push(family);
  }
  return normalized;
}

function normalizeIgnoredDuplicatePairs(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Set();
  for (const pairKey of value) {
    if (typeof pairKey !== 'string') continue;
    const parts = pairKey.toLowerCase().split('|');
    if (parts.length !== 2 || !parts.every((part) => /^[0-9a-f]{16}$/.test(part))) continue;
    const key = parts[0] < parts[1] ? `${parts[0]}|${parts[1]}` : `${parts[1]}|${parts[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function getSamplingBounds(settings = {}) {
  const mode = settings.samplingWindow || 'even';
  if (mode === '25-75') return { start: 0.25, end: 0.75 };
  if (mode === '20-80') return { start: 0.2, end: 0.8 };
  if (mode === '15-85') return { start: 0.15, end: 0.85 };
  if (mode === 'custom') {
    const start = clamp((settings.customStartPercent ?? 0) / 100, 0, 0.95);
    const end = clamp((settings.customEndPercent ?? 100) / 100, start + 0.01, 1);
    return { start, end };
  }
  return { start: 0, end: 1 };
}

// A seek between two frames returns the earlier or the later one depending on the container's time
// base (FFmpeg rounds the seek target to it), so a file and its remux were fingerprinted one frame
// apart. A quarter frame before a frame boundary every time base agrees on that frame.
function snapToFrame(timestamp, fps) {
  let rate = Number(fps);
  if (!Number.isFinite(rate) || rate <= 0) return timestamp;
  // Stored frame rates are rounded to 0.01; 23.98, 29.97 and 59.94 stand for N * 1000 / 1001.
  const ntscRate = Math.round(rate) * 1000 / 1001;
  if (Math.abs(ntscRate - rate) < 0.006) rate = ntscRate;
  const snapped = (Math.round(timestamp * rate) - 0.25) / rate;
  return Math.max(0, Math.round(snapped * 1e6) / 1e6);
}

function getSamplingTimestamps(durationSecs, sampleCount, settings = {}, fps = null) {
  const duration = Number(durationSecs);
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const count = Math.max(1, Number(sampleCount) || DEFAULT_DUPLICATE_SETTINGS.sampleCount);
  const maxDuration = Number(settings.maxSamplingDuration) > 0
    ? Math.min(duration, Number(settings.maxSamplingDuration))
    : duration;
  const { start, end } = getSamplingBounds(settings);
  const windowStart = maxDuration * start;
  const windowEnd = maxDuration * end;
  const span = Math.max(0.01, windowEnd - windowStart);
  const timestamps = [];
  for (let i = 1; i <= count; i++) {
    const ratio = i / (count + 1);
    timestamps.push(snapToFrame(Math.round((windowStart + span * ratio) * 100) / 100, fps));
  }
  return timestamps;
}

function getDuplicateFingerprintKey(input = {}) {
  const settings = normalizeDuplicateSettings(input);
  const bounds = getSamplingBounds(settings);
  const maxDuration = Number(settings.maxSamplingDuration) > 0 ? Number(settings.maxSamplingDuration) : 0;
  return [
    // Bump when stored fingerprints stop being comparable with new ones. v2: the bundled FFmpeg
    // moved from 2018 to 9.0.2, which decodes some frames differently (mixed old/new pHash fell to
    // 62–94% similarity for identical files, checked with scripts/compare-ffmpeg-builds.js).
    // v3: samples are taken at frame-aligned times (see snapToFrame).
    'gray32-v3',
    settings.sampleCount,
    bounds.start,
    bounds.end,
    maxDuration,
  ].join('|');
}

// Bursts are read at the fingerprint's sample times, so they are valid only beside those fingerprints.
// 'hash': the burst stores hashes only, which serves pHash mode.
function getDuplicateBurstKey(input = {}) {
  return `${getDuplicateFingerprintKey(input)}|b1|hash`;
}

// Raise when a change to the comparison or grouping code can change which pairs match, so stored
// results made by the previous code are discarded.
const DUPLICATE_ALGORITHM_VERSION = 1;

// Every duplicate setting is in exactly one of these lists (a test checks it), so a new setting cannot
// be forgotten. Matching settings change which pairs match; the others only change what is done with
// the result, are resolved into another setting, or are handled when results are loaded.
const MATCHING_SETTING_KEYS = [
  'comparisonMode', 'sampleCount', 'samplingWindow', 'customStartPercent', 'customEndPercent',
  'finalSimilarityThreshold', 'phashFirstSampleOnly', 'durationTolerancePercent', 'requireEverySample',
  'ignoreBlackPixels', 'ignoreWhitePixels', 'compareFlipped', 'matchBlackBars', 'skipBlankFrames',
  'matchPartlyUnreadable', 'minComparedSamples', 'maxSamplingDuration', 'verifyNearMatches', 'nearMissRange',
];
const NON_MATCHING_SETTING_KEYS = [
  'enabled', 'runAfterScan', 'defaultScope', 'protectKeep', 'protectSkipped', 'keeperOrder', 'codecOrder',
  // Resolved into finalSimilarityThreshold by normalizeDuplicateSettings.
  'separateSimilarityThresholds', 'phashSimilarityThreshold', 'visualSimilarityThreshold',
  'retryFailedFingerprintExtraction', 'checkpointIntervalMinutes',
  // Applied to stored results when they are loaded: an ignored pair is removed and its group rebuilt.
  'ignoredDuplicatePairs',
  'phashDefaultApplied', 'averageSamplesDefaultApplied',
];

/** Identity of everything that decides which pairs match; stored results with another key are discarded. */
function getDuplicateResultsSettingsKey(input = {}) {
  const settings = normalizeDuplicateSettings(input);
  const matching = Object.fromEntries(MATCHING_SETTING_KEYS.map((key) => [key, settings[key]]));
  const identity = JSON.stringify([DUPLICATE_ALGORITHM_VERSION, getDuplicateFingerprintKey(settings), matching]);
  return crypto.createHash('sha1').update(identity).digest('hex');
}

function calculateDctPHash(grayBytes, size = 32, lowSize = 8) {
  if (!grayBytes || grayBytes.length < size * size) {
    throw new Error('Expected a 32x32 grayscale frame buffer.');
  }
  const values = new Float64Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = grayBytes[i];

  const dct = [];
  for (let u = 0; u < lowSize; u++) {
    for (let v = 0; v < lowSize; v++) {
      let sum = 0;
      for (let x = 0; x < size; x++) {
        const cosX = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
        for (let y = 0; y < size; y++) {
          const cosY = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
          sum += values[x * size + y] * cosX * cosY;
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct.push(0.25 * cu * cv * sum);
    }
  }

  // Skip dct[0] (the DC component / average brightness) — it's almost always
  // above the median so bit 63 would universally be 1, wasting a hash bit.
  const comparable = dct.slice(1);
  const median = comparable.slice().sort((a, b) => a - b)[Math.floor(comparable.length / 2)] ?? 0;
  let hash = 0n;
  for (let i = 0; i < 63; i++) {
    if ((comparable[i] ?? 0) > median) hash |= 1n << BigInt(62 - i);
  }
  return hash.toString(16).padStart(16, '0');
}

function flipGrayBytes(grayBytes, width = 32, height = 32) {
  if (!grayBytes || grayBytes.length < width * height) {
    throw new Error('Expected grayscale bytes matching the requested dimensions.');
  }
  const flipped = Buffer.alloc(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      flipped[row * width + col] = grayBytes[row * width + (width - 1 - col)];
    }
  }
  return flipped;
}

// A hash is kept as its high and low 32-bit halves: comparing BigInts dominated the pair loop.
function parsePHashWords(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{1,16}$/i.test(value)) return new Uint32Array(2);
  const hex = value.padStart(16, '0');
  return Uint32Array.of(parseInt(hex.slice(0, 8), 16), parseInt(hex.slice(8), 16));
}

function popcount32(value) {
  let n = value - ((value >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return Math.imul((n + (n >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Accepts hex strings or the word pairs from parsePHashWords. */
function pHashSimilarity(hashA, hashB) {
  const a = typeof hashA === 'string' ? parsePHashWords(hashA) : hashA;
  const b = typeof hashB === 'string' ? parsePHashWords(hashB) : hashB;
  const distance = popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]);
  return ((64 - distance) / 64) * 100;
}

function rawGraySimilarity(bytesA, bytesB, options = {}) {
  if (!bytesA || !bytesB || bytesA.length !== bytesB.length || bytesA.length === 0) return 0;
  let total = 0;
  let count = 0;
  const ignoreBlack = Boolean(options.ignoreBlackPixels);
  const ignoreWhite = Boolean(options.ignoreWhitePixels);
  for (let i = 0; i < bytesA.length; i++) {
    const a = bytesA[i];
    const b = bytesB[i];
    if (ignoreBlack && a <= 5 && b <= 5) continue;
    if (ignoreWhite && a >= 250 && b >= 250) continue;
    total += Math.abs(a - b);
    count++;
  }
  if (count === 0) return 100;
  return Math.max(0, 100 - (total / count / 255) * 100);
}

function frameDarkRatio(grayBytes) {
  if (!grayBytes || grayBytes.length === 0) return 0;
  let dark = 0;
  for (const value of grayBytes) {
    if (value <= 16) dark++;
  }
  return dark / grayBytes.length;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

// The pair score must be the value the threshold actually tests, so a pair shown as
// X% is exactly what a scan at X% would find. With every-sample matching that is the
// weakest sample; otherwise it is the average.
function combineSampleScores(scores, settings) {
  return settings.requireEverySample ? Math.min(...scores) : average(scores);
}

const DARK_SAMPLE_RATIO_THRESHOLD = 0.8;

function isDarkSample(sample) {
  return Number(sample?.darkRatio ?? 0) >= DARK_SAMPLE_RATIO_THRESHOLD;
}

// A frame of one flat colour (a grey card, a fade) matches any other such frame, so it is no evidence.
// Measured on the test collection: flat passages 1, the darkest real picture 30.
const BLANK_FRAME_MAX_LUMA_RANGE = 12;

// A sample counts as evidence when it was decoded, is not mostly dark and, with skipBlankFrames, is
// not blank. A fingerprint without a stored luma range is treated as not blank.
function isUsableSample(sample, settings) {
  if (sample.unreadable || isDarkSample(sample)) return false;
  return !(settings.skipBlankFrames && sample.lumaRange !== null && sample.lumaRange <= BLANK_FRAME_MAX_LUMA_RANGE);
}

// Below this many differing bits between its own samples a video shows (nearly) the same picture
// throughout, such as a slideshow frame or a recorded screen.
const STATIC_MAX_HASH_DISTANCE = 6;

/**
 * 'static', 'moving' or 'unknown', from the video's own usable samples. One sample cannot show
 * movement, so fewer than two usable samples gives 'unknown'.
 */
function movementClass(samples, settings) {
  const hashes = samples
    .filter((sample) => sample.motionHash && isUsableSample(sample, settings))
    .map((sample) => sample.motionHash);
  if (hashes.length < 2) return 'unknown';
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const distance = popcount32(hashes[i][0] ^ hashes[j][0]) + popcount32(hashes[i][1] ^ hashes[j][1]);
      if (distance >= STATIC_MAX_HASH_DISTANCE) return 'moving';
    }
  }
  return 'static';
}

/**
 * How many samples must be compared for a pair to be eligible. 'auto' is the rule from before the
 * setting existed: 2, or 1 with one sample or first-sample scoring.
 */
function minimumComparedSamples(settings, firstSampleOnly) {
  if (firstSampleOnly) return 1;
  if (settings.minComparedSamples === 'auto') return settings.sampleCount > 1 ? 2 : 1;
  return Math.min(Number(settings.minComparedSamples), settings.sampleCount);
}

/** 'low' when one frame decided the match or when neither video moves; a later check is advised. */
function matchConfidence(comparedSamples, isStatic) {
  return comparedSamples === 1 || isStatic ? 'low' : 'normal';
}

/**
 * Groups fingerprint rows per video in sample order. A video with fewer rows than `sampleCount` is
 * left out, and so is one with a sample that could not be read unless `keepPartlyUnreadable`.
 * `toSample(row)` builds what the matching sample-score function reads.
 */
function groupSamplesByVideo(rows, sampleCount, toSample, keepPartlyUnreadable) {
  const byVideo = new Map();
  for (const row of rows) {
    const list = byVideo.get(row.video_id) ?? [];
    list.push({
      index: Number(row.sample_index),
      darkRatio: Number(row.frame_dark_ratio ?? 0),
      unreadable: row.sample_state === 'unreadable',
      lumaRange: row.luma_range ?? null,
      timestamp: row.timestamp_secs ?? null,
      // The full-frame hash in both modes: the movement class is judged on it.
      motionHash: row.phash_hex ? parsePHashWords(row.phash_hex) : null,
      ...toSample(row),
    });
    byVideo.set(row.video_id, list);
  }

  const result = new Map();
  for (const [videoId, samples] of byVideo) {
    const ordered = samples.sort((a, b) => a.index - b.index).slice(0, sampleCount);
    if (ordered.length < sampleCount) continue;
    if (!keepPartlyUnreadable && ordered.some((sample) => sample.unreadable)) continue;
    result.set(videoId, ordered);
  }
  return result;
}

// Every sample has a `full` variant and, for a video with black bars, a `crop` variant holding the
// picture inside them. A sample-score function compares one variant of each side.
function pHashSamplesByVideo(rows, sampleCount, keepPartlyUnreadable = false) {
  return groupSamplesByVideo(rows, sampleCount, (row) => ({
    full: {
      hash: parsePHashWords(row.phash_hex),
      flippedHash: parsePHashWords(row.flipped_phash_hex ?? row.phash_hex),
    },
    crop: row.crop_phash_hex
      ? {
          hash: parsePHashWords(row.crop_phash_hex),
          flippedHash: parsePHashWords(row.crop_flipped_phash_hex ?? row.crop_phash_hex),
        }
      : null,
  }), keepPartlyUnreadable);
}

function graySamplesByVideo(rows, sampleCount, keepPartlyUnreadable = false) {
  return groupSamplesByVideo(rows, sampleCount, (row) => ({
    full: { bytes: row.gray_bytes, flippedBytes: null },
    crop: row.crop_gray_bytes ? { bytes: row.crop_gray_bytes, flippedBytes: null } : null,
  }), keepPartlyUnreadable);
}

function pHashSampleScore(variantA, variantB, flipped) {
  return pHashSimilarity(flipped ? variantA.flippedHash : variantA.hash, variantB.hash);
}

function graySampleScore(settings) {
  return (variantA, variantB, flipped) => {
    if (!variantA.bytes || !variantB.bytes) return null;
    if (!flipped) return rawGraySimilarity(variantA.bytes, variantB.bytes, settings);
    // The mirrored frame is kept on the sample: one video is compared against many others.
    variantA.flippedBytes ??= flipGrayBytes(variantA.bytes);
    return rawGraySimilarity(variantA.flippedBytes, variantB.bytes, settings);
  };
}

/** The row shape the cache loaders return, for a fingerprint that was just built. */
function fingerprintToRow(videoId, fingerprint) {
  return {
    video_id: videoId,
    sample_index: fingerprint.sampleIndex,
    timestamp_secs: fingerprint.timestampSecs ?? null,
    border_ltrb: fingerprint.borderLtrb ?? null,
    phash_hex: fingerprint.phashHex,
    flipped_phash_hex: fingerprint.flippedPHashHex ?? null,
    gray_bytes: fingerprint.grayBytes,
    frame_dark_ratio: fingerprint.frameDarkRatio ?? null,
    sample_state: fingerprint.sampleState ?? null,
    luma_range: fingerprint.lumaRange ?? null,
    crop_phash_hex: fingerprint.cropPHashHex ?? null,
    crop_flipped_phash_hex: fingerprint.cropFlippedPHashHex ?? null,
    crop_gray_bytes: fingerprint.cropGrayBytes ?? null,
  };
}

// Which side is compared without its black bars. (full, full) is scored first, so it wins a tie.
const CROPPED_HYPOTHESES = [[true, false], [false, true], [true, true]];

/**
 * The one scoring rule for two videos, used by both comparison workers and by the recomputation
 * during grouping. `sampleScore(variantA, variantB, flipped)` returns 0-100, or null when the two
 * samples cannot be compared. Returns null when the pair is not comparable or, with
 * requireEverySample, when a sample is below the threshold. The caller applies the final threshold.
 *
 * With matchBlackBars the pair is also scored with one or both videos cut to the picture inside
 * their black bars, and the best score counts. One choice holds for every sample of the pair, and
 * (full, full) is always among them, so this can add a match but never remove one.
 */
function scoreSamples(samplesA, samplesB, settings, sampleScore, options = {}) {
  let best = scoreSampleVariants(samplesA, samplesB, settings, sampleScore, options, false, false);
  if (!settings.matchBlackBars) return best;
  // Bars are found per video, so the first sample tells whether the video has a cropped variant.
  const hasCropA = Boolean(samplesA[0]?.crop);
  const hasCropB = Boolean(samplesB[0]?.crop);
  if (!hasCropA && !hasCropB) return best;
  for (const [cropA, cropB] of CROPPED_HYPOTHESES) {
    if ((cropA && !hasCropA) || (cropB && !hasCropB)) continue;
    const result = scoreSampleVariants(samplesA, samplesB, settings, sampleScore, options, cropA, cropB);
    if (result && (!best || result.similarity > best.similarity)) best = { ...result, borderAdjusted: true };
  }
  return best;
}

function scoreSampleVariants(samplesA, samplesB, settings, sampleScore, { firstSampleOnly = false, stopBelowThreshold = false, floor = undefined }, cropA, cropB) {
  // `floor`: the lowest score the caller still wants back, below the threshold for near misses.
  const threshold = floor ?? settings.finalSimilarityThreshold;
  // An average at the threshold allows this much shortfall in total; past it the pair cannot match,
  // which ends most comparisons of unrelated videos after the first sample.
  const maxShortfall = stopBelowThreshold ? (100 - threshold) * settings.sampleCount : Infinity;
  const scores = [];
  let shortfall = 0;
  let flipped = false;
  for (let i = 0; i < settings.sampleCount; i++) {
    const sampleA = samplesA[i];
    const sampleB = samplesB[i];
    if (!sampleA || !sampleB) return null;
    // Usability is judged on the full frame, whichever variant is compared.
    if (!isUsableSample(sampleA, settings) || !isUsableSample(sampleB, settings)) continue;
    const variantA = cropA ? sampleA.crop : sampleA.full;
    const variantB = cropB ? sampleB.crop : sampleB.full;
    if (!variantA || !variantB) return null;
    let score = sampleScore(variantA, variantB, false);
    if (score === null) continue;
    if (settings.compareFlipped) {
      const flippedScore = sampleScore(variantA, variantB, true);
      if (flippedScore !== null && flippedScore > score) {
        score = flippedScore;
        flipped = true;
      }
    }
    if (settings.requireEverySample && score < threshold) return null;
    scores.push(score);
    shortfall += 100 - score;
    if (shortfall > maxShortfall) return null;
    // Only the first sample usable in both videos counts.
    if (firstSampleOnly) break;
  }

  if (scores.length < minimumComparedSamples(settings, firstSampleOnly)) return null;
  // `flipped`: a sample matched better mirrored. `borderAdjusted` is set by scoreSamples when a
  // variant without black bars won.
  return { similarity: combineSampleScores(scores, settings), scores, compared: scores.length, flipped, borderAdjusted: false };
}

function durationsWithinTolerance(a, b, settings) {
  const durationA = Number(a.durationSecs ?? 0);
  const durationB = Number(b.durationSecs ?? 0);
  if (durationA <= 0 || durationB <= 0) return true;
  const diff = Math.abs(durationA - durationB);
  const percentAllowance = Math.min(durationA, durationB) * ((settings.durationTolerancePercent ?? 2) / 100);
  return diff <= percentAllowance;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolutionDisplayTier(video) {
  const width = finiteNumber(video.width);
  const height = finiteNumber(video.height);
  if (width <= 0 || height <= 0) return 0;
  const longestEdge = Math.max(width, height);
  const shortestEdge = Math.min(width, height);

  if (longestEdge >= 7680) return 8000;
  if (longestEdge >= 5120) return 5000;
  if (longestEdge >= 3840) return 4000;
  if (longestEdge >= 2560) return 1440;
  if (longestEdge >= 1920) return 1080;
  if (longestEdge >= 1280) return 720;
  return shortestEdge;
}

// ffprobe names other than the family keys in codecOrder. SYNC NOTE: mirrored in src/store.ts.
const CODEC_ALIASES = { h265: 'hevc', wmv1: 'vc1', wmv2: 'vc1', wmv3: 'vc1' };

// Higher is better; codecs outside the preference list all score 0 and tie.
function codecPreferenceScore(video, codecOrder) {
  const name = String(video.videoCodec ?? '').toLowerCase();
  const index = codecOrder.indexOf(CODEC_ALIASES[name] ?? name);
  return index === -1 ? 0 : codecOrder.length - index;
}

// A video's metadata is trusted only after its probe succeeded; until then it may lack an audio
// codec simply because nothing was read yet.
function hasProbedMetadata(video) {
  return video.metadataVersion != null && !video.metadataFailedAt;
}

/**
 * Per member, the sample positions it could not read while another current member read the same
 * position. Members without fingerprint data are unknown: they neither count as failing nor as the
 * member that read a position.
 */
function confirmedUnreadablePositions(videos, unreadableSamples = {}) {
  const result = new Map();
  for (const video of videos) {
    const own = unreadableSamples[video.id];
    if (!own) continue;
    const confirmed = own.filter((sample) => videos.some((other) => {
      const otherUnreadable = unreadableSamples[other.id];
      return other.id !== video.id && otherUnreadable && !otherUnreadable.some((item) => item.index === sample.index);
    }));
    if (confirmed.length > 0) result.set(video.id, confirmed);
  }
  return result;
}

function formatPositions(samples) {
  const labels = samples.map((sample) => (sample.percent == null ? `sample ${sample.index + 1}` : `${sample.percent} %`));
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
}

// Higher is better for every rule.
function keeperRuleScore(video, rule, codecOrder, health) {
  if (rule === 'health') return -(health.get(video.id)?.length ?? 0);
  // Unknown metadata ties with the best, so an unprobed video is never demoted for missing sound.
  if (rule === 'audio') return !hasProbedMetadata(video) || video.audioCodec ? 1 : 0;
  if (rule === 'resolution') return resolutionDisplayTier(video);
  if (rule === 'videoBitrate') return finiteNumber(video.videoBitrate ?? video.totalBitrate);
  if (rule === 'duration') return finiteNumber(video.durationSecs);
  if (rule === 'fps') return finiteNumber(video.fps);
  if (rule === 'size') return finiteNumber(video.sizeBytes);
  if (rule === 'codec') return codecPreferenceScore(video, codecOrder);
  return 0;
}

// Copies of one video rarely end on exactly the same frame; a shorter one by less than this is not
// "missing" anything, so the next rule decides.
const KEEPER_DURATION_MARGIN_SECS = 2;
const KEEPER_DURATION_MARGIN_SHARE = 0.01;

function keeperRuleMargin(rule, videos) {
  if (rule !== 'duration') return 0;
  const longest = Math.max(0, ...videos.map((video) => finiteNumber(video.durationSecs)));
  return Math.max(KEEPER_DURATION_MARGIN_SECS, longest * KEEPER_DURATION_MARGIN_SHARE);
}

// Rules that only separate copies when nothing about the picture differs.
const KEEPER_TIE_BREAK_RULES = new Set(['size', 'codec', 'path']);

function formatSeconds(seconds) {
  return seconds >= 10 ? String(Math.round(seconds)) : String(Math.round(seconds * 10) / 10);
}

/** One fixed phrase for why `video` lost at `rule` against the best score `best`. */
function keeperReason(rule, video, best, codecOrder, health) {
  const score = keeperRuleScore(video, rule, codecOrder, health);
  if (rule === 'health') return `could not be read at ${formatPositions(health.get(video.id) ?? [])}`;
  if (rule === 'audio') return 'has no audio track';
  if (rule === 'resolution') return 'lower resolution';
  if (rule === 'videoBitrate') return 'lower bitrate';
  if (rule === 'duration') return `shorter by ${formatSeconds(best - score)} s`;
  if (rule === 'fps') return score > 0 ? `${score} fps instead of ${best}` : 'unknown frame rate';
  if (rule === 'size') return 'smaller file';
  if (rule === 'codec') return 'less preferred codec';
  return 'no difference found; chosen by file name';
}

/**
 * The suggested keeper of a group. Each rule in order keeps the candidates within its margin of the
 * best score; with every margin 0 this is the earlier strict comparison. Remaining ties go to the
 * alphabetically first path. Returns the keeper, the rule that decided, whether that rule is only a
 * tie-break, and per other member the phrase for the rule it lost at.
 * SYNC NOTE: mirrored by rankKeeperCandidates in src/store.ts.
 */
function rankKeeperCandidates(videos, order, codecOrder = DEFAULT_DUPLICATE_SETTINGS.codecOrder, unreadableSamples = {}) {
  if (videos.length === 0) return null;
  const health = confirmedUnreadablePositions(videos, unreadableSamples);
  let candidates = [...videos];
  const reasons = {};
  let rule = 'path';
  for (const current of order) {
    if (candidates.length < 2) break;
    const scores = new Map(candidates.map((video) => [video.id, keeperRuleScore(video, current, codecOrder, health)]));
    const best = Math.max(...scores.values());
    const margin = keeperRuleMargin(current, videos);
    const kept = candidates.filter((video) => scores.get(video.id) >= best - margin);
    for (const video of candidates) {
      if (!kept.includes(video)) reasons[video.id] = keeperReason(current, video, best, codecOrder, health);
    }
    if (kept.length === 1) rule = current;
    candidates = kept;
  }
  candidates.sort((a, b) => String(a.path ?? '').localeCompare(String(b.path ?? '')));
  for (const video of candidates.slice(1)) reasons[video.id] = keeperReason('path', video, 0, codecOrder, health);
  return { keeper: candidates[0], rule, tieBreak: KEEPER_TIE_BREAK_RULES.has(rule), reasons };
}

function chooseSuggestedKeeper(videos, settings) {
  return rankKeeperCandidates(videos, settings.keeperOrder, settings.codecOrder)?.keeper ?? null;
}

module.exports = {
  DEFAULT_DUPLICATE_SETTINGS,
  normalizeDuplicateSettings,
  getSamplingTimestamps,
  getDuplicateFingerprintKey,
  getDuplicateBurstKey,
  getDuplicateResultsSettingsKey,
  MATCHING_SETTING_KEYS,
  NON_MATCHING_SETTING_KEYS,
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
  fingerprintToRow,
  isDarkSample,
  isUsableSample,
  movementClass,
  matchConfidence,
  minimumComparedSamples,
  rawGraySimilarity,
  frameDarkRatio,
  average,
  combineSampleScores,
  durationsWithinTolerance,
  chooseSuggestedKeeper,
  rankKeeperCandidates,
};
