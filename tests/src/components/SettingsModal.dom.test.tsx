// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsModal from '../../../src/components/SettingsModal';
import useStore from '../../../src/store';
import { makeVideo } from '../../helpers/videoFactory';
import type { UpdateInfo } from '../../../src/types';

type ElectronApiMock = {
  openExternalUrl: ReturnType<typeof vi.fn>;
  getAppVersion: ReturnType<typeof vi.fn>;
  getAutoConcurrency: ReturnType<typeof vi.fn>;
  onUpdateStatus: ReturnType<typeof vi.fn>;
  migrateCacheSettings: ReturnType<typeof vi.fn>;
  saveConfig: ReturnType<typeof vi.fn>;
  validateCacheLocation: ReturnType<typeof vi.fn>;
  selectDirectory: ReturnType<typeof vi.fn>;
  confirmDistributedMode: ReturnType<typeof vi.fn>;
  chooseReportScope: ReturnType<typeof vi.fn>;
  exportReport: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  installUpdate: ReturnType<typeof vi.fn>;
  emitUpdateStatus: (info: UpdateInfo) => void;
};

function installElectronApiMock(): ElectronApiMock {
  let updateStatusHandler: ((info: UpdateInfo) => void) | null = null;
  const electronAPI = {
    openExternalUrl: vi.fn().mockResolvedValue(true),
    getAppVersion: vi.fn().mockResolvedValue('2.0.0-test'),
    getAutoConcurrency: vi.fn().mockResolvedValue(4),
    onUpdateStatus: vi.fn((callback: (info: UpdateInfo) => void) => {
      updateStatusHandler = callback;
      return () => {
        if (updateStatusHandler === callback) updateStatusHandler = null;
      };
    }),
    migrateCacheSettings: vi.fn().mockResolvedValue({ status: 'error', migrated: 0, errors: ['Cannot write to target cache root'] }),
    saveConfig: vi.fn().mockResolvedValue(true),
    validateCacheLocation: vi.fn().mockResolvedValue({ ok: true }),
    selectDirectory: vi.fn().mockResolvedValue(null),
    confirmDistributedMode: vi.fn().mockResolvedValue(true),
    chooseReportScope: vi.fn().mockResolvedValue(null),
    exportReport: vi.fn().mockResolvedValue('cancelled'),
    checkForUpdates: vi.fn().mockResolvedValue({ ok: true, status: 'idle' }),
    installUpdate: vi.fn().mockResolvedValue(true),
    emitUpdateStatus(info: UpdateInfo) {
      act(() => {
        updateStatusHandler?.(info);
      });
    },
  };
  Object.assign(window, { electronAPI });
  return electronAPI;
}

function getStoreApi() {
  return useStore as typeof useStore & {
    getInitialState: () => ReturnType<typeof useStore.getState>;
  };
}

describe('SettingsModal integration behavior', () => {
  let electronAPI: ElectronApiMock;

  beforeEach(() => {
    Object.defineProperty(globalThis, '__APP_VERSION__', {
      value: '2.0.0-test',
      configurable: true,
      writable: true,
    });
    electronAPI = installElectronApiMock();
    const store = getStoreApi();
    store.setState(store.getInitialState(), true);
    useStore.setState({
      isSettingsModalOpen: true,
      directory: 'D:\\Media',
      directories: ['D:\\Media'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('keeps the modal open and shows the migration error when cache relocation fails', async () => {
    render(<SettingsModal initialTab="cache" />);

    const [cacheStorageSelect] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(cacheStorageSelect, 'per-drive');
    await userEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(electronAPI.migrateCacheSettings).toHaveBeenCalled();
    });

    expect(await screen.findByText('Cannot write to target cache root')).toBeTruthy();
    expect(useStore.getState().isSettingsModalOpen).toBe(true);
  });

  test('saves update-setting changes through the store and closes the modal', async () => {
    render(<SettingsModal initialTab="updates" />);

    const autoUpdateToggle = screen.getByRole('checkbox', { name: /automatically check for updates on startup/i });
    expect(autoUpdateToggle).toBeTruthy();

    await userEvent.click(autoUpdateToggle);
    await userEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(electronAPI.saveConfig).toHaveBeenCalled();
    });

    expect(useStore.getState().settings.autoUpdates).toBe(false);
    expect(useStore.getState().isSettingsModalOpen).toBe(false);
  });

  test('shows an export failure message when report export fails', async () => {
    const filteredVideo = makeVideo('filtered');
    useStore.setState({
      videos: [filteredVideo, makeVideo('other')],
      filteredVideos: [filteredVideo],
      stats: { total: 2, pending: 2, skipped: 0, keep: 0, delete: 0, totalSize: 200, deleteSize: 0 },
      isScanning: false,
    });
    electronAPI.chooseReportScope.mockResolvedValue('filtered');
    electronAPI.exportReport.mockResolvedValue('error');

    render(<SettingsModal initialTab="interface" />);

    await userEvent.click(screen.getByRole('button', { name: /export report/i }));

    await waitFor(() => {
      expect(electronAPI.chooseReportScope).toHaveBeenCalled();
      expect(electronAPI.exportReport).toHaveBeenCalledWith([filteredVideo], ['D:\\Media']);
    });

    expect(await screen.findByText('Export failed.')).toBeTruthy();
  });

  test('starts a manual update check from the updates tab', async () => {
    render(<SettingsModal initialTab="updates" />);

    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }));

    await waitFor(() => {
      expect(electronAPI.checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  test('offers install when an update is ready and triggers the restart action', async () => {
    render(<SettingsModal initialTab="updates" />);

    electronAPI.emitUpdateStatus({ status: 'ready', version: '2.2.0' });

    const installButton = await screen.findByRole('button', { name: /restart to install v2.2.0/i });
    await userEvent.click(installButton);

    await waitFor(() => {
      expect(electronAPI.installUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
