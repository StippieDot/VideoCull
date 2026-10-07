import { buildSubfolderMenu, type LocationActions } from '../../src/components/locationMenus';
import { __test__, videosOutsideFolderFilter } from '../../src/store';
import useStore from '../../src/store';
import { makeVideo } from '../helpers/videoFactory';

// Guards against slow filtering, sorting and folder lists on big sessions. The limits are about
// ten times what a development machine takes, so only a real regression (such as per-call
// collators or per-video path normalising) trips them, not a busy CI runner.
const VIDEO_COUNT = 50_000;
const FOLDER_COUNT = 2_000;

const videos = Array.from({ length: VIDEO_COUNT }, (_, index) => {
  const folder = index % FOLDER_COUNT;
  return makeVideo(`clip ${VIDEO_COUNT - index}`, {}, `P:\\Media\\Group ${folder % 20}\\Folder ${folder}`);
});

const filterState = {
  videos,
  searchQuery: '',
  statusFilter: 'all' as const,
  minSizeFilter: 0,
  maxSizeFilter: null,
  minDurationFilter: 0,
  maxDurationFilter: null,
  folderFilter: null,
  minRatingFilter: 0 as const,
  favoritesFilter: false,
  incompatibleFilter: false,
  duplicateFilter: false,
  sortBy: 'name' as const,
  sortOrder: 'asc' as const,
  groupByFolder: true,
  folderSortBy: 'name' as const,
  folderSortOrder: 'asc' as const,
};

function timed<T>(run: () => T): { result: T; ms: number } {
  const startedAt = performance.now();
  const result = run();
  return { result, ms: performance.now() - startedAt };
}

test('sorting 50,000 videos by name, grouped by folder, stays fast', () => {
  const { result, ms } = timed(() => __test__.computeFiltered(filterState));
  expect(result).toHaveLength(VIDEO_COUNT);
  expect(ms).toBeLessThan(800);
});

test('filtering 50,000 videos to a folder and its subfolders stays fast', () => {
  const { result, ms } = timed(() => __test__.computeFiltered({
    ...filterState,
    folderFilter: { path: 'P:\\Media\\Group 3', includeSubfolders: true },
  }));
  expect(result).toHaveLength(VIDEO_COUNT / 20);
  expect(ms).toBeLessThan(300);
});

test('listing the subfolders of a folder in a 50,000 video session stays fast', () => {
  useStore.setState({ ...filterState, filteredVideos: videos, folderFilter: { path: 'P:\\Media\\Group 3', includeSubfolders: true } });
  const actions = new Proxy({}, { get: () => () => {} }) as LocationActions;
  const { result, ms } = timed(() => buildSubfolderMenu(
    videosOutsideFolderFilter(useStore.getState()),
    'P:\\Media',
    { filterPath: 'P:\\Media\\Group 3', directories: ['P:\\Media'] },
    actions,
  ));
  // "All of Media", a separator, then the 20 groups.
  expect(result.items).toHaveLength(22);
  expect(ms).toBeLessThan(800);
});
