// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import Sidebar from '../../../src/components/Sidebar';
import useStore from '../../../src/store';
import { resetPerfDevMock } from '../../helpers/perfDevMock';
import { makeDuplicateGroup, makeVideo } from '../../helpers/videoFactory';

vi.mock('../../../src/perf-dev', async () => await import('../../helpers/perfDevMock'));

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

function installElectronApiMock() {
  const electronAPI = {
    selectDirectory: vi.fn().mockResolvedValue(null),
    validateDroppedPath: vi.fn().mockResolvedValue({ valid: true, isDirectory: true }),
    openInExplorer: vi.fn().mockResolvedValue(true),
    saveConfig: vi.fn().mockResolvedValue(true),
    getProcessingPauseState: vi.fn().mockResolvedValue({ status: 'running' }),
    setProcessingPaused: vi.fn().mockResolvedValue({ status: 'running' }),
    onProcessingPauseState: vi.fn(() => vi.fn()),
  };
  Object.assign(window, { electronAPI });
  return electronAPI;
}

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      onRescan={vi.fn()}
      onDirectoryPicked={vi.fn()}
      onNotify={vi.fn()}
      onOpenSettings={vi.fn()}
      onCloseSession={vi.fn()}
      onFindDuplicates={vi.fn()}
      onSwitchDuplicateMethod={vi.fn()}
      onOpenDuplicateSettings={vi.fn()}
      onOpenDocumentation={vi.fn()}
      onRequestPermanentDelete={vi.fn().mockResolvedValue(false)}
      globalMute={false}
      globalMuteEnabled={false}
      globalMuteLabel="M"
      onToggleGlobalMute={vi.fn()}
      theme="dark"
      onToggleTheme={vi.fn()}
      {...props}
    />,
  );
}

