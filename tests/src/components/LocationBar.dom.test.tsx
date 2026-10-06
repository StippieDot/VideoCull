// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import LocationBar from '../../../src/components/LocationBar';
import {
  buildFolderMenu,
  buildVideoMenu,
  collapseSegments,
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
    reveal: vi.fn(), copyPath: vi.fn(), playExternally: vi.fn(), goToFolder: vi.fn(), showFolderInGrid: vi.fn(),
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

test('the grid folder menu counts the folder and lists every folder to go to', () => {
  const context = {
    mode: 'grid' as const, folder: `${ROOT}\\Trips`, videos: VIDEOS, filteredVideos: VIDEOS,
    directories: [ROOT], folderFilterPath: null, canNarrowReview: true,
  };
  const menu = buildFolderMenu(context, actionsMock());
  expect(menu.title).toBe('Trips');
  expect(menu.detail).toBe('2 videos · 1 to review · 200 B');
  expect(labels(menu.items)).toEqual(['Review This Folder', 'Show Only This Folder', 'Regenerate Thumbnails', 'Reveal in Explorer', 'Copy Path', 'Go to Folder']);
  const goTo = menu.items.find((item) => item.type === 'submenu');
  expect(goTo?.type === 'submenu' && goTo.items.map((entry) => [entry.label, entry.detail, Boolean(entry.current)])).toEqual([
    ['Trips', '1 to review', true],
    ['Clips', '1 to review', false],
  ]);

  const filtered = buildFolderMenu({ ...context, folderFilterPath: `${ROOT}\\Trips` }, actionsMock());
  expect(labels(filtered.items)).toContain('Show All Folders');

  // A folder above the loaded one has no videos of its own: no review or filter actions.
  const parent = buildFolderMenu({ ...context, folder: 'D:\\' }, actionsMock());
  expect(labels(parent.items)).toEqual(['Regenerate Thumbnails', 'Reveal in Explorer', 'Copy Path', 'Go to Folder']);
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

  const appActions = () => ({ reviewFolder: vi.fn(), regenerateThumbnails: vi.fn(), findDuplicates: vi.fn(), openDuplicateSettings: vi.fn() });

  test('shows the grid folder on screen and runs its menu from the keyboard', () => {
    const actions = appActions();
    render(<LocationBar sessionTitle="Media" appActions={actions} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['D:', 'Media', 'Trips']);

    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    expect(screen.getByRole('menu', { name: 'Trips' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Review This Folder');
    // Enter on a focused button is the browser's click.
    act(() => (document.activeElement as HTMLElement).click());
    expect(actions.reviewFolder).toHaveBeenCalledWith(`${ROOT}\\Trips`);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('arrow keys reach Go to Folder and move between path parts', () => {
    render(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    const menu = screen.getByRole('menu', { name: 'Trips' });

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Go to Folder');
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Trips1 to review');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    act(() => (document.activeElement as HTMLElement).click());
    expect(useStore.getState().gridFolderJump?.folderPath).toBe(`${ROOT}\\Clips`);

    act(() => screen.getByRole('button', { name: 'Trips' }).click());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' });
    expect(screen.getByRole('menu', { name: 'Media' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Media');
  });

  test('in review it shows the open video, and duplicates get their own menu', () => {
    useStore.setState({ reviewMode: true, activeReviewVideoPath: VIDEOS[1].path });
    const { rerender } = render(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['D:', 'Media', 'Trips', 'b.mp4']);

    useStore.setState({ reviewMode: false, duplicateGroupsMode: true, duplicateGroups: [makeDuplicateGroup({ videoIds: ['a', 'b'] })] });
    rerender(<LocationBar sessionTitle="Media" appActions={appActions()} />);
    act(() => screen.getByRole('button', { name: 'Duplicates · 1 group' }).click());
    expect(screen.getByRole('menu', { name: 'Duplicates' }).textContent).toContain('1 group · 2 videos · 100 B to reclaim');
    act(() => screen.getByRole('menuitem', { name: 'Back to Grid' }).click());
    expect(useStore.getState().duplicateGroupsMode).toBe(false);
  });
});
