const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { calculateDctPHash, flipGrayBytes, normalizeDuplicateSettings } = require('../../electron/duplicate-utils');

const FRAME_BYTES = 64 * 96;
const modulePaths = ['duplicates', 'media-process'].map((name) => require.resolve(`../../electron/${name}`));

// The primary 32×32 picture sits in the top-left of each stacked 64-wide frame.
function primary(seed) {
  const bytes = Buffer.alloc(1024);
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) bytes[row * 32 + col] = (row * 8 * seed + col * 3 + seed * 17) % 256;
  }
  return bytes;
}

function stackedFrame(seed) {
  const frame = Buffer.alloc(FRAME_BYTES);
  const picture = primary(seed);
  for (let row = 0; row < 32; row++) picture.copy(frame, row * 64, row * 32, row * 32 + 32);
  return frame;
}

// FFmpeg stand-in: every call returns `frames` copies of the picture with seed 1 (none for 0).
function loadDuplicates(frames = 61) {
  const calls = [];
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGKILL'));
    calls.push(args);
    setImmediate(() => {
      if (frames > 0) child.stdout.emit('data', Buffer.concat(Array.from({ length: frames }, () => stackedFrame(1))));
      child.emit('close', 0, null);
    });
    return child;
  };
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  try {
    return { duplicates: require('../../electron/duplicates'), calls };
  } finally {
    childProcess.spawn = realSpawn;
    for (const modulePath of modulePaths) delete require.cache[modulePath];
  }
}

function memoryCache() {
  const bursts = new Map();
  return {
    bursts,
    loadVideoBursts: async (_folder, _options, ids, key) => ids.map((id) => bursts.get(id)).filter((row) => row?.burst_key === key),
    saveVideoBurst: async (_folder, _options, id, key, state, framesJson) => {
      bursts.set(id, { video_id: id, burst_key: key, state, frames_json: framesJson });
    },
  };
}

const video = (id) => ({ id, filename: `${id}.mp4`, path: `P:\\${id}.mp4`, durationSecs: 100 });

function rows(id, seed) {
  return [0, 1].map((index) => ({
    video_id: id,
    sample_index: index,
    timestamp_secs: (index + 1) * 33,
    phash_hex: calculateDctPHash(primary(seed)),
    flipped_phash_hex: calculateDctPHash(flipGrayBytes(primary(seed))),
    frame_dark_ratio: 0,
    luma_range: 200,
    border_ltrb: null,
  }));
}

const settings = normalizeDuplicateSettings({ comparisonMode: 'phash', sampleCount: 2 });

function verify(duplicates, cacheAccess, nearMisses, videos, allRows, options = {}) {
  return duplicates.__test__.verifyNearMisses({
    comparison: { nearMisses, nearMissCount: options.nearMissCount ?? nearMisses.length },
    videos,
    rows: allRows,
    settings: options.settings ?? settings,
    videoCount: options.videoCount ?? videos.length,
    checkAll: options.checkAll ?? false,
    run: duplicates.createDuplicateRun(),
    sendProgress: undefined,
    maxConcurrency: 2,
    executionOptions: {},
    cacheAccess,
    cacheOptions: {},
  });
}

