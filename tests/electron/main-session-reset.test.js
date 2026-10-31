const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// main.js registers its IPC handlers at load and cannot be required without Electron, so the
// handlers are checked as text.
const mainSource = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8').replace(/\r\n/g, '\n');

function handlerBody(channel) {
  const start = mainSource.indexOf(`ipcMain.handle('${channel}'`);
  assert.notEqual(start, -1, `${channel} handler not found`);
  const next = mainSource.indexOf('\nipcMain.handle(', start + 1);
  return mainSource.slice(start, next === -1 ? undefined : next);
}

describe('handlers that throw away the loaded session also stop duplicate detection', () => {
  for (const channel of ['reset-loaded-directories', 'clear-cache', 'migrate-cache-settings']) {
    test(channel, () => {
      assert.match(handlerBody(channel), /\bcancelActiveDuplicateRun\(\)/);
    });
  }
});

test('stopping duplicate detection cancels the run and forgets it', () => {
  const body = mainSource.match(/function cancelActiveDuplicateRun\(\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /activeDuplicateRun\.cancel\(\)/);
  assert.match(body, /activeDuplicateRun = null/);
  assert.doesNotMatch(body, /resume/);
});

describe('linked folders and files', () => {
  test('a reset forgets the followed links and real paths of the old session', () => {
    const body = handlerBody('reset-loaded-directories');
    for (const name of ['knownRealPathsByPath', 'sessionRealPathOwners', 'followedLinkTargets']) {
      assert.match(body, new RegExp(`\\b${name}\\.clear\\(\\)`));
    }
  });

  for (const [channel, remove] of [['batch-delete', 'shell.trashItem'], ['permanently-delete', 'fs.unlink']]) {
    test(`${channel} checks and removes the real file, not a file link to it`, () => {
      const body = handlerBody(channel);
      assert.match(body, /const realPath = knownRealPathsByPath\.get\(filePath\) \?\? filePath;/);
      assert.match(body, /filePath: realPath,/);
      assert.match(body, new RegExp(`${remove.replace('.', '\\.')}\\(realPath\\)`));
    });
  }

  test('unloading one folder forgets only that folder and keeps the session', () => {
    const body = handlerBody('unload-directory');
    assert.match(body, /!currentScanDirs\.has\(dirPath\) \|\| currentScanDirs\.size < 2\) return false/);
    assert.match(body, /cacheService\.blockFolder\(folderPath, cacheOptions\)/);
    assert.match(body, /currentScanDirs\.delete\(dirPath\)/);
    // A video another folder reaches through a link is listed again only by a rescan.
    assert.match(body, /if \(followedLinkTargets\.size > 0\) return false;/);
    for (const name of ['knownVideoPaths', 'knownVideoIdsByPath', 'knownVideoIdentitiesByPath', 'knownRealPathsByPath']) {
      assert.ok(body.includes(`${name}.delete(videoPath)`), name);
    }
    assert.doesNotMatch(body, /\.clear\(\)/);
    assert.doesNotMatch(body, /scanGeneration/);
  });

  test('duplicate detection compares each real file once', () => {
    assert.match(handlerBody('find-duplicates'), /if \(seenRealPaths\.has\(realKey\)\) continue;/);
  });

  test('empty-folder cleanup stays inside the loaded folders and skips links', () => {
    const body = mainSource.match(/async function maybeRemoveEmptyDeletedVideoFolders[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(body, /isPathWithinAnyDir\(folderPath, dirs, false\)/);
    assert.match(body, /isSymbolicLink\(\)/);
  });
});
