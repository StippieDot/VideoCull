import { __test__ } from '../../src/store';
import type { DuplicateGroup, VideoStore } from '../../src/types';
import { makeVideo } from '../helpers/videoFactory';

function makeStoreState(overrides: Partial<VideoStore> = {}): VideoStore {
  const videos = overrides.videos ?? [];
  return {
    videos,
    filteredVideos: [],
    duplicateGroups: [],
    duplicateFilter: false,
    duplicateGroupsMode: false,
    statusFilter: 'all',
    minSizeFilter: 0,
    maxSizeFilter: null,
    minDurationFilter: 0,
    maxDurationFilter: null,
    folderFilterPath: null,
    minRatingFilter: 0,
    favoritesFilter: false,
    incompatibleFilter: false,
    sortBy: 'name',
    sortOrder: 'asc',
    groupByFolder: false,
    folderSortBy: 'name',
    folderSortOrder: 'asc',
    stats: __test__.computeStats(videos),
    sidebarAggregates: __test__.computeSidebarAggregates(videos),
    ...overrides,
  } as VideoStore;
}

describe('thumbnail ordering', () => {
  test('keeps thumbnails in human-friendly numeric order when files contain thumb indexes', () => {
    expect(__test__.orderedThumbnails([
      'thumb_10.jpg',
      'thumb-2.jpg',
      'cover.jpg',
      'thumb_01.jpg',
    ])).toEqual([
      'cover.jpg',
      'thumb_01.jpg',
      'thumb-2.jpg',
      'thumb_10.jpg',
    ]);
  });
});

describe('review statistics', () => {
  test('counts each review status and the reclaimable bytes for deleted videos', () => {
    const stats = __test__.computeStats([
      makeVideo('a', { status: 'pending', sizeBytes: 10 }),
      makeVideo('b', { status: 'delete', sizeBytes: 20 }),
      makeVideo('c', { status: 'keep', sizeBytes: 30 }),
      makeVideo('d', { status: 'skipped', sizeBytes: 40 }),
      makeVideo('e', { status: 'delete', sizeBytes: 50 }),
    ]);

    expect(stats).toEqual({
      total: 5,
      pending: 1,
      skipped: 1,
      keep: 1,
      delete: 2,
      totalSize: 150,
      deleteSize: 70,
    });
  });
});

describe('sidebar aggregates', () => {
  test('captures max ranges and duplicate and incompatible counts from the loaded library', () => {
    const aggregates = __test__.computeSidebarAggregates([
      makeVideo('a', { sizeBytes: 10, durationSecs: 15, duplicateGroupId: 'group-1', compatible: false }),
      makeVideo('b', { sizeBytes: 25, durationSecs: 45, duplicateGroupId: null, compatible: true }),
      makeVideo('c', { sizeBytes: 5, durationSecs: null, duplicateGroupId: 'group-2', compatible: false }),
    ]);

    expect(aggregates).toEqual({
      maxSizeBytes: 25,
      maxDurationSeconds: 45,
      duplicateCount: 2,
      incompatibleCount: 2,
    });
  });
});

describe('media batch merge helpers', () => {
  test('recomputes compatibility from merged metadata when the batch updates codec information', () => {
    const previousVideo = makeVideo('legacy', {
      path: 'D:\\Media\\legacy.avi',
      containerFormat: null,
      videoCodec: null,
      compatible: true,
    });

    expect(__test__.resolveMediaBatchCompatibility(previousVideo, {
      videoId: previousVideo.id,
      containerFormat: 'avi',
      videoCodec: 'mpeg4',
    })).toBe(false);
  });

  test('preserves the existing compatibility flag when the batch does not change media metadata', () => {
    const previousVideo = makeVideo('alpha', {
      compatible: true,
      containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
      videoCodec: 'h264',
    });

    expect(__test__.resolveMediaBatchCompatibility(previousVideo, {
      videoId: previousVideo.id,
      thumbnails: ['thumb_1.jpg'],
    })).toBe(true);
  });
});

