const { parentPort, workerData } = require('worker_threads');
const {
  normalizeDuplicateSettings,
  parsePHashHex,
  pHashSimilarity,
  average,
  durationsWithinTolerance,
} = require('./duplicate-utils');

const BUCKET_SIZE_SECS = 1;
const DARK_SAMPLE_RATIO_THRESHOLD = 0.8;

function compactSamples(rows, sampleCount) {
  const byVideo = new Map();
  for (const row of rows) {
    const list = byVideo.get(row.video_id) ?? [];
    list.push({
      index: Number(row.sample_index),
      hash: parsePHashHex(row.phash_hex),
      flippedHash: parsePHashHex(row.flipped_phash_hex ?? row.phash_hex),
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

function isDarkSample(sample) {
  return Number(sample?.darkRatio ?? 0) >= DARK_SAMPLE_RATIO_THRESHOLD;
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
  const samplesByVideo = compactSamples(workerData.phashRows ?? [], settings.sampleCount);
  const candidates = videos
    .filter((video) => samplesByVideo.has(video.id))
    .map((video, index) => ({ ...video, index, samples: samplesByVideo.get(video.id) }));

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
  });

  const comparePair = (a, b) => {
    if (!durationsWithinTolerance(a, b, settings)) return;
    const sampleScores = [];
    for (let k = 0; k < settings.sampleCount; k++) {
      if (isDarkSample(a.samples[k]) || isDarkSample(b.samples[k])) continue;
      const normalScore = pHashSimilarity(a.samples[k].hash, b.samples[k].hash);
      const flippedScore = settings.compareFlipped
        ? pHashSimilarity(a.samples[k].flippedHash, b.samples[k].hash)
        : normalScore;
      sampleScores.push(Math.max(normalScore, flippedScore));
    }
    if (sampleScores.length === 0) return;
    if (settings.sampleCount > 1 && sampleScores.length < 2) return;
    const similarity = average(sampleScores);
    const samplesMeetThreshold = !settings.requireEverySample || sampleScores.every((score) => score >= settings.finalSimilarityThreshold);
    if (similarity >= settings.finalSimilarityThreshold && samplesMeetThreshold) {
      pairs.push({
        aId: a.id,
        bId: b.id,
        pHashSimilarity: similarity,
        bestSampleIndex: sampleScores.indexOf(Math.max(...sampleScores)),
      });
    }
  };
  const reportProgress = () => {
    if (compared - lastProgressAt >= 250000) {
      lastProgressAt = compared;
      parentPort.postMessage({ type: 'progress', compared, total });
    }
  };

  forEachCandidatePair(candidates, buckets, unknownDurationCandidates, settings, (a, b) => {
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
    unknownDurationCount: unknownDurationCandidates.length,
  });
}

try {
  comparePHashes();
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message || String(err) });
}
