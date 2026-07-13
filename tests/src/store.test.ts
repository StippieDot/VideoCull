import { __test__ } from '../../src/store';
import type { VideoStore } from '../../src/types';
import { makeDuplicateGroup as makeGroup, makeVideo } from '../helpers/videoFactory';

type FilterState = Pick<VideoStore,
  'videos' | 'searchQuery' | 'statusFilter' | 'minSizeFilter' | 'maxSizeFilter' | 'minDurationFilter' | 'maxDurationFilter' |
  'folderFilterPath' | 'minRatingFilter' | 'favoritesFilter' | 'incompatibleFilter' | 'duplicateFilter' |
  'sortBy' | 'sortOrder' | 'groupByFolder' | 'folderSortBy' | 'folderSortOrder'
>;

function makeFilterState(overrides: Partial<FilterState> = {}): FilterState {
  return {
    videos: [],
    searchQuery: '',
    statusFilter: 'all',
    minSizeFilter: 0,
    maxSizeFilter: null,
    minDurationFilter: 0,
    maxDurationFilter: null,
    folderFilterPath: null,
    minRatingFilter: 0,
    favoritesFilter: false,
    incompatibleFilter: false,
    duplicateFilter: false,
    sortBy: 'name',
    sortOrder: 'asc',
    groupByFolder: false,
    folderSortBy: 'name',
    folderSortOrder: 'asc',
    ...overrides,
  };
}

describe('store filtering and grouping behavior', () => {
  test('keeps only videos that satisfy the active review filters', () => {
    const videos = [
      makeVideo('a', { sizeBytes: 500, durationSecs: 30, rating: 4, favorite: true, duplicateGroupId: 'g1' }),
      makeVideo('b', { sizeBytes: 300, durationSecs: 20, rating: 2, favorite: false, compatible: false }),
      makeVideo('c', { sizeBytes: 700, durationSecs: 40, rating: 5, favorite: true, duplicateGroupId: 'g2' }),
    ];

    const filtered = __test__.computeFiltered(
      makeFilterState({
        videos,
        minSizeFilter: 400,
        minDurationFilter: 25,
        minRatingFilter: 4,
        favoritesFilter: true,
        duplicateFilter: true,
        sortBy: 'size',
        sortOrder: 'desc',
      })
    );

    expect(filtered.map((video) => video.id)).toEqual(['c', 'a']);
  });

  test('orders grouped results by total folder size before applying item sorting inside each folder', () => {
    const videos = [
      makeVideo('a', { path: 'C:\\one\\a.mp4', sizeBytes: 50 }),
      makeVideo('b', { path: 'C:\\two\\b.mp4', sizeBytes: 500 }),
      makeVideo('c', { path: 'C:\\two\\c.mp4', sizeBytes: 10 }),
    ];

    const filtered = __test__.computeFiltered(
      makeFilterState({
        videos,
        groupByFolder: true,
        folderSortBy: 'size',
        folderSortOrder: 'desc',
        sortBy: 'name',
        sortOrder: 'asc',
      })
    );

    expect(filtered.map((video) => video.id)).toEqual(['b', 'c', 'a']);
  });

  test('orders resolution sort by actual pixel count regardless of orientation', () => {
    const videos = [
      makeVideo('sd', { width: 854, height: 480, path: 'C:\\one\\sd.mp4' }),
      makeVideo('portrait-hd', { width: 1080, height: 1920, path: 'C:\\one\\portrait.mp4' }),
      makeVideo('wide-hd', { width: 1920, height: 1080, path: 'C:\\one\\wide.mp4' }),
      makeVideo('uhd', { width: 3840, height: 2160, path: 'C:\\one\\uhd.mp4' }),
    ];

    const filtered = __test__.computeFiltered(
      makeFilterState({
        videos,
        sortBy: 'resolution',
        sortOrder: 'desc',
      })
    );

    expect(filtered.map((video) => video.id)).toEqual(['uhd', 'portrait-hd', 'wide-hd', 'sd']);
  });

  test('orders resolution sort by the displayed resolution tier instead of rewarding wider low-height files', () => {
    const videos = [
      makeVideo('400p-wide', { width: 640, height: 400, path: 'C:\\one\\400p-wide.mp4' }),
      makeVideo('352p-extra-wide', { width: 720, height: 352, path: 'C:\\one\\352p-extra-wide.mp4' }),
      makeVideo('432p-classic', { width: 576, height: 432, path: 'C:\\one\\432p-classic.mp4' }),
    ];

    const filtered = __test__.computeFiltered(
      makeFilterState({
        videos,
        sortBy: 'resolution',
        sortOrder: 'desc',
      })
    );

    expect(filtered.map((video) => video.id)).toEqual(['432p-classic', '400p-wide', '352p-extra-wide']);
  });
});

