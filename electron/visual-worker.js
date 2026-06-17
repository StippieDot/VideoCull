const { parentPort, workerData } = require('worker_threads');
const {
  normalizeDuplicateSettings,
  rawGraySimilarity,
  flipGrayBytes,
  durationsWithinTolerance,
} = require('./duplicate-utils');

const BUCKET_SIZE_SECS = 1;
const DARK_SAMPLE_RATIO_THRESHOLD = 0.8;

function compactGraySamples(rows, sampleCount) {
  const byVideo = new Map();
  for (const row of rows) {
    const list = byVideo.get(row.video_id) ?? [];
    list.push({
      index: Number(row.sample_index),
      bytes: row.gray_bytes,
      flippedBytes: null,
      darkRatio: Number(row.frame_dark_ratio ?? 0),
    });
    byVideo.set(row.video_id, list);
  }

  const result = new Map();
  for (const [videoId, samples] of byVideo) {
    const ordered = samples.sort((a, b) => a.index - b.index).slice(0, sampleCount);
    if (ordered.length >= sampleCount) result.set(videoId, ordered);
  }
  return result;
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

function isDarkSample(sample) {
  return Number(sample?.darkRatio ?? 0) >= DARK_SAMPLE_RATIO_THRESHOLD;
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

function compareSamples(a, b, settings) {
  const scores = [];
  let diffSum = 0;
  const maxDiffSum = (100 - settings.finalSimilarityThreshold) * settings.sampleCount;
  for (let i = 0; i < settings.sampleCount; i++) {
    const sampleA = a.samples[i];
    const sampleB = b.samples[i];
    if (!sampleA?.bytes || !sampleB?.bytes) continue;
    if (isDarkSample(sampleA) || isDarkSample(sampleB)) continue;
    const normalScore = rawGraySimilarity(sampleA.bytes, sampleB.bytes, settings);
    let bestScore = normalScore;
    if (settings.compareFlipped) {
      sampleA.flippedBytes ??= flipGrayBytes(sampleA.bytes);
      const flippedScore = rawGraySimilarity(sampleA.flippedBytes, sampleB.bytes, settings);
      bestScore = Math.max(normalScore, flippedScore);
    }
    scores.push(bestScore);
    diffSum += 100 - bestScore;
    if (settings.requireEverySample && bestScore < settings.finalSimilarityThreshold) return null;
    if (diffSum > maxDiffSum) return null;
  }

  if (scores.length === 0) return null;
  if (settings.sampleCount > 1 && scores.length < 2) return null;
  const similarity = 100 - (diffSum / scores.length);
  if (similarity < settings.finalSimilarityThreshold) return null;
  return {
    similarity,
    bestSampleIndex: scores.indexOf(Math.max(...scores)),
  };
}

function compareVisuals() {
  const settings = normalizeDuplicateSettings(workerData.settings);
  const sampleMap = compactGraySamples(workerData.grayRows ?? [], settings.sampleCount);
  const candidates = (workerData.videos ?? [])
    .filter((video) => sampleMap.has(video.id))
    .map((video, index) => ({ ...video, index, samples: sampleMap.get(video.id) }));

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

  const pairs = [];
  let compared = 0;
  let lastProgressAt = 0;
  let total = 0;
  forEachBucketedPair(buckets, unknownDurationCandidates, settings, () => {
    total++;
  });

  const comparePair = (a, b) => {
    if (!durationsWithinTolerance(a, b, settings)) return;
    const result = compareSamples(a, b, settings);
    if (!result) return;
    pairs.push({
      aId: a.id,
      bId: b.id,
      pHashSimilarity: null,
      bestSampleIndex: result.bestSampleIndex,
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
    comparePair(a, b);
    reportProgress();
  });

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
