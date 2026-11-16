const { WORDS_PER_SECOND } = require('../../electron/audio-fingerprint');
const { findSharedSound } = require('../../electron/sound-search');

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
    expect(relation).toMatchObject({ aId: 'source', bId: 'clip', fullCoverage: false });
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

  test('two tracks with the same sound throughout are marked as fully covered', () => {
    const sound = randomWords(seconds(40), 10);
    const [relation] = findSharedSound([{ id: 'a', words: sound }, { id: 'b', words: reencoded(sound) }]);
    expect(relation.fullCoverage).toBe(true);
  });

  test('stretches shorter than 10 seconds are not reported', () => {
    const source = randomWords(seconds(60), 11);
    expect(findSharedSound([{ id: 'a', words: source }, { id: 'b', words: source.slice(seconds(10), seconds(17)) }])).toEqual([]);
  });
});
