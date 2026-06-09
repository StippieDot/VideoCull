// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import ReviewMode from '../../../src/components/ReviewMode';
import useStore from '../../../src/store';
import { resetPerfDevMock } from '../../helpers/perfDevMock';
import { makeVideo } from '../../helpers/videoFactory';

vi.mock('@videojs/react', () => ({
  createPlayer: () => ({
    Provider: ({ children }: { children: ReactNode }) => children,
  }),
  videoFeatures: {},
}));

vi.mock('@videojs/react/video', () => ({
  MinimalVideoSkin: ({ children }: { children: ReactNode }) => children,
  Video: () => null,
}));

vi.mock('../../../src/components/ThumbnailStrip', () => ({
  default: () => <div data-testid="thumbnail-strip">thumbs</div>,
}));

vi.mock('../../../src/perf-dev', async () => await import('../../helpers/perfDevMock'));

function installElectronApiMock() {
  const electronAPI = {
    openVideo: vi.fn().mockResolvedValue(true),
    openInExplorer: vi.fn().mockResolvedValue(true),
    setVideoFullscreen: vi.fn().mockResolvedValue(true),
  };
  Object.assign(window, { electronAPI });
  return electronAPI;
}

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

describe('ReviewMode behavior', () => {
  beforeEach(() => {
    installElectronApiMock();
    resetPerfDevMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('marks the current video as keep and advances to the next review item', async () => {
    const alpha = makeVideo('alpha', { path: 'D:\\Media\\alpha.mp4' });
    const beta = makeVideo('beta', { path: 'D:\\Media\\beta.mp4' });
    useStore.setState({
      videos: [alpha, beta],
      filteredVideos: [alpha, beta],
      reviewMode: true,
      reviewIndex: 0,
      reviewScopeIds: ['alpha', 'beta'],
    });

    render(<ReviewMode />);

    expect(screen.getByText('alpha.mp4')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Keep/ }));

    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'alpha')?.status).toBe('keep');
      expect(screen.getByText('beta.mp4')).toBeTruthy();
    });
  });

  test('opens the file in the external player when the video cannot play in review', async () => {
    const electronAPI = installElectronApiMock();
    const unsupportedVideo = makeVideo('legacy', {
      path: 'D:\\Media\\legacy.avi',
      compatible: false,
    });
    useStore.setState({
      videos: [unsupportedVideo],
      filteredVideos: [unsupportedVideo],
      reviewMode: true,
      reviewIndex: 0,
      reviewScopeIds: ['legacy'],
    });

    render(<ReviewMode />);

    await userEvent.click(screen.getByRole('button', { name: /^Open External/ }));

    await waitFor(() => {
      expect(electronAPI.openVideo).toHaveBeenCalledWith('D:\\Media\\legacy.avi');
    });
  });

  test('marks the current video for deletion and advances to the next review item', async () => {
    const alpha = makeVideo('alpha', { path: 'D:\\Media\\alpha.mp4' });
    const beta = makeVideo('beta', { path: 'D:\\Media\\beta.mp4' });
    useStore.setState({
      videos: [alpha, beta],
      filteredVideos: [alpha, beta],
      reviewMode: true,
      reviewIndex: 0,
      reviewScopeIds: ['alpha', 'beta'],
    });

    render(<ReviewMode />);

    expect(screen.getByText('alpha.mp4')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Delete/ }));

    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'alpha')?.status).toBe('delete');
      expect(screen.getByText('beta.mp4')).toBeTruthy();
    });
  });

  test('supports keep, delete, and skip shortcuts through to review completion', async () => {
    const alpha = makeVideo('alpha', { path: 'D:\\Media\\alpha.mp4' });
    const beta = makeVideo('beta', { path: 'D:\\Media\\beta.mp4' });
    const gamma = makeVideo('gamma', { path: 'D:\\Media\\gamma.mp4' });
    useStore.setState({
      videos: [alpha, beta, gamma],
      filteredVideos: [alpha, beta, gamma],
      reviewMode: true,
      reviewIndex: 0,
      reviewScopeIds: ['alpha', 'beta', 'gamma'],
    });

    render(<ReviewMode />);

    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'alpha')?.status).toBe('keep');
      expect(screen.getByText('beta.mp4')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'beta')?.status).toBe('delete');
      expect(screen.getByText('gamma.mp4')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 's' });
    await waitFor(() => {
      expect(useStore.getState().videos.find((video) => video.id === 'gamma')?.status).toBe('skipped');
      expect(screen.getByText('Review complete')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Back to Grid' })).toBeTruthy();
    });
  });

  test('falls back to the current filtered list when review scope ids are not set', async () => {
    const alpha = makeVideo('alpha', { path: 'D:\\Media\\alpha.mp4' });
    const beta = makeVideo('beta', { path: 'D:\\Media\\beta.mp4' });
    useStore.setState({
      videos: [alpha, beta],
      filteredVideos: [beta],
      reviewMode: true,
      reviewIndex: 0,
      reviewScopeIds: null,
    });

    render(<ReviewMode />);

    expect(screen.getByText('beta.mp4')).toBeTruthy();
    expect(screen.queryByText('alpha.mp4')).toBeNull();
  });
});
