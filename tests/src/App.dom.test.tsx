// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import useStore from '../../src/store';
import { resetPerfDevMock } from '../helpers/perfDevMock';
import { makeVideo } from '../helpers/videoFactory';
import type {
  DuplicateProgress,
  ThumbReadyEvent,
  UpdateInfo,
  VideoStore,
} from '../../src/types';

vi.mock('../../src/components/Sidebar', async () => {
  const ReactModule = await import('react');
  const storeModule = await import('../../src/store');
  const MockSidebar = (props: {
    onFindDuplicates?: () => void;
    onCloseSession?: () => void;
    onToggleTheme?: () => void;
  }) => {
    const duplicateProgress = storeModule.default((state) => state.duplicateProgress);
    return ReactModule.createElement(ReactModule.Fragment, null,
      ReactModule.createElement(
        'div',
        { 'data-testid': 'sidebar-progress' },
        duplicateProgress ? `${duplicateProgress.stage}:${duplicateProgress.current}/${duplicateProgress.total}` : 'none'
      ),
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'sidebar-find-duplicates',
          onClick: props.onFindDuplicates,
        },
        'Find duplicates'
      ),
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'sidebar-close-session',
          onClick: props.onCloseSession,
        },
        'Close'
      ),
      ReactModule.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'sidebar-toggle-theme',
          onClick: props.onToggleTheme,
        },
        'Toggle theme'
      )
    );
  };
  return { default: MockSidebar };
});

vi.mock('../../src/components/GridMode', async () => {
  const ReactModule = await import('react');
  const storeModule = await import('../../src/store');
  let mountCount = 0;
  const MockGridMode = () => {
    const mountIdRef = ReactModule.useRef<number | null>(null);
    if (mountIdRef.current === null) {
      mountCount += 1;
      mountIdRef.current = mountCount;
    }
    const firstVideo = storeModule.default((state) => state.videos[0] ?? null);
    const text = firstVideo
      ? `thumbs:${firstVideo.thumbnails.length}|codec:${firstVideo.videoCodec ?? 'none'}|compat:${firstVideo.compatible ? 'yes' : 'no'}`
      : 'empty';
    return ReactModule.createElement('div', { 'data-testid': 'grid-state', 'data-mount-id': String(mountIdRef.current) }, text);
  };
  return { default: MockGridMode };
});

vi.mock('../../src/components/ReviewMode', () => ({
  default: () => <div data-testid="review-mode">Review Mode</div>,
}));

vi.mock('../../src/components/EmptyState', () => ({
  default: () => <div data-testid="empty-state">Empty State</div>,
}));

vi.mock('../../src/components/SettingsModal', async () => {
  const ReactModule = await import('react');
  const storeModule = await import('../../src/store');
  return {
    default: (props: { initialTab?: string }) => {
      const isOpen = storeModule.default((state) => state.isSettingsModalOpen);
      if (!isOpen) return null;
      return ReactModule.createElement('div', { 'data-testid': 'settings-modal' }, props.initialTab ?? 'interface');
    },
  };
});

vi.mock('../../src/components/DuplicateGroupsView', () => ({
  default: () => <div data-testid="duplicate-groups">Duplicate Groups</div>,
}));

vi.mock('../../src/components/ShortcutsHelp', () => ({
  default: () => <div data-testid="shortcuts-help">Shortcuts Help</div>,
}));

vi.mock('../../src/components/DocumentationModal', () => ({
  default: (props: {
    onOpenSettings?: (tab: string) => void;
    onOpenShortcutsHelp?: () => void;
  }) => (
    <div data-testid="documentation-modal">
      Documentation Modal
      <button type="button" data-testid="docs-open-duplicates" onClick={() => props.onOpenSettings?.('duplicates')}>
        Open duplicate settings
      </button>
      <button type="button" data-testid="docs-open-shortcuts" onClick={() => props.onOpenShortcutsHelp?.()}>
        Open shortcuts
      </button>
    </div>
  ),
}));

vi.mock('../../src/perf-dev', async () => await import('../helpers/perfDevMock'));

import App from '../../src/App';

type Subscription<T> = (payload: T) => void;

type ElectronHandlers = {
  updateStatus?: Subscription<UpdateInfo>;
  metadataReadyBatch?: Subscription<ThumbReadyEvent[]>;
  thumbReadyBatch?: Subscription<ThumbReadyEvent[]>;
  duplicateProgress?: Subscription<DuplicateProgress>;
  menuAction?: Subscription<string>;
};

