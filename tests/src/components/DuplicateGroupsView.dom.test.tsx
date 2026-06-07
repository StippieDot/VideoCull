// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { vi } from 'vitest';
import DuplicateGroupsView from '../../../src/components/DuplicateGroupsView';
import useStore from '../../../src/store';
import { resetPerfDevMock } from '../../helpers/perfDevMock';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';

vi.mock('react-window', () => ({
  List: ({
    rowCount,
    rowComponent: RowComponent,
    listRef,
  }: {
    rowCount: number;
    rowComponent: ComponentType<{ index: number; style: Record<string, unknown>; ariaAttributes: Record<string, unknown> }>;
    listRef?: { current: unknown };
  }) => {
    if (listRef) {
      listRef.current = { element: { scrollTop: 0 } };
    }
    return (
      <div data-testid="virtual-list">
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

    await userEvent.click(await screen.findByRole('button', { name: 'Select suggested deletions' }));
    await userEvent.click(screen.getByRole('button', { name: /Mark selected for deletion/i }));

    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'b')?.status).toBe('delete');
      expect(useStore.getState().videos.find((video) => video.id === 'a')?.status).toBe('pending');
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
});
