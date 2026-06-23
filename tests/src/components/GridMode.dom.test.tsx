// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { vi } from 'vitest';
import GridMode from '../../../src/components/GridMode';
import useStore from '../../../src/store';
import { makeVideo } from '../../helpers/videoFactory';

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
    if (listRef) listRef.current = { element: { scrollTop: 0 } };
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
    Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
    Object.assign(window, {
      electronAPI: {
        saveConfig: vi.fn().mockResolvedValue(true),
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
});