type ElectronApiMock = ReturnType<typeof createElectronApiMock>;

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => VideoStore;
    setState: (partial: Partial<VideoStore>, replace?: boolean) => void;
  };
}

function createElectronApiMock() {
  const handlers: ElectronHandlers = {};
  const api = {
    getConfig: vi.fn().mockResolvedValue(null),
    saveConfig: vi.fn().mockResolvedValue(true),
    saveCache: vi.fn().mockResolvedValue(true),
    saveCacheAtomic: vi.fn().mockResolvedValue(true),
    setExportReportAvailable: vi.fn(),
    getPathForFile: vi.fn(),
    selectDirectory: vi.fn().mockResolvedValue(null),
    validateDroppedPath: vi.fn().mockResolvedValue({ valid: true, isDirectory: true }),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    cancelDuplicateDetection: vi.fn().mockResolvedValue(undefined),
    resetLoadedDirectories: vi.fn().mockResolvedValue(undefined),
    scanDirectory: vi.fn().mockResolvedValue([]),
    processMetadata: vi.fn().mockResolvedValue(true),
    generateThumbnails: vi.fn().mockResolvedValue(true),
    batchDelete: vi.fn().mockResolvedValue([]),
    findDuplicates: vi.fn().mockResolvedValue({ status: 'ok', groups: [], videos: [], stats: { groupCount: 0, duplicateVideoCount: 0, exactGroupCount: 0, similarityGroupCount: 0 } }),
    chooseReportScope: vi.fn().mockResolvedValue('all'),
    exportReport: vi.fn().mockResolvedValue('saved'),
    onUpdateStatus: vi.fn((callback: Subscription<UpdateInfo>) => {
      handlers.updateStatus = callback;
      return vi.fn();
    }),
    onScanProgress: vi.fn(() => vi.fn()),
    onThumbProgress: vi.fn(() => vi.fn()),
    onMetadataProgress: vi.fn(() => vi.fn()),
    onMetadataReadyBatch: vi.fn((callback: Subscription<ThumbReadyEvent[]>) => {
      handlers.metadataReadyBatch = callback;
      return vi.fn();
    }),
    onThumbReadyBatch: vi.fn((callback: Subscription<ThumbReadyEvent[]>) => {
      handlers.thumbReadyBatch = callback;
      return vi.fn();
    }),
    onAppNotification: vi.fn(() => vi.fn()),
    onDuplicateProgress: vi.fn((callback: Subscription<DuplicateProgress>) => {
      handlers.duplicateProgress = callback;
      return vi.fn();
    }),
    onMenuAction: vi.fn((callback: Subscription<string>) => {
      handlers.menuAction = callback;
      return vi.fn();
    }),
  };

  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, {
      electronAPI: api,
      confirm: vi.fn(() => true),
    }),
  });

  return {
    api,
    emitUpdateStatus(info: UpdateInfo) {
      act(() => {
        handlers.updateStatus?.(info);
      });
    },
    emitMetadataReadyBatch(batch: ThumbReadyEvent[]) {
      act(() => {
        handlers.metadataReadyBatch?.(batch);
      });
    },
    emitThumbReadyBatch(batch: ThumbReadyEvent[]) {
      act(() => {
        handlers.thumbReadyBatch?.(batch);
      });
    },
    emitDuplicateProgress(progress: DuplicateProgress) {
      act(() => {
        handlers.duplicateProgress?.(progress);
      });
    },
    async emitMenuAction(action: string) {
      await act(async () => {
        await handlers.menuAction?.(action);
      });
    },
  };
}

