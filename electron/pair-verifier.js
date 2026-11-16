// Timing verification of near misses: a pair that scores just below the similarity threshold is looked
// at again against a short burst of frames around each sample time of the other video. A copy that
// starts a moment earlier or later then reaches the threshold at one consistent time shift.
const {
  combineSampleScores,
  isUsableSample,
  minimumComparedSamples,
  parsePHashWords,
  pHashSampleScore,
} = require('./duplicate-utils');

// A burst: up to 61 frames at 30 fps, from 1 s before the sample time to 1 s after. Measured: at 5 fps a
// re-encode one frame (42 ms) off at a fast cut stayed at 72 % on its nearest burst frame and was
// missed; at 30 fps it reached 98 %. The cost is about 0.15 s more per sample position.
const BURST_FRAME_COUNT = 61;
const BURST_FPS = 30;
const BURST_LEAD_SECS = 1;
// How far the shift at the last compared sample may differ from the one at the first, beyond what the
// difference in length explains.
const ALIGNMENT_ALLOWANCE_SECS = 0.4;
const BURST_BUDGET_MIN = 20;
const BURST_BUDGET_MAX = 200;
const BURST_BUDGET_SHARE = 0.1;
const PENDING_LIST_LIMIT = 50_000;
// More near misses than this per video: the band is not selective for this library.
const MANY_NEAR_MISSES_PER_VIDEO = 5;
// (crop A, crop B); (full, full) first so it wins a tie.
const HYPOTHESES = [[false, false], [true, false], [false, true], [true, true]];

/** Near misses are double-checked in pHash mode with at least two samples scored on all of them. */
function nearMissVerificationEnabled(settings) {
  return settings.verifyNearMatches === 'auto'
    && settings.comparisonMode === 'phash'
    && settings.sampleCount >= 2
    && !settings.phashFirstSampleOnly;
}

/** The lowest score that is still a near miss; pairs from here up to the threshold are double-checked. */
function nearMissFloor(settings) {
  return Math.max(0, settings.finalSimilarityThreshold - settings.nearMissRange);
}

/** Bursts a normal run may extract: about a tenth of the videos, at least 20 and at most 200. */
function burstBudget(videoCount) {
  return Math.min(BURST_BUDGET_MAX, Math.max(BURST_BUDGET_MIN, Math.ceil(videoCount * BURST_BUDGET_SHARE)));
}

