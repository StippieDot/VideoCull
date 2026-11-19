const {
  graySampleScore,
  normalizeDuplicateSettings,
  parsePHashWords,
} = require('../../electron/duplicate-utils');
const {
  burstBudget,
  burstKind,
  keepBestNearMisses,
  nearMissFloor,
  nearMissVerificationEnabled,
  parseBurst,
  selectBurstVideos,
  verifyNearMiss,
} = require('../../electron/pair-verifier');

const OFFSETS = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1];

// A hash per seed, far from every other seed's hash.
function hashHex(seed) {
  let value = (BigInt(seed) * 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  value ^= value >> 29n;
  value = (value * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  return value.toString(16).padStart(16, '0');
}

// The hash with its `bits` lowest bits flipped: 64 - bits of 64 match.
function nearHex(hex, bits) {
  const mask = (1n << BigInt(bits)) - 1n;
  return (BigInt(`0x${hex}`) ^ mask).toString(16).padStart(16, '0');
}

function variant(hex, flippedHex = hex) {
  return { hash: parsePHashWords(hex), flippedHash: parsePHashWords(flippedHex) };
}

function samples(hexes, { duration = 100, crops = [], flipped = [] } = {}) {
  return hexes.map((hex, index) => ({
    index,
    darkRatio: 0,
    unreadable: hex === null,
    lumaRange: 100,
    timestamp: ((index + 1) / (hexes.length + 1)) * duration,
    full: hex ? variant(hex, flipped[index] ?? hex) : null,
    crop: crops[index] ? variant(crops[index]) : null,
  }));
}

/** A burst where the frame at offset `matchAt[i]` shows `hexes[i]`; every other frame is unrelated. */
function burst(hexes, matchAt) {
  return {
    state: 'ok',
    samples: hexes.map((hex, i) => OFFSETS.map((offset, k) => ({
      offset,
      full: variant(Math.abs(offset - matchAt[i]) < 1e-9 ? hex : hashHex(1000 + i * 20 + k)),
      crop: null,
    }))),
  };
}

const settings = (overrides = {}) => normalizeDuplicateSettings({ sampleCount: 3, ...overrides });
const A = [hashHex(1), hashHex(2), hashHex(3)];
const OTHER = [hashHex(7), hashHex(8), hashHex(9)];

describe('timing verification of near misses', () => {
  test('a constant shift is found and accepted', () => {
    const result = verifyNearMiss(
      { samples: samples(A), durationSecs: 100 },
      { samples: samples(OTHER), burst: burst(A, [0.6, 0.6, 0.6]), durationSecs: 100 },
      settings(),
    );
    expect(result).toMatchObject({ outcome: 'accepted', similarity: 100, compared: 3, shiftSecs: 0.6 });
  });

  test('a shift that grows over the video is accepted when the length difference explains it', () => {
    const b = { samples: samples(OTHER), burst: burst(A, [-0.4, 0, 0.4]) };
    // Positions at 25 % and 75 %: half the video lies between them, so 2 s longer allows 0.4 + 1 s.
    expect(verifyNearMiss({ samples: samples(A), durationSecs: 100 }, { ...b, durationSecs: 102 }, settings()).outcome).toBe('accepted');
    // Equal lengths allow 0.4 s between the first and the last shift, not 0.8 s.
    expect(verifyNearMiss({ samples: samples(A), durationSecs: 100 }, { ...b, durationSecs: 100 }, settings()).outcome).toBe('rejected');
  });

  test('a slow scene where every frame matches is accepted', () => {
    const still = { state: 'ok', samples: A.map((hex) => OFFSETS.map((offset) => ({ offset, full: variant(hex), crop: null }))) };
    const result = verifyNearMiss({ samples: samples(A), durationSecs: 100 }, { samples: samples(A), burst: still, durationSecs: 100 }, settings());
    expect(result).toMatchObject({ outcome: 'accepted', similarity: 100 });
  });

  test('fewer than two comparable positions make the pair unverifiable once a burst exists', () => {
    const partial = samples([A[0], null, null]);
    const withBurst = { samples: samples(A), burst: burst(A, [0, 0, 0]), durationSecs: 100 };
    expect(verifyNearMiss({ samples: partial, durationSecs: 100 }, withBurst, settings()).outcome).toBe('unverifiable');
  });

  test('a direction that compared enough positions goes before a higher score on too few', () => {
    const near = A.map((hex) => nearHex(hex, 2));
    // Against b's frames all 3 positions compare (62 of 64 bits); b's own third sample is unreadable,
    // so against a's frames only 2 compare, at 100 %.
    const a = { samples: samples(A), burst: burst(A, [0, 0, 0]), durationSecs: 100 };
    const b = { samples: samples([A[0], A[1], null]), burst: burst(near, [0, 0, 0]), durationSecs: 100 };
    const result = verifyNearMiss(a, b, settings({ minComparedSamples: 3, finalSimilarityThreshold: 95 }));
    expect(result).toMatchObject({ outcome: 'accepted', compared: 3 });
  });

  test('without a usable burst a pair is pending until both bursts failed', () => {
    const failed = { state: 'failed', samples: [] };
    expect(verifyNearMiss({ samples: samples(A) }, { samples: samples(A) }, settings())).toEqual({ outcome: 'pending' });
    expect(verifyNearMiss({ samples: samples(A), burst: failed }, { samples: samples(A) }, settings()).outcome).toBe('pending');
    expect(verifyNearMiss({ samples: samples(A), burst: failed }, { samples: samples(A), burst: failed }, settings()).outcome).toBe('unverifiable');
  });

  test('requireEverySample rejects an alignment with one weak position', () => {
    // Position 3 matches at 60 of 64 bits (93.75 %): the average passes, the weakest does not.
    const b = { samples: samples(OTHER), burst: burst([A[0], A[1], nearHex(A[2], 4)], [0.2, 0.2, 0.2]), durationSecs: 100 };
    expect(verifyNearMiss({ samples: samples(A), durationSecs: 100 }, b, settings()).outcome).toBe('accepted');
    expect(verifyNearMiss({ samples: samples(A), durationSecs: 100 }, b, settings({ requireEverySample: true })).outcome).toBe('rejected');
  });

  test('a mirrored copy is accepted only with mirrored comparison on', () => {
    // A's mirrored hashes are what B's burst shows.
    const a = { samples: samples([hashHex(90), hashHex(91), hashHex(92)], { flipped: A }), durationSecs: 100 };
    const b = { samples: samples(OTHER), burst: burst(A, [0, 0, 0]), durationSecs: 100 };
    expect(verifyNearMiss(a, b, settings({ compareFlipped: true }))).toMatchObject({ outcome: 'accepted', flipped: true });
    expect(verifyNearMiss(a, b, settings()).outcome).toBe('rejected');
  });

  test('the picture inside black bars is compared with matchBlackBars', () => {
    const a = { samples: samples([hashHex(40), hashHex(41), hashHex(42)], { crops: A }), durationSecs: 100 };
    const b = { samples: samples(OTHER), burst: burst(A, [0.4, 0.4, 0.4]), durationSecs: 100 };
    expect(verifyNearMiss(a, b, settings())).toMatchObject({ outcome: 'accepted', borderAdjusted: true });
    expect(verifyNearMiss(a, b, settings({ matchBlackBars: false })).outcome).toBe('rejected');
  });

  test('both directions are tried and the better one counts', () => {
    const a = { samples: samples(A), burst: burst(OTHER, [0.2, 0.2, 0.2]), durationSecs: 100 };
    const b = { samples: samples(OTHER), burst: burst([hashHex(60), hashHex(61), hashHex(62)], [0, 0, 0]), durationSecs: 100 };
    expect(verifyNearMiss(a, b, settings()).outcome).toBe('accepted');
  });

  test('stored bursts read back, and unreadable stored data counts as none', () => {
    const json = JSON.stringify([[[-1000, A[0], A[1], null, null], [0, A[0], null, A[2], null]], null, []]);
    const parsed = parseBurst('ok', json);
    expect(parsed.samples[0]).toHaveLength(2);
    expect(parsed.samples[0][0].offset).toBe(-1);
    expect(parsed.samples[0][1].crop.hash).toEqual(parsePHashWords(A[2]));
    expect(parsed.samples[1]).toBeNull();
    expect(parsed.samples[2]).toBeNull();
    expect(parseBurst('failed', null)).toEqual({ state: 'failed', samples: [] });
    expect(parseBurst('ok', '{')).toBeNull();
  });

  test('a gray burst reads back its frames and is verified with the Visual score', () => {
    const frame = (seed) => Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * seed + seed * 7) % 256));
    const json = JSON.stringify([0, 1, 2].map((index) => [-200, 0, 200].map((offsetMs) => [
      offsetMs,
      (offsetMs === 200 ? frame(index + 1) : frame(index + 50)).toString('base64'),
      null,
    ])));
    const burst = parseBurst('ok', json, 'gray');
    expect(Buffer.compare(burst.samples[1][2].full.bytes, frame(2))).toBe(0);
    const visual = settings({ comparisonMode: 'visual' });
    const graySamples = [0, 1, 2].map((index) => ({
      index, darkRatio: 0, unreadable: false, lumaRange: 200, timestamp: (index + 1) * 25, full: { bytes: frame(index + 1) }, crop: null,
    }));
    const result = verifyNearMiss({ samples: graySamples, durationSecs: 100 }, { samples: graySamples, burst, durationSecs: 100 }, visual, graySampleScore(visual));
    expect(result).toMatchObject({ outcome: 'accepted', similarity: 100, shiftSecs: 0.2 });
  });
});

