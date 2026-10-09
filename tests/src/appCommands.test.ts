// @vitest-environment jsdom

import { vi } from 'vitest';
import { openAppMenuAt, runAppCommand } from '../../src/appCommands';
import useStore from '../../src/store';

function installApi(api: { runCommand?: unknown; openAppMenu?: unknown }) {
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
}

const toastTitles = () => useStore.getState().toasts.map((toast) => toast.title);

// Toasts with the same dedupe key are suppressed for a while, so every test starts later than the last.
let now = Date.UTC(2026, 0, 1);

beforeEach(() => {
  now += 60_000;
  vi.useFakeTimers({ toFake: ['Date'], now });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

test('a command the main process runs shows nothing', async () => {
  installApi({ runCommand: vi.fn().mockResolvedValue(true) });
  expect(await runAppCommand('File > Open')).toBe(true);
  expect(toastTitles()).toEqual([]);
});

test('a refused or failed command is reported instead of dropped', async () => {
  installApi({ runCommand: vi.fn().mockResolvedValue(false) });
  expect(await runAppCommand('Actions > Delete Marked Videos')).toBe(false);
  expect(toastTitles()).toEqual(['Menu unavailable']);

  useStore.setState({ toasts: [] });
  vi.setSystemTime(now += 60_000);
  installApi({ runCommand: vi.fn().mockRejectedValue(new Error('ipc closed')) });
  expect(await runAppCommand('File > Open')).toBe(false);
  expect(toastTitles()).toEqual(['Menu unavailable']);
});

test('a menu that cannot open is reported, one that opens is not', async () => {
  installApi({ openAppMenu: vi.fn().mockResolvedValue(false) });
  await openAppMenuAt('File', 0, 0);
  expect(toastTitles()).toEqual(['Menu unavailable']);

  useStore.setState({ toasts: [] });
  vi.setSystemTime(now += 60_000);
  installApi({ openAppMenu: vi.fn().mockResolvedValue(true) });
  await openAppMenuAt('File', 0, 0);
  expect(toastTitles()).toEqual([]);
});
