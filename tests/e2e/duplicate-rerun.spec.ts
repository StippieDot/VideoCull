import { test, expect } from '@playwright/test';
import {
  createSessionFixture,
  createUserDataDir,
  launchElectronApp,
  openSeededRecentFolder,
  removeDir,
  seedRecentDirectory,
} from './electronHarness';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

async function waitForFindDuplicates(page: Page) {
  const button = page.getByRole('button', { name: 'Find Duplicates' });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  return button;
}

function duplicateRow(page: Page, fileName: string): Locator {
  return page.locator('.duplicate-row').filter({ hasText: fileName });
}

test('duplicate rerun preserves manual keeper and ignored-pair behavior', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);

    await (await waitForFindDuplicates(page)).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Duplicates' })).toBeVisible();
    const betaRow = duplicateRow(page, 'beta.mp4');
    await expect(betaRow).toBeVisible();

    await betaRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark as selected keeper' }).click();
    await expect(page.getByText('Selected keeper updated')).toBeVisible();
    await expect(betaRow).toContainText('Selected keeper');

    await page.getByRole('button', { name: 'Run Again' }).click();
    await expect(betaRow).toContainText('Selected keeper');

    await page.getByRole('button', { name: 'Dismiss group' }).click();
    await expect(page.getByText('Group dismissed')).toBeVisible();
    await expect(page.locator('.duplicate-row')).toHaveCount(0);

    await page.getByRole('button', { name: /Run Again|Find Duplicates/ }).click();
    await expect(page.getByText('No duplicates found')).toBeVisible();
    await expect(page.locator('.duplicate-row')).toHaveCount(0);
  } finally {
    if (app) {
      await app.close();
    }
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
