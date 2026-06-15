// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import Sidebar from '../../../src/components/Sidebar';
import useStore from '../../../src/store';
import { resetPerfDevMock } from '../../helpers/perfDevMock';
import { makeVideo } from '../../helpers/videoFactory';

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
      onOpenDuplicateSettings={vi.fn()}
      globalMute={false}
      globalMuteEnabled={false}
      globalMuteLabel="M"
      onToggleGlobalMute={vi.fn()}
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
});