describe('Sidebar recent folder behavior', () => {
  beforeEach(() => {
    installElectronApiMock();
    resetPerfDevMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('offers a quick theme toggle in the header', async () => {
    const onToggleTheme = vi.fn();
    renderSidebar({ theme: 'dark', onToggleTheme });

    const toggle = screen.getByRole('button', { name: /switch to light mode/i });
    await userEvent.click(toggle);

    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  test('opens a valid recent folder through the recent-session panel', async () => {
    const electronAPI = installElectronApiMock();
    const onDirectoryPicked = vi.fn();
    const currentDir = 'D:\\Media\\Current';
    const recentDir = 'D:\\Media\\Trips';
    useStore.setState({
      directory: currentDir,
      directories: [currentDir],
      settings: {
        ...useStore.getState().settings,
        recentDirectories: [currentDir, recentDir],
        recentDirectoryTimestamps: {
          [currentDir]: Date.now() - 60_000,
          [recentDir]: Date.now() - 120_000,
        },
      },
    });

    renderSidebar({ onDirectoryPicked });

    await userEvent.click(screen.getByRole('button', { name: /recent folders/i }));
    const [recentOpenButton] = screen.getAllByRole('button', { name: /Media \/ Trips/i });
    await userEvent.click(recentOpenButton);

    await waitFor(() => {
      expect(electronAPI.validateDroppedPath).toHaveBeenCalledWith(recentDir);
      expect(onDirectoryPicked).toHaveBeenCalledWith(recentDir);
    });

    expect(screen.queryByRole('button', { name: /clear all recent folders/i })).toBeNull();
  });

  test('the folder switcher names the folder and holds the session actions', async () => {
    installElectronApiMock();
    const onRescan = vi.fn();
    const onCloseSession = vi.fn();
    useStore.setState({ directory: 'D:\\Media\\Current', directories: ['D:\\Media\\Current', 'E:\\Clips'] });
    renderSidebar({ onRescan, onCloseSession });

    const switcher = screen.getByRole('button', { name: 'Current + 1 more' });
    await userEvent.click(switcher);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open Another Folder...Ctrl+O', 'Add Folder to Session...', 'RescanF5', 'Close Session',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: /Rescan/ }));
    expect(onRescan).toHaveBeenCalledTimes(1);
    await userEvent.click(switcher);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close Session' }));
    expect(onCloseSession).toHaveBeenCalledTimes(1);
  });

  test('reveals a recent folder through the sidebar context menu', async () => {
    const electronAPI = installElectronApiMock();
    const currentDir = 'D:\\Media\\Current';
    const recentDir = 'D:\\Media\\Trips';
    useStore.setState({
      directory: currentDir,
      directories: [currentDir],
      settings: {
        ...useStore.getState().settings,
        recentDirectories: [currentDir, recentDir],
        recentDirectoryTimestamps: {
          [currentDir]: Date.now() - 60_000,
          [recentDir]: Date.now() - 120_000,
        },
      },
    });

    renderSidebar();

    await userEvent.click(screen.getByRole('button', { name: /recent folders/i }));
    const [recentOpenButton] = screen.getAllByRole('button', { name: /Media \/ Trips/i });
    fireEvent.contextMenu(recentOpenButton);

    await userEvent.click(await screen.findByRole('button', { name: 'Reveal in Explorer' }));

    await waitFor(() => {
      expect(electronAPI.openInExplorer).toHaveBeenCalledWith(recentDir);
    });
  });

  test('keeps unavailable recent folders listed in case a drive is offline', async () => {
    const electronAPI = installElectronApiMock();
    const onNotify = vi.fn();
    const currentDir = 'D:\\Media\\Current';
    const recentDir = 'D:\\Media\\Trips';
    useStore.setState({
      directory: currentDir,
      directories: [currentDir],
      settings: {
        ...useStore.getState().settings,
        recentDirectories: [currentDir, recentDir],
        recentDirectoryTimestamps: {
          [currentDir]: Date.now() - 60_000,
          [recentDir]: Date.now() - 120_000,
        },
      },
    });
    electronAPI.validateDroppedPath.mockResolvedValue({ valid: false, isDirectory: false });

    renderSidebar({ onNotify });

    await userEvent.click(screen.getByRole('button', { name: /recent folders/i }));
    const [recentOpenButton] = screen.getAllByRole('button', { name: /Media \/ Trips/i });
    await userEvent.click(recentOpenButton);

    await waitFor(() => {
      expect(useStore.getState().settings.recentDirectories).toEqual([currentDir, recentDir]);
      expect(screen.getByText('Unavailable')).toBeTruthy();
    });
    expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Folder unavailable',
      kind: 'warning',
    }));
  });

  test('shows a back-to-grid escape hatch when duplicate mode is active but duplicates are disabled', async () => {
    useStore.setState({
      duplicateGroupsMode: true,
      settings: {
        ...useStore.getState().settings,
        duplicates: {
          ...useStore.getState().settings.duplicates,
          enabled: false,
        },
      },
      stats: {
        total: 2,
        pending: 2,
        keep: 0,
        skipped: 0,
        delete: 0,
        totalSize: 2048,
        deleteSize: 0,
      },
    });

    renderSidebar();

    expect(screen.getByRole('button', { name: /back to grid/i })).toBeTruthy();
    expect(screen.getByText(/duplicate detection is disabled/i)).toBeTruthy();
  });

  test('applies the keep status filter from the status buttons', async () => {
    const keepVideo = makeVideo('keep-1', { status: 'keep' });
    const deleteVideo = makeVideo('delete-1', { status: 'delete' });
    useStore.setState({
      videos: [keepVideo, deleteVideo],
      stats: {
        total: 4,
        pending: 1,
        keep: 2,
        skipped: 0,
        delete: 1,
        totalSize: 4096,
        deleteSize: 2048,
      },
      statusFilter: 'all',
      filteredVideos: [keepVideo, deleteVideo],
    });

    renderSidebar();

    const keepButton = screen.getByRole('button', { name: /2Keep/i });
    await userEvent.click(keepButton);

    expect(useStore.getState().statusFilter).toBe('keep');
    expect(keepButton.getAttribute('aria-pressed')).toBe('true');
  });

  test('shows the folder filter as a chip that clears it', async () => {
    const video = makeVideo('a', {}, 'D:\\Media\\Trips');
    useStore.setState({
      directory: 'D:\Media',
      directories: ['D:\Media'],
      videos: [video],
      filteredVideos: [video],
      stats: { ...useStore.getState().stats, total: 1, pending: 1 },
      folderFilter: { path: 'D:\\Media\\Trips', includeSubfolders: false },
    });
    renderSidebar();
    const chip = screen.getByRole('button', { name: 'Clear folder filter: D:\\Media\\Trips' });
    expect(chip.textContent).toBe('Media / Trips (only)');
    await userEvent.click(chip);
    expect(useStore.getState().folderFilter).toBeNull();
  });

  test('in duplicate groups it offers to run again with the other method', async () => {
    const onSwitchDuplicateMethod = vi.fn();
    const videos = [makeVideo('a'), makeVideo('b')];
    useStore.setState({
      directory: 'D:\Media',
      directories: ['D:\Media'],
      videos,
      filteredVideos: videos,
      stats: { ...useStore.getState().stats, total: 2, pending: 2 },
      duplicateGroups: [makeDuplicateGroup({ videoIds: ['a', 'b'] })],
      duplicateGroupsMode: true,
      lastDuplicateMethod: 'visual',
    });
    renderSidebar({ onSwitchDuplicateMethod });
    await userEvent.click(screen.getByRole('button', { name: 'Run Again with pHash' }));
    expect(onSwitchDuplicateMethod).toHaveBeenCalledTimes(1);
  });

  test('opens documentation from the sidebar header button', async () => {
    const onOpenDocumentation = vi.fn();
    useStore.setState({
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
    });

    renderSidebar({ onOpenDocumentation });

    await userEvent.click(screen.getByRole('button', { name: 'Open documentation' }));

    expect(onOpenDocumentation).toHaveBeenCalledTimes(1);
  });

  test('disables batch delete while a folder scan is replacing the session', () => {
    const deleteVideo = makeVideo('delete-1', { status: 'delete' });
    useStore.setState({
      directory: 'D:\\Media',
      videos: [deleteVideo],
      filteredVideos: [deleteVideo],
      isScanning: true,
      stats: {
        total: 1,
        pending: 0,
        keep: 0,
        skipped: 0,
        delete: 1,
        totalSize: 2048,
        deleteSize: 2048,
      },
    });

    renderSidebar();

    expect((screen.getByRole('button', { name: /scanning/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
