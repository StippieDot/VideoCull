import { test, expect } from '@playwright/test';
import { createUserDataDir, launchElectronApp, removeDir } from './electronHarness';

test('launches the packaged renderer in an isolated Electron session', async () => {
  const userDataDir = await createUserDataDir();
  const app = await launchElectronApp(userDataDir);

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Video Cull' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Directory' })).toBeVisible();
  } finally {
    await app.close();
    await removeDir(userDataDir);
  }
});
