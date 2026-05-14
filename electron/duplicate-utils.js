const DEFAULT_DUPLICATE_SETTINGS = {
  enabled: true,
  runAfterScan: false,
  comparisonMode: 'visual',
  sampleCount: 3,
  defaultScope: 'all',
  protectKeep: true,
  protectSkipped: false,
  keeperOrder: ['resolution', 'videoBitrate', 'duration', 'fps', 'size', 'metadataDate', 'filename'],
  samplingWindow: 'even',
  customStartPercent: 0,
  customEndPercent: 100,
  finalSimilarityThreshold: 95,
  durationTolerancePercent: 20,
  requireEverySample: false,
  ignoreBlackPixels: false,
  ignoreWhitePixels: false,
  compareFlipped: false,
  maxSamplingDuration: 0,
  retryFailedFingerprintExtraction: false,
  checkpointIntervalMinutes: 5,
  ignoredDuplicatePairs: [],
};

const SAMPLE_COUNT_OPTIONS = new Set([1, 2, 3, 4, 5, 7, 9]);
const COMPARISON_MODES = new Set(['phash', 'visual']);
const KEEPER_RULES = new Set(['resolution', 'videoBitrate', 'duration', 'fps', 'size', 'metadataDate', 'filename']);

function normalizeDuplicateSettings(input = {}) {
  const sampleCount = SAMPLE_COUNT_OPTIONS.has(Number(input.sampleCount))
    ? Number(input.sampleCount)
    : DEFAULT_DUPLICATE_SETTINGS.sampleCount;
  const comparisonMode = COMPARISON_MODES.has(input.comparisonMode)
    ? input.comparisonMode
    : DEFAULT_DUPLICATE_SETTINGS.comparisonMode;
  const similarityThreshold = input.similarityThreshold ?? input.finalSimilarityThreshold ?? DEFAULT_DUPLICATE_SETTINGS.finalSimilarityThreshold;
  return {
    ...DEFAULT_DUPLICATE_SETTINGS,
    ...input,
    comparisonMode,
    sampleCount,
    finalSimilarityThreshold: clampPercent(similarityThreshold),
    durationTolerancePercent: clamp(input.durationTolerancePercent ?? DEFAULT_DUPLICATE_SETTINGS.durationTolerancePercent, 0, 100),
    checkpointIntervalMinutes: clamp(input.checkpointIntervalMinutes ?? DEFAULT_DUPLICATE_SETTINGS.checkpointIntervalMinutes, 0, 60),
    ignoredDuplicatePairs: normalizeIgnoredDuplicatePairs(input.ignoredDuplicatePairs),
    keeperOrder: normalizeKeeperOrder(input.keeperOrder),
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

function clampPercent(value) {
  return clamp(Number(value), 0, 100);
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

function getSamplingTimestamps(durationSecs, sampleCount, settings = {}) {
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
    timestamps.push(Math.round((windowStart + span * ratio) * 100) / 100);
  }
  return timestamps;
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

  const comparable = dct.slice(1);
  const median = comparable.slice().sort((a, b) => a - b)[Math.floor(comparable.length / 2)] ?? 0;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if ((dct[i] ?? 0) > median) hash |= 1n << BigInt(63 - i);
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

function parsePHashHex(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value)) return 0n;
  return BigInt(`0x${value}`);
}

function popcountBigInt(value) {
  let n = value < 0n ? -value : value;
  let count = 0;
  while (n > 0n) {
    n &= n - 1n;
    count++;
  }
  return count;
}

function pHashSimilarity(hashA, hashB, bitCount = 64) {
  const a = typeof hashA === 'bigint' ? hashA : parsePHashHex(hashA);
  const b = typeof hashB === 'bigint' ? hashB : parsePHashHex(hashB);
  const distance = popcountBigInt(a ^ b);
  return ((bitCount - distance) / bitCount) * 100;
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

function durationsWithinTolerance(a, b, settings) {
  const durationA = Number(a.durationSecs ?? 0);
  const durationB = Number(b.durationSecs ?? 0);
  if (durationA <= 0 || durationB <= 0) return true;
  const diff = Math.abs(durationA - durationB);
  const percentAllowance = Math.max(durationA, durationB) * ((settings.durationTolerancePercent ?? 2) / 100);
  return diff <= percentAllowance;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolutionPixels(video) {
  return finiteNumber(video.width) * finiteNumber(video.height);
}

function compareKeeperCandidates(a, b, order) {
  for (const rule of order) {
    let diff = 0;
    if (rule === 'resolution') diff = resolutionPixels(a) - resolutionPixels(b);
    else if (rule === 'videoBitrate') diff = finiteNumber(a.videoBitrate ?? a.totalBitrate) - finiteNumber(b.videoBitrate ?? b.totalBitrate);
    else if (rule === 'duration') diff = finiteNumber(a.durationSecs) - finiteNumber(b.durationSecs);
    else if (rule === 'fps') diff = finiteNumber(a.fps) - finiteNumber(b.fps);
    else if (rule === 'size') diff = finiteNumber(a.sizeBytes) - finiteNumber(b.sizeBytes);
    else if (rule === 'metadataDate') diff = finiteNumber(a.metadataDate ?? a.date) - finiteNumber(b.metadataDate ?? b.date);
    else if (rule === 'filename') diff = String(b.filename ?? '').localeCompare(String(a.filename ?? ''), undefined, { numeric: true });
    if (Number.isFinite(diff) && diff !== 0) return diff;
  }
  return String(b.path ?? '').localeCompare(String(a.path ?? ''));
}

function chooseSuggestedKeeper(videos, settings) {
  return [...videos].sort((a, b) => -compareKeeperCandidates(a, b, settings.keeperOrder))[0] ?? null;
}

module.exports = {
  DEFAULT_DUPLICATE_SETTINGS,
  normalizeDuplicateSettings,
  getSamplingTimestamps,
  calculateDctPHash,
  flipGrayBytes,
  parsePHashHex,
  popcountBigInt,
  pHashSimilarity,
  rawGraySimilarity,
  frameDarkRatio,
  average,
  durationsWithinTolerance,
  chooseSuggestedKeeper,
  compareKeeperCandidates,
};
