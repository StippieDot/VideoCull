// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StoreTransition from '../../../src/components/StoreTransition';

test('does not show the direct-install prompt when no eligible installation exists', async () => {
  Object.assign(window, {
    electronAPI: {
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({ installed: false, eligible: false }),
    },
  });

  render(<StoreTransition />);

  await waitFor(() => expect(window.electronAPI.getLegacyInstallStatus).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Both VideoCull editions are installed/i)).toBeNull();
});

test('shows and dismisses the direct-install prompt after Store startup', async () => {
  const dismiss = vi.fn().mockResolvedValue(true);
  Object.assign(window, {
    electronAPI: {
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({
        installed: true,
        eligible: true,
        promptDismissed: false,
        displayName: 'VideoCull 2.2.1',
      }),
      dismissLegacyInstallPrompt: dismiss,
    },
  });

  render(<StoreTransition />);

  expect(await screen.findByText(/Both VideoCull editions are installed/i)).toBeTruthy();
  expect(screen.getByText(/recommend removing VideoCull 2.2.1/i)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /not now/i }));
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Both VideoCull editions are installed/i)).toBeNull();
});

test('opens the validated direct-edition uninstaller on request', async () => {
  const uninstall = vi.fn().mockResolvedValue(true);
  Object.assign(window, {
    electronAPI: {
      onStoreTransitionReady: vi.fn(() => () => {}),
      getLegacyInstallStatus: vi.fn().mockResolvedValue({
        installed: true,
        eligible: true,
        promptDismissed: false,
      }),
      uninstallLegacyInstall: uninstall,
    },
  });

  render(<StoreTransition />);

  await userEvent.click(await screen.findByRole('button', { name: /open uninstaller/i }));
  expect(uninstall).toHaveBeenCalledTimes(1);
});

test('refreshes direct-install detection when the Store window becomes ready', async () => {
  let readyCallback: (() => void) | undefined;
  const getStatus = vi.fn()
    .mockResolvedValueOnce({ installed: false, eligible: false })
    .mockResolvedValueOnce({ installed: true, eligible: true, promptDismissed: false });
  Object.assign(window, {
    electronAPI: {
      onStoreTransitionReady: vi.fn((callback: () => void) => {
        readyCallback = callback;
        return () => {};
      }),
      getLegacyInstallStatus: getStatus,
    },
  });

  render(<StoreTransition />);
  await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));

  await act(async () => readyCallback?.());

  expect(await screen.findByText(/Both VideoCull editions are installed/i)).toBeTruthy();
  expect(getStatus).toHaveBeenCalledTimes(2);
});