describe('video state updates', () => {
  test('preserves the current filtered order when a change does not invalidate the view', () => {
    const oldVideos = [
      makeVideo('a', { sizeBytes: 10 }),
      makeVideo('b', { sizeBytes: 20 }),
    ];
    const newVideos = [
      makeVideo('a', { sizeBytes: 11 }),
      makeVideo('b', { sizeBytes: 21 }),
      makeVideo('c', { sizeBytes: 30 }),
    ];

    const currentState = makeStoreState({
      videos: oldVideos,
      filteredVideos: [oldVideos[1]!, oldVideos[0]!],
    });

    const next = __test__.buildVideoStateUpdate(currentState, newVideos, []);
    expect(next.filteredVideos.map((video) => video.id)).toEqual(['b', 'a']);
  });

  test('recomputes filtered videos when a changed field affects the current view', () => {
    const oldVideos = [
      makeVideo('a', { status: 'pending', sizeBytes: 10 }),
      makeVideo('b', { status: 'keep', sizeBytes: 30 }),
    ];
    const newVideos = [
      makeVideo('a', { status: 'keep', sizeBytes: 10 }),
      makeVideo('b', { status: 'keep', sizeBytes: 30 }),
    ];

    const currentState = makeStoreState({
      videos: oldVideos,
      filteredVideos: [oldVideos[1]!],
      statusFilter: 'keep',
    });

    const next = __test__.buildVideoStateUpdate(currentState, newVideos, ['status']);
    expect(next.filteredVideos.map((video) => video.id)).toEqual(['a', 'b']);
    expect(next.sidebarAggregates).toBe(currentState.sidebarAggregates);
  });

  test('carries requested stats and duplicate-view metadata into the next state', () => {
    const oldVideos = [
      makeVideo('a', { status: 'pending', sizeBytes: 10 }),
      makeVideo('b', { status: 'keep', sizeBytes: 30 }),
    ];
    const newVideos = [
      makeVideo('a', { status: 'keep', sizeBytes: 10 }),
      makeVideo('b', { status: 'keep', sizeBytes: 30 }),
    ];
    const groups: DuplicateGroup[] = [{
      id: 'group-1',
      videoIds: ['a', 'b'],
      similarity: 99,
      matchType: 'exact',
      suggestedKeeperId: 'a',
      reason: 'Exact match',
    }];

    const currentState = makeStoreState({
      videos: oldVideos,
      filteredVideos: [oldVideos[1]!],
      statusFilter: 'keep',
    });

    const next = __test__.buildVideoStateUpdate(currentState, newVideos, ['status'], {
      duplicateFilter: false,
      duplicateGroups: groups,
      duplicateGroupsMode: true,
      recomputeStats: true,
      reviewIndex: 1,
      undoStack: [],
    });

    expect(next.stats).toEqual({
      total: 2,
      pending: 0,
      skipped: 0,
      keep: 2,
      delete: 0,
      totalSize: 40,
      deleteSize: 0,
    });
    expect(next.duplicateFilter).toBe(false);
    expect(next.duplicateGroupsMode).toBe(true);
    expect(next.duplicateGroups).toEqual(groups);
    expect(next.reviewIndex).toBe(1);
  });

  test('recomputes sidebar aggregates when changed fields affect cached library metrics', () => {
    const oldVideos = [
      makeVideo('a', { sizeBytes: 10, durationSecs: 15, duplicateGroupId: null, compatible: true }),
      makeVideo('b', { sizeBytes: 20, durationSecs: 25, duplicateGroupId: null, compatible: true }),
    ];
    const newVideos = [
      makeVideo('a', { sizeBytes: 10, durationSecs: 60, duplicateGroupId: 'group-1', compatible: false }),
      makeVideo('b', { sizeBytes: 20, durationSecs: 25, duplicateGroupId: null, compatible: true }),
    ];

    const currentState = makeStoreState({
      videos: oldVideos,
      filteredVideos: oldVideos,
    });

    const next = __test__.buildVideoStateUpdate(currentState, newVideos, ['duration', 'duplicate', 'compatible']);
    expect(next.sidebarAggregates).toEqual({
      maxSizeBytes: 20,
      maxDurationSeconds: 60,
      duplicateCount: 1,
      incompatibleCount: 1,
    });
  });
});

describe('review navigation', () => {
  const videos = [makeVideo('a'), makeVideo('b'), makeVideo('c')];

  test('resolves the current review item from an explicit review scope', () => {
    expect(__test__.getVideoByReviewIndex(videos, ['c', 'a'], [videos[1]!, videos[0]!], 0)?.id).toBe('c');
  });

  test('returns null when an explicit review scope points at a video that no longer exists', () => {
    expect(__test__.getVideoByReviewIndex(videos, ['missing'], [videos[1]!, videos[0]!], 0)).toBeNull();
  });

  test('falls back to the provided visible list when there is no explicit scope', () => {
    expect(__test__.getVideoByReviewIndex(videos, null, [videos[1]!, videos[0]!], 1)?.id).toBe('a');
  });
});

describe('path helpers', () => {
  const video = makeVideo('a', { path: 'D:/media/Trips/a.mp4' });

  test('treats a video inside the root as part of that session root even when slashes differ', () => {
    expect(__test__.isPathInsideRoot('D:\\media\\Trips\\a.mp4', 'd:/media')).toBe(true);
  });

  test('rejects paths outside the root when selecting a session root for a video', () => {
    expect(__test__.isPathInsideRoot('D:\\other\\a.mp4', 'd:/media')).toBe(false);
    expect(__test__.findRootForVideo(video, ['D:\\other'], 'D:\\fallback')).toBe('D:\\fallback');
  });

  test('prefers a matching session root over the fallback directory', () => {
    expect(__test__.findRootForVideo(video, ['D:\\other', 'D:\\media'], 'D:\\fallback')).toBe('D:\\media');
  });

  test('renders folder labels and pluralized counts for review messaging', () => {
    expect(__test__.folderLabel('D:\\media\\Trips')).toBe('Trips');
    expect(__test__.folderLabel(null)).toBe('folder');
    expect(__test__.plural(1, 'video')).toBe('1 video');
    expect(__test__.plural(2, 'video')).toBe('2 videos');
    expect(__test__.plural(2, 'analysis', 'analyses')).toBe('2 analyses');
  });
});
