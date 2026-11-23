import { rebuildDuplicateGroups, stableDuplicateGroupId, summariseDuplicateGroup } from '../../src/duplicateGroupRebuild';
import type { DuplicateGroup, DuplicateGroupPair, Video } from '../../src/types';
import { makeDuplicateGroup, makeVideo } from '../helpers/videoFactory';

const SUMMARY_FIELDS = [
  'id', 'videoIds', 'similarity', 'averageSimilarity', 'matchType', 'exactVideoIds', 'static', 'borderAdjusted',
  'flipped', 'partialFingerprint', 'comparedSamples', 'confidence', 'relation', 'durationDifferenceSecs', 'reason',
] as const;

function pick(group: DuplicateGroup) {
  return Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, group[field]]));
}

function pair(aId: string, bId: string, similarity: number, extra: Partial<DuplicateGroupPair> = {}): DuplicateGroupPair {
  return { aId, bId, similarity, matchType: 'phash', comparedSamples: 3, confidence: 'normal', ...extra };
}

describe('duplicate group summary matches the backend copy', () => {
  test('ID, score, wording and flags agree for groups the backend built', async () => {
    const { __test__: backend } = (await import('../../electron/duplicates.js')).default;
    const { normalizeDuplicateSettings } = (await import('../../electron/duplicate-utils.js')).default;
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const videos: Video[] = ids.map((id, index) => makeVideo(id, { durationSecs: 100 + index * 3, path: `${id}.mp4` }));
    const videosById = new Map(videos.map((video) => [video.id, video]));
    const settings = normalizeDuplicateSettings({ finalSimilarityThreshold: 95, comparisonMode: 'phash', sampleCount: 5 });
    const groups: DuplicateGroup[] = backend.buildGroups([['e', 'f']], [
      { aId: 'a', bId: 'b', similarity: 99, matchType: 'phash', comparedSamples: 5, confidence: 'normal' },
      { aId: 'a', bId: 'c', similarity: 97.3, matchType: 'phash', comparedSamples: 2, confidence: 'normal', borderAdjusted: true },
      { aId: 'b', bId: 'c', similarity: 96.1, matchType: 'phash', comparedSamples: 4, confidence: 'low', static: true, flipped: true },
      { aId: 'd', bId: 'e', similarity: 98, matchType: 'phash', comparedSamples: 5, confidence: 'normal', partialFingerprint: true },
      { aId: 'd', bId: 'f', similarity: 98, matchType: 'phash', comparedSamples: 5, confidence: 'normal' },
    ], videosById, settings) as unknown as DuplicateGroup[];
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.id).toBe(backend.stableDuplicateGroupId(group.videoIds));
      expect(pick(summariseDuplicateGroup(group.videoIds, group.pairs!, group, videosById))).toEqual(pick(group));
    }
    expect(stableDuplicateGroupId(['b', 'a'])).toBe(backend.stableDuplicateGroupId(['a', 'b']));
  });
});

describe('rebuilding duplicate groups from their pairs', () => {
  const videos = ['a', 'b', 'c', 'd'].map((id) => makeVideo(id));
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const group = (pairs: DuplicateGroupPair[], overrides: Partial<DuplicateGroup> = {}) => makeDuplicateGroup({
    id: 'g', videoIds: ['a', 'b', 'c'], sampleCount: 3, similarity: 96, matchType: 'phash', pairs, ...overrides,
  });

  test('a member that was the only link takes its neighbours apart', () => {
    const chain = group([pair('a', 'b', 98), pair('b', 'c', 96)]);
    expect(rebuildDuplicateGroups([chain], { removedVideoIds: new Set(['b']) }, videosById)).toEqual([]);
  });

  test('the remaining pairs decide score, ID and manual keeper', () => {
    const triangle = group([pair('a', 'b', 99), pair('a', 'c', 96), pair('b', 'c', 95.5)], { manualSuggestedKeeperId: 'c' });
    const [rebuilt] = rebuildDuplicateGroups([triangle], { removedVideoIds: new Set(['c']) }, videosById);
    expect(rebuilt).toMatchObject({
      id: stableDuplicateGroupId(['a', 'b']), videoIds: ['a', 'b'], similarity: 99, manualSuggestedKeeperId: null,
      reason: 'Same content at 3 of 3 sampled moments',
    });
    expect(rebuilt!.pairs).toEqual([pair('a', 'b', 99)]);
  });

  test('a pair marked as not a match leaves the group whole when the others still connect it', () => {
    const triangle = group([pair('a', 'b', 99), pair('a', 'c', 97), pair('b', 'c', 96)]);
    const rebuilt = rebuildDuplicateGroups([triangle], { ignoredPairKeys: new Set(['a|b']) }, videosById);
    expect(rebuilt.map((entry) => [entry.videoIds, entry.similarity, entry.averageSimilarity])).toEqual([[['a', 'b', 'c'], 96, 96.5]]);
  });

  test('a group splits into the sets its remaining pairs connect', () => {
    const four = group([pair('a', 'b', 99), pair('c', 'd', 98), pair('b', 'c', 96)], { videoIds: ['a', 'b', 'c', 'd'] });
    const rebuilt = rebuildDuplicateGroups([four], { ignoredPairKeys: new Set(['b|c']) }, videosById);
    expect(rebuilt.map((entry) => entry.videoIds)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('untouched groups and groups from before pairs were stored keep their object or only lose members', () => {
    const untouched = group([pair('a', 'b', 99), pair('b', 'c', 98)]);
    expect(rebuildDuplicateGroups([untouched], { removedVideoIds: new Set(['d']) }, videosById)[0]).toBe(untouched);
    const legacy = makeDuplicateGroup({ id: 'old', videoIds: ['a', 'b', 'c'], similarity: 91, manualSuggestedKeeperId: 'b' });
    const [pruned] = rebuildDuplicateGroups([legacy], { removedVideoIds: new Set(['b']) }, videosById);
    expect(pruned).toMatchObject({ id: 'old', videoIds: ['a', 'c'], similarity: 91, manualSuggestedKeeperId: null });
  });

  test('unreadable positions follow the members that remain', () => {
    const triangle = group([pair('a', 'b', 99), pair('a', 'c', 97), pair('b', 'c', 96)], {
      unreadableSamples: { a: [], b: [{ index: 2, percent: 75 }], c: [] },
    });
    const [rebuilt] = rebuildDuplicateGroups([triangle], { removedVideoIds: new Set(['c']) }, videosById);
    expect(rebuilt!.unreadableSamples).toEqual({ a: [], b: [{ index: 2, percent: 75 }] });
  });
});
