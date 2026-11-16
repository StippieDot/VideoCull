import { describeDuplicateRun, restoreStoredResults, toStoredResults } from '../../src/duplicateResultsPersistence';
import type { DuplicateGroupPair, StoredDuplicateResults } from '../../src/types';
import { makeDuplicateGroup, makeVideo } from '../helpers/videoFactory';

const pair = (aId: string, bId: string, similarity: number): DuplicateGroupPair => ({
  aId, bId, similarity, matchType: 'phash', comparedSamples: 3, confidence: 'normal',
});

function stored(overrides: Partial<StoredDuplicateResults> = {}): StoredDuplicateResults {
  const videos = ['a', 'b', 'c', 'd'].map((id) => makeVideo(id, { date: 10, sizeBytes: 5 }));
  const run = describeDuplicateRun(videos, 'key', 'all', 1_700_000_000_000);
  return {
    ...toStoredResults(run, [makeDuplicateGroup({
      id: 'dup-0000000000000001', videoIds: ['a', 'b', 'c'], sampleCount: 3, matchType: 'phash', manualSuggestedKeeperId: 'c',
      pairs: [pair('a', 'b', 99), pair('b', 'c', 97), pair('a', 'c', 96)],
    })]),
    ...overrides,
  };
}

describe('stored duplicate results', () => {
  test('a group without stored pairs is not written', () => {
    const run = describeDuplicateRun([makeVideo('a')], 'key', 'all');
    expect(toStoredResults(run, [makeDuplicateGroup({ videoIds: ['a', 'b'] })]).groups).toEqual([]);
  });

  test('unchanged videos bring the groups back with their score and manual keeper', () => {
    const videos = ['a', 'b', 'c', 'd'].map((id) => makeVideo(id, { date: 10, sizeBytes: 5 }));
    const { groups, run } = restoreStoredResults(stored(), videos, []);
    expect(groups.map((group) => [group.videoIds, group.similarity, group.manualSuggestedKeeperId])).toEqual([[['a', 'b', 'c'], 96, 'c']]);
    expect(run).toMatchObject({ restored: true, addedSince: 0, createdAt: 1_700_000_000_000 });
  });

  test('a member that is gone or changed is removed and its group rebuilt', () => {
    const videos = [makeVideo('a', { date: 10 }), makeVideo('b', { date: 99 }), makeVideo('c', { date: 10 })];
    const { groups, run } = restoreStoredResults(stored(), videos, []);
    expect(groups.map((group) => [group.videoIds, group.similarity, group.manualSuggestedKeeperId])).toEqual([[['a', 'c'], 96, 'c']]);
    expect(run.videos.map((video) => video.id)).toEqual(['a', 'c']);
  });

  test('a pair marked as not a match since is removed', () => {
    const videos = ['a', 'b', 'c', 'd'].map((id) => makeVideo(id, { date: 10 }));
    const { groups } = restoreStoredResults(stored(), videos, ['a|c', 'b|c']);
    expect(groups.map((group) => group.videoIds)).toEqual([['a', 'b']]);
  });

  test('partial clips are stored and come back unless a video changed or the pair was dismissed', () => {
    const clip = (aId: string, bId: string) => ({
      aId, bId, relation: 'partial' as const, state: 'confirmed' as const, shorterId: bId,
      segments: [{ startA: 10, startB: 0, lengthSecs: 20, soundSimilarity: 96, pictureState: 'confirmed' as const, pictureSimilarity: 99 }],
      coverage: 1, soundSimilarity: 96, pictureSimilarity: 99,
    });
    const videos = ['a', 'b', 'c', 'd'].map((id) => makeVideo(id, { date: 10, sizeBytes: 5 }));
    const run = describeDuplicateRun(videos, 'key', 'all');
    const file = toStoredResults(run, [], [clip('a', 'd'), clip('b', 'd'), clip('c', 'd')]);
    expect(file.partialClips).toHaveLength(3);
    expect(toStoredResults(run, [], null).partialClips).toBeUndefined();

    const changed = videos.map((video) => (video.id === 'b' ? { ...video, date: 99 } : video));
    const { partialClips } = restoreStoredResults(file, changed, ['c|d']);
    expect(partialClips?.map((entry) => entry.aId)).toEqual(['a']);
  });

  test('new videos are counted for a full run and not for a filtered one', () => {
    const videos = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makeVideo(id, { date: 10 }));
    expect(restoreStoredResults(stored(), videos, []).run.addedSince).toBe(2);
    expect(restoreStoredResults(stored({ scope: 'filtered' }), videos, []).run.addedSince).toBe(0);
  });
});