describe('App renderer behavior', () => {
  let electron: ElectronApiMock;

  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    resetPerfDevMock();
    electron = createElectronApiMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('shows and dismisses the update-ready banner from Electron update events', async () => {
    render(<App />);

    electron.emitUpdateStatus({ status: 'ready', version: '2.1.0' });

    expect(await screen.findByText('Video Cull v2.1.0 is ready to install.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));

    await waitFor(() => {
      expect(screen.queryByText('Video Cull v2.1.0 is ready to install.')).toBeNull();
    });
  });

  test('applies metadata-ready and thumb-ready batches to the rendered video state', async () => {
    getStoreApi().setState({
      directory: 'D:\\Media',
      videos: [makeVideo('a', { compatible: false })],
      filteredVideos: [makeVideo('a', { compatible: false })],
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    });

    render(<App />);

    expect(screen.getByTestId('grid-state').textContent).toContain('thumbs:0|codec:none|compat:no');

    electron.emitMetadataReadyBatch([{
      videoId: 'a',
      containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
      videoCodec: 'h264',
      width: 1920,
      height: 1080,
      fps: 30,
      durationSecs: 12,
    }]);
    electron.emitThumbReadyBatch([{
      videoId: 'a',
      thumbnails: ['thumb_2.jpg', 'thumb_1.jpg'],
    }]);

    await waitFor(() => {
      expect(screen.getByTestId('grid-state').textContent).toContain('thumbs:2|codec:h264|compat:yes');
    });
  });

  test('reflects duplicate-progress events in the sidebar state', async () => {
    getStoreApi().setState({
      directory: 'D:\\Media',
      videos: [makeVideo('a')],
      filteredVideos: [makeVideo('a')],
      isFindingDuplicates: true,
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    });

    render(<App />);

    electron.emitDuplicateProgress({
      stage: 'Finding candidates',
      current: 4,
      total: 10,
      message: 'Comparing videos',
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-progress').textContent).toBe('Finding candidates:4/10');
    });
  });

  test('quick theme toggle applies and persists the next theme', async () => {
    getStoreApi().setState({ directory: 'D:\\Media' });
    render(<App />);

    await userEvent.click(screen.getByTestId('sidebar-toggle-theme'));

    await waitFor(() => {
      expect(useStore.getState().settings.theme).toBe('light');
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(electron.api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
    });
  });

  test('configured theme shortcut toggles and persists the theme', async () => {
    getStoreApi().setState({
      settings: {
        ...useStore.getState().settings,
        keyToggleTheme: { key: 't', ctrl: false, shift: false, alt: true },
      },
    });
    render(<App />);

    fireEvent.keyDown(window, { key: 'T', altKey: true });

    await waitFor(() => {
      expect(useStore.getState().settings.theme).toBe('light');
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(electron.api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
    });
  });

  test('opens documentation from the Help menu action', async () => {
    render(<App />);

    expect(screen.queryByTestId('documentation-modal')).toBeNull();
    await electron.emitMenuAction('open-documentation');
    expect(screen.getByTestId('documentation-modal')).toBeTruthy();
  });

  test('routes documentation actions into shortcuts help and the duplicate settings tab', async () => {
    render(<App />);

    await electron.emitMenuAction('open-documentation');
    await userEvent.click(screen.getByTestId('docs-open-shortcuts'));

    expect(screen.queryByTestId('documentation-modal')).toBeNull();
    expect(screen.getByTestId('shortcuts-help')).toBeTruthy();

    await electron.emitMenuAction('open-documentation');
    await userEvent.click(screen.getByTestId('docs-open-duplicates'));

    expect(screen.queryByTestId('documentation-modal')).toBeNull();
    expect(screen.getByTestId('settings-modal').textContent).toBe('duplicates');
  });

  test('pointer-clicked buttons do not retain focus and steal Enter or Space shortcuts afterward', async () => {
    getStoreApi().setState({
      directory: 'D:\\Media',
      videos: [makeVideo('a')],
      filteredVideos: [makeVideo('a')],
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    });

    render(<App />);

    const button = screen.getByTestId('sidebar-find-duplicates');
    await userEvent.click(button);

    expect(document.activeElement).not.toBe(button);
  });

  test('opening shortcut help does not rebuild IPC progress subscriptions', async () => {
    render(<App />);

    expect(electron.api.onScanProgress).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: '?', shiftKey: true });

    expect(await screen.findByTestId('shortcuts-help')).toBeTruthy();
    expect(electron.api.onScanProgress).toHaveBeenCalledTimes(1);
  });

  test('prevents duplicate detection while metadata is still updating and explains why', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    const videos = [makeVideo('a'), makeVideo('b', { path: 'D:\\Media\\b.mp4' })];
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      videos,
      filteredVideos: videos,
      isGenerating: true,
      genProgress: { current: 1, total: 2, phase: 'metadata' },
    }, true);

    render(<App />);

    await userEvent.click(screen.getByTestId('sidebar-find-duplicates'));

    expect(await screen.findByText('Metadata still updating')).toBeTruthy();
    expect(electron.api.findDuplicates).not.toHaveBeenCalled();
  });

  test('does not rescan loaded directories when only processing settings change', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
    }, true);

    render(<App />);

    await waitFor(() => {
      expect(electron.api.scanDirectory).toHaveBeenCalledTimes(1);
    });

    act(() => {
      store.getState().updateSettings({
        ...store.getState().settings,
        thumbsPerVideo: 4,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(electron.api.scanDirectory).toHaveBeenCalledTimes(1);
  });

  test('ignores delete-all menu action while a replacement scan is pending', async () => {
    const deleteVideo = makeVideo('a', { status: 'delete' });
    const store = getStoreApi();
    const initialState = store.getInitialState();
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      videos: [deleteVideo],
      filteredVideos: [deleteVideo],
      isScanning: true,
      stats: { total: 1, pending: 0, skipped: 0, keep: 0, delete: 1, totalSize: 100, deleteSize: 100 },
    }, true);

    render(<App />);

    await electron.emitMenuAction('delete-all');

    expect(window.confirm).not.toHaveBeenCalled();
    expect(electron.api.batchDelete).not.toHaveBeenCalled();
  });

  test('shows a scan message while old videos are still visible', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    let finishScan!: (videos: unknown[]) => void;
    electron.api.scanDirectory.mockReturnValue(new Promise((resolve) => {
      finishScan = resolve;
    }));
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
      videos: [makeVideo('old')],
      filteredVideos: [makeVideo('old')],
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    }, true);

    render(<App />);

    expect(await screen.findByText(/scanning folders/i)).toBeTruthy();
    expect(screen.getByTestId('grid-state').textContent).toContain('thumbs:0');

    await act(async () => {
      finishScan([]);
    });
  });

  test('reports skipped folders from scan results', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    electron.api.scanDirectory.mockResolvedValue({
      videos: [makeVideo('a')],
      summary: {
        skippedDirectoryCount: 1,
        skippedDirectorySamples: [{ path: 'D:\\Media\\Offline', reason: 'EACCES' }],
      },
    });
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
    }, true);

    render(<App />);

    expect(await screen.findByText('Some folders were skipped')).toBeTruthy();
    expect(screen.getByText(/1 folder could not be scanned/i)).toBeTruthy();
  });

  test('closes the loaded session before Electron cleanup finishes', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    const video = makeVideo('a');
    let finishReset!: () => void;
    electron.api.resetLoadedDirectories.mockReturnValue(new Promise((resolve) => {
      finishReset = () => resolve(true);
    }));
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
      videos: [video],
      filteredVideos: [video],
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    }, true);

    render(<App />);

    await userEvent.click(screen.getByTestId('sidebar-close-session'));

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(store.getState().videos).toEqual([]);

    await act(async () => {
      finishReset();
    });
  });

  test('rejects dropped shortcuts and shows a user-facing error toast', async () => {
    electron.api.getPathForFile.mockReturnValue('C:\\Incoming\\shortcut.lnk');
    electron.api.validateDroppedPath.mockResolvedValue({ valid: false, isDirectory: false });

    render(<App />);

    const layout = document.querySelector('.app-layout');
    expect(layout).toBeTruthy();

    fireEvent.dragEnter(layout!, {
      dataTransfer: { files: [new File([''], 'shortcut.lnk')], types: ['Files'] },
    });
    expect(screen.getByText('Drop folder to open')).toBeTruthy();

    fireEvent.drop(layout!, {
      dataTransfer: { files: [new File([''], 'shortcut.lnk')], types: ['Files'] },
    });

    expect(await screen.findByText('Shortcuts are not supported. Please drop the actual folder.')).toBeTruthy();
  });

  test('offers to add a valid dropped folder to the current session and persists the addition', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
      videos: [makeVideo('a')],
      filteredVideos: [makeVideo('a')],
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    }, true);

    electron.api.getPathForFile.mockReturnValue('E:\\Clips');
    electron.api.validateDroppedPath.mockResolvedValue({ valid: true, isDirectory: true });

    render(<App />);

    const layout = document.querySelector('.app-layout');
    expect(layout).toBeTruthy();

    fireEvent.drop(layout!, {
      dataTransfer: { files: [new File([''], 'clips')], types: ['Files'] },
    });

    expect(await screen.findByRole('button', { name: 'Add to session' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Add to session' }));

    await waitFor(() => {
      expect(getStoreApi().getState().directories).toEqual(['D:\\Media', 'E:\\Clips']);
      expect(screen.getByText('Folder added')).toBeTruthy();
      expect(electron.api.saveConfig).toHaveBeenCalled();
    });
  });

  test('explains when a dropped folder is already covered by a loaded parent folder', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
      videos: [makeVideo('a')],
      filteredVideos: [makeVideo('a')],
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    }, true);

    electron.api.getPathForFile.mockReturnValue('D:\\Media\\Trips');
    electron.api.validateDroppedPath.mockResolvedValue({ valid: true, isDirectory: true });

    render(<App />);

    const layout = document.querySelector('.app-layout');
    expect(layout).toBeTruthy();

    fireEvent.drop(layout!, {
      dataTransfer: { files: [new File([''], 'trips')], types: ['Files'] },
    });

    expect(await screen.findByRole('button', { name: 'Add to session' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Add to session' }));

    await waitFor(() => {
      expect(getStoreApi().getState().directories).toEqual(['D:\\Media']);
      expect(screen.getByText('Folder already covered')).toBeTruthy();
    });
  });


  test('exports the filtered report from the menu action and confirms success to the user', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    const videos = [makeVideo('a'), makeVideo('b', { path: 'D:\\Media\\b.mp4' })];
    const filteredVideos = [videos[1]!];
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
      videos,
      filteredVideos,
      stats: { total: 2, pending: 2, skipped: 0, keep: 0, delete: 0, totalSize: 200, deleteSize: 0 },
    }, true);

    electron.api.chooseReportScope.mockResolvedValue('filtered');
    electron.api.exportReport.mockResolvedValue('saved');

    render(<App />);

    await electron.emitMenuAction('export-report');

    await waitFor(() => {
      expect(electron.api.exportReport).toHaveBeenCalledWith(filteredVideos, ['D:\\Media']);
      expect(screen.getByText('Report exported')).toBeTruthy();
      expect(screen.getByText('1 video included.')).toBeTruthy();
    });
  });

  test('toggles global mute through the App control and persists the setting', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    store.setState({
      ...initialState,
      reviewMode: true,
      settings: {
        ...initialState.settings,
        globalMute: false,
        features: {
          ...initialState.settings.features,
          globalMute: true,
        },
      },
    }, true);

    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Mute in-app playback' }));

    await waitFor(() => {
      expect(getStoreApi().getState().settings.globalMute).toBe(true);
      expect(electron.api.saveConfig).toHaveBeenCalled();
      expect(screen.getByText('Muted')).toBeTruthy();
    });
  });

  test('keeps the grid mounted while review mode is open so visible thumbnails do not reset on return', async () => {
    const store = getStoreApi();
    const initialState = store.getInitialState();
    store.setState({
      ...initialState,
      directory: 'D:\\Media',
      videos: [makeVideo('a')],
      filteredVideos: [makeVideo('a')],
      reviewMode: false,
      stats: { total: 1, pending: 1, skipped: 0, keep: 0, delete: 0, totalSize: 100, deleteSize: 0 },
    }, true);

    render(<App />);

    const gridBefore = screen.getByTestId('grid-state');
    const originalMountId = gridBefore.getAttribute('data-mount-id');
    expect(originalMountId).toBeTruthy();

    act(() => {
      store.setState({ reviewMode: true });
    });

    expect(screen.getByTestId('review-mode')).toBeTruthy();
    const gridWhileHidden = screen.getByTestId('grid-state');
    expect(gridWhileHidden.getAttribute('data-mount-id')).toBe(originalMountId);
    expect(gridWhileHidden.parentElement?.getAttribute('style')).toContain('display: flex');
    expect(gridWhileHidden.parentElement?.getAttribute('style')).toContain('visibility: hidden');
    expect(gridWhileHidden.parentElement?.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      store.setState({ reviewMode: false });
    });

    const gridAfter = screen.getByTestId('grid-state');
    expect(gridAfter.getAttribute('data-mount-id')).toBe(originalMountId);
    expect(gridAfter.parentElement?.getAttribute('style')).toContain('display: flex');
    expect(gridAfter.parentElement?.getAttribute('style')).toContain('visibility: visible');
    expect(gridAfter.parentElement?.getAttribute('aria-hidden')).toBe('false');
  });
});
