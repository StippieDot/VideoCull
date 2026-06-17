import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, test, vi } from 'vitest';

let exposedName = null;
let exposedApi = null;
let invoke;
let send;
let on;
let removeListener;
let getPathForFile;

function loadPreload() {
  const preloadPath = path.resolve(process.cwd(), 'electron', 'preload.js');
  const source = fs.readFileSync(preloadPath, 'utf8');
  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: vi.fn((name, api) => {
        exposedName = name;
        exposedApi = api;
      }),
    },
    ipcRenderer: {
      invoke,
      send,
      on,
      removeListener,
    },
    webUtils: {
      getPathForFile,
    },
  };

  vm.runInNewContext(source, {
    require: (name) => {
      if (name === 'electron') return fakeElectron;
      throw new Error(`Unexpected module request: ${name}`);
    },
  });
}

describe('preload electronAPI bridge', () => {
  beforeEach(() => {
    exposedName = null;
    exposedApi = null;
    invoke = vi.fn();
    send = vi.fn();
    on = vi.fn();
    removeListener = vi.fn();
    getPathForFile = vi.fn((file) => file?.path ?? null);
    loadPreload();
  });

  test('exposes the electronAPI contract on the main world', () => {
    expect(exposedName).toBe('electronAPI');
    expect(exposedApi).toBeTruthy();
    expect(exposedApi.selectDirectory).toBeTypeOf('function');
    expect(exposedApi.saveConfig).toBeTypeOf('function');
    expect(exposedApi.exportReport).toBeTypeOf('function');
    expect(exposedApi.onUpdateStatus).toBeTypeOf('function');
  });

  test('forwards invoke and send actions to the expected IPC channels', async () => {
    await exposedApi.selectDirectory();
    await exposedApi.openVideo('D:\\Media\\clip.mp4');
    await exposedApi.exportReport([{ id: 'a' }], ['D:\\Media']);
    await exposedApi.confirmThumbnailRebuild(6, 9, 12);
    exposedApi.setExportReportAvailable(true);
    exposedApi.getPathForFile({ path: 'D:\\Media\\clip.mp4' });

    expect(invoke).toHaveBeenNthCalledWith(1, 'select-directory');
    expect(invoke).toHaveBeenNthCalledWith(2, 'open-video', 'D:\\Media\\clip.mp4');
    expect(invoke).toHaveBeenNthCalledWith(3, 'export-report', [{ id: 'a' }], ['D:\\Media']);
    expect(invoke).toHaveBeenNthCalledWith(4, 'confirm-thumbnail-rebuild', 6, 9, 12);
    expect(send).toHaveBeenCalledWith('set-export-report-available', true);
    expect(getPathForFile).toHaveBeenCalledWith({ path: 'D:\\Media\\clip.mp4' });
  });

  test('subscribes to update events and unsubscribes the same handler', () => {
    const callback = vi.fn();
    const unsubscribe = exposedApi.onUpdateStatus(callback);

    expect(on).toHaveBeenCalledWith('update-status', expect.any(Function));

    const handler = on.mock.calls[0][1];
    handler({}, { status: 'ready', version: '2.2.0' });
    expect(callback).toHaveBeenCalledWith({ status: 'ready', version: '2.2.0' });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('update-status', handler);
  });
});
