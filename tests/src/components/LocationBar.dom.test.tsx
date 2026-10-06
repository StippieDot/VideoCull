// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import LocationBar from '../../../src/components/LocationBar';
import {
  buildFolderMenu,
  buildVideoMenu,
  buildSubfolderMenu,
  collapseSegments,
  listSubfolders,
  reclaimableBytes,
  splitPath,
  type LocationActions,
} from '../../../src/components/locationMenus';
import useStore from '../../../src/store';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';

const ROOT = 'D:\\Media';
const VIDEOS = [
  makeVideo('a', { status: 'keep' }, `${ROOT}\\Trips`),
  makeVideo('b', {}, `${ROOT}\\Trips`),
  makeVideo('c', {}, `${ROOT}\\Clips`),
];

function actionsMock(): LocationActions {
  return {
    reviewFolder: vi.fn(), reviewOnlyFolder: vi.fn(), filterToPath: vi.fn(), regenerateThumbnails: vi.fn(),
    reveal: vi.fn(), copyPath: vi.fn(), playExternally: vi.fn(), openFolderSearch: vi.fn(), showFolderInGrid: vi.fn(),
    findDuplicates: vi.fn(), openDuplicateSettings: vi.fn(), backToGrid: vi.fn(),
  };
}

function labels(items: Array<{ type: string; label?: string }>) {
  return items.filter((item) => item.type !== 'separator').map((item) => item.label);
}

test('splits paths into clickable parts and collapses the middle of long ones', () => {
  expect(splitPath('P:\\Downloads\\New')).toEqual([
    { label: 'P:', path: 'P:\\' },
    { label: 'Downloads', path: 'P:\\Downloads' },
    { label: 'New', path: 'P:\\Downloads\\New' },
  ]);
  expect(splitPath('\\\\nas\\share\\Clips').map((segment) => segment.path)).toEqual(['\\\\nas\\share', '\\\\nas\\share\\Clips']);
  expect(collapseSegments([1, 2, 3, 4, 5], 0)).toEqual([1, 2, 3, 4, 5]);
  expect(collapseSegments([1, 2, 3, 4, 5], 2)).toEqual([1, null, 4, 5]);
  // The last part always stays.
  expect(collapseSegments([1, 2, 3], 9)).toEqual([1, null, 3]);
});

test('the grid folder menu counts the folder and offers the folder search', () => {
  const context = {
    mode: 'grid' as const, folder: `${ROOT}\\Trips`, videos: VIDEOS, filteredVideos: VIDEOS,
    directories: [ROOT], canNarrowReview: true,
  };
  const menu = buildFolderMenu(context, actionsMock());
  expect(menu.title).toBe('Trips');
  expect(menu.detail).toBe('2 videos · 1 to review · 200 B');
  expect(labels(menu.items)).toEqual(['Review This Folder', 'Regenerate Thumbnails', 'Reveal in Explorer', 'Copy Path', 'Go to Folder...']);

  // A folder above the loaded one has no videos of its own: nothing to review.
  const parent = buildFolderMenu({ ...context, folder: 'D:\\' }, actionsMock());
  expect(labels(parent.items)).toEqual(['Regenerate Thumbnails', 'Reveal in Explorer', 'Copy Path', 'Go to Folder...']);
});

test('a › list offers all of the folder before it, then each folder one level down, and filters to the choice', () => {
  const videos = [...VIDEOS, makeVideo('d', { status: 'keep' }, `${ROOT}\\Trips\\2024\\June`)];
  expect(listSubfolders(videos, 'D:\\')).toEqual([{ path: ROOT, label: 'Media', count: 4, toReview: 2 }]);
  expect(listSubfolders(videos, `${ROOT}\\Trips`)).toEqual([{ path: `${ROOT}\\Trips\\2024`, label: '2024', count: 1, toReview: 0 }]);

  const actions = actionsMock();
  const scope = { pathFilter: `${ROOT}\\Trips\\2024`, directories: [ROOT] };
  const menu = buildSubfolderMenu(videos, ROOT, scope, actions);
  const rows = menu.items.filter((item) => item.type === 'item');
  expect(rows.map((item) => item.type === 'item' && [item.label, item.detail, Boolean(item.current)])).toEqual([
    ['All of Media', '2 to review', false],
    ['Clips', '1 to review', false],
    // Ticked: the shown folder lies inside it.
    ['Trips', '1 to review', true],
  ]);
  rows.forEach((item) => item.type === 'item' && item.onSelect());
  // All of the loaded folder is the same as no filter.
  expect(vi.mocked(actions.filterToPath).mock.calls).toEqual([[null], [`${ROOT}\\Clips`], [`${ROOT}\\Trips`]]);
});

test('the video menu describes the video and only narrows review when it can', () => {
  const video = makeVideo('clip', { sizeBytes: 1024 * 1024, durationSecs: 983, width: 1920, height: 1080 });
  const menu = buildVideoMenu(video, false, actionsMock());
  expect(menu.title).toBe('clip.mp4');
  expect(menu.detail).toBe('1.0 MB · 16:23 · 1080p · To review');
  expect(labels(menu.items)).toEqual(['Reveal in Explorer', 'Play Externally', 'Copy Path', 'Show Folder in Grid']);
});

test('reclaimable space counts everything except each group\'s keeper', () => {
  const videosById = new Map([
    ['a', makeVideo('a', { sizeBytes: 500 })],
    ['b', makeVideo('b', { sizeBytes: 300 })],
    ['c', makeVideo('c', { sizeBytes: 200 })],
  ]);
  expect(reclaimableBytes([makeDuplicateGroup({ videoIds: ['a', 'b', 'c'], suggestedKeeperId: 'b' })], videosById)).toBe(700);
  expect(reclaimableBytes([makeDuplicateGroup({ videoIds: ['a', 'b'], suggestedKeeperId: null })], videosById)).toBe(300);
});

