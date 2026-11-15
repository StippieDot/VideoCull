// SYNC NOTE: These defaults are duplicated in src/keybind-defaults.ts (DEFAULT_DUPLICATE_SETTINGS).
// The renderer copy is needed for instant settings UI feedback. Keep both in sync when changing defaults.
// The compareKeeperCandidates / chooseSuggestedKeeper functions below are also mirrored in src/store.ts.
const DEFAULT_DUPLICATE_SETTINGS = {
  enabled: true,
  runAfterScan: false,
  comparisonMode: 'phash',
  sampleCount: 3,
  defaultScope: 'all',
  protectKeep: true,
  protectSkipped: false,
  keeperOrder: ['resolution', 'videoBitrate', 'duration', 'fps', 'size', 'codec'],
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
  maxSamplingDuration: 0,
  retryFailedFingerprintExtraction: false,
  checkpointIntervalMinutes: 5,
  ignoredDuplicatePairs: [],
  phashDefaultApplied: true,
  averageSamplesDefaultApplied: true,
};

const SAMPLE_COUNT_OPTIONS = new Set([1, 2, 3, 4, 5, 7, 9]);
const COMPARISON_MODES = new Set(['phash', 'visual']);
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
    if (!normalized.includes(rule)) normalized.push(rule);
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

function minimumUsableSamples(sampleCount) {
  return sampleCount > 1 ? 2 : 1;
}

/**
 * Groups fingerprint rows per video in sample order. A video with fewer rows than `sampleCount`, or
 * with a sample that could not be read, is left out. `toSample(row)` builds what the matching sample-score function reads.
 */
function groupSamplesByVideo(rows, sampleCount, toSample) {
  const byVideo = new Map();
  for (const row of rows) {
    const list = byVideo.get(row.video_id) ?? [];
    list.push({
      index: Number(row.sample_index),
      darkRatio: Number(row.frame_dark_ratio ?? 0),
      unreadable: row.sample_state === 'unreadable',
      ...toSample(row),
    });
    byVideo.set(row.video_id, list);
  }

  const result = new Map();
  for (const [videoId, samples] of byVideo) {
    const ordered = samples.sort((a, b) => a.index - b.index).slice(0, sampleCount);
    // shortcut: a video with an unreadable sample is not compared at all, until matching on the
    // remaining samples (minimum evidence) is built.
    if (ordered.length >= sampleCount && !ordered.some((sample) => sample.unreadable)) result.set(videoId, ordered);
  }
  return result;
}

function pHashSamplesByVideo(rows, sampleCount) {
  return groupSamplesByVideo(rows, sampleCount, (row) => ({
    hash: parsePHashWords(row.phash_hex),
    flippedHash: parsePHashWords(row.flipped_phash_hex ?? row.phash_hex),
  }));
}

function graySamplesByVideo(rows, sampleCount) {
  return groupSamplesByVideo(rows, sampleCount, (row) => ({ bytes: row.gray_bytes, flippedBytes: null }));
}

function pHashSampleScore(sampleA, sampleB, flipped) {
  return pHashSimilarity(flipped ? sampleA.flippedHash : sampleA.hash, sampleB.hash);
}

function graySampleScore(settings) {
  return (sampleA, sampleB, flipped) => {
    if (!sampleA.bytes || !sampleB.bytes) return null;
    if (!flipped) return rawGraySimilarity(sampleA.bytes, sampleB.bytes, settings);
    // The mirrored frame is kept on the sample: one video is compared against many others.
    sampleA.flippedBytes ??= flipGrayBytes(sampleA.bytes);
    return rawGraySimilarity(sampleA.flippedBytes, sampleB.bytes, settings);
  };
}

/**
 * The one scoring rule for two videos, used by both comparison workers and by the recomputation
 * during grouping. `sampleScore(sampleA, sampleB, flipped)` returns 0-100, or null when the two
 * samples cannot be compared. Returns null when the pair is not comparable or, with
 * requireEverySample, when a sample is below the threshold. The caller applies the final threshold.
 */
function scoreSamples(samplesA, samplesB, settings, sampleScore, { firstSampleOnly = false, stopBelowThreshold = false } = {}) {
  const threshold = settings.finalSimilarityThreshold;
  // An average at the threshold allows this much shortfall in total; past it the pair cannot match,
  // which ends most comparisons of unrelated videos after the first sample.
  const maxShortfall = stopBelowThreshold ? (100 - threshold) * settings.sampleCount : Infinity;
  const scores = [];
  let shortfall = 0;
  for (let i = 0; i < settings.sampleCount; i++) {
    const sampleA = samplesA[i];
    const sampleB = samplesB[i];
    if (!sampleA || !sampleB) return null;
    if (isDarkSample(sampleA) || isDarkSample(sampleB)) continue;
    let score = sampleScore(sampleA, sampleB, false);
    if (score === null) continue;
    if (settings.compareFlipped) score = Math.max(score, sampleScore(sampleA, sampleB, true));
    if (settings.requireEverySample && score < threshold) return null;
    scores.push(score);
    shortfall += 100 - score;
    if (shortfall > maxShortfall) return null;
    // Only the first sample where neither frame is dark counts.
    if (firstSampleOnly) break;
  }

  if (scores.length < minimumUsableSamples(firstSampleOnly ? 1 : settings.sampleCount)) return null;
  return { similarity: combineSampleScores(scores, settings), scores, compared: scores.length };
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

function compareKeeperCandidates(a, b, order, codecOrder = DEFAULT_DUPLICATE_SETTINGS.codecOrder) {
  for (const rule of order) {
    let diff = 0;
    if (rule === 'resolution') diff = resolutionDisplayTier(a) - resolutionDisplayTier(b);
    else if (rule === 'videoBitrate') diff = finiteNumber(a.videoBitrate ?? a.totalBitrate) - finiteNumber(b.videoBitrate ?? b.totalBitrate);
    else if (rule === 'duration') diff = finiteNumber(a.durationSecs) - finiteNumber(b.durationSecs);
    else if (rule === 'fps') diff = finiteNumber(a.fps) - finiteNumber(b.fps);
    else if (rule === 'size') diff = finiteNumber(a.sizeBytes) - finiteNumber(b.sizeBytes);
    else if (rule === 'codec') diff = codecPreferenceScore(a, codecOrder) - codecPreferenceScore(b, codecOrder);
    if (Number.isFinite(diff) && diff !== 0) return diff;
  }
  return String(b.path ?? '').localeCompare(String(a.path ?? ''));
}

function chooseSuggestedKeeper(videos, settings) {
  return [...videos].sort((a, b) => -compareKeeperCandidates(a, b, settings.keeperOrder, settings.codecOrder))[0] ?? null;
}

module.exports = {
  DEFAULT_DUPLICATE_SETTINGS,
  normalizeDuplicateSettings,
  getSamplingTimestamps,
  getDuplicateFingerprintKey,
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
  isDarkSample,
  rawGraySimilarity,
  frameDarkRatio,
  average,
  combineSampleScores,
  durationsWithinTolerance,
  chooseSuggestedKeeper,
  compareKeeperCandidates,
};
