import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  configureUpdatePolicy,
  shouldInstallUpdateOnQuit,
} = require('../../electron/update-policy');

describe('update installation policy', () => {
  test('downloads updates without installing them when the app closes', () => {
    const autoUpdater = {
      autoDownload: false,
      autoInstallOnAppQuit: true,
    };

    configureUpdatePolicy(autoUpdater);

    expect(autoUpdater.autoDownload).toBe(true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  test('installs on quit only after an explicit choice for a ready update', () => {
    expect(shouldInstallUpdateOnQuit({ scheduled: false, ready: true, installInProgress: false })).toBe(false);
    expect(shouldInstallUpdateOnQuit({ scheduled: true, ready: false, installInProgress: false })).toBe(false);
    expect(shouldInstallUpdateOnQuit({ scheduled: true, ready: true, installInProgress: true })).toBe(false);
    expect(shouldInstallUpdateOnQuit({ scheduled: true, ready: true, installInProgress: false })).toBe(true);
  });
});