describe('LocationBar', () => {
  beforeEach(() => {
    useStore.setState({
      directories: [ROOT],
      videos: VIDEOS,
      filteredVideos: VIDEOS,
      reviewMode: false,
      duplicateGroupsMode: false,
      gridFolderJump: null,
      folderFilterPath: null,
      pathFilter: null,
      statusFilter: 'all',
      searchQuery: '',
    });
  });

  const appActions = () => ({
    reviewFolder: vi.fn(), regenerateThumbnails: vi.fn(), findDuplicates: vi.fn(), openDuplicateSettings: vi.fn(), openFolderSearch: vi.fn(),
  });
  const buttonNames = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
  const shownIds = () => useStore.getState().filteredVideos.map((video) => video.id);

  test('the › lists filter the grid to a folder and everything below it, and back', () => {
    render(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    expect(buttonNames()).toEqual(['D:', 'Folders in D:', 'Media', 'Folders in Media']);

    act(() => screen.getByRole('button', { name: 'Folders in Media' }).click());
    // Opens on what is shown: all of the loaded folder.
    expect(document.activeElement?.textContent).toBe('All of Media2 to review');
    act(() => screen.getByRole('menuitemradio', { name: /^Trips/ }).click());
    expect(useStore.getState().pathFilter).toBe(`${ROOT}\\Trips`);
    expect(shownIds()).toEqual(['a', 'b']);
    expect(buttonNames()).toEqual(['D:', 'Folders in D:', 'Media', 'Folders in Media', 'Trips']);

    act(() => screen.getByRole('button', { name: 'Folders in Media' }).click());
    expect(document.activeElement?.textContent).toBe('Trips1 to review');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    act(() => (document.activeElement as HTMLElement).click());
    expect(useStore.getState().pathFilter).toBeNull();
    expect(shownIds()).toHaveLength(3);
  });

  test('path parts keep their action menus, run from the keyboard', () => {
    const actions = appActions();
    useStore.getState().setPathFilter(`${ROOT}\\Trips`);
    render(<LocationBar sessionTitle="Media" appActions={actions} />);

    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    expect(screen.getByRole('menu', { name: 'Trips' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Review This Folder');
    // Enter on a focused button is the browser's click.
    act(() => (document.activeElement as HTMLElement).click());
    expect(actions.reviewFolder).toHaveBeenCalledWith(`${ROOT}\\Trips`);
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' });
    expect(screen.getByRole('menu', { name: 'Folders in Media' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' });
    expect(screen.getByRole('menu', { name: 'Media' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Copy Path');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Media');
  });

  test('a path that does not fit hides middle parts behind a … that lists them, each with its own menu', () => {
    // jsdom has no layout: pretend the path never fits, so every middle part hides.
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    const deep = 'P:\\a\\b\\c\\d\\e';
    const videos = [makeVideo('deep', {}, deep)];
    useStore.setState({ directories: ['P:\\'], videos, filteredVideos: videos });
    useStore.getState().setPathFilter(deep);
    render(<LocationBar sessionTitle="P:" appActions={appActions()} />);
    scrollWidth.mockRestore();
    clientWidth.mockRestore();
    expect(buttonNames()).toEqual(['P:', 'Folders in P:', 'Hidden folders', 'Folders in d', 'e']);

    act(() => screen.getByRole('button', { name: 'Hidden folders' }).click());
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['a', 'b', 'c', 'd']);
    act(() => screen.getByRole('menuitemradio', { name: 'b' }).click());
    expect(screen.getByRole('menu', { name: 'b' }).textContent).toContain('1 video · 1 to review');
    expect(screen.getByRole('menuitem', { name: 'Reveal in Explorer' })).toBeTruthy();
  });

  test('with several loaded folders, a switcher shows them all or one of them', () => {
    const videos = [...VIDEOS, makeVideo('p', {}, 'P:\\Clips')];
    useStore.setState({ directories: [ROOT, 'P:\\'], videos, filteredVideos: videos });
    render(<LocationBar sessionTitle="Media + 1 more" appActions={appActions()} />);
    expect(buttonNames()).toEqual(['Loaded folders']);
    expect(screen.getByText('Media + 1 more')).toBeTruthy();

    act(() => screen.getByRole('button', { name: 'Loaded folders' }).click());
    expect(screen.getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['All Loaded Folders3 to review', 'true'],
      [`${ROOT}2 to review`, 'false'],
      ['P:\\1 to review', 'false'],
    ]);
    act(() => screen.getByRole('menuitemradio', { name: /^P:/ }).click());
    expect(shownIds()).toEqual(['p']);
    expect(buttonNames()).toEqual(['Loaded folders', 'P:', 'Folders in P:']);
  });

  test('in review it shows the open video, and duplicates get their own menu', () => {
    useStore.setState({ reviewMode: true, activeReviewVideoPath: VIDEOS[1].path });
    const { rerender } = render(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    // Review shows a plain path: no subfolder lists.
    expect(buttonNames()).toEqual(['D:', 'Media', 'Trips', 'b.mp4']);

    useStore.setState({ reviewMode: false, duplicateGroupsMode: true, duplicateGroups: [makeDuplicateGroup({ videoIds: ['a', 'b'] })] });
    rerender(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    act(() => screen.getByRole('button', { name: 'Duplicates · 1 group' }).click());
    expect(screen.getByRole('menu', { name: 'Duplicates' }).textContent).toContain('1 group · 2 videos · 100 B to reclaim');
    act(() => screen.getByRole('menuitem', { name: 'Back to Grid' }).click());
    expect(useStore.getState().duplicateGroupsMode).toBe(false);
  });
});