describe('duplicate pair normalization', () => {
  test('stores a valid duplicate pair key in stable lowercase order', () => {
    expect(__test__.normalizeDuplicatePairKey('ABCDEFABCDEFABCD|0011223344556677')).toBe('0011223344556677|abcdefabcdefabcd');
  });

  test('rejects malformed duplicate pair keys', () => {
    expect(__test__.normalizeDuplicatePairKey('bad')).toBeNull();
  });

  test('rejects duplicate pair keys that point to the same video twice', () => {
    expect(__test__.normalizeDuplicatePairKey('0011223344556677|0011223344556677')).toBeNull();
  });
});

describe('duplicate group annotations', () => {
  test('marks videos inside a duplicate group with their group metadata', () => {
    const videos = [
      makeVideo('a', { duplicateGroupId: 'old', duplicateSuggestedKeeper: true }),
      makeVideo('b'),
      makeVideo('c', { duplicateGroupId: 'stale' }),
    ];
    const groups = [makeGroup({ videoIds: ['a', 'b'], suggestedKeeperId: 'b', exactVideoIds: ['a'] })];

    const next = __test__.applyDuplicateGroupsToVideos(videos, groups);

    expect(next[0]).toMatchObject({
      duplicateGroupId: 'group-1',
      duplicateSuggestedKeeper: false,
      duplicateExact: true,
      duplicateGroupSize: 2,
    });
    expect(next[1]).toMatchObject({
      duplicateGroupId: 'group-1',
      duplicateSuggestedKeeper: true,
      duplicateMatchType: 'visual',
    });
  });

  test('clears stale duplicate metadata from videos that no longer belong to a group', () => {
    const videos = [
      makeVideo('a', { duplicateGroupId: 'old' }),
      makeVideo('b', { duplicateGroupId: 'stale', duplicateSuggestedKeeper: true }),
    ];

    const next = __test__.applyDuplicateGroupsToVideos(videos, []);

    expect(next[0]).toMatchObject({
      duplicateGroupId: null,
      duplicateSuggestedKeeper: false,
      duplicateGroupSize: 0,
    });
    expect(next[1]).toMatchObject({
      duplicateGroupId: null,
      duplicateSuggestedKeeper: false,
      duplicateGroupSize: 0,
    });
  });
});

