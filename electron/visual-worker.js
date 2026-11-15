const { parentPort, workerData } = require('worker_threads');
const {
  normalizeDuplicateSettings,
  graySamplesByVideo,
  graySampleScore,
  scoreSamples,
  movementClass,
  durationsWithinTolerance,
} = require('./duplicate-utils');

const BUCKET_SIZE_SECS = 1;
const pauseView = workerData.pauseSignal ? new Int32Array(workerData.pauseSignal) : null;

function pauseCheckpoint() {
  if (!pauseView || Atomics.load(pauseView, 0) !== 1) return;
  Atomics.store(pauseView, 1, 1);
  parentPort.postMessage({ type: 'paused' });
  while (Atomics.load(pauseView, 0) === 1) Atomics.wait(pauseView, 0, 1);
  Atomics.store(pauseView, 1, 0);
}

function getCandidateBuckets(video, settings) {
  const duration = Number(video.durationSecs ?? 0);
  const tolerance = duration * ((settings.durationTolerancePercent ?? 0) / 100);
  const minDuration = Math.max(0, duration - tolerance);
  const maxDuration = duration + tolerance;
  const minKey = Math.floor(minDuration / BUCKET_SIZE_SECS);
  const maxKey = Math.floor(maxDuration / BUCKET_SIZE_SECS);
  const keys = [];
  for (let key = minKey; key <= maxKey; key++) keys.push(key);
  return keys;
}

function forEachBucketedPair(buckets, unknownDurationCandidates, settings, callback) {
  const bucketEntries = Array.from(buckets.entries());
  for (const [, bucketVideos] of bucketEntries) {
    for (const a of bucketVideos) {
      const candidateKeys = getCandidateBuckets(a, settings);
      for (const key of candidateKeys) {
        const compareBucket = buckets.get(key);
        if (!compareBucket) continue;
        for (const b of compareBucket) {
          if (b.index <= a.index) continue;
          if (!durationsWithinTolerance(a, b, settings)) continue;
          callback(a, b);
        }
      }
    }
  }

  for (let i = 0; i < unknownDurationCandidates.length; i++) {
    for (let j = i + 1; j < unknownDurationCandidates.length; j++) {
      callback(unknownDurationCandidates[i], unknownDurationCandidates[j]);
    }
  }
}

function compareVisuals() {
  const settings = normalizeDuplicateSettings(workerData.settings);
  const sampleMap = graySamplesByVideo(workerData.grayRows ?? [], settings.sampleCount);
  const candidates = (workerData.videos ?? [])
    .filter((video) => sampleMap.has(video.id))
    .map((video, index) => {
      const samples = sampleMap.get(video.id);
      return { ...video, index, samples, static: movementClass(samples, settings) === 'static' };
    });

  const buckets = new Map();
  const unknownDurationCandidates = [];
  for (const video of candidates) {
    const duration = Number(video.durationSecs ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      unknownDurationCandidates.push(video);
      continue;
    }
    const key = Math.floor(duration / BUCKET_SIZE_SECS);
    const list = buckets.get(key) ?? [];
    list.push(video);
    buckets.set(key, list);
  }

  const sampleScore = graySampleScore(settings);
  const pairs = [];
  let compared = 0;
  let lastProgressAt = 0;
  let total = 0;
  forEachBucketedPair(buckets, unknownDurationCandidates, settings, () => {
    total++;
    if ((total & 1023) === 0) pauseCheckpoint();
  });

  const comparePair = (a, b) => {
    if (!durationsWithinTolerance(a, b, settings)) return;
    const result = scoreSamples(a.samples, b.samples, settings, sampleScore, { stopBelowThreshold: true });
    if (!result || result.similarity < settings.finalSimilarityThreshold) return;
    pairs.push({
      aId: a.id,
      bId: b.id,
      pHashSimilarity: null,
      bestSampleIndex: result.scores.indexOf(Math.max(...result.scores)),
      static: a.static && b.static,
      similarity: result.similarity,
      matchType: 'visual',
    });
  };

  const reportProgress = () => {
    if (compared - lastProgressAt >= 250000) {
      lastProgressAt = compared;
      parentPort.postMessage({ type: 'progress', compared, total });
    }
  };

  forEachBucketedPair(buckets, unknownDurationCandidates, settings, (a, b) => {
    compared++;
    if ((compared & 1023) === 0) pauseCheckpoint();
    comparePair(a, b);
    reportProgress();
  });

  pauseCheckpoint();
  parentPort.postMessage({
    type: 'done',
    pairs,
    compared,
    total,
    bucketed: true,
    bucketCount: buckets.size,
  });
}

try {
  compareVisuals();
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message || String(err) });
}
