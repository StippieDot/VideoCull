// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { changeAffectsCurrentView, patchFilteredVideosPreservingOrder, type ViewInvalidationState } from './store-invalidation.ts';

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

test('thumbnail-only changes do not affect a name-sorted view', () => {
  assert.equal(changeAffectsCurrentView(['thumbnails'], baseState), false);
});

test('duration changes affect views when duration sort is active', () => {
  assert.equal(changeAffectsCurrentView(['duration'], { ...baseState, sortBy: 'duration' }), true);
});

test('size changes affect grouped views when folder size sorting is active', () => {
  assert.equal(
    changeAffectsCurrentView(['size'], { ...baseState, groupByFolder: true, folderSortBy: 'size' }),
    true
  );
});

test('status changes do not affect all-status views and preserve order on patch', () => {
  assert.equal(changeAffectsCurrentView(['status'], baseState), false);

  const next = patchFilteredVideosPreservingOrder(
    [
      { id: 'a', filename: 'a.mp4', path: 'a', sizeBytes: 1, date: 0, durationSecs: null, duplicateHash: null, status: 'pending', thumbnails: [], rating: 0, favorite: false, compatible: true, videoCodec: null, audioCodec: null, containerFormat: null, width: null, height: null, fps: null },
      { id: 'b', filename: 'b.mp4', path: 'b', sizeBytes: 1, date: 0, durationSecs: null, duplicateHash: null, status: 'pending', thumbnails: [], rating: 0, favorite: false, compatible: true, videoCodec: null, audioCodec: null, containerFormat: null, width: null, height: null, fps: null },
    ],
    [
      { id: 'b', filename: 'b.mp4', path: 'b', sizeBytes: 1, date: 0, durationSecs: null, duplicateHash: null, status: 'delete', thumbnails: [], rating: 0, favorite: false, compatible: true, videoCodec: null, audioCodec: null, containerFormat: null, width: null, height: null, fps: null },
      { id: 'a', filename: 'a.mp4', path: 'a', sizeBytes: 1, date: 0, durationSecs: null, duplicateHash: null, status: 'keep', thumbnails: [], rating: 0, favorite: false, compatible: true, videoCodec: null, audioCodec: null, containerFormat: null, width: null, height: null, fps: null },
    ]
  );

  assert.deepEqual(next.map((video) => `${video.id}:${video.status}`), ['a:keep', 'b:delete']);
});

test('duplicate changes affect duplicate-focused views', () => {
  assert.equal(changeAffectsCurrentView(['duplicate'], { ...baseState, duplicateFilter: true }), true);
});
