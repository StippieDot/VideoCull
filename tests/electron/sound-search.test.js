const { WORDS_PER_SECOND } = require('../../electron/audio-fingerprint');
const { buildIndex, findSharedSound, matchingWindows, relationsFromWindows, searchIndex, unionLength } = require('../../electron/sound-search');

function randomWords(count, seed) {
  let state = seed >>> 0;
  return Uint32Array.from({ length: count }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state || 1;
  });
}

// A re-encoded copy: every other word has one bit flipped (about 98 % of bits agree).
function reencoded(words, seed = 3) {
  return words.map((word, i) => (i % 2 === 0 ? word : (word ^ (1 << ((i * seed) % 32))) >>> 0));
}

const concat = (...parts) => Uint32Array.from(parts.flatMap((part) => Array.from(part)));
const seconds = (s) => Math.round(s * WORDS_PER_SECOND);
const near = (value, expected) => Math.abs(value - expected) <= 1;

describe('shared sound search', () => {
  test('an excerpt is found at its offset with its length', () => {
    const source = randomWords(seconds(120), 1);
    const clip = reencoded(source.subarray(seconds(40), seconds(70)));
    const [relation, ...rest] = findSharedSound([
      { id: 'source', words: source },
      { id: 'clip', words: clip },
      { id: 'other', words: randomWords(seconds(90), 2) },
    ]);
    expect(rest).toEqual([]);
    expect(relation).toMatchObject({ aId: 'source', bId: 'clip' });
    expect(relation.segments).toHaveLength(1);
    const [segment] = relation.segments;
    expect(near(segment.startA, 40) && near(segment.startB, 0) && near(segment.lengthSecs, 30)).toBe(true);
    expect(relation.soundSimilarity).toBeGreaterThan(0.95);
  });

  test('two joined excerpts give two segments', () => {
    const source = randomWords(seconds(300), 4);
    const clip = concat(source.subarray(seconds(30), seconds(50)), source.subarray(seconds(250), seconds(270)));
    const [relation] = findSharedSound([{ id: 'source', words: source }, { id: 'clip', words: clip }]);
    expect(relation.segments.map((segment) => [Math.round(segment.startA), Math.round(segment.startB)])).toEqual([[30, 0], [250, 20]]);
    for (const segment of relation.segments) expect(near(segment.lengthSecs, 20)).toBe(true);
  });

  test('a chorus that occurs twice in the song is found at both places', () => {
    const chorus = randomWords(seconds(20), 5);
    const song = concat(randomWords(seconds(30), 6), chorus, randomWords(seconds(30), 7), chorus, randomWords(seconds(20), 8));
    const clip = reencoded(chorus);
    const [relation] = findSharedSound([{ id: 'song', words: song }, { id: 'clip', words: clip }]);
    expect(relation.segments.map((segment) => Math.round(segment.startA))).toEqual([30, 80]);
  });

  test('a word that is everywhere does not make unrelated tracks match', () => {
    // Half of every track is one word; the rest is unrelated.
    const common = 0x5a5a5a5a;
    const track = (seed) => randomWords(seconds(60), seed).map((word, i) => (i % 2 === 0 ? common : word));
    expect(findSharedSound([1, 2, 3, 4].map((seed) => ({ id: `t${seed}`, words: track(seed) })))).toEqual([]);
  });

  test('silent stretches and pairs to skip are not reported', () => {
    const source = randomWords(seconds(60), 9);
    const clip = source.slice(seconds(10), seconds(30));
    expect(findSharedSound([{ id: 'a', words: new Uint32Array(source.length) }, { id: 'b', words: new Uint32Array(source.length) }])).toEqual([]);
    expect(findSharedSound([{ id: 'a', words: source }, { id: 'b', words: clip }], { skipPairKeys: new Set(['a|b']) })).toEqual([]);
  });

  test('two tracks with the same sound throughout give one segment over all of it', () => {
    const sound = randomWords(seconds(40), 10);
    const [relation] = findSharedSound([{ id: 'a', words: sound }, { id: 'b', words: reencoded(sound) }], { minShare: 0.4 });
    expect(relation.segments).toHaveLength(1);
    expect(near(relation.segments[0].lengthSecs, 40)).toBe(true);
  });

  test('a clip that occurs twice in a longer video is found at both places', () => {
    const clip = randomWords(seconds(40), 21);
    const longer = concat(reencoded(clip), randomWords(seconds(5), 22), reencoded(clip, 5));
    const [relation] = findSharedSound([{ id: 'clip', words: clip }, { id: 'longer', words: longer }]);
    expect(relation.segments).toHaveLength(2);
    expect(unionLength([[0, 10], [5, 12], [20, 21]])).toBe(13);
  });

  test('a shared intro is too small a part of either video, an excerpt or a long overlap is not', () => {
    const intro = randomWords(seconds(15), 40);
    const withIntro = (seed) => concat(intro, randomWords(seconds(120), seed));
    const shareOnly = { minShare: 0.4 };
    expect(findSharedSound([{ id: 'a', words: withIntro(41) }, { id: 'b', words: withIntro(42) }], shareOnly)).toEqual([]);

    const source = randomWords(seconds(120), 43);
    expect(findSharedSound([{ id: 's', words: source }, { id: 'c', words: reencoded(source.subarray(seconds(30), seconds(60))) }], shareOnly)).toHaveLength(1);

    // Six shared minutes are a fifth of each 30-minute recording, and still reported.
    const overlap = randomWords(seconds(360), 44);
    const first = concat(randomWords(seconds(1440), 45), overlap);
    const second = concat(reencoded(overlap), randomWords(seconds(1440), 46));
    expect(findSharedSound([{ id: 'x', words: first }, { id: 'y', words: second }], shareOnly)).toHaveLength(1);
  });

  test('sound found in more tracks than the common limit is skipped and counted', () => {
    const jingle = randomWords(seconds(20), 50);
    const tracks = [51, 52, 53, 54].map((seed) => ({ id: `t${seed}`, words: concat(jingle, randomWords(seconds(40), seed)) }));
    const index = searchIndex(tracks, buildIndex(tracks));
    expect(matchingWindows(tracks, index, { commonLimit: 2 })).toMatchObject({ pairs: [], commonTracks: 4 });
    // At the limit it is still searched: three other tracks, limit three.
    expect(matchingWindows(tracks, index, { commonLimit: 3 }).pairs).toHaveLength(6);
  });

  test('a search split into shards over a shared index finds what one search finds', () => {
    const source = randomWords(seconds(200), 31);
    const tracks = [
      { id: 's', words: source },
      { id: 'c1', words: reencoded(source.subarray(seconds(20), seconds(60))) },
      { id: 'c2', words: concat(source.subarray(seconds(100), seconds(130)), randomWords(seconds(20), 32)) },
      { id: 'u', words: randomWords(seconds(80), 33) },
      { id: 'c3', words: reencoded(source.subarray(seconds(150), seconds(190)), 7) },
    ];
    const index = searchIndex(tracks, buildIndex(tracks, { shared: true }));
    const sharded = relationsFromWindows(tracks, [0, 1, 2].map((i) => matchingWindows(tracks, index, { shard: [i, 3] }).pairs));
    expect(sharded.length).toBe(3);
    expect(sharded).toEqual(findSharedSound(tracks));
  });

  test('stretches shorter than 10 seconds are not reported', () => {
    const source = randomWords(seconds(60), 11);
    expect(findSharedSound([{ id: 'a', words: source }, { id: 'b', words: source.slice(seconds(10), seconds(17)) }])).toEqual([]);
  });
});
