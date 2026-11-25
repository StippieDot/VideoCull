// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ShortVideosDialog from '../../../src/components/ShortVideosDialog';
import useStore from '../../../src/store';
import { makeVideo } from '../../helpers/videoFactory';

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

const statusOf = (id: string) => useStore.getState().videos.find((video) => video.id === id)?.status;

function loadVideos(inView: ReturnType<typeof makeVideo>[], outOfView: ReturnType<typeof makeVideo>[] = []) {
  useStore.setState({ videos: [...inView, ...outOfView], filteredVideos: inView });
}

describe('ShortVideosDialog', () => {
  beforeEach(() => {
    Object.assign(window, { electronAPI: { saveReviewState: vi.fn().mockResolvedValue(true) } });
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  test('previews what will be marked and what is left alone', () => {
    loadVideos([
      makeVideo('a', { durationSecs: 3, sizeBytes: 1024, status: 'pending' }),
      makeVideo('kept', { durationSecs: 3, status: 'keep' }),
      makeVideo('rated', { durationSecs: 3, rating: 4 }),
      makeVideo('long', { durationSecs: 120 }),
      makeVideo('unknown', { durationSecs: null }),
    ]);
    render(<ShortVideosDialog onClose={vi.fn()} />);

    expect(screen.getByText(/1 video \(.*\) will be marked Delete\./)).toBeTruthy();
    expect(screen.getByText('1 marked Keep, left alone')).toBeTruthy();
    expect(screen.getByText('1 rated, left alone')).toBeTruthy();
    expect(screen.getByText('1 video with an unknown length, left alone')).toBeTruthy();
    expect(screen.getByText(/Delete Marked Videos later deletes every video marked Delete/)).toBeTruthy();
  });

  test('marks only the shown short videos in one undoable step', async () => {
    const onClose = vi.fn();
    loadVideos(
      [makeVideo('a', { durationSecs: 3 }), makeVideo('b', { durationSecs: 4 }), makeVideo('long', { durationSecs: 90 })],
      [makeVideo('hidden', { durationSecs: 2 })],
    );
    render(<ShortVideosDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Mark 2 videos' }));

    expect(['a', 'b', 'long', 'hidden'].map(statusOf)).toEqual(['delete', 'delete', 'pending', 'pending']);
    expect(onClose).toHaveBeenCalled();
    const toasts = useStore.getState().toasts;
    const toast = toasts[toasts.length - 1];
    expect(toast?.detail).toBe('2 videos shorter than 10 seconds marked Delete.');

    toast?.action?.();
    expect(['a', 'b'].map(statusOf)).toEqual(['pending', 'pending']);
  });

  test('applies a changed length and refuses one that is not above zero', async () => {
    loadVideos([makeVideo('a', { durationSecs: 3 }), makeVideo('b', { durationSecs: 30 })]);
    render(<ShortVideosDialog onClose={vi.fn()} />);
    const input = screen.getByRole('spinbutton');

    await userEvent.clear(input);
    expect(screen.getByText('Enter a length above 0 seconds.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Mark videos' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(input, '60');
    expect(screen.getByRole('button', { name: 'Mark 2 videos' })).toBeTruthy();
  });

  test('checks again at Apply, so a video decided while the dialog was open is not marked', async () => {
    loadVideos([makeVideo('a', { durationSecs: 3 }), makeVideo('b', { durationSecs: 3 })]);
    render(<ShortVideosDialog onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Mark 2 videos' });

    // Another route (a shortcut, say) keeps b after the preview was drawn but before Apply.
    useStore.setState((state) => ({
      videos: state.videos.map((video) => (video.id === 'b' ? { ...video, status: 'keep' as const } : video)),
      filteredVideos: state.filteredVideos.map((video) => (video.id === 'b' ? { ...video, status: 'keep' as const } : video)),
    }));
    await userEvent.click(button);

    expect(['a', 'b'].map(statusOf)).toEqual(['delete', 'keep']);
  });

  test('closes without marking anything on Escape', async () => {
    const onClose = vi.fn();
    loadVideos([makeVideo('a', { durationSecs: 3 })]);
    render(<ShortVideosDialog onClose={onClose} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(statusOf('a')).toBe('pending');
  });
});
