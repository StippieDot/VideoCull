// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import EmptyState from '../../../src/components/EmptyState';
import useStore from '../../../src/store';

function installElectronApiMock() {
  const electronAPI = {
    selectDirectory: vi.fn().mockResolvedValue(null),
    validateDroppedPath: vi.fn().mockResolvedValue({ valid: true, isDirectory: true }),
    openInExplorer: vi.fn().mockResolvedValue(true),
    saveConfig: vi.fn().mockResolvedValue(true),
  };
  Object.assign(window, { electronAPI });
  return electronAPI;
}

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

describe('EmptyState recent folder behavior', () => {
  beforeEach(() => {
    installElectronApiMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('keeps an unavailable recent folder listed and reports the offline state', async () => {
    const electronAPI = installElectronApiMock();
    const notify = vi.fn();
    const staleDir = 'D:\\Videos\\Trip';
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        recentSessions: [{ folders: [staleDir], includeSubfolders: true, openedAt: Date.now() - 60_000 }],
      },
    });
    electronAPI.validateDroppedPath.mockResolvedValue({ valid: false, isDirectory: false });

    render(<EmptyState onNotify={notify} onOpenDocumentation={vi.fn()} onToggleTheme={vi.fn()} />);

    const [recentOpenButton] = screen.getAllByRole('button', { name: /Videos \/ Trip/i });
    await userEvent.click(recentOpenButton);

    await waitFor(() => {
      expect(electronAPI.validateDroppedPath).toHaveBeenCalledWith(staleDir);
      expect(useStore.getState().settings.recentSessions.map((recent) => recent.folders)).toEqual([[staleDir]]);
    });

    expect(useStore.getState().toasts).toEqual([
      expect.objectContaining({
        title: 'Folder unavailable',
        detail: 'Videos / Trip',
        kind: 'warning',
      }),
    ]);
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });

  test('a recent session shows only the folders that can be reached, and lists every folder in its tooltip', () => {
    const offline = 'E:\\Offline\\Clips';
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        recentSessions: [{ folders: ['D:\\Videos\\Trip', offline, 'F:\\Videos\\Family'], includeSubfolders: true, openedAt: Date.now() }],
      },
      unreachableFolders: new Set(['e:\\offline\\clips']),
    });

    render(<EmptyState onNotify={vi.fn()} onOpenDocumentation={vi.fn()} onToggleTheme={vi.fn()} />);

    const entry = screen.getByText('Videos / Trip + 1 more').closest('button');
    expect(entry?.getAttribute('title')).toContain(`${offline} (unavailable)`);
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  test('clears all recent folders from the empty-state panel and reports how many were removed', async () => {
    const notify = vi.fn();
    const firstDir = 'D:\\Videos\\Trip';
    const secondDir = 'D:\\Videos\\Family';
    useStore.setState({
      settings: {
        ...useStore.getState().settings,
        recentSessions: [
          { folders: [firstDir], includeSubfolders: true, openedAt: Date.now() - 60_000 },
          { folders: [secondDir], includeSubfolders: true, openedAt: Date.now() - 120_000 },
        ],
      },
    });

    render(<EmptyState onNotify={notify} onOpenDocumentation={vi.fn()} onToggleTheme={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));

    await waitFor(() => {
      expect(useStore.getState().settings.recentSessions).toEqual([]);
    });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Recents cleared',
        detail: '2 entries removed.',
        kind: 'info',
      }),
    );
  });

  test('explains the next step in the initial empty state', () => {
    render(<EmptyState onNotify={vi.fn()} onOpenDocumentation={vi.fn()} onToggleTheme={vi.fn()} />);

    expect(screen.getByText(/Select a folder to start reviewing your video collection\./i)).toBeTruthy();
    expect(screen.getByText(/Quickly sort, keep, or delete videos using thumbnails\./i)).toBeTruthy();
  });

  test('opens documentation from the empty-state corner button', async () => {
    const onOpenDocumentation = vi.fn();
    render(<EmptyState onNotify={vi.fn()} onOpenDocumentation={onOpenDocumentation} onToggleTheme={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open documentation' }));

    expect(onOpenDocumentation).toHaveBeenCalledTimes(1);
  });
});
