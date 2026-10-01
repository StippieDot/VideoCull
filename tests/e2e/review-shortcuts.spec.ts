import { test, expect, type ElectronApplication } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import { kb } from '../../src/keybinds';
import {
  createSessionFixture,
  createUserDataDir,
  launchElectronApp,
  openSeededRecentFolder,
  removeDir,
  seedRecentDirectory,
} from './electronHarness';

test('player shortcuts work before and after focus while app shortcuts and dialogs take priority', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  const settingsPath = path.join(userDataDir, 'settings.json');
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  await fs.writeFile(settingsPath, JSON.stringify({ ...settings, keyShowHelp: kb('h') }));
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);
    await page.getByText('alpha.mp4').click();
    await page.locator('.review-actions').getByRole('button', { name: 'Play' }).click();
    const video = page.locator('.review-video-skin video');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.duration)).toBe(1);
    await video.evaluate((el: HTMLVideoElement) => el.pause());
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.review-video-skin')))).toBe(false);

    await page.keyboard.press('6');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(0.6);
    await video.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.volume)).toBeCloseTo(0.95);
    await page.locator('.review-filename').click();
    await page.keyboard.press('3');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(0.3);

    await page.keyboard.press('h');
    await expect(page.locator('.shortcuts-overlay')).toBeVisible();
    await page.locator('.shortcuts-overlay h2').click();
    await page.keyboard.press('0');
    expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(0.3);
    await page.keyboard.press('Escape');
    await expect(page.locator('.shortcuts-overlay')).toHaveCount(0);

    await video.focus();
    await page.keyboard.press('m');
    await expect(page.locator('button.app-global-mute[aria-label="Unmute in-app playback"]')).toBeVisible();
    expect(await video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(true);
    await page.keyboard.press('k');
    await expect(page.locator('.review-filename')).toHaveText('beta.mp4');
    await expect(page.locator('.review-mode')).toHaveClass(/review-preview/);
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});

test('custom app bindings override player bindings and release the unused defaults', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  const settingsPath = path.join(userDataDir, 'settings.json');
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  await fs.writeFile(settingsPath, JSON.stringify({ ...settings, keyKeep: kb('j'), keyGlobalMute: kb('5') }));
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);
    await page.getByText('alpha.mp4').click();
    await page.locator('.review-actions').getByRole('button', { name: 'Play' }).click();
    const video = page.locator('.review-video-skin video');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.duration)).toBe(1);
    await video.evaluate((el: HTMLVideoElement) => { el.pause(); el.currentTime = 0; });

    await page.keyboard.press('5');
    await expect(page.locator('button.app-global-mute[aria-label="Unmute in-app playback"]')).toBeVisible();
    expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBe(0);
    await page.keyboard.press('m');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(false);
    await page.keyboard.press('k');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
    await page.keyboard.press('j');
    await expect(page.locator('.review-filename')).toHaveText('beta.mp4');
    await expect(page.locator('button[title="Show keep videos"]')).toContainText('1');
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