/** The best-scoring `limit` near misses, so the list stays a few megabytes on any library. */
function keepBestNearMisses(nearMisses, limit = PENDING_LIST_LIMIT) {
  if (nearMisses.length <= limit) return nearMisses;
  return [...nearMisses].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/**
 * Stored burst → what the verifier reads. `framesJson` holds, per sample index, null or a list of
 * [offset in ms from the sample time, hash, mirrored hash, cropped hash, cropped mirrored hash].
 * Returns null for unreadable stored data, which then counts as no burst.
 */
function parseBurst(state, framesJson) {
  if (state !== 'ok') return { state: 'failed', samples: [] };
  let stored;
  try {
    stored = JSON.parse(framesJson);
  } catch {
    return null;
  }
  if (!Array.isArray(stored)) return null;
  const samples = stored.map((frames) => (Array.isArray(frames) && frames.length > 0
    ? frames.map(([offsetMs, hash, flipped, cropHash, cropFlipped]) => ({
        offset: Number(offsetMs) / 1000,
        full: { hash: parsePHashWords(hash), flippedHash: parsePHashWords(flipped ?? hash) },
        crop: cropHash ? { hash: parsePHashWords(cropHash), flippedHash: parsePHashWords(cropFlipped ?? cropHash) } : null,
      }))
    : null));
  return { state: 'ok', samples };
}

function sampleTime(samples, index, durationSecs) {
  const stored = samples[index].timestamp;
  if (stored !== null && stored !== undefined && Number.isFinite(Number(stored))) return Number(stored);
  return durationSecs > 0 ? ((index + 1) / (samples.length + 1)) * durationSecs : index;
}

// A burst's frames are evenly spaced, so the nearest one follows from the offset.
function nearestFrame(frames, offset) {
  if (frames.length < 2) return 0;
  const step = frames[1].offset - frames[0].offset;
  const index = Math.round((offset - frames[0].offset) / step);
  return Math.max(0, Math.min(frames.length - 1, index));
}

function scoreFrame(variantA, variantB, settings) {
  const score = pHashSampleScore(variantA, variantB, false);
  if (!settings.compareFlipped) return { score, flipped: false };
  const flippedScore = pHashSampleScore(variantA, variantB, true);
  return flippedScore > score ? { score: flippedScore, flipped: true } : { score, flipped: false };
}

/**
 * A's samples against B's burst. An alignment picks a burst frame at the first and at the last compared
 * position and interpolates the shift for the others; the two shifts may differ by the allowance plus
 * the share of the video between them times the difference in length. Returns the best alignment over
 * the border hypotheses, or null when fewer than two positions can be compared.
 */
function verifyDirection(samplesA, burstB, durationA, durationB, settings) {
  const positions = [];
  for (let i = 0; i < samplesA.length; i++) {
    if (isUsableSample(samplesA[i], settings) && burstB.samples[i]?.length) positions.push(i);
  }
  if (positions.length < 2) return null;

  const times = positions.map((index) => sampleTime(samplesA, index, durationA));
  const span = times[times.length - 1] - times[0];
  const lengthDifference = durationA > 0 && durationB > 0 ? Math.abs(durationA - durationB) : 0;
  const allowance = ALIGNMENT_ALLOWANCE_SECS + (durationA > 0 ? span / durationA : 1) * lengthDifference;
  const fractions = times.map((time) => (span > 0 ? (time - times[0]) / span : 0));
  const framesB = positions.map((index) => burstB.samples[index]);

  let best = null;
  for (const [cropA, cropB] of HYPOTHESES) {
    if ((cropA || cropB) && !settings.matchBlackBars) continue;
    const variantsA = positions.map((index) => (cropA ? samplesA[index].crop : samplesA[index].full));
    if (variantsA.some((variant) => !variant)) continue;
    if (framesB.some((frames) => frames.some((frame) => !(cropB ? frame.crop : frame.full)))) continue;
    const scored = framesB.map((frames, p) => frames.map((frame) => scoreFrame(variantsA[p], cropB ? frame.crop : frame.full, settings)));

    for (const first of framesB[0]) {
      for (const last of framesB[framesB.length - 1]) {
        if (Math.abs(last.offset - first.offset) > allowance + 1e-9) continue;
        const scores = [];
        let flipped = false;
        for (let p = 0; p < positions.length; p++) {
          const target = first.offset + (last.offset - first.offset) * fractions[p];
          const { score, flipped: mirrored } = scored[p][nearestFrame(framesB[p], target)];
          scores.push(score);
          flipped ||= mirrored;
        }
        // With requireEverySample this is the weakest position, so one position below the threshold
        // rejects the alignment, as on the direct path.
        const similarity = combineSampleScores(scores, settings);
        if (!best || similarity > best.similarity) {
          best = {
            similarity,
            compared: scores.length,
            flipped,
            borderAdjusted: cropA || cropB,
            shiftSecs: Math.round(((first.offset + last.offset) / 2) * 1000) / 1000,
          };
        }
      }
    }
  }
  return best;
}

/**
 * One near miss. `a` and `b` are `{ samples, burst, durationSecs }`, `burst` undefined while none was
 * extracted. Both directions are tried when both videos have a burst; the better one counts.
 * One usable burst settles the pair: 'accepted' at or above the threshold with enough compared
 * positions, 'rejected' below, 'unverifiable' when too few positions could be compared. Without one it
 * is 'pending' while a side has no burst yet, and 'unverifiable' when both failed.
 * SYNC NOTE: selectBurstVideos treats a pair as settled under the same rule.
 */
function verifyNearMiss(a, b, settings) {
  if (a.burst?.state !== 'ok' && b.burst?.state !== 'ok') {
    return { outcome: !a.burst || !b.burst ? 'pending' : 'unverifiable' };
  }
  const results = [];
  if (b.burst?.state === 'ok') results.push(verifyDirection(a.samples, b.burst, a.durationSecs, b.durationSecs, settings));
  if (a.burst?.state === 'ok') results.push(verifyDirection(b.samples, a.burst, b.durationSecs, a.durationSecs, settings));
  const best = results.filter(Boolean).sort((x, y) => y.similarity - x.similarity)[0];
  if (!best) return { outcome: 'unverifiable' };
  const needed = Math.max(2, minimumComparedSamples(settings, false));
  const accepted = best.similarity >= settings.finalSimilarityThreshold && best.compared >= needed;
  return { outcome: accepted ? 'accepted' : 'rejected', ...best };
}

/**
 * Videos to extract a burst for, at most `budget`: each time the video with the most near misses that
 * no usable burst settles yet, since one burst settles every near miss of its video. `burstState(id)`
 * is 'ok', 'failed' or undefined; a video whose burst failed is not read again, so its near misses wait
 * for the other video's burst.
 */
function selectBurstVideos(nearMisses, burstState, budget) {
  const counts = new Map();
  const pairsByVideo = new Map();
  nearMisses.forEach((pair, index) => {
    const ids = [pair.aId, pair.bId];
    if (ids.some((id) => burstState(id) === 'ok')) return;
    for (const id of ids) {
      if (burstState(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!pairsByVideo.has(id)) pairsByVideo.set(id, []);
      pairsByVideo.get(id).push(index);
    }
  });
  const settled = new Set();
  const chosen = [];
  while (chosen.length < budget && counts.size > 0) {
    let bestId = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        bestId = id;
        bestCount = count;
      }
    }
    chosen.push(bestId);
    counts.delete(bestId);
    for (const index of pairsByVideo.get(bestId)) {
      if (settled.has(index)) continue;
      settled.add(index);
      const pair = nearMisses[index];
      const other = pair.aId === bestId ? pair.bId : pair.aId;
      const remaining = (counts.get(other) ?? 0) - 1;
      if (remaining > 0) counts.set(other, remaining);
      else counts.delete(other);
    }
  }
  return chosen;
}

module.exports = {
  BURST_FRAME_COUNT,
  BURST_FPS,
  BURST_LEAD_SECS,
  MANY_NEAR_MISSES_PER_VIDEO,
  PENDING_LIST_LIMIT,
  nearMissVerificationEnabled,
  nearMissFloor,
  burstBudget,
  keepBestNearMisses,
  parseBurst,
  verifyDirection,
  verifyNearMiss,
  selectBurstVideos,
};