describe('near-miss selection and budget', () => {
  test('the video with the most open near misses is extracted first', () => {
    const pairs = [
      { aId: 'x', bId: 'a' }, { aId: 'x', bId: 'b' }, { aId: 'c', bId: 'x' },
      { aId: 'y', bId: 'd' }, { aId: 'e', bId: 'f' },
    ];
    expect(selectBurstVideos(pairs, () => undefined, 1)).toEqual(['x']);
    expect(selectBurstVideos(pairs, () => undefined, 3)).toEqual(['x', 'y', 'e']);
    // A pair with a usable burst on either side is settled already.
    expect(selectBurstVideos(pairs, (id) => (id === 'x' || id === 'e' ? 'ok' : undefined), 5)).toEqual(['y']);
  });

  test('after a failed burst the other video of each near miss is read instead', () => {
    const pairs = [{ aId: 'x', bId: 'a' }, { aId: 'x', bId: 'b' }, { aId: 'f', bId: 'g' }];
    const state = (id) => ({ x: 'failed', f: 'failed', g: 'failed' })[id];
    expect(selectBurstVideos(pairs, state, 5)).toEqual(['a', 'b']);
  });

  test('runs with budget 1 settle every near miss in turn, then extract nothing', () => {
    const pairs = [{ aId: 'a', bId: 'b' }, { aId: 'c', bId: 'd' }, { aId: 'a', bId: 'c' }];
    const bursts = new Set();
    const runs = [];
    for (let run = 0; run < 4; run++) {
      const chosen = selectBurstVideos(pairs, (id) => (bursts.has(id) ? 'ok' : undefined), 1);
      runs.push(chosen);
      chosen.forEach((id) => bursts.add(id));
    }
    expect(runs).toEqual([['a'], ['c'], [], []]);
  });

  test('the budget is a tenth of the run, at least 20 and at most 200', () => {
    expect([5, 100, 1000, 10_000, 50_000].map(burstBudget)).toEqual([20, 20, 100, 200, 200]);
  });

  test('the pending list keeps the best-scoring near misses', () => {
    const list = [80, 90, 76, 85].map((similarity, i) => ({ aId: `a${i}`, bId: 'b', similarity }));
    expect(keepBestNearMisses(list, 2).map((pair) => pair.similarity)).toEqual([90, 85]);
    expect(keepBestNearMisses(list, 10)).toBe(list);
  });

  test('verification is off with one sample, with first-sample scoring and when switched off', () => {
    expect(nearMissVerificationEnabled(settings())).toBe(true);
    expect(nearMissVerificationEnabled(settings({ comparisonMode: 'visual' }))).toBe(true);
    // First-sample scoring is a pHash setting; Visual similarity always averages.
    expect(nearMissVerificationEnabled(settings({ comparisonMode: 'visual', phashFirstSampleOnly: true }))).toBe(true);
    expect(nearMissVerificationEnabled(settings({ sampleCount: 1 }))).toBe(false);
    expect(nearMissVerificationEnabled(settings({ phashFirstSampleOnly: true }))).toBe(false);
    expect(nearMissVerificationEnabled(settings({ verifyNearMatches: 'off' }))).toBe(false);
  });

  test('the band starts the chosen number of points below the similarity value', () => {
    expect(nearMissFloor(settings())).toBe(75);
    expect(nearMissFloor(settings({ nearMissRange: 10, phashSimilarityThreshold: 90 }))).toBe(80);
    // Visual similarity (90 by default) never looks further than 10 points down.
    expect(nearMissFloor(settings({ comparisonMode: 'visual', nearMissRange: 20 }))).toBe(80);
    expect(burstKind(settings({ comparisonMode: 'visual' }))).toBe('gray');
    expect(burstKind(settings())).toBe('hash');
    expect(settings({ nearMissRange: 17 }).nearMissRange).toBe(20);
  });
});
