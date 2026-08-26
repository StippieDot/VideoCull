import useStore from '../../src/store';
import type { VideoStore } from '../../src/types';
import { makeDuplicateGroup as makeGroup, makeVideo } from '../helpers/videoFactory';

type ElectronApiMock = {
  saveConfig: ReturnType<typeof vi.fn>;
  saveCache: ReturnType<typeof vi.fn>;
  saveCacheAtomic: ReturnType<typeof vi.fn>;
  getConfig: ReturnType<typeof vi.fn>;
  validateDroppedPath: ReturnType<typeof vi.fn>;
};

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => VideoStore;
  };
}

function installElectronApiMock(): ElectronApiMock {
  const electronAPI = {
    saveConfig: vi.fn().mockResolvedValue(true),
    saveCache: vi.fn().mockResolvedValue(true),
    saveCacheAtomic: vi.fn().mockResolvedValue(true),
    getConfig: vi.fn().mockResolvedValue(null),
    validateDroppedPath: vi.fn(),
  };
  (globalThis as { window?: unknown }).window = { electronAPI };
  return electronAPI;
}

function flushMicrotasks() {
  return Promise.resolve();
}

describe('useStore public behavior', () => {
  let electronAPI: ElectronApiMock;

  beforeEach(() => {
    electronAPI = installElectronApiMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('starting a new session root updates recent directories and clears duplicate/review state', async () => {
    const store = getStoreApi();
    store.setState({
      duplicateGroupsMode: true,
      duplicateGroups: [makeGroup()],
      duplicateFilter: true,
      reviewIndex: 5,
      reviewMode: true,
      reviewScopeIds: ['old'],
      activeReviewVideoPath: 'D:\\Old\\old.mp4',
    });

    useStore.getState().setDirectory('D:\\Media');
    await flushMicrotasks();

    const state = useStore.getState();
    expect(state.directory).toBe('D:\\Media');
    expect(state.directories).toEqual(['D:\\Media']);
    expect(state.reviewMode).toBe(false);
    expect(state.reviewIndex).toBe(0);
    expect(state.reviewScopeIds).toBeNull();
    expect(state.activeReviewVideoPath).toBeNull();
    expect(state.duplicateGroupsMode).toBe(false);
    expect(state.duplicateGroups).toEqual([]);
    expect(state.duplicateFilter).toBe(false);
    expect(state.settings.recentDirectories[0]).toBe('D:\\Media');
    expect(electronAPI.saveConfig).toHaveBeenCalledTimes(1);
  });

  test('adding another session root deduplicates directory identities and preserves the active root order', async () => {
    useStore.getState().setDirectory('D:\\Media');
    useStore.getState().addDirectory('d:/media/');
    useStore.getState().addDirectory('E:\\Clips');
    await flushMicrotasks();

    const state = useStore.getState();
    expect(state.directory).toBe('D:\\Media');
    expect(state.directories).toEqual(['D:\\Media', 'E:\\Clips']);
    expect(state.settings.recentDirectories.slice(0, 2)).toEqual(['E:\\Clips', 'd:/media/']);
  });

  test('adding nested session roots keeps only the broadest scan root', async () => {
    useStore.getState().setDirectory('D:\\Media');
    useStore.getState().addDirectory('D:\\Media\\Trips');
    useStore.getState().addDirectory('E:\\Clips\\Summer');
    useStore.getState().addDirectory('E:\\Clips');
    await flushMicrotasks();

    const state = useStore.getState();
    expect(state.directories).toEqual(['D:\\Media', 'E:\\Clips']);
  });

  test('searches video filenames and paths case-insensitively', () => {
    useStore.getState().setVideos([
      makeVideo('trip', { filename: 'Summer Trip.mp4', path: 'D:\\Media\\Spain\\Summer Trip.mp4' }),
      makeVideo('meeting', { filename: 'Meeting.mp4', path: 'D:\\Media\\Work\\Meeting.mp4' }),
    ]);

    useStore.getState().setSearchQuery('  SPAIN  ');

    expect(useStore.getState().searchQuery).toBe('  SPAIN  ');
    expect(useStore.getState().filteredVideos.map((video) => video.id)).toEqual(['trip']);
  });

  test('combines grid search with existing filters', () => {
    useStore.getState().setVideos([
      makeVideo('pending-trip', { filename: 'Trip pending.mp4', status: 'pending' }),
      makeVideo('kept-trip', { filename: 'Trip kept.mp4', status: 'keep' }),
    ]);

    useStore.getState().setSearchQuery('trip');
    useStore.getState().setStatusFilter('keep');

    expect(useStore.getState().filteredVideos.map((video) => video.id)).toEqual(['kept-trip']);
  });

  test('search prunes grid selections that are no longer visible', () => {
    useStore.getState().setVideos([
      makeVideo('trip', { filename: 'Trip.mp4' }),
      makeVideo('meeting', { filename: 'Meeting.mp4' }),
    ]);
    useStore.getState().setGridSelectionIds(new Set(['trip', 'meeting']));
    useStore.getState().setGridSelectionAnchorId('meeting');

    useStore.getState().setSearchQuery('trip');

    expect(Array.from(useStore.getState().gridSelectionIds)).toEqual(['trip']);
    expect(useStore.getState().gridSelectionAnchorId).toBeNull();
  });

  test('starting a replacement folder session clears grid search', () => {
    useStore.getState().setSearchQuery('trip');

    useStore.getState().setDirectory('D:\\Other');

    expect(useStore.getState().searchQuery).toBe('');
  });

  test('loading a new video set orders thumbnails and clears stale duplicate annotations', () => {
    const firstVideos = [
      makeVideo('a', { duplicateGroupId: 'old', thumbnails: ['thumb_2.jpg', 'thumb_01.jpg'] }),
      makeVideo('b'),
    ];
    useStore.getState().setDuplicateGroups([makeGroup()]);

    useStore.getState().setVideos(firstVideos);
    let state = useStore.getState();
    expect(state.videos[0]?.thumbnails).toEqual(['thumb_01.jpg', 'thumb_2.jpg']);
    expect(state.duplicateGroupsMode).toBe(false);
    expect(state.duplicateGroups).toEqual([]);

    useStore.getState().setDuplicateGroups([makeGroup()]);
    useStore.getState().setVideos([
      makeVideo('a', { thumbnails: ['thumb_2.jpg', 'thumb_01.jpg'] }),
      makeVideo('b'),
    ]);
    state = useStore.getState();
    expect(state.duplicateGroupsMode).toBe(true);
    expect(state.duplicateGroups).toHaveLength(1);
  });

  test('loading a different video set clears stale duplicate selection and review state', () => {
    const store = getStoreApi();
    store.setState({
      videos: [makeVideo('a'), makeVideo('b')],
      filteredVideos: [makeVideo('a'), makeVideo('b')],
      duplicateGroups: [makeGroup({ videoIds: ['a', 'b'] })],
      duplicateGroupsMode: true,
      duplicateFilter: true,
      reviewMode: true,
      reviewIndex: 1,
      reviewScopeIds: ['a', 'b'],
      activeReviewVideoPath: 'D:\\Media\\b.mp4',
      gridSelectionIds: new Set(['a', 'b']),
      gridSelectionAnchorId: 'b',
    });

    useStore.getState().setVideos([makeVideo('c', { path: 'D:\\Media\\c.mp4' })]);

    const state = useStore.getState();
    expect(state.videos.map((video) => video.id)).toEqual(['c']);
    expect(state.duplicateGroups).toEqual([]);
    expect(state.duplicateGroupsMode).toBe(false);
    expect(state.duplicateFilter).toBe(false);
    expect(state.reviewMode).toBe(false);
    expect(state.reviewIndex).toBe(0);
    expect(state.reviewScopeIds).toBeNull();
    expect(state.activeReviewVideoPath).toBeNull();
    expect(Array.from(state.gridSelectionIds)).toEqual([]);
    expect(state.gridSelectionAnchorId).toBeNull();
  });

  test('setting and undoing a review decision updates status, stats, and persisted cache payloads', async () => {
    useStore.getState().setDirectory('D:\\Media');
    useStore.getState().setVideos([
      makeVideo('a', { path: 'D:\\Media\\a.mp4' }),
      makeVideo('b', { path: 'D:\\Media\\b.mp4', status: 'keep' }),
    ]);

    useStore.getState().setVideoStatus('a', 'delete');
    await flushMicrotasks();

    let state = useStore.getState();
    expect(state.videos.find((video) => video.id === 'a')?.status).toBe('delete');
    expect(state.stats.delete).toBe(1);
    expect(state.undoStack).toHaveLength(1);
    expect(electronAPI.saveCache).toHaveBeenCalledWith(
      'D:\\Media',
      expect.arrayContaining([expect.objectContaining({ id: 'a', status: 'delete' })])
    );

    useStore.getState().undo();
    await flushMicrotasks();

    state = useStore.getState();
    expect(state.videos.find((video) => video.id === 'a')?.status).toBe('pending');
    expect(state.stats.delete).toBe(0);
    expect(state.undoStack).toHaveLength(0);
  });

  test('public filter actions change the visible review list and reset the review cursor', () => {
    useStore.getState().setVideos([
      makeVideo('a', { favorite: true, rating: 5 }),
      makeVideo('b', { favorite: false, rating: 3 }),
      makeVideo('c', { favorite: true, rating: 2 }),
    ]);
    useStore.getState().setReviewIndex(2);

    useStore.getState().setFavoritesFilter(true);
    useStore.getState().setMinRatingFilter(4);

    const state = useStore.getState();
    expect(state.reviewIndex).toBe(0);
    expect(state.filteredVideos.map((video) => video.id)).toEqual(['a']);
  });

  test('saving unrelated settings changes preserves the active sort and grouping state', () => {
    useStore.getState().setSortBy('size');
    useStore.getState().setSortOrder('desc');
    useStore.getState().setGroupByFolder(false);

    useStore.getState().updateSettings({
      ...useStore.getState().settings,
      hardwareAccel: !useStore.getState().settings.hardwareAccel,
    });

    const state = useStore.getState();
    expect(state.sortBy).toBe('size');
    expect(state.sortOrder).toBe('desc');
    expect(state.groupByFolder).toBe(false);
  });

  test('required features stay enabled even if settings updates try to turn them off', () => {
    const { settings, updateSettings } = useStore.getState();

    updateSettings({
      ...settings,
      features: {
        ...settings.features,
        ratings: false,
        favorites: false,
        codecBadges: false,
        compatibilityCheck: false,
        globalMute: false,
        nextUndecided: false,
      },
    });

    expect(useStore.getState().settings.features).toEqual({
      ...settings.features,
      ratings: false,
      favorites: false,
      codecBadges: true,
      compatibilityCheck: true,
      globalMute: true,
      nextUndecided: true,
    });
  });

  test('duplicate result actions annotate videos and allow a manual keeper override through the store API', () => {
    useStore.getState().setVideos([
      makeVideo('a', { path: 'D:\\Media\\z.mp4', width: 1280, height: 720, sizeBytes: 100 }),
      makeVideo('b', { path: 'D:\\Media\\a.mp4', width: 1920, height: 1080, sizeBytes: 150 }),
      makeVideo('c', { path: 'D:\\Media\\c.mp4', width: 640, height: 480, sizeBytes: 80 }),
    ]);

    useStore.getState().setDuplicateGroups([
      makeGroup({ videoIds: ['a', 'b'], suggestedKeeperId: null }),
      makeGroup({ id: 'group-2', videoIds: ['b', 'c'], suggestedKeeperId: null, reason: 'Other' }),
    ]);

    let state = useStore.getState();
    expect(state.duplicateGroupsMode).toBe(true);
    expect(state.duplicateGroups[0]?.suggestedKeeperId).toBe('b');
    expect(state.videos.find((video) => video.id === 'b')?.duplicateSuggestedKeeper).toBe(true);

    useStore.getState().setManualDuplicateKeeper('group-1', 'a');
    state = useStore.getState();
    expect(state.duplicateGroups[0]?.manualSuggestedKeeperId).toBe('a');
    expect(state.duplicateGroups[0]?.suggestedKeeperId).toBe('a');
    expect(state.videos.find((video) => video.id === 'a')?.duplicateSuggestedKeeper).toBe(true);
  });

  test('review entry and deleted-video removal keep navigation and duplicate groups consistent', () => {
    useStore.getState().setVideos([
      makeVideo('a', { path: 'D:\\Media\\a.mp4' }),
      makeVideo('b', { path: 'D:\\Media\\b.mp4' }),
      makeVideo('c', { path: 'D:\\Media\\c.mp4' }),
    ]);
    useStore.getState().setDuplicateGroups([
      makeGroup({ videoIds: ['a', 'b'], suggestedKeeperId: 'b' }),
      makeGroup({ id: 'group-2', videoIds: ['b', 'c'], suggestedKeeperId: 'b', reason: 'Other' }),
    ]);

    useStore.getState().enterReviewAndPlay('b', ['c', 'b']);
    useStore.getState().setGridSelectionIds(new Set(['a', 'b', 'c']));
    useStore.getState().setGridSelectionAnchorId('b');
    let state = useStore.getState();
    expect(state.reviewMode).toBe(true);
    expect(state.reviewScopeIds).toEqual(['c', 'b']);
    expect(state.reviewIndex).toBe(1);
    expect(state.activeReviewVideoPath).toBe('D:\\Media\\b.mp4');

    useStore.getState().removeDeletedVideos(['D:\\Media\\b.mp4']);
    state = useStore.getState();
    expect(state.videos.map((video) => video.id)).toEqual(['a', 'c']);
    expect(state.duplicateGroups).toEqual([]);
    expect(state.duplicateGroupsMode).toBe(false);
    expect(state.reviewMode).toBe(false);
    expect(state.reviewIndex).toBe(0);
    expect(state.reviewScopeIds).toBeNull();
    expect(state.activeReviewVideoPath).toBeNull();
    expect(Array.from(state.gridSelectionIds)).toEqual(['a', 'c']);
    expect(state.gridSelectionAnchorId).toBeNull();
  });

  test('ignored duplicate pair settings are normalized and persisted through the public settings actions', async () => {
    useStore.getState().addIgnoredDuplicatePairs(['ABCDEFABCDEFABCD|0011223344556677', 'bad']);
    await flushMicrotasks();
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).toEqual([
      '0011223344556677|abcdefabcdefabcd',
    ]);

    useStore.getState().removeIgnoredDuplicatePairs(['0011223344556677|ABCDEFABCDEFABCD']);
    await flushMicrotasks();
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).toEqual([]);

    useStore.getState().addIgnoredDuplicatePairs(['0011223344556677|ABCDEFABCDEFABCD']);
    await flushMicrotasks();
    useStore.getState().clearIgnoredDuplicatePairs();
    await flushMicrotasks();
    expect(useStore.getState().settings.duplicates.ignoredDuplicatePairs).toEqual([]);
    expect(electronAPI.saveConfig).toHaveBeenCalled();
  });

  test('loading persisted legacy settings prunes stale recents, migrates invalid fields, and saves the cleaned config', async () => {
    electronAPI.getConfig.mockResolvedValue({
      theme: 'light',
      keyKeep: 'K',
      appMode: 'legacy',
      cacheLocation: 'unknown',
      autoPruneMissingSubfolderCache: 'broken',
      removeEmptyFoldersAfterDelete: 'broken',
      recentDirectories: ['D:\\Keep', 'D:\\Missing'],
      recentDirectoryTimestamps: {
        'D:\\Keep': 111,
        'D:\\Missing': 222,
      },
      duplicates: {
        comparisonMode: 'broken',
        sampleCount: 6,
        ignoredDuplicatePairs: ['ABCDEFABCDEFABCD|0011223344556677', 'bad'],
      },
    });
    electronAPI.validateDroppedPath.mockImplementation(async (target: string) => ({
      valid: target === 'D:\\Keep',
      isDirectory: target === 'D:\\Keep',
    }));

    await useStore.getState().loadSettings();

    const { settings } = useStore.getState();
    expect(settings.theme).toBe('light');
    expect(settings.keyKeep).toEqual({ key: 'k', ctrl: false, shift: false, alt: false });
    expect(settings.cacheLocation).toBe('centralised');
    expect(settings.autoPruneMissingSubfolderCache).toBe(false);
    expect(settings.removeEmptyFoldersAfterDelete).toBe(false);
    expect(settings.recentDirectories).toEqual(['D:\\Keep']);
    expect(settings.recentDirectoryTimestamps).toEqual({ 'D:\\Keep': 111 });
    expect(settings.duplicates.comparisonMode).toBe('visual');
    expect(settings.duplicates.sampleCount).toBe(3);
    expect(settings.duplicates.ignoredDuplicatePairs).toEqual(['abcdefabcdefabcd|0011223344556677']);
    expect(electronAPI.validateDroppedPath).toHaveBeenCalledTimes(2);
    expect(electronAPI.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      cacheLocation: 'centralised',
      recentDirectories: ['D:\\Keep'],
      recentDirectoryTimestamps: { 'D:\\Keep': 111 },
    }));
  });
});
