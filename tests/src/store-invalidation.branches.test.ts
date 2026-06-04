import { changeAffectsCurrentView } from '../../src/store-invalidation';
import type { ViewInvalidationState } from '../../src/store-invalidation';

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

test('metadata date changes only affect date-sorted views', () => {
  expect(changeAffectsCurrentView(['metadataDate'], baseState)).toBe(false);
  expect(changeAffectsCurrentView(['metadataDate'], { ...baseState, sortBy: 'date' })).toBe(true);
});

test('rating and favorite changes only affect views using those filters or sorts', () => {
  expect(changeAffectsCurrentView(['rating'], baseState)).toBe(false);
  expect(changeAffectsCurrentView(['rating'], { ...baseState, minRatingFilter: 1 })).toBe(true);
  expect(changeAffectsCurrentView(['rating'], { ...baseState, sortBy: 'rating' })).toBe(true);

  expect(changeAffectsCurrentView(['favorite'], baseState)).toBe(false);
  expect(changeAffectsCurrentView(['favorite'], { ...baseState, favoritesFilter: true })).toBe(true);
});

test('compatibility and media metric changes affect only dependent views', () => {
  expect(changeAffectsCurrentView(['compatible'], baseState)).toBe(false);
  expect(changeAffectsCurrentView(['compatible'], { ...baseState, incompatibleFilter: true })).toBe(true);

  expect(changeAffectsCurrentView(['resolution'], baseState)).toBe(false);
  expect(changeAffectsCurrentView(['resolution'], { ...baseState, sortBy: 'resolution' })).toBe(true);

  expect(changeAffectsCurrentView(['fps'], baseState)).toBe(false);
  expect(changeAffectsCurrentView(['fps'], { ...baseState, sortBy: 'fps' })).toBe(true);
});
