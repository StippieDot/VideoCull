// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import CommandPalette, { filterCommands, formatAccelerator, parseQuery, rankFolders } from '../../../src/components/CommandPalette';
import useStore from '../../../src/store';
import type { AppCommand } from '../../../src/types';
import { makeVideo } from '../../helpers/videoFactory';

// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const COMMANDS: AppCommand[] = [
  { id: 'File > Open Folder', path: ['File', 'Open Folder...'], accelerator: 'CmdOrCtrl+O', enabled: true, checked: null },
  { id: 'View > Sort By > Size', path: ['View', 'Sort By', 'Size'], accelerator: null, enabled: true, checked: false },
  { id: 'View > Sort By > Name', path: ['View', 'Sort By', 'Name'], accelerator: null, enabled: true, checked: true },
  { id: 'File > Rescan', path: ['File', 'Rescan'], accelerator: 'F5', enabled: false, checked: null },
];

test('matches every query word anywhere in the menu path', () => {
  expect(filterCommands(COMMANDS, 'sort size').map((command) => command.id)).toEqual(['View > Sort By > Size']);
  expect(filterCommands(COMMANDS, '  ')).toHaveLength(4);
});

const FOLDERS = [
  { path: 'D:\\Media\\Trips', label: 'Trips', count: 4, toReview: 1 },
  { path: 'D:\\Media\\Clips\\Old', label: 'Clips\\Old', count: 9, toReview: 6 },
  { path: 'D:\\Media\\Clips', label: 'Clips', count: 2, toReview: 0 },
];

test('a leading > / or @ narrows the search to one kind', () => {
  expect(parseQuery('/ Clips old')).toEqual({ source: 'folders', text: 'Clips old', words: ['clips', 'old'] });
  expect(parseQuery('@beach').source).toBe('videos');
  expect(parseQuery('>sort').source).toBe('commands');
  expect(parseQuery('sort').source).toBeNull();
});

test('folders: typed words must all appear; without a query, recent picks and most to review come first', () => {
  expect(rankFolders(FOLDERS, ['clips', 'old'], []).map((folder) => folder.label)).toEqual(['Clips\\Old']);
  expect(rankFolders(FOLDERS, [], []).map((folder) => folder.label)).toEqual(['Clips\\Old', 'Trips', 'Clips']);
  expect(rankFolders(FOLDERS, [], ['folder:D:\\Media\\Clips']).map((folder) => folder.label)).toEqual(['Clips', 'Clips\\Old', 'Trips']);
});

test('shows accelerators the way Windows users write them', () => {
  expect(formatAccelerator('CmdOrCtrl+Plus')).toBe('Ctrl++');
  expect(formatAccelerator('CmdOrCtrl+Shift+E')).toBe('Ctrl+Shift+E');
});

