// Finds stretches of sound that two videos share, from their sound words (audio-fingerprint.js).
// Each video's sound is cut into 10-second windows every 5 seconds; a window looks up its words in an
// index of every 4th word of all videos, the hits vote for a time offset, and an offset with enough
// votes is checked word by word. Matching windows at one offset merge into a segment, whose edges are
// then found to within a word (about 0.12 s).
const { WORDS_PER_SECOND } = require('./audio-fingerprint');

const INDEX_STEP = 4;
// Words more common than this share of all indexed positions carry no information, like blank frames.
const COMMON_WORD_SHARE = 0.01;
const WINDOW_WORDS = 81;
const WINDOW_STEP = 40;
// A window that is mostly silent, or repeats few words (a drone inside a normal track), is not used.
const WINDOW_MAX_ZERO_SHARE = 0.5;
const WINDOW_MIN_DISTINCT_SHARE = 0.2;
// One offset (± 2 words) needs this many votes before the window is checked. Measured: 14 votes for a
// 20 s excerpt, 0–1 for unrelated pairs.
const VOTE_SPREAD = 2;
const MIN_VOTES = 4;
const REFINE_WORDS = 4;
// Bits that must agree. Measured: 94–98 % related, at most 59 % unrelated and 71 % at a wrong offset
// inside the same film.
const MATCH_SIMILARITY = 0.85;
// Windows whose offsets differ by at most this many words (0.5 s) belong to one segment.
const MERGE_OFFSET_WORDS = 4;
const EDGE_BLOCK_WORDS = 16;
const EDGE_SIMILARITY = 0.8;
const MIN_SEGMENT_WORDS = WINDOW_WORDS;
// Segments covering this much of both videos make them duplicates, which the duplicate run handles.
const FULL_COVERAGE = 0.95;

