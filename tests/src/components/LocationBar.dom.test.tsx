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
    reviewFolder: vi.fn(), reviewOnlyFolder: vi.fn(), showOnlyFolder: vi.fn(), regenerateThumbnails: vi.fn(),
    reveal: vi.fn(), copyPath: vi.fn(), playExternally: vi.fn(), goToFolder: vi.fn(), openFolderSearch: vi.fn(), showFolderInGrid: vi.fn(),
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
  expect(collapseSegments([1, 2, 3, 4, 5, 6])).toEqual([1, null, 4, 5, 6]);
  expect(collapseSegments([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
});

test('the grid folder menu counts the folder and offers the folder search', () => {
  const context = {
    mode: 'grid' as const, folder: `${ROOT}\\Trips`, videos: VIDEOS, filteredVideos: VIDEOS,
    directories: [ROOT], folderFilterPath: null, canNarrowReview: true,
  };
  const menu = buildFolderMenu(context, actionsMock());
  expect(menu.title).toBe('Trips');
  expect(menu.detail).toBe('2 videos · 1 to review · 200 B');
  expect(labels(menu.items)).toEqual(['Review This Folder', 'Show Only This Folder', 'Regenerate Thumbnails', 'Reveal in Explorer', 'Copy Path', 'Go to Folder...']);

  const filtered = buildFolderMenu({ ...context, folderFilterPath: `${ROOT}\\Trips` }, actionsMock());
  expect(labels(filtered.items)).toContain('Show All Folders');

  // A folder above the loaded one has no videos of its own: no review or filter actions.
  const parent = buildFolderMenu({ ...context, folder: 'D:\\' }, actionsMock());
  expect(labels(parent.items)).toEqual(['Regenerate Thumbnails', 'Reveal in Explorer', 'Copy Path', 'Go to Folder...']);
});

test('subfolder lists go one level down, count everything below and tick the current one', () => {
  const videos = [...VIDEOS, makeVideo('d', { status: 'keep' }, `${ROOT}\\Trips\\2024\\June`)];
  expect(listSubfolders(videos, 'D:\\')).toEqual([{ path: ROOT, label: 'Media', count: 4, toReview: 2 }]);
  expect(listSubfolders(videos, `${ROOT}\\Trips`)).toEqual([{ path: `${ROOT}\\Trips\\2024`, label: '2024', count: 1, toReview: 0 }]);

  const menu = buildSubfolderMenu(videos, ROOT, `${ROOT}\\Trips`, actionsMock());
  expect(menu.items.map((item) => item.type === 'item' && [item.label, item.detail, Boolean(item.current)])).toEqual([
    ['Clips', '1 to review', false],
    ['Trips', '1 to review', true],
  ]);
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
      gridTopFolder: `${ROOT}\\Trips`,
      gridFolderJump: null,
      folderFilterPath: null,
    });
  });

  const appActions = () => ({
    reviewFolder: vi.fn(), regenerateThumbnails: vi.fn(), findDuplicates: vi.fn(), openDuplicateSettings: vi.fn(), openFolderSearch: vi.fn(),
  });
  const buttonNames = () => screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

  test('shows the grid folder on screen and runs its menu from the keyboard', () => {
    const actions = appActions();
    render(<LocationBar sessionTitle="Media" appActions={actions} />);
    expect(buttonNames()).toEqual(['D:', 'Folders in D:', 'Media', 'Folders in Media', 'Trips']);

    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    expect(screen.getByRole('menu', { name: 'Trips' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Review This Folder');
    // Enter on a focused button is the browser's click.
    act(() => (document.activeElement as HTMLElement).click());
    expect(actions.reviewFolder).toHaveBeenCalledWith(`${ROOT}\\Trips`);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('arrow keys reach Go to Folder and the subfolder lists between path parts', () => {
    const actions = appActions();
    render(<LocationBar sessionTitle="Media" appActions={actions} />);
    act(() => screen.getByRole('button', { name: 'Trips' }).click());

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Trips' }), { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Go to Folder...Ctrl+G');
    act(() => (document.activeElement as HTMLElement).click());
    expect(actions.openFolderSearch).toHaveBeenCalled();

    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' });
    const list = screen.getByRole('menu', { name: 'Folders in Media' });
    // Opens on the folder you are in.
    expect(document.activeElement?.textContent).toBe('Trips1 to review');
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    act(() => (document.activeElement as HTMLElement).click());
    expect(useStore.getState().gridFolderJump?.folderPath).toBe(`${ROOT}\\Clips`);

    act(() => screen.getByRole('button', { name: 'Media' }).click());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Media');
  });

  test('the … in a long path lists the folders it hides, each with its own menu', () => {
    const deep = 'P:\\a\\b\\c\\d\\e';
    const videos = [makeVideo('deep', {}, deep)];
    useStore.setState({ directories: ['P:\\'], videos, filteredVideos: videos, gridTopFolder: deep });
    render(<LocationBar sessionTitle="P:" appActions={appActions()} />);
    expect(buttonNames()).toEqual(['P:', 'Folders in P:', 'Hidden folders', 'Folders in b', 'c', 'Folders in c', 'd', 'Folders in d', 'e']);

    act(() => screen.getByRole('button', { name: 'Hidden folders' }).click());
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['a', 'b']);
    act(() => screen.getByRole('menuitemradio', { name: 'b' }).click());
    expect(screen.getByRole('menu', { name: 'b' }).textContent).toContain('1 video · 1 to review');
    expect(screen.getByRole('menuitem', { name: 'Reveal in Explorer' })).toBeTruthy();
  });

  test('a trailing › lists the subfolders, and several loaded folders get a switcher', () => {
    useStore.setState({
      directories: [ROOT, 'P:\\'],
      videos: [...VIDEOS, makeVideo('p', {}, 'P:\\Clips')],
      filteredVideos: [...VIDEOS, makeVideo('p', {}, 'P:\\Clips')],
      gridTopFolder: ROOT,
    });
    render(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    expect(buttonNames()).toEqual(['Loaded folders', 'D:', 'Folders in D:', 'Media', 'Folders in Media']);

    act(() => screen.getByRole('button', { name: 'Loaded folders' }).click());
    expect(screen.getByRole('menu').textContent).toContain('P:\\');
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
