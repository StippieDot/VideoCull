const { parentPort, workerData } = require('worker_threads');
const {
  normalizeDuplicateSettings,
  pHashSamplesByVideo,
  pHashSampleScore,
  scoreSamples,
  movementClass,
  matchConfidence,
  durationsWithinTolerance,
} = require('./duplicate-utils');
const {
  PENDING_LIST_LIMIT,
  keepBestNearMisses,
  nearMissFloor,
  nearMissVerificationEnabled,
} = require('./pair-verifier');

const BUCKET_SIZE_SECS = 1;
const pauseView = workerData.pauseSignal ? new Int32Array(workerData.pauseSignal) : null;

function pauseCheckpoint() {
  if (!pauseView || Atomics.load(pauseView, 0) !== 1) return;
  Atomics.store(pauseView, 1, 1);
  parentPort.postMessage({ type: 'paused' });
  while (Atomics.load(pauseView, 0) === 1) Atomics.wait(pauseView, 0, 1);
  Atomics.store(pauseView, 1, 0);
}

function getBucketKey(video) {
  const duration = Number(video.durationSecs ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.floor(duration / BUCKET_SIZE_SECS);
}

function getCandidateBucketKeys(video, settings) {
  const duration = Number(video.durationSecs ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const tolerance = duration * ((settings.durationTolerancePercent ?? 0) / 100);
  const minKey = Math.floor(Math.max(0, duration - tolerance) / BUCKET_SIZE_SECS);
  const maxKey = Math.floor((duration + tolerance) / BUCKET_SIZE_SECS);
  const keys = [];
  for (let key = minKey; key <= maxKey; key++) keys.push(key);
  return keys;
}

function forEachCandidatePair(candidates, buckets, unknownDurationCandidates, settings, callback) {
  for (const a of candidates) {
    const bucketKeys = getCandidateBucketKeys(a, settings);
    if (bucketKeys.length === 0) continue;
    for (const key of bucketKeys) {
      const compareBucket = buckets.get(key);
      if (!compareBucket) continue;
      for (const b of compareBucket) {
        if (b.index <= a.index) continue;
        callback(a, b);
      }
    }
  }

  for (let i = 0; i < unknownDurationCandidates.length; i++) {
    for (let j = i + 1; j < unknownDurationCandidates.length; j++) {
      callback(unknownDurationCandidates[i], unknownDurationCandidates[j]);
    }
  }
}

function comparePHashes() {
  const settings = normalizeDuplicateSettings(workerData.settings);
  const videos = workerData.videos ?? [];
  const samplesByVideo = pHashSamplesByVideo(workerData.phashRows ?? [], settings.sampleCount, settings.matchPartlyUnreadable);
  const candidates = videos
    .filter((video) => samplesByVideo.has(video.id))
    .map((video, index) => {
      const samples = samplesByVideo.get(video.id);
      return { ...video, index, samples, static: movementClass(samples, settings) === 'static', partial: samples.some((sample) => sample.unreadable) };
    });

  const pairs = [];
  let compared = 0;
  let lastProgressAt = 0;
  const buckets = new Map();
  const unknownDurationCandidates = [];

  for (const video of candidates) {
    const key = getBucketKey(video);
    if (key === null) {
      unknownDurationCandidates.push(video);
      continue;
    }
    const list = buckets.get(key) ?? [];
    list.push(video);
    buckets.set(key, list);
  }

  let total = 0;
  forEachCandidatePair(candidates, buckets, unknownDurationCandidates, settings, () => {
    total++;
    if ((total & 1023) === 0) pauseCheckpoint();
  });

  const verify = nearMissVerificationEnabled(settings);
  const floor = verify ? nearMissFloor(settings) : undefined;
  let nearMisses = [];
  let nearMissCount = 0;
  const comparePair = (a, b) => {
    if (!durationsWithinTolerance(a, b, settings)) return;
    const result = scoreSamples(a.samples, b.samples, settings, pHashSampleScore, {
      firstSampleOnly: settings.phashFirstSampleOnly,
      stopBelowThreshold: true,
      floor,
    });
    if (!result) return;
    if (result.similarity < settings.finalSimilarityThreshold) {
      if (!verify || result.similarity < floor || result.compared < 2) return;
      nearMissCount++;
      nearMisses.push({ aId: a.id, bId: b.id, similarity: result.similarity });
      // Trimmed in steps so the list never holds more than twice the limit.
      if (nearMisses.length >= PENDING_LIST_LIMIT * 2) nearMisses = keepBestNearMisses(nearMisses);
      return;
    }
    pairs.push({
      aId: a.id,
      bId: b.id,
      pHashSimilarity: result.similarity,
      bestSampleIndex: result.scores.indexOf(Math.max(...result.scores)),
      static: a.static && b.static,
      comparedSamples: result.compared,
      confidence: matchConfidence(result.compared, a.static && b.static),
      borderAdjusted: result.borderAdjusted,
      flipped: result.flipped,
      partialFingerprint: a.partial || b.partial,
    });
  };
  const reportProgress = () => {
    if (compared - lastProgressAt >= 250000) {
      lastProgressAt = compared;
      parentPort.postMessage({ type: 'progress', compared, total });
    }
  };

  forEachCandidatePair(candidates, buckets, unknownDurationCandidates, settings, (a, b) => {
    compared++;
    if ((compared & 1023) === 0) pauseCheckpoint();
    comparePair(a, b);
    reportProgress();
  });

  pauseCheckpoint();
  parentPort.postMessage({
    type: 'done',
    pairs,
    nearMisses: keepBestNearMisses(nearMisses),
    nearMissCount,
    compared,
    total,
    bucketed: true,
    bucketCount: buckets.size,
    unknownDurationCount: unknownDurationCandidates.length,
  });
}

try {
  comparePHashes();
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message || String(err) });
}
