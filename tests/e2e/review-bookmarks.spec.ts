import { test, expect, type ElectronApplication } from '@playwright/test';
import {
  createSessionFixture,
  createUserDataDir,
  launchElectronApp,
  openSeededRecentFolder,
  removeDir,
  seedRecentDirectory,
} from './electronHarness';

test('review bookmark chapters update in the real player and follow the current video', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);
    await page.getByText('alpha.mp4').click();
    await page.locator('.review-actions').getByRole('button', { name: 'Play' }).click();
    const video = page.locator('.review-video-skin video');
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.duration)).toBe(1);
    const bookmark = page.getByTitle('Bookmark current position (B)');
    const chapters = page.locator('.media-time-slider-chapter');

    for (const time of [0.2, 0.6]) {
      await video.evaluate((el: HTMLVideoElement, position) => {
        el.pause();
        el.currentTime = position;
      }, time);
      await bookmark.click();
    }
    await expect(chapters).toHaveCount(3);
    expect(await video.evaluate((el: HTMLVideoElement) => (
      Array.from(el.textTracks[0].cues ?? [], (cue) => [cue.startTime, cue.endTime, (cue as VTTCue).text])
    ))).toEqual([[0.2, 0.6, 'Bookmark at 0:00'], [0.6, 1, 'Bookmark at 0:00']]);

    const slider = page.locator('.media-time-slider');
    const bounds = (await slider.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height / 2);
    await expect(page.locator('.media-time-slider-chapter-title')).toHaveText('Bookmark at 0:00');

    await page.getByTitle('Remove bookmark').first().click();
    await expect(chapters).toHaveCount(2);
    await page.getByTitle('Remove bookmark').click();
    await expect(chapters).toHaveCount(1);
    expect(await video.evaluate((el: HTMLVideoElement) => el.textTracks[0].cues?.length)).toBe(0);

    await video.evaluate((el: HTMLVideoElement) => { el.currentTime = 0.4; });
    await bookmark.click();
    await page.locator('.review-nav-right').click();
    await expect(page.locator('.review-filename')).toHaveText('beta.mp4');
    await page.locator('.review-actions').getByRole('button', { name: 'Play' }).click();
    await expect(chapters).toHaveCount(1);
    expect(await video.evaluate((el: HTMLVideoElement) => el.textTracks.length)).toBe(1);
    expect(await video.evaluate((el: HTMLVideoElement) => el.textTracks[0].cues?.length)).toBe(0);

    await page.locator('.review-nav-left').click();
    await page.locator('.review-actions').getByRole('button', { name: 'Play' }).click();
    await expect(chapters).toHaveCount(2);
    expect(await video.evaluate((el: HTMLVideoElement) => el.textTracks[0].cues?.[0].startTime)).toBe(0.4);
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
