import { changeAffectsCurrentView, patchFilteredVideosPreservingOrder, type ViewInvalidationState } from '../../src/store-invalidation';
import type { Video } from '../../src/types';

const baseState: ViewInvalidationState = {
  statusFilter: 'all',
  minSizeFilter: 0,
  maxSizeFilter: null,
  minDurationFilter: 0,
  maxDurationFilter: null,
  minRatingFilter: 0,
  favoritesFilter: false,
  incompatibleFilter: false,
  duplicateFilter: false,
  duplicateGroupsMode: false,
  sortBy: 'name',
  groupByFolder: false,
  folderSortBy: 'name',
};

function makeVideo(id: string, status: Video['status'] = 'pending'): Video {
  return {
    id,
    filename: `${id}.mp4`,
    path: id,
    sizeBytes: 1,
    date: 0,
    durationSecs: null,
    duplicateHash: null,
    status,
    thumbnails: [],
    rating: 0,
    favorite: false,
    compatible: true,
    videoCodec: null,
    audioCodec: null,
    containerFormat: null,
    width: null,
    height: null,
    fps: null,
  };
}

test('thumbnail-only changes do not affect a name-sorted view', () => {
  expect(changeAffectsCurrentView(['thumbnails'], baseState)).toBe(false);
});

test('duration changes affect views when duration sort is active', () => {
  expect(changeAffectsCurrentView(['duration'], { ...baseState, sortBy: 'duration' })).toBe(true);
});

test('size changes affect grouped views when folder size sorting is active', () => {
  expect(
    changeAffectsCurrentView(['size'], { ...baseState, groupByFolder: true, folderSortBy: 'size' })
  ).toBe(true);
});

test('status changes do not affect all-status views and preserve order on patch', () => {
  expect(changeAffectsCurrentView(['status'], baseState)).toBe(false);

  const next = patchFilteredVideosPreservingOrder(
    [makeVideo('a'), makeVideo('b')],
    [makeVideo('b', 'delete'), makeVideo('a', 'keep')]
  );

  expect(next.map((video) => `${video.id}:${video.status}`)).toEqual(['a:keep', 'b:delete']);
});

test('duplicate changes affect duplicate-focused views', () => {
  expect(changeAffectsCurrentView(['duplicate'], { ...baseState, duplicateFilter: true })).toBe(true);
});
