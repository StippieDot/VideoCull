import { _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const electronPath = require('electron') as string;
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

export async function createUserDataDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'videocull-e2e-userdata-'));
}

export async function createSessionFixture(videoNames: string[]) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-e2e-session-'));
  const mediaDir = path.join(rootDir, 'session-clips');
  await fs.mkdir(mediaDir, { recursive: true });
  const sourcePath = path.join(mediaDir, '__fixture-source__.mp4');
  await execFileAsync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=160x90:d=1',
    '-an',
    '-pix_fmt', 'yuv420p',
    sourcePath,
  ]);
  await Promise.all(videoNames.map((name) => fs.copyFile(sourcePath, path.join(mediaDir, name))));
  await fs.rm(sourcePath, { force: true });
  return { rootDir, mediaDir };
}

export async function seedRecentDirectory(userDataDir: string, directory: string) {
  const settingsPath = path.join(userDataDir, 'settings.json');
  const timestamp = Date.now();
  const settings = {
    autoUpdates: false,
    recentDirectories: [directory],
    recentDirectoryTimestamps: {
      [directory]: timestamp,
    },
  };
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

export async function launchElectronApp(userDataDir: string): Promise<ElectronApplication> {
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  return electron.launch({
    executablePath: electronPath,
    args: [process.cwd()],
    env: {
      ...launchEnv,
      VC_E2E_USE_DIST: '1',
      VC_E2E_USER_DATA_DIR: userDataDir,
      VC_DISABLE_UPDATES: '1',
    },
  });
}

export async function openSeededRecentFolder(app: ElectronApplication, fileName = 'alpha.mp4'): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'VideoCull' })).toBeVisible();
  await page.locator('.empty-recent-item').first().click();
  await expect(page.getByText(fileName)).toBeVisible();
  return page;
}

export async function removeDir(target: string) {
  await fs.rm(target, { recursive: true, force: true });
}
