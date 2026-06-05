import { test, expect } from '@playwright/test';
import {
  createSessionFixture,
  createUserDataDir,
  launchElectronApp,
  removeDir,
  seedRecentDirectory,
} from './electronHarness';
import type { ElectronApplication, Page } from '@playwright/test';

async function openSeededRecentFolder(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Video Cull' })).toBeVisible();
  await page.locator('.empty-recent-item').first().click();
  await expect(page.getByText('alpha.mp4')).toBeVisible();
  return page;
}

test('relaunch preserves review decisions', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    let page = await openSeededRecentFolder(app);

    await page.getByText('alpha.mp4').click();
    await expect(page.locator('.review-mode')).toBeVisible();
    await page.locator('.review-actions').getByRole('button', { name: 'Keep' }).click();
    await page.keyboard.press('Escape');

    const keepStat = page.locator('button[title="Show keep videos"]');
    await expect(keepStat).toContainText('1');
    await page.waitForTimeout(250);

    await app.close();
    app = await launchElectronApp(userDataDir);
    page = await openSeededRecentFolder(app);

    const reopenedKeepStat = page.locator('button[title="Show keep videos"]');
    await expect(reopenedKeepStat).toContainText('1');
    await reopenedKeepStat.click();
    await expect(page.getByText('alpha.mp4')).toBeVisible();
    await expect(page.getByText('beta.mp4')).toHaveCount(0);
  } finally {
    if (app) {
      await app.close();
    }
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
