// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { vi } from 'vitest';
import GridMode from '../../../src/components/GridMode';
import useStore from '../../../src/store';
import { makeVideo } from '../../helpers/videoFactory';

const virtualListState = vi.hoisted(() => ({
  element: { scrollTop: 0 },
  visibleRows: { startIndex: 0, stopIndex: 0 },
}));

vi.mock('react-window', () => ({
  List: ({
    rowCount,
    rowComponent: RowComponent,
    listRef,
    onRowsRendered,
  }: {
    rowCount: number;
    rowComponent: ComponentType<{ index: number; style: Record<string, unknown>; ariaAttributes: Record<string, unknown> }>;
    listRef?: { current: unknown };
    onRowsRendered?: (
      visibleRows: { startIndex: number; stopIndex: number },
      allRows: { startIndex: number; stopIndex: number }
    ) => void;
  }) => {
    if (listRef) listRef.current = { element: virtualListState.element };
    onRowsRendered?.(virtualListState.visibleRows, virtualListState.visibleRows);
    return (
      <div data-testid="virtual-list">
        {Array.from({ length: rowCount }, (_, index) => (
          <RowComponent key={index} index={index} style={{}} ariaAttributes={{}} />
        ))}
      </div>
    );
  },
}));

vi.mock('../../../src/components/VideoCard', () => ({
  default: ({ video }: { video: { filename: string } }) => <div>{video.filename}</div>,
}));

