import { test, expect, type ElectronApplication } from '@playwright/test';
import {
  createSessionFixture,
  createUserDataDir,
  launchElectronApp,
  openSeededRecentFolder,
  removeDir,
  seedRecentDirectory,
} from './electronHarness';

async function recordMenuActions(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const sent: string[] = [];
    (globalThis as unknown as { __menuActions: string[] }).__menuActions = sent;
    const send = contents.send.bind(contents);
    contents.send = (channel: string, ...args: unknown[]) => {
      if (channel === 'menu-action') sent.push(String(args[0]));
      return send(channel, ...args);
    };
  });
  return () => app.evaluate(() => (globalThis as unknown as { __menuActions: string[] }).__menuActions);
}

// Playwright's keys come in through DevTools, which skips Electron's menu shortcut handling.
// sendInputEvent takes the same path as a real keystroke.
async function pressWithControl(app: ElectronApplication, keyCode: string) {
  await app.evaluate(({ BrowserWindow }, key) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
  }, keyCode);
}

test('editing shortcuts in a text field edit the text instead of running menu actions', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);
    const menuActions = await recordMenuActions(app);
    const search = page.getByPlaceholder('Search filename or path');
    await search.click();
    await page.keyboard.type('alpha beta');
    await pressWithControl(app, 'Backspace');
    await expect(search).toHaveValue('alpha ');
    await pressWithControl(app, 'z');
    await expect(search).toHaveValue('alpha beta');
    expect(await menuActions()).toEqual([]);

    // Outside a text field the same key does reach the menu, so the check above is meaningful.
    await search.blur();
    await pressWithControl(app, 'Backspace');
    await expect.poll(menuActions).toEqual(['delete-all']);
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
