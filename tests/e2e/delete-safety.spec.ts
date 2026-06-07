import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import {
  createSessionFixture,
  createUserDataDir,
  launchElectronApp,
  openSeededRecentFolder,
  removeDir,
  seedRecentDirectory,
} from './electronHarness';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

function videoCard(page: Page, fileName: string): Locator {
  return page.locator('.video-card').filter({ hasText: fileName });
}

test('batch delete only removes intended files', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  const alphaPath = path.join(mediaDir, 'alpha.mp4');
  const betaPath = path.join(mediaDir, 'beta.mp4');
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);

    const alphaCard = videoCard(page, 'alpha.mp4');
    await expect(alphaCard).toBeVisible();
    await alphaCard.getByTitle('Delete (D)').click();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Delete 1 videos/ }).click();

    await expect(page.getByText('Moved to Recycle Bin')).toBeVisible();
    await expect(page.getByText('alpha.mp4')).toHaveCount(0);
    await expect(page.getByText('beta.mp4')).toBeVisible();

    await expect(fs.access(alphaPath)).rejects.toThrow();
    await expect(fs.access(betaPath)).resolves.toBeUndefined();
  } finally {
    if (app) {
      await app.close();
    }
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
