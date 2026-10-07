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

    // Outside a text field a Ctrl shortcut does reach the menu, so the check above is meaningful.
    await search.blur();
    await pressWithControl(app, ',');
    await expect.poll(menuActions).toEqual(['open-settings']);
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});

async function menuItem(app: ElectronApplication, path: string[]) {
  return app.evaluate(({ Menu }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let found;
    for (const label of labels) {
      found = items.find((entry) => entry.label === label);
      items = found?.submenu?.items ?? [];
    }
    return found ? { enabled: found.enabled, checked: found.checked } : null;
  }, path);
}

async function clickMenuItem(app: ElectronApplication, path: string[]) {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let found;
    for (const label of labels) {
      found = items.find((entry) => entry.label === label);
      items = found?.submenu?.items ?? [];
    }
    found?.click(undefined, BrowserWindow.getAllWindows()[0]);
  }, path);
}

test('the menu follows the session and its new items act on it', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    expect(await menuItem(app, ['File', 'Rescan'])).toMatchObject({ enabled: false });
    const page = await openSeededRecentFolder(app);
    await expect.poll(() => menuItem(app!, ['File', 'Rescan'])).toMatchObject({ enabled: true });
    expect(await menuItem(app, ['Video', 'Reveal in Explorer'])).toMatchObject({ enabled: false });

    await page.getByText('alpha.mp4').click();
    await expect(page.locator('.review-mode')).toBeVisible();
    await expect.poll(() => menuItem(app!, ['Video', 'Reveal in Explorer'])).toMatchObject({ enabled: true });

    await clickMenuItem(app, ['View', 'Privacy Screen']);
    await expect(page.locator('.privacy-screen')).toBeVisible();
    await expect.poll(() => menuItem(app!, ['File', 'Close Session'])).toMatchObject({ enabled: false });
    await clickMenuItem(app, ['View', 'Privacy Screen']);
    await expect(page.locator('.privacy-screen')).toHaveCount(0);

    await clickMenuItem(app, ['File', 'Close Session']);
    await expect.poll(() => menuItem(app!, ['File', 'Rescan'])).toMatchObject({ enabled: false });
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});

test('Ctrl+K opens the command palette, which runs menu commands', async () => {
  const userDataDir = await createUserDataDir();
  const { rootDir, mediaDir } = await createSessionFixture(['alpha.mp4', 'beta.mp4']);
  await seedRecentDirectory(userDataDir, mediaDir);
  let app: ElectronApplication | undefined;

  try {
    app = await launchElectronApp(userDataDir);
    const page = await openSeededRecentFolder(app);
    await pressWithControl(app, 'k');
    const input = page.getByPlaceholder('Search commands, folders and videos');
    await expect(input).toBeFocused();
    await input.fill('close session');
    // The commands arrive from the main process; before that only the grid search row is listed.
    await expect(page.getByRole('option', { name: /Close Session/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    await expect.poll(() => menuItem(app!, ['File', 'Rescan'])).toMatchObject({ enabled: false });
  } finally {
    if (app) await app.close();
    await removeDir(userDataDir);
    await removeDir(rootDir);
  }
});
