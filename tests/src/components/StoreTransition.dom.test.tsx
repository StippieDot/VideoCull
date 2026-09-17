// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StoreTransition, { formatByteProgress } from '../../../src/components/StoreTransition';
import type { ProfileMigrationStatus } from '../../../src/types';

function awaitingStatus(): ProfileMigrationStatus {
  return {
    stage: 'awaiting-cache-choice',
    durable: 'complete',
    cacheOutcome: null,
    sourceCachePath: 'C:\\Users\\Example\\AppData\\Roaming\\VideoCull\\video-cache',
    preflight: {
      sourceBytes: 1024,
      fileCount: 3,
      freeBytes: 1024 * 1024 * 1024,
      requiredBytes: 256 * 1024 * 1024 + 1024,
      headroomBytes: 256 * 1024 * 1024,
    canCopy: true,
    },
  preflightProgress: null,
  progress: null,
  warning: null,
  errors: [],
};
}

function strategyStatus(): ProfileMigrationStatus {
  return {
    ...awaitingStatus(),
    stage: 'awaiting-cache-strategy',
    sourceCachePath: 'C:\\Users\\Example\\AppData\\Roaming\\VideoCull\\video-cache',
    preflight: null,
  };
}

test('formats cache copy progress using the total size unit for both values', () => {
  expect(formatByteProgress(1022.3 * 1024 * 1024, 1024 * 1024 * 1024)).toBe('0.998 GB of 1 GB copied');
  expect(formatByteProgress(512 * 1024 * 1024, 2 * 1024 * 1024 * 1024)).toBe('0.5 GB of 2 GB copied');
});

test('offers retain, inspect-and-copy, or rebuild before inspecting cache files', async () => {
  const choose = vi.fn().mockResolvedValue({ ...strategyStatus(), stage: 'complete', cacheOutcome: 'retained' });
  Object.assign(window, {
    electronAPI: {
      getProfileMigrationStatus: vi.fn().mockResolvedValue(strategyStatus()),
      chooseProfileCacheMigration: choose,
      onProfileMigrationStatus: vi.fn(() => () => {}),
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({ installed: false, eligible: false }),
    },
  });

  render(<StoreTransition />);

  expect(await screen.findByText(/settings and library state are already migrated/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /keep using existing cache/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /check size and copy/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /rebuild cache/i })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /keep using existing cache/i }));
  expect(choose).toHaveBeenCalledWith('retain');
});

test('starts cache inspection only when the copy route is selected', async () => {
  const choose = vi.fn().mockResolvedValue({ ...strategyStatus(), stage: 'cache-preflight' });
  Object.assign(window, {
    electronAPI: {
      getProfileMigrationStatus: vi.fn().mockResolvedValue(strategyStatus()),
      chooseProfileCacheMigration: choose,
      onProfileMigrationStatus: vi.fn(() => () => {}),
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({ installed: false, eligible: false }),
    },
  });

  render(<StoreTransition />);

  await userEvent.click(await screen.findByRole('button', { name: /check size and copy/i }));
  expect(choose).toHaveBeenCalledWith('inspect');
});

test('offers copy, retain, or rebuild after durable migration and copy preflight succeed', async () => {
  const choose = vi.fn().mockResolvedValue({ ...awaitingStatus(), stage: 'complete', cacheOutcome: 'rebuild' });
  Object.assign(window, {
    electronAPI: {
      getProfileMigrationStatus: vi.fn().mockResolvedValue(awaitingStatus()),
      chooseProfileCacheMigration: choose,
      onProfileMigrationStatus: vi.fn(() => () => {}),
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({ installed: false, eligible: false }),
    },
  });
  render(<StoreTransition />);

  expect(await screen.findByText(/settings and library state are already migrated/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /copy existing cache/i })).toBeTruthy();
  expect(screen.getByRole('button', { name: /keep using existing cache/i })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /skip and rebuild/i }));
  expect(choose).toHaveBeenCalledWith('rebuild');
});

test('shows live cache inspection progress while Store preflight runs', async () => {
  const preflight: ProfileMigrationStatus = {
    ...awaitingStatus(),
    stage: 'cache-preflight',
    preflight: null,
    preflightProgress: { filesScanned: 365345, directoriesScanned: 52750, bytesScanned: 4698810774 },
  };
  Object.assign(window, {
    electronAPI: {
      getProfileMigrationStatus: vi.fn().mockResolvedValue(preflight),
      onProfileMigrationStatus: vi.fn(() => () => {}),
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({ installed: false, eligible: false }),
    },
  });

  render(<StoreTransition />);

  expect(await screen.findByText(/365[,.]345 files/i)).toBeTruthy();
  expect(screen.getByText(/52[,.]750 folders checked/i)).toBeTruthy();
});

test('offers a dismissible legacy uninstall prompt after a completed Store launch', async () => {
  const dismiss = vi.fn().mockResolvedValue(true);
  Object.assign(window, {
    electronAPI: {
      getProfileMigrationStatus: vi.fn().mockResolvedValue({ ...awaitingStatus(), stage: 'complete', cacheOutcome: 'copied' }),
      onProfileMigrationStatus: vi.fn(() => () => {}),
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({ installed: true, eligible: true, promptDismissed: false, displayName: 'VideoCull 2.2.1' }),
      dismissLegacyInstallPrompt: dismiss,
    },
  });
  render(<StoreTransition />);

  expect(await screen.findByText(/Store migration complete/i)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /not now/i }));
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
});