vi.mock('../../../src/components/ContextMenu', () => ({
  default: () => null,
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

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

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

function renderGrid() {
  return render(<GridMode onReviewFolder={vi.fn()} onRegenerateThumbnails={vi.fn().mockResolvedValue(undefined)} />);
}

describe('GridMode search', () => {
  beforeEach(() => {
    virtualListState.element.scrollTop = 0;
    virtualListState.visibleRows = { startIndex: 0, stopIndex: 0 };
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
    Object.assign(window, {
      electronAPI: {
        saveConfig: vi.fn().mockResolvedValue(true),
        saveCacheAtomic: vi.fn().mockResolvedValue(true),
        openVideo: vi.fn().mockResolvedValue(true),
        openInExplorer: vi.fn().mockResolvedValue(true),
      },
    });
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
    useStore.getState().setDirectory('D:\\Media');
    useStore.getState().setVideos([
      makeVideo('trip', { filename: 'Trip.mp4', path: 'D:\\Media\\Trip.mp4' }),
      makeVideo('meeting', { filename: 'Meeting.mp4', path: 'D:\\Media\\Meeting.mp4' }),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('keeps search outside the virtual list and reports matching videos', async () => {
    renderGrid();

    const searchbox = screen.getByRole('searchbox', { name: /search videos/i });
    expect(screen.getByTestId('virtual-list').contains(searchbox)).toBe(false);

    await userEvent.type(searchbox, 'trip');

    expect(await screen.findByText('1 of 2 videos')).toBeTruthy();
    expect(screen.getByText('Trip.mp4')).toBeTruthy();
    expect(screen.queryByText('Meeting.mp4')).toBeNull();
  });

  test('focuses search with Ctrl+F and clears it before clearing grid selection', async () => {
    useStore.getState().setGridSelectionIds(new Set(['trip']));
    renderGrid();

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const searchbox = screen.getByRole('searchbox', { name: /search videos/i });
    expect(document.activeElement).toBe(searchbox);

    await userEvent.type(searchbox, 'trip');
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useStore.getState().searchQuery).toBe('');
    expect(Array.from(useStore.getState().gridSelectionIds)).toEqual(['trip']);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(Array.from(useStore.getState().gridSelectionIds)).toEqual([]);
  });

  test('focuses search with the configured shortcut instead of hardcoded Ctrl+F', () => {
    useStore.getState().updateSettings({
      keySearch: { key: 'g', ctrl: true, shift: false, alt: false },
    });
    renderGrid();

    const searchbox = screen.getByRole('searchbox', { name: /search videos/i });

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(document.activeElement).not.toBe(searchbox);

    fireEvent.keyDown(window, { key: 'g', ctrlKey: true });
    expect(document.activeElement).toBe(searchbox);
  });

  test('keeps native text selection and clipboard shortcuts inside the search field', () => {
    useStore.getState().updateSettings({
      keySearch: { key: 'c', ctrl: true, shift: false, alt: false },
    });
    useStore.getState().setSearchQuery('trip meeting');
    renderGrid();

    const searchbox = screen.getByRole('searchbox', { name: /search videos/i }) as HTMLInputElement;
    searchbox.focus();
    searchbox.setSelectionRange(0, 4);
    const copyEvent = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    searchbox.dispatchEvent(copyEvent);

    expect(copyEvent.defaultPrevented).toBe(false);
    expect(searchbox.selectionStart).toBe(0);
    expect(searchbox.selectionEnd).toBe(4);
  });

  test('offers a clear action when search has no matches', async () => {
    renderGrid();

    await userEvent.type(screen.getByRole('searchbox', { name: /search videos/i }), 'missing');
    expect(await screen.findByText('No videos match your search.')).toBeTruthy();

    await userEvent.click(screen.getByText('Clear search'));

    await waitFor(() => expect(useStore.getState().searchQuery).toBe(''));
  });

  test('does not activate grid search while review mode is open', () => {
    useStore.setState({ reviewMode: true, searchQuery: 'trip' });
    renderGrid();

    const searchbox = screen.getByRole('searchbox', { name: /search videos/i });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    expect(document.activeElement).not.toBe(searchbox);
    expect(useStore.getState().searchQuery).toBe('trip');
  });

  test('preserves the next surviving video offset when the visible pending batch disappears', async () => {
    useStore.getState().setVideos([
      makeVideo('a', { filename: 'a.mp4' }),
      makeVideo('b', { filename: 'b.mp4' }),
      makeVideo('c', { filename: 'c.mp4' }),
      makeVideo('d', { filename: 'd.mp4' }),
      makeVideo('e', { filename: 'e.mp4' }),
      makeVideo('f', { filename: 'f.mp4' }),
    ]);
    useStore.getState().setStatusFilter('pending');
    useStore.getState().setGroupByFolder(false);
    useStore.getState().setGridSelectionIds(new Set(['d', 'e']));
    virtualListState.visibleRows = { startIndex: 3, stopIndex: 4 };
    renderGrid();
    await waitFor(() => expect(screen.getByText('f.mp4')).toBeTruthy());
    virtualListState.element.scrollTop = 1000;

    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(virtualListState.element.scrollTop).toBe(256));
    expect(screen.getByText('f.mp4')).toBeTruthy();
  });

  test('preserves a surviving visible video offset when grouped pending rows rebuild', async () => {
    useStore.getState().setVideos([
      makeVideo('a0', { filename: 'a0.mp4', path: 'D:\\Media\\Folder A\\a0.mp4' }),
      makeVideo('a1', { filename: 'a1.mp4', path: 'D:\\Media\\Folder A\\a1.mp4' }),
      makeVideo('a2', { filename: 'a2.mp4', path: 'D:\\Media\\Folder A\\a2.mp4' }),
      makeVideo('a3', { filename: 'a3.mp4', path: 'D:\\Media\\Folder A\\a3.mp4' }),
      makeVideo('b0', { filename: 'b0.mp4', path: 'D:\\Media\\Folder B\\b0.mp4' }),
      makeVideo('b1', { filename: 'b1.mp4', path: 'D:\\Media\\Folder B\\b1.mp4' }),
    ]);
    useStore.getState().setStatusFilter('pending');
    useStore.getState().setGroupByFolder(true);
    useStore.getState().setGridSelectionIds(new Set(['a1', 'a2']));
    virtualListState.visibleRows = { startIndex: 6, stopIndex: 7 };
    renderGrid();
    await waitFor(() => expect(screen.getByText('b0.mp4')).toBeTruthy());
    virtualListState.element.scrollTop = 1500;

    await userEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => expect(virtualListState.element.scrollTop).toBe(756));
    expect(screen.getByText('b0.mp4')).toBeTruthy();
  });
});
