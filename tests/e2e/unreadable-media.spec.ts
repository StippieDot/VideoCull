import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import { createSessionFixture, createUserDataDir, launchElectronApp, openSeededRecentFolder, removeDir, seedRecentDirectory } from './electronHarness';

test('a scan warns about unreadable videos, makes previews for the rest and ignores source folders', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4']);
  await fs.writeFile(path.join(mediaDir, 'broken.mp4'), 'this is not a video');
  await fs.writeFile(path.join(mediaDir, 'empty.mp4'), '');
  await fs.writeFile(path.join(mediaDir, 'source.ts'), 'export const value = 1;\n');
  await fs.mkdir(path.join(mediaDir, 'node_modules'));
  await fs.copyFile(path.join(mediaDir, 'alpha.mp4'), path.join(mediaDir, 'node_modules', 'dependency.mp4'));
  await seedRecentDirectory(userDataDir, mediaDir);
  const app = await launchElectronApp(userDataDir);

  try {
    const page = await openSeededRecentFolder(app);

    await expect(page.getByText('Some videos could not be read')).toBeVisible();
    await expect(page.getByText(/No new previews for 2 videos/)).toBeVisible();
    await expect(page.getByText('Thumbnails created')).toBeVisible();
    await expect(page.getByText('Some thumbnails failed')).toHaveCount(0);

    await expect(page.locator('.video-card')).toHaveCount(3);
    await expect(page.locator('.video-card').filter({ hasText: 'alpha.mp4' }).locator('.thumb-img-loaded')).toHaveCount(1);
    await expect(page.getByText('source.ts')).toHaveCount(0);
    await expect(page.getByText('dependency.mp4')).toHaveCount(0);
  } finally {
    await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
