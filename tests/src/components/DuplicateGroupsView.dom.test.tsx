// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { vi } from 'vitest';
import DuplicateGroupsView, { __test__ } from '../../../src/components/DuplicateGroupsView';
import useStore from '../../../src/store';
import { resetPerfDevMock } from '../../helpers/perfDevMock';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';

vi.mock('react-window', () => ({
  List: ({
    rowCount,
    rowComponent: RowComponent,
    listRef,
    onScroll,
  }: {
    rowCount: number;
    rowComponent: ComponentType<{ index: number; style: Record<string, unknown>; ariaAttributes: Record<string, unknown> }>;
    listRef?: { current: unknown };
    onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
  }) => {
    return (
      <div
        data-testid="virtual-list"
        ref={(element) => {
          if (listRef) listRef.current = element ? { element } : null;
        }}
        onScroll={onScroll}
      >
        {Array.from({ length: rowCount }, (_, index) => (
          <RowComponent
            key={index}
            index={index}
            style={{}}
            ariaAttributes={{}}
          />
        ))}
      </div>
    );
  },
}));

vi.mock('../../../src/components/VideoCard', () => ({
  default: ({ video }: { video: { filename: string } }) => <div>{video.filename}</div>,
}));

vi.mock('../../../src/components/ContextMenu', () => ({
  default: ({
    items,
  }: {
    items: Array<{ key?: string; label?: string; onSelect?: () => void; type?: string }>;
  }) => (
    <div data-testid="context-menu">
      {items
        .filter((item) => item.type !== 'separator' && item.label)
        .map((item) => (
          <button key={item.key ?? item.label} type="button" onClick={item.onSelect}>
            {item.label}
          </button>
        ))}
    </div>
  ),
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/perf-dev', async () => await import('../../helpers/perfDevMock'));

class ResizeObserverStub {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe() {
    this.callback([{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  disconnect() {}
}

function installElectronApiMock() {
  const electronAPI = {
    openVideo: vi.fn().mockResolvedValue(true),
    openInExplorer: vi.fn().mockResolvedValue(true),
  };
  Object.assign(window, { electronAPI });
  return electronAPI;
}

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

describe('DuplicateGroupsView behavior', () => {
  beforeEach(() => {
    installElectronApiMock();
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
    resetPerfDevMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reuses derived data for duplicate groups whose videos did not change', () => {
    const firstVideos = [makeVideo('a'), makeVideo('b')];
    const secondVideos = [makeVideo('c'), makeVideo('d')];
    const groups = [
      makeDuplicateGroup({ id: 'group-1', videoIds: ['a', 'b'] }),
      makeDuplicateGroup({ id: 'group-2', videoIds: ['c', 'd'] }),
    ];
    const initialVideos = [...firstVideos, ...secondVideos];
    const initial = __test__.buildDuplicateGroupViews(
      groups,
      new Map(initialVideos.map((video) => [video.id, video])),
      new Map()
    );
    const changedVideo = { ...firstVideos[0], status: 'delete' as const };
    const updated = __test__.buildDuplicateGroupViews(
      groups,
      new Map([changedVideo, firstVideos[1], ...secondVideos].map((video) => [video.id, video])),
      initial.cache
    );

    expect(initial.recomputedCount).toBe(2);
    expect(updated.recomputedCount).toBe(1);
    expect(updated.views[0]).not.toBe(initial.views[0]);
    expect(updated.views[1]).toBe(initial.views[1]);
  });

  test('releases virtual row data when the duplicate view unmounts', () => {
    const view = render(<DuplicateGroupsView />);
    expect(__test__.hasActiveRowRuntime()).toBe(true);

    view.unmount();

    expect(__test__.hasActiveRowRuntime()).toBe(false);
  });

  test('selects suggested deletions and marks the non-keeper videos for deletion', async () => {
    const groupId = 'group-1';
    const keeper = makeVideo('a', { duplicateGroupId: groupId, path: 'D:\\Media\\a.mp4' });
    const duplicate = makeVideo('b', { duplicateGroupId: groupId, path: 'D:\\Media\\b.mp4' });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
    });

    render(<DuplicateGroupsView />);

    expect(screen.queryByText('Use checkboxes for batch actions. Right-click a row or group for more actions.')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Select suggested deletions' }));
    await userEvent.click(screen.getByRole('button', { name: /Mark selected as Delete/i }));

    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'b')?.status).toBe('delete');
      expect(useStore.getState().videos.find((video) => video.id === 'a')?.status).toBe('pending');
    });
  });

  test('adds suggested deletions from multiple chosen duplicate groups', async () => {
    const firstKeeper = makeVideo('a', { duplicateGroupId: 'group-1' });
    const firstDuplicate = makeVideo('b', { duplicateGroupId: 'group-1' });
    const secondKeeper = makeVideo('c', { duplicateGroupId: 'group-2' });
    const secondDuplicate = makeVideo('d', { duplicateGroupId: 'group-2' });
    useStore.setState({
      videos: [firstKeeper, firstDuplicate, secondKeeper, secondDuplicate],
      duplicateGroups: [
        makeDuplicateGroup({
          id: 'group-1',
          videoIds: ['a', 'b'],
          suggestedKeeperId: 'a',
          similarity: 99,
        }),
        makeDuplicateGroup({
          id: 'group-2',
          videoIds: ['c', 'd'],
          suggestedKeeperId: 'c',
          similarity: 90,
        }),
      ],
    });

    render(<DuplicateGroupsView />);

    const groupButtons = await screen.findAllByRole('button', { name: 'Select for deletion' });
    expect(groupButtons).toHaveLength(2);
    await userEvent.click(groupButtons[0]!);
    expect(screen.getByRole('button', { name: /Mark selected as Delete \(1\)/i })).toBeTruthy();
    await userEvent.click(groupButtons[1]!);
    expect(screen.getByRole('button', { name: /Mark selected as Delete \(2\)/i })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Mark selected as Delete \(2\)/i }));

    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'b')?.status).toBe('delete');
      expect(useStore.getState().videos.find((video) => video.id === 'a')?.status).toBe('pending');
      expect(useStore.getState().videos.find((video) => video.id === 'c')?.status).toBe('pending');
      expect(useStore.getState().videos.find((video) => video.id === 'd')?.status).toBe('delete');
    });
  });

  test('clears duplicate selections when filters hide the selected videos', async () => {
    const groupId = 'group-1';
    const keeper = makeVideo('a', { duplicateGroupId: groupId, path: 'D:\\Media\\keeper.mp4' });
    const duplicate = makeVideo('b', { duplicateGroupId: groupId, path: 'D:\\Media\\duplicate.mp4' });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
    });

    render(<DuplicateGroupsView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Select suggested deletions' }));
    expect(screen.getByRole('button', { name: /Mark selected as Delete \(1\)/i })).toBeTruthy();

    act(() => {
      useStore.getState().setDuplicatePathFilter('no matching path');
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear selected' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Mark selected as Delete' })).toHaveProperty('disabled', true);
    });
  });

  test('dismisses a duplicate group from the current duplicate review', async () => {
    const groupId = 'group-1';
    const keeper = makeVideo('a', { duplicateGroupId: groupId });
    const duplicate = makeVideo('b', { duplicateGroupId: groupId });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
    });

    render(<DuplicateGroupsView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss group' }));

    await waitFor(() => {
      expect(useStore.getState().duplicateGroups).toEqual([]);
      expect(screen.getByText('No duplicate groups')).toBeTruthy();
    });
  });

  test('does not render an empty thumbnail src when a duplicate row has no thumbnail image', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const groupId = 'group-1';
    const keeper = makeVideo('a', {
      duplicateGroupId: groupId,
      path: 'D:\\Media\\a.mp4',
      thumbnails: [],
      osThumbnail: null,
    });
    const duplicate = makeVideo('b', {
      duplicateGroupId: groupId,
      path: 'D:\\Media\\b.mp4',
      thumbnails: [],
      osThumbnail: null,
    });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
    });

    const { container } = render(<DuplicateGroupsView />);

    await waitFor(() => {
      expect(screen.getByText('a.mp4')).toBeTruthy();
    });

    const rowImages = Array.from(container.querySelectorAll('.duplicate-row img'));
    expect(rowImages).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('sets a manual keeper override from the duplicate video context menu', async () => {
    const groupId = 'group-1';
    const keeper = makeVideo('a', { duplicateGroupId: groupId, path: 'D:\\Media\\a.mp4' });
    const duplicate = makeVideo('b', { duplicateGroupId: groupId, path: 'D:\\Media\\b.mp4' });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
    });

    render(<DuplicateGroupsView />);

    const duplicateRow = await screen.findByText('b.mp4');
    fireEvent.contextMenu(duplicateRow.closest('.duplicate-row')!);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as selected keeper' }));

    await waitFor(() => {
      expect(useStore.getState().duplicateGroups[0]?.manualSuggestedKeeperId).toBe('b');
      expect(useStore.getState().duplicateGroups[0]?.suggestedKeeperId).toBe('b');
      expect(screen.getByText('Selected keeper')).toBeTruthy();
    });
  });

  test('marks file size independently from the other quality metrics', async () => {
    const groupId = 'group-1';
    const smaller = makeVideo('small', {
      duplicateGroupId: groupId,
      filename: 'small.mp4',
      sizeBytes: 100,
      videoBitrate: 3_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSecs: 10,
      path: 'D:\\Media\\small.mp4',
    });
    const better = makeVideo('better', {
      duplicateGroupId: groupId,
      filename: 'better.mp4',
      sizeBytes: 200,
      videoBitrate: 2_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSecs: 10,
      path: 'D:\\Media\\better.mp4',
    });
    useStore.setState({
      videos: [smaller, better],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['small', 'better'],
        suggestedKeeperId: 'better',
      })],
    });

    const { container } = render(<DuplicateGroupsView />);

    await screen.findByText('small.mp4');
    const smallSizeChip = Array.from(container.querySelectorAll('.duplicate-row'))
      .find((row) => row.textContent?.includes('small.mp4'))
      ?.querySelector('.duplicate-meta-chips .meta-chip:last-child');
    const betterSizeChip = Array.from(container.querySelectorAll('.duplicate-row'))
      .find((row) => row.textContent?.includes('better.mp4'))
      ?.querySelector('.duplicate-meta-chips .meta-chip:last-child');

    expect(smallSizeChip?.textContent).toBe('100 B');
    expect(smallSizeChip?.classList.contains('best')).toBe(false);
    expect(betterSizeChip?.textContent).toBe('200 B');
    expect(betterSizeChip?.classList.contains('best')).toBe(true);
  });

  test('marks the larger file size as best when duplicate quality is equal', async () => {
    const groupId = 'group-1';
    const smaller = makeVideo('small', {
      duplicateGroupId: groupId,
      filename: 'small.mp4',
      sizeBytes: 100,
      videoBitrate: 2_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSecs: 10,
      path: 'D:\\Media\\small.mp4',
    });
    const larger = makeVideo('large', {
      duplicateGroupId: groupId,
      filename: 'large.mp4',
      sizeBytes: 200,
      videoBitrate: 2_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      durationSecs: 10,
      path: 'D:\\Media\\large.mp4',
    });
    useStore.setState({
      videos: [smaller, larger],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['small', 'large'],
        suggestedKeeperId: 'small',
      })],
    });

    const { container } = render(<DuplicateGroupsView />);

    await screen.findByText('small.mp4');
    const smallSizeChip = Array.from(container.querySelectorAll('.duplicate-row'))
      .find((row) => row.textContent?.includes('small.mp4'))
      ?.querySelector('.duplicate-meta-chips .meta-chip:last-child');
    const largeSizeChip = Array.from(container.querySelectorAll('.duplicate-row'))
      .find((row) => row.textContent?.includes('large.mp4'))
      ?.querySelector('.duplicate-meta-chips .meta-chip:last-child');

    expect(smallSizeChip?.classList.contains('best')).toBe(false);
    expect(largeSizeChip?.classList.contains('best')).toBe(true);
  });

  test('restores the real duplicate list scroll position when returning from review', async () => {
    const groupId = 'group-1';
    const keeper = makeVideo('a', { duplicateGroupId: groupId });
    const duplicate = makeVideo('b', { duplicateGroupId: groupId });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
      duplicateScrollTop: 420,
      reviewMode: true,
    });

    render(<DuplicateGroupsView />);
    const list = await screen.findByTestId('virtual-list');

    act(() => useStore.getState().setReviewMode(false));
    list.scrollTop = 0;
    fireEvent.scroll(list);

    expect(useStore.getState().duplicateScrollTop).toBe(420);
    await waitFor(() => expect(list.scrollTop).toBe(420));
  });

  test('defers hidden duplicate data updates until review closes', async () => {
    const groupId = 'group-1';
    const keeper = makeVideo('a', { duplicateGroupId: groupId, filename: 'keeper.mp4' });
    const duplicate = makeVideo('b', { duplicateGroupId: groupId, filename: 'duplicate.mp4' });
    useStore.setState({
      videos: [keeper, duplicate],
      duplicateGroups: [makeDuplicateGroup({
        id: groupId,
        videoIds: ['a', 'b'],
        suggestedKeeperId: 'a',
      })],
    });
    render(<DuplicateGroupsView />);
    expect(await screen.findByText('duplicate.mp4')).toBeTruthy();

    act(() => useStore.getState().setReviewMode(true));
    act(() => useStore.setState({
      videos: [keeper, { ...duplicate, filename: 'updated.mp4' }],
    }));

    expect(screen.getByText('duplicate.mp4')).toBeTruthy();
    expect(screen.queryByText('updated.mp4')).toBeNull();

    act(() => useStore.getState().setReviewMode(false));
    expect(await screen.findByText('updated.mp4')).toBeTruthy();
  });
});
