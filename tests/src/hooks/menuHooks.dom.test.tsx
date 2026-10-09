// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import useAppMenuState from '../../../src/hooks/useAppMenuState';
import useProcessingPauseState from '../../../src/hooks/useProcessingPauseState';
import useStore from '../../../src/store';
import type { AppMenuState, ProcessingPauseState } from '../../../src/types';
import { makeVideo } from '../../helpers/videoFactory';

function installApi(api: Record<string, unknown>) {
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('useAppMenuState', () => {
  const lastState = (setMenuState: ReturnType<typeof vi.fn>) => setMenuState.mock.lastCall?.[0] as AppMenuState;
  const videos = [makeVideo('a'), makeVideo('b')];

  beforeEach(() => {
    useStore.setState({
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
      videos,
      filteredVideos: videos,
      isScanning: false,
      isGenerating: false,
      isFindingDuplicates: false,
      genProgress: { ...useStore.getState().genProgress, phase: 'thumbnails' },
    });
  });

  test('derives what the menu can act on from the store', () => {
    const setMenuState = vi.fn();
    installApi({ setMenuState });
    renderHook(() => useAppMenuState(false));
    expect(lastState(setMenuState)).toMatchObject({
      hasSession: true,
      canExport: true,
      canFindDuplicates: useStore.getState().settings.duplicates.enabled,
      canPauseProcessing: false,
      canRegenerateThumbnails: true,
    });

    act(() => useStore.setState({ isScanning: true }));
    expect(lastState(setMenuState)).toMatchObject({ canExport: false, canRegenerateThumbnails: false });

    act(() => useStore.setState({ stats: { ...useStore.getState().stats, delete: 2 } }));
    expect(lastState(setMenuState).canDeleteMarked).toBe(false);
    act(() => useStore.setState({ isScanning: false }));
    expect(lastState(setMenuState).canDeleteMarked).toBe(true);
    act(() => useStore.setState({ isScanning: true }));

    act(() => useStore.setState({ isScanning: false, videos: [videos[0]], filteredVideos: [videos[0]] }));
    expect(lastState(setMenuState).canFindDuplicates).toBe(false);
  });

  test('the sort choices follow the ratings and codec badge settings', () => {
    const setMenuState = vi.fn();
    installApi({ setMenuState });
    const settings = useStore.getState().settings;
    act(() => useStore.setState({ settings: { ...settings, features: { ...settings.features, ratings: false, codecBadges: false } } }));
    renderHook(() => useAppMenuState(false));
    expect(lastState(setMenuState).sortOptions).toEqual(['name', 'size', 'duration', 'date']);

    act(() => useStore.setState({ settings: { ...settings, features: { ...settings.features, ratings: true, codecBadges: true } } }));
    expect(lastState(setMenuState).sortOptions).toEqual(['name', 'size', 'duration', 'date', 'rating', 'resolution', 'fps']);
  });

  test('an unchanged state is not sent again', () => {
    const setMenuState = vi.fn();
    installApi({ setMenuState });
    renderHook(() => useAppMenuState(false));
    const sent = setMenuState.mock.calls.length;
    // Same videos in a new array: the menu state does not change, so the menu must not be rebuilt.
    act(() => useStore.setState({ filteredVideos: [...videos] }));
    act(() => useStore.setState({ stats: { ...useStore.getState().stats } }));
    expect(setMenuState).toHaveBeenCalledTimes(sent);
  });
});

describe('useProcessingPauseState', () => {
  test('a pause event that arrives before the first answer is not overwritten by it', async () => {
    let pushEvent: (state: ProcessingPauseState) => void = () => {};
    let resolveInitial: (state: ProcessingPauseState) => void = () => {};
    const unsubscribe = vi.fn();
    installApi({
      onProcessingPauseState: vi.fn((callback: (state: ProcessingPauseState) => void) => {
        pushEvent = callback;
        return unsubscribe;
      }),
      getProcessingPauseState: vi.fn(() => new Promise<ProcessingPauseState>((resolve) => { resolveInitial = resolve; })),
    });

    const { result, unmount } = renderHook(() => useProcessingPauseState());
    expect(result.current.status).toBe('running');

    act(() => pushEvent({ status: 'paused' }));
    await act(async () => resolveInitial({ status: 'running' }));
    expect(result.current.status).toBe('paused');

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('the first answer is used when no event arrived', async () => {
    installApi({
      onProcessingPauseState: vi.fn(() => () => {}),
      getProcessingPauseState: vi.fn().mockResolvedValue({ status: 'paused' }),
    });
    const { result } = renderHook(() => useProcessingPauseState());
    await act(async () => {});
    expect(result.current.status).toBe('paused');
  });

  test('a failed first query leaves the default state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installApi({
      onProcessingPauseState: vi.fn(() => () => {}),
      getProcessingPauseState: vi.fn().mockRejectedValue(new Error('ipc closed')),
    });
    const { result } = renderHook(() => useProcessingPauseState());
    await act(async () => {});
    expect(result.current.status).toBe('running');
    vi.restoreAllMocks();
  });
});