test('runs the highlighted command with the keyboard and skips disabled ones', async () => {
  const runCommand = vi.fn().mockResolvedValue(true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getCommands: vi.fn().mockResolvedValue(COMMANDS),
    runCommand,
  };
  const onClose = vi.fn();
  render(<CommandPalette onClose={onClose} />);
  await screen.findByText('Open Folder...');
  const input = screen.getByRole('combobox');

  fireEvent.change(input, { target: { value: 'rescan' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(runCommand).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: 'sort' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onClose).toHaveBeenCalled();
  expect(runCommand).toHaveBeenCalledWith('View > Sort By > Name');
});

describe('folders and videos', () => {
  const videos = [
    makeVideo('a', { filename: 'beach.mp4', path: 'D:\\Media\\Trips\\beach.mp4' }, 'D:\\Media\\Trips'),
    makeVideo('b', { filename: 'old.mp4', path: 'D:\\Media\\Clips\\old.mp4' }, 'D:\\Media\\Clips'),
  ];
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getCommands: vi.fn().mockResolvedValue(COMMANDS),
      runCommand: vi.fn(),
    };
    useStore.setState({
      directories: ['D:\\Media'], videos, filteredVideos: videos, reviewMode: true, folderFilter: null,
      gridFolderJump: null, gridVideoJump: null, gridSelectionIds: new Set(), searchQuery: '',
    });
  });

  test('Enter on a folder leaves Review and goes to it; Shift+Enter filters to it', () => {
    const { unmount } = render(<CommandPalette initialQuery="/" onClose={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '/clip' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().reviewMode).toBe(false);
    expect(useStore.getState().gridFolderJump?.folderPath).toBe('D:\\Media\\Clips');
    unmount();

    render(<CommandPalette initialQuery="/clip" onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', shiftKey: true });
    expect(useStore.getState().folderFilter).toEqual({ path: 'D:\\Media\\Clips', includeSubfolders: true });
  });

  test('folder search includes siblings and clears a blocking folder filter while preserving other filters', async () => {
    const kept = makeVideo('kept', { status: 'keep' }, 'D:\\Media\\Hidden');
    const state = useStore.getState();
    state.setVideos([...videos, kept]);
    state.setStatusFilter('pending');
    state.setFolderFilter({ path: 'D:\\Media\\Trips', includeSubfolders: true });
    render(<CommandPalette initialQuery="/" onClose={vi.fn()} />);

    expect(screen.getByRole('option', { name: /^Clips/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /^Hidden/ })).toBeNull();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '/clip' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(useStore.getState().folderFilter).toBeNull();
    expect(useStore.getState().statusFilter).toBe('pending');
    expect(useStore.getState().filteredVideos).toHaveLength(2);
    expect(useStore.getState().gridFolderJump?.folderPath).toBe('D:\\Media\\Clips');
  });

  test.each([true, false])('going to an ancestor clears the child folder filter (recursive: %s)', async (includeSubfolders) => {
    const state = useStore.getState();
    state.setVideos([
      makeVideo('parent', { rating: 5 }, 'D:\\Media\\Trips'),
      makeVideo('child', { rating: 5 }, 'D:\\Media\\Trips\\Summer'),
      makeVideo('kept', { status: 'keep', rating: 5 }, 'D:\\Media\\Trips'),
    ]);
    state.setStatusFilter('pending');
    state.setMinRatingFilter(5);
    state.setFolderFilter({ path: 'D:\\Media\\Trips\\Summer', includeSubfolders });
    render(<CommandPalette initialQuery="/Trips" onClose={vi.fn()} />);

    await act(async () => fireEvent.click(screen.getByRole('option', { name: /^Trips\s*1 to review$/ })));
    expect(useStore.getState().folderFilter).toBeNull();
    expect(useStore.getState().statusFilter).toBe('pending');
    expect(useStore.getState().minRatingFilter).toBe(5);
    expect(useStore.getState().filteredVideos.map((video) => video.id).sort()).toEqual(['child', 'parent']);
    expect(useStore.getState().gridFolderJump?.folderPath).toBe('D:\\Media\\Trips');
  });

  test.each([true, false])('going to a descendant retains only a recursive parent filter (recursive: %s)', async (includeSubfolders) => {
    const filter = { path: 'D:\\Media\\Trips', includeSubfolders };
    useStore.getState().setVideos([
      makeVideo('parent', {}, filter.path),
      makeVideo('child', {}, 'D:\\Media\\Trips\\Summer'),
    ]);
    useStore.getState().setFolderFilter(filter);
    render(<CommandPalette initialQuery="/Summer" onClose={vi.fn()} />);

    await act(async () => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }));
    expect(useStore.getState().folderFilter).toBe(includeSubfolders ? filter : null);
    expect(useStore.getState().filteredVideos.some((video) => video.id === 'child')).toBe(true);
    expect(useStore.getState().gridFolderJump?.folderPath).toBe('D:\\Media\\Trips\\Summer');
  });

  test('going to a visible folder preserves the active folder filter', async () => {
    const filter = { path: 'D:\\Media\\Trips', includeSubfolders: false };
    useStore.getState().setFolderFilter(filter);
    render(<CommandPalette initialQuery="/trip" onClose={vi.fn()} />);

    await act(async () => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' }));
    expect(useStore.getState().folderFilter).toBe(filter);
    expect(useStore.getState().gridFolderJump?.folderPath).toBe(filter.path);
  });

  test.each(videos)('Ctrl+Enter on $filename replaces a duplicate Review scope with the matching library scope', async (video) => {
    useStore.setState({ duplicateGroupsMode: true, reviewScopeIds: ['b'], reviewIndex: 0 });
    render(<CommandPalette initialQuery={`@${video.filename}`} onClose={vi.fn()} />);

    await act(async () => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', ctrlKey: true }));
    expect(useStore.getState().duplicateGroupsMode).toBe(false);
    expect(useStore.getState().reviewMode).toBe(true);
    expect(useStore.getState().reviewScopeIds).toEqual(['a', 'b']);
    expect(useStore.getState().reviewIndex).toBe(videos.indexOf(video));
    expect(useStore.getState().activeReviewVideoPath).toBe(video.path);
  });

  test('without a prefix it lists each kind; a video is selected and scrolled to, or opened in Review with Ctrl+Enter', async () => {
    const { unmount } = render(<CommandPalette initialQuery="beach" onClose={vi.fn()} />);
    expect(screen.getByRole('option', { name: /beach\.mp4/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Search videos for “beach”' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(useStore.getState().gridVideoJump?.videoId).toBe('a');
    expect([...useStore.getState().gridSelectionIds]).toEqual(['a']);
    unmount();

    render(<CommandPalette initialQuery="@old" onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', ctrlKey: true });
    expect(useStore.getState().reviewMode).toBe(true);
    expect(useStore.getState().reviewIndex).toBe(1);
  });

  test('the last row hands the text to the grid search', () => {
    render(<CommandPalette initialQuery="@beach" onClose={vi.fn()} />);
    act(() => screen.getByRole('option', { name: 'Search videos for “beach”' }).click());
    expect(useStore.getState().searchQuery).toBe('beach');
    expect(useStore.getState().reviewMode).toBe(false);
  });
});