describe('keeper suggestions', () => {
  test('picks the highest-ranked video when no manual override exists', () => {
    const videos = [
      makeVideo('a', { path: 'C:\\z.mp4', width: 1280, height: 720, videoBitrate: 2000, durationSecs: 30, fps: 30, sizeBytes: 100 }),
      makeVideo('b', { path: 'C:\\a.mp4', width: 1920, height: 1080, videoBitrate: 4000, durationSecs: 60, fps: 60, sizeBytes: 150 }),
    ];

    const groups = __test__.applyKeeperOrderToGroups([makeGroup({ videoIds: ['a', 'b'] })], videos, ['resolution', 'size']);
    expect(groups[0]?.suggestedKeeperId).toBe('b');
  });

  test('uses bitrate when displayed resolution tiers match', () => {
    const videos = [
      makeVideo('more-pixels', { path: 'C:\\more-pixels.mp4', width: 1920, height: 1080, videoBitrate: 3586000 }),
      makeVideo('higher-bitrate', { path: 'C:\\higher-bitrate.mp4', width: 1920, height: 800, videoBitrate: 6008000 }),
      makeVideo('lower-tier', { path: 'C:\\lower-tier.mp4', width: 1280, height: 720, videoBitrate: 12000000 }),
    ];

    const groups = __test__.applyKeeperOrderToGroups(
      [makeGroup({ videoIds: ['more-pixels', 'higher-bitrate', 'lower-tier'] })],
      videos,
      ['resolution', 'videoBitrate']
    );

    expect(groups[0]?.suggestedKeeperId).toBe('higher-bitrate');
  });

  test('does not assign a resolution tier to incomplete metadata', () => {
    const videos = [
      makeVideo('incomplete', { path: 'C:\\incomplete.mp4', width: 1920, height: null, videoBitrate: 6008000 }),
      makeVideo('complete', { path: 'C:\\complete.mp4', width: 1280, height: 720, videoBitrate: 3586000 }),
    ];

    const groups = __test__.applyKeeperOrderToGroups(
      [makeGroup({ videoIds: ['incomplete', 'complete'] })],
      videos,
      ['resolution', 'videoBitrate']
    );

    expect(groups[0]?.suggestedKeeperId).toBe('complete');
  });

  test('keeps a valid manual keeper override instead of replacing it with the automatic ranking', () => {
    const videos = [
      makeVideo('a', { path: 'C:\\z.mp4', width: 1280, height: 720, videoBitrate: 2000, durationSecs: 30, fps: 30, sizeBytes: 100 }),
      makeVideo('b', { path: 'C:\\a.mp4', width: 1920, height: 1080, videoBitrate: 4000, durationSecs: 60, fps: 60, sizeBytes: 150 }),
      makeVideo('c', { path: 'C:\\c.mp4', width: 640, height: 480, videoBitrate: 1000, durationSecs: 20, fps: 24, sizeBytes: 80 }),
    ];

    const groups = __test__.applyKeeperOrderToGroups(
      [makeGroup({ videoIds: ['a', 'b'], manualSuggestedKeeperId: 'a', suggestedKeeperId: 'b' }), makeGroup({ id: 'group-2', videoIds: ['b', 'c'], suggestedKeeperId: 'b', reason: 'Other' })],
      videos,
      ['resolution', 'size']
    );

    expect(groups[0]?.suggestedKeeperId).toBe('a');
    expect(groups[0]?.manualSuggestedKeeperId).toBe('a');
    expect(groups[1]?.suggestedKeeperId).toBe('b');
  });
});

describe('review scope behavior', () => {
  const videos = [makeVideo('a'), makeVideo('b'), makeVideo('c')];
  const filteredVideos = [videos[1]!, videos[2]!];

  test('honors an explicit review scope when the current video is still inside it', () => {
    expect(__test__.getReviewScopeIdsForVideo('b', ['b', 'a', 'b'], videos, filteredVideos)).toEqual(['b', 'a']);
  });

  test('falls back to the filtered view when the explicit scope no longer contains the current video', () => {
    expect(__test__.getReviewScopeIdsForVideo('c', ['a'], videos, filteredVideos)).toEqual(['b', 'c']);
  });

  test('falls back to all loaded videos when neither the explicit nor filtered scope contains the current video', () => {
    expect(__test__.getReviewScopeIdsForVideo('a', ['x'], videos, filteredVideos)).toEqual(['a', 'b', 'c']);
  });
});

describe('directory identity', () => {
  test('keeps only the first occurrence of each normalized directory path', () => {
    expect(__test__.uniqueDirectories([
      'C:\\Media',
      'c:/media/',
      'D:\\Clips',
      'D:\\Clips\\',
    ])).toEqual(['C:\\Media', 'D:\\Clips']);
  });
});
