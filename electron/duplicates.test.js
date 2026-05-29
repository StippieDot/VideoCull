const test = require('node:test');
const assert = require('node:assert/strict');
const { __test__ } = require('./duplicates');
const { normalizeDuplicateSettings } = require('./duplicate-utils');

function video(id) {
  return {
    id,
    filename: `${id}.mp4`,
    path: `P:\\${id}.mp4`,
    width: 1920,
    height: 1080,
    videoBitrate: 2000000,
    durationSecs: 100,
    fps: 30,
    sizeBytes: 1000,
  };
}

test('daisy-chain validation splits weak connected duplicate groups', () => {
  const videos = ['a', 'b', 'c', 'd', 'e'].map(video);
  const videosById = new Map(videos.map((item) => [item.id, item]));
  const settings = normalizeDuplicateSettings({ finalSimilarityThreshold: 95, comparisonMode: 'phash' });
  const chainPairs = [
    { aId: 'a', bId: 'b', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'c', similarity: 96, matchType: 'phash' },
    { aId: 'c', bId: 'd', similarity: 96, matchType: 'phash' },
    { aId: 'd', bId: 'e', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'd', similarity: 96, matchType: 'phash' },
  ];

  const groups = __test__.buildGroups([], chainPairs, videosById, settings);
  const groupedIds = groups.map((group) => group.videoIds.toSorted());

  assert.equal(groups.length, 2);
  assert.deepEqual(groupedIds, [['a', 'b'], ['c', 'd']]);
});

test('daisy-chain cleanup can drop weak members after similarity is recomputed', () => {
  const videos = ['a', 'b', 'c'].map(video);
  const videosById = new Map(videos.map((item) => [item.id, item]));
  const settings = normalizeDuplicateSettings({ finalSimilarityThreshold: 95, comparisonMode: 'phash' });
  const matchedPairs = [
    { aId: 'a', bId: 'b', similarity: 96, matchType: 'phash' },
    { aId: 'a', bId: 'c', similarity: 96, matchType: 'phash' },
    { aId: 'b', bId: 'c', similarity: 96, matchType: 'phash' },
  ];

  const groups = __test__.buildGroups([], matchedPairs, videosById, settings, {
    revalidateSimilarity(aId, bId) {
      const key = [aId, bId].toSorted().join('|');
      if (key === 'a|b') return 96;
      return 80;
    },
  });

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].videoIds.toSorted(), ['a', 'b']);
});