describe('double-checking near misses', () => {
  test('a near miss is accepted from a stored burst, and the next run reads nothing', async () => {
    const { duplicates, calls } = loadDuplicates();
    const cache = memoryCache();
    // b shows the burst's picture; a's own samples differ, so only a's burst can confirm the pair.
    const pair = { aId: 'a', bId: 'b', similarity: 80 };
    const all = [...rows('a', 5), ...rows('b', 1)];

    const first = await verify(duplicates, cache, [pair], [video('a'), video('b')], all);
    expect(first.stats).toMatchObject({ candidates: 1, accepted: 1, rejected: 0, pending: 0, complete: true });
    expect(first.acceptedPairs).toEqual([expect.objectContaining({ aId: 'a', bId: 'b', pHashSimilarity: 100, timingAdjusted: true })]);
    // One call per sample position.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(['-vf', expect.stringMatching(/^fps=30,/)]));
    expect(cache.bursts.get('a').state).toBe('ok');

    const second = await verify(duplicates, cache, [pair], [video('a'), video('b')], all);
    expect(second.stats.accepted).toBe(1);
    expect(calls).toHaveLength(2);
  });

  test('a normal run reads at most its budget and reports the rest as pending', async () => {
    const { duplicates } = loadDuplicates(3);
    const videos = Array.from({ length: 50 }, (_, i) => video(`v${i}`));
    const pairs = Array.from({ length: 25 }, (_, i) => ({ aId: `v${2 * i}`, bId: `v${2 * i + 1}`, similarity: 80 }));
    const all = videos.flatMap((entry) => rows(entry.id, 3));

    const limited = await verify(duplicates, memoryCache(), pairs, videos, all, { videoCount: 100 });
    expect(limited.stats).toMatchObject({ candidates: 25, pending: 5, complete: false });

    const unlimited = await verify(duplicates, memoryCache(), pairs, videos, all, { videoCount: 100, checkAll: true });
    expect(unlimited.stats).toMatchObject({ pending: 0, complete: true });
  });

  test('a failed burst is stored, the other video is read next, and two failures end it', async () => {
    const { duplicates, calls } = loadDuplicates(0);
    const cache = memoryCache();
    const pair = { aId: 'a', bId: 'b', similarity: 80 };
    const all = [...rows('a', 5), ...rows('b', 1)];

    const first = await verify(duplicates, cache, [pair], [video('a'), video('b')], all);
    expect(cache.bursts.get('a').state).toBe('failed');
    expect(first.stats).toMatchObject({ pending: 1, complete: false });

    const second = await verify(duplicates, cache, [pair], [video('a'), video('b')], all);
    expect(cache.bursts.get('b').state).toBe('failed');
    expect(second.stats).toMatchObject({ unverifiable: 1, pending: 0, complete: true });
    const callsAfterTwoRuns = calls.length;

    await verify(duplicates, cache, [pair], [video('a'), video('b')], all);
    expect(calls).toHaveLength(callsAfterTwoRuns);
  });

  test('pairs marked as not a match are not checked, and pairs beyond the list count as pending', async () => {
    const { duplicates, calls } = loadDuplicates();
    const a = '000000000000000a';
    const b = '000000000000000b';
    const ignored = normalizeDuplicateSettings({ ...settings, ignoredDuplicatePairs: [`${a}|${b}`] });
    const result = await verify(duplicates, memoryCache(), [{ aId: a, bId: b, similarity: 80 }], [video(a), video(b)], [], {
      settings: ignored,
      nearMissCount: 3,
    });
    expect(calls).toHaveLength(0);
    expect(result.stats).toMatchObject({ candidates: 2, pending: 2, complete: false });
  });

  test('a group of three with one verified link keeps every member at or above the threshold', () => {
    const { duplicates } = loadDuplicates();
    const { buildGroups, createSimilarityRevalidator } = duplicates.__test__;
    // b and c each differ from a by a few bits, and from each other by more than the threshold allows.
    const flip = (hex, mask) => (BigInt(`0x${hex}`) ^ mask).toString(16).padStart(16, '0');
    const base = calculateDctPHash(primary(1));
    const hashes = { a: base, b: flip(base, 0b11n), c: flip(base, 0b11100n) };
    const allRows = Object.entries(hashes).flatMap(([id, hash]) => [0, 1].map((index) => ({
      video_id: id, sample_index: index, phash_hex: hash, flipped_phash_hex: hash, frame_dark_ratio: 0, luma_range: 200,
    })));
    const videosById = new Map(['a', 'b', 'c'].map((id) => [id, { ...video(id), width: 1920, height: 1080 }]));
    const pair = (aId, bId, similarity, extra = {}) => ({ aId, bId, similarity, matchType: 'phash', comparedSamples: 2, ...extra });
    const pairs = [pair('a', 'b', 96.875), pair('a', 'c', 95.3125), pair('b', 'c', 96, { timingAdjusted: true })];
    const verifiedScores = new Map([['b\0c', 96]]);
    const revalidate = createSimilarityRevalidator(settings, { mode: 'phash', rows: allRows, verifiedScores });

    const groups = buildGroups([], pairs, videosById, settings, { revalidateSimilarity: revalidate });
    expect(groups).toHaveLength(1);
    expect([...groups[0].videoIds].sort()).toEqual(['a', 'b', 'c']);
    expect(groups[0].similarity).toBeGreaterThanOrEqual(95);
    expect(groups[0].timingAdjusted).toBe(true);
    // Recomputed while a chain is split, the verified score wins over the direct one (92 %).
    expect(revalidate('b', 'c')).toBe(96);
    expect(revalidate.score('c', 'b')).toBe(96);
    expect(createSimilarityRevalidator(settings, { mode: 'phash', rows: allRows })('b', 'c')).toBeNull();
  });
});