function popcount(x) {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function pairKey(aId, bId) {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

const bucketHash = (bits) => {
  const shift = 32 - bits;
  return (word) => Math.imul(word, 0x9e3779b1) >>> shift;
};

/**
 * Every 4th word of every track, bucketed by a hash of the word. Holds only track and position (8 bytes
 * per entry); a lookup confirms the word against the track itself. With `shared` the arrays live in
 * shared memory, so search workers can use one index (see `searchIndex`).
 */
function buildIndex(tracks, { shared = false } = {}) {
  const allocate = (length) => (shared ? new Uint32Array(new SharedArrayBuffer(length * 4)) : new Uint32Array(length));
  let total = 0;
  for (const track of tracks) total += Math.ceil(track.words.length / INDEX_STEP);
  const bits = Math.max(10, Math.min(24, Math.ceil(Math.log2(Math.max(1, total / 4)))));
  const bucketCount = 1 << bits;
  const bucketOf = bucketHash(bits);

  const starts = allocate(bucketCount + 1);
  let indexed = 0;
  for (const track of tracks) {
    for (let p = 0; p < track.words.length; p += INDEX_STEP) {
      if (track.words[p] === 0) continue;
      starts[bucketOf(track.words[p]) + 1]++;
      indexed++;
    }
  }
  for (let b = 0; b < bucketCount; b++) starts[b + 1] += starts[b];
  const fill = starts.slice(0, bucketCount);
  const entryTrack = allocate(indexed);
  const entryPosition = allocate(indexed);
  tracks.forEach((track, t) => {
    for (let p = 0; p < track.words.length; p += INDEX_STEP) {
      const word = track.words[p];
      if (word === 0) continue;
      const slot = fill[bucketOf(word)]++;
      entryTrack[slot] = t;
      entryPosition[slot] = p;
    }
  });

  // Only a bucket larger than the limit can hold a common word, so only those are counted exactly.
  const limit = Math.max(MIN_VOTES, indexed * COMMON_WORD_SHARE);
  const common = new Set();
  for (let b = 0; b < bucketCount; b++) {
    if (starts[b + 1] - starts[b] <= limit) continue;
    const counts = new Map();
    for (let e = starts[b]; e < starts[b + 1]; e++) {
      const word = tracks[entryTrack[e]].words[entryPosition[e]];
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    for (const [word, count] of counts) if (count > limit) common.add(word);
  }
  return { bits, starts, entryTrack, entryPosition, common: [...common] };
}

/** Lookups in an index from `buildIndex`, also one passed to a worker. */
function searchIndex(tracks, { bits, starts, entryTrack, entryPosition, common }) {
  const bucketOf = bucketHash(bits);
  const commonWords = new Set(common);
  return {
    /** Calls `visit(track, position)` for every indexed occurrence of `word`. */
    forEach(word, visit) {
      if (word === 0 || commonWords.has(word)) return;
      const bucket = bucketOf(word);
      for (let e = starts[bucket]; e < starts[bucket + 1]; e++) {
        const t = entryTrack[e];
        if (tracks[t].words[entryPosition[e]] === word) visit(t, entryPosition[e]);
      }
    },
  };
}

function usableWindow(words, start) {
  let zeros = 0;
  const distinct = new Set();
  for (let i = start; i < start + WINDOW_WORDS; i++) {
    if (words[i] === 0) zeros++;
    distinct.add(words[i]);
  }
  return zeros / WINDOW_WORDS <= WINDOW_MAX_ZERO_SHARE && distinct.size / WINDOW_WORDS >= WINDOW_MIN_DISTINCT_SHARE;
}

/** Share of agreeing bits between `length` words of a from `startA` and of b at `startA + offset`. */
function similarityAt(a, b, startA, offset, length, minimumPairs) {
  let bits = 0;
  let pairs = 0;
  for (let i = startA; i < startA + length; i++) {
    const j = i + offset;
    if (i < 0 || i >= a.length || j < 0 || j >= b.length) continue;
    if (a[i] === 0 || b[j] === 0) continue;
    bits += popcount(a[i] ^ b[j]);
    pairs++;
  }
  return pairs >= minimumPairs ? 1 - bits / (pairs * 32) : 0;
}

/** Offsets in other tracks that collect enough votes for the window of track `a` starting at `start`. */
// Votes are kept per track, keyed by offset: small integer keys, which a Map handles far faster than one
// key combining track and offset. Per track the offsets are visited in first-vote order, so ties go to
// the same offset as with a single map.
function candidateOffsets(tracks, index, a, start) {
  const votesByTrack = new Map();
  const words = tracks[a].words;
  for (let i = start; i < start + WINDOW_WORDS; i++) {
    index.forEach(words[i], (t, position) => {
      if (t === a) return;
      let votes = votesByTrack.get(t);
      if (!votes) {
        votes = new Map();
        votesByTrack.set(t, votes);
      }
      const offset = position - i;
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
    });
  }
  const candidates = [];
  for (const [t, votes] of votesByTrack) {
    let best = 0;
    let bestOffset = 0;
    for (const offset of votes.keys()) {
      let total = 0;
      for (let d = -VOTE_SPREAD; d <= VOTE_SPREAD; d++) total += votes.get(offset + d) ?? 0;
      if (total >= MIN_VOTES && total > best) {
        best = total;
        bestOffset = offset;
      }
    }
    if (best > 0) candidates.push({ t, offset: bestOffset });
  }
  return candidates;
}

/**
 * Matching windows of every pair, oriented from the lower to the higher track index, as
 * `[{ lo, hi, windows }]`. With `shard: [i, n]` only the windows of every n-th track from i are searched;
 * the windows of all n shards together are those of one full search.
 */
function matchingWindows(tracks, index, { onProgress, shard = [0, 1] } = {}) {
  const [first, step] = shard;
  const byPair = new Map();
  let done = 0;
  for (let a = first; a < tracks.length; a += step) {
    const track = tracks[a];
    for (let start = 0; start + WINDOW_WORDS <= track.words.length; start += WINDOW_STEP) {
      if (!usableWindow(track.words, start)) continue;
      for (const { t, offset } of candidateOffsets(tracks, index, a, start)) {
        let best = { similarity: 0, offset };
        for (let r = -REFINE_WORDS; r <= REFINE_WORDS; r++) {
          const similarity = similarityAt(track.words, tracks[t].words, start, offset + r, WINDOW_WORDS, WINDOW_WORDS * 0.6);
          if (similarity > best.similarity) best = { similarity, offset: offset + r };
        }
        if (best.similarity < MATCH_SIMILARITY) continue;
        const [lo, hi] = a < t ? [a, t] : [t, a];
        // Positions in the lower track, offset from it to the higher one.
        const window = a < t
          ? { start, offset: best.offset, similarity: best.similarity }
          : { start: start + best.offset, offset: -best.offset, similarity: best.similarity };
        const key = lo * tracks.length + hi;
        if (!byPair.has(key)) byPair.set(key, { lo, hi, windows: [] });
        byPair.get(key).windows.push(window);
      }
    }
    onProgress?.(++done);
  }
  return [...byPair.values()];
}

function mergeWindows(windows) {
  const sorted = [...windows].sort((x, y) => x.offset - y.offset || x.start - y.start);
  const segments = [];
  for (const window of sorted) {
    const end = window.start + WINDOW_WORDS;
    const segment = segments.find((s) => Math.abs(s.offset - window.offset) <= MERGE_OFFSET_WORDS
      && window.start <= s.end + WINDOW_STEP && end >= s.start - WINDOW_STEP);
    if (segment) {
      segment.start = Math.min(segment.start, window.start);
      segment.end = Math.max(segment.end, end);
      segment.offsets.push(window.offset);
    } else {
      segments.push({ start: window.start, end, offset: window.offset, offsets: [window.offset] });
    }
  }
  return segments.map((segment) => {
    const offsets = [...segment.offsets].sort((x, y) => x - y);
    return { start: segment.start, end: segment.end, offset: offsets[Math.floor(offsets.length / 2)] };
  });
}

/** Segments at one offset that overlap once their edges are refined are one stretch of sound. */
function mergeOverlapping(segments) {
  const merged = [];
  for (const segment of [...segments].sort((x, y) => x.start - y.start)) {
    const previous = merged.find((other) => Math.abs(other.offset - segment.offset) <= MERGE_OFFSET_WORDS
      && segment.start <= other.end && segment.end >= other.start);
    if (previous) {
      previous.start = Math.min(previous.start, segment.start);
      if (segment.end >= previous.end) previous.atTrackEnd = segment.atTrackEnd;
      previous.end = Math.max(previous.end, segment.end);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/**
 * Moves the segment's edges to where its sound stops matching, to within a word. Word p matches when
 * the block of words around it does, so an edge lands where the block's centre crosses it.
 */
function refineEdges(a, b, segment) {
  const half = EDGE_BLOCK_WORDS / 2;
  const wordMatches = (p) => similarityAt(a, b, p - half, segment.offset, EDGE_BLOCK_WORDS, half) >= EDGE_SIMILARITY;
  const first = Math.max(0, -segment.offset);
  const last = Math.min(a.length, b.length - segment.offset);
  let start = Math.max(first, segment.start);
  while (start - 1 >= first && wordMatches(start - 1)) start--;
  while (start < segment.end - EDGE_BLOCK_WORDS && !wordMatches(start)) start++;
  let end = Math.min(segment.end, last);
  while (end < last && wordMatches(end)) end++;
  while (end > start + EDGE_BLOCK_WORDS && !wordMatches(end - 1)) end--;
  return { start, end, atTrackEnd: end >= last };
}

/** Total length of `[start, end]` intervals, counting overlapping parts once. */
function unionLength(intervals) {
  let total = 0;
  let reach = -Infinity;
  for (const [start, end] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (end > reach) total += end - Math.max(start, reach);
    reach = Math.max(reach, end);
  }
  return total;
}

// A word starts at its frame and covers the frame plus the smoothing that follows it, so a stretch that
// runs to the end of a track lasts this much past the start of its last word.
const LAST_WORD_SPAN_SECS = (4096 + 4 * 1365) / 11025;

/**
 * The pairs that share sound, from the matching windows of every shard (`matchingWindows`), each with
 * its segments in seconds (start in a, start in b, length) and their average bit similarity. Pairs in
 * `skipPairKeys` (duplicates, pairs marked as not a match) are left out; `fullCoverage` marks pairs whose
 * segments cover almost all of both videos.
 */
function relationsFromWindows(tracks, shardPairs, skipPairKeys = new Set()) {
  const byPair = new Map();
  for (const pairs of shardPairs) {
    for (const { lo, hi, windows } of pairs) {
      const key = lo * tracks.length + hi;
      if (byPair.has(key)) byPair.get(key).windows.push(...windows);
      else byPair.set(key, { lo, hi, windows: [...windows] });
    }
  }
  const relations = [];
  for (const { lo, hi, windows } of [...byPair.values()].sort((x, y) => x.lo - y.lo || x.hi - y.hi)) {
    const a = tracks[lo];
    const b = tracks[hi];
    if (skipPairKeys.has(pairKey(a.id, b.id))) continue;
    const refined = mergeWindows(windows).map((segment) => ({ ...segment, ...refineEdges(a.words, b.words, segment) }));
    const segments = mergeOverlapping(refined)
      .map(({ start, end, offset, atTrackEnd }) => ({
        startA: start / WORDS_PER_SECOND,
        startB: (start + offset) / WORDS_PER_SECOND,
        lengthSecs: atTrackEnd ? (end - 1 - start) / WORDS_PER_SECOND + LAST_WORD_SPAN_SECS : (end - start) / WORDS_PER_SECOND,
        similarity: similarityAt(a.words, b.words, start, offset, end - start, 1),
        words: end - start,
        startWord: start,
        offset,
      }))
      .filter((segment) => segment.words >= MIN_SEGMENT_WORDS)
      .sort((x, y) => x.startA - y.startA);
    if (segments.length === 0) continue;
    const covered = segments.reduce((sum, segment) => sum + segment.words, 0);
    // Counted per video: a clip that occurs twice in a longer video covers the clip, not the video.
    const coveredA = unionLength(segments.map((segment) => [segment.startWord, segment.startWord + segment.words]));
    const coveredB = unionLength(segments.map((segment) => [segment.startWord + segment.offset, segment.startWord + segment.offset + segment.words]));
    relations.push({
      aId: a.id,
      bId: b.id,
      // With matching pictures such a pair is a duplicate, which the duplicate run reports; with other
      // pictures it is shared sound worth reporting. The caller decides after the picture check.
      fullCoverage: coveredA >= FULL_COVERAGE * a.words.length && coveredB >= FULL_COVERAGE * b.words.length,
      segments: segments.map(({ words: _words, startWord: _startWord, offset: _offset, ...segment }) => segment),
      soundSimilarity: segments.reduce((sum, segment) => sum + segment.similarity * segment.words, 0) / covered,
    });
  }
  return relations;
}

/** `tracks`: `{ id, words }` of videos whose sound is usable. The whole search on this thread. */
function findSharedSound(tracks, { skipPairKeys = new Set(), onProgress } = {}) {
  const index = searchIndex(tracks, buildIndex(tracks));
  return relationsFromWindows(tracks, [matchingWindows(tracks, index, { onProgress })], skipPairKeys);
}

module.exports = { buildIndex, findSharedSound, matchingWindows, pairKey, relationsFromWindows, searchIndex, unionLength };
