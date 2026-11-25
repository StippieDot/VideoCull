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
  // processing-runs.test.js proves invalidateSession() cancels every kind of run.
  for (const channel of ['reset-loaded-directories', 'clear-cache', 'migrate-cache-settings']) {
    test(channel, () => {
      assert.match(handlerBody(channel), /\bprocessingRuns\.invalidateSession\(\)/);
    });
  }
});

test('cancelling duplicate detection goes through the run registry', () => {
  assert.match(handlerBody('cancel-duplicate-detection'), /processingRuns\.cancelKinds\('duplicate'\)/);
});

describe('linked folders and files', () => {
  test('a reset forgets the followed links and real paths of the old session', () => {
    const body = handlerBody('reset-loaded-directories');
    // library-registry.test.js proves reset() forgets links and real paths.
    assert.match(body, /\blibraryRegistry\.reset\(\)/);
  });

  // file-ops-delete.test.js proves the real file, not the link to it, is checked and removed.
  for (const [channel, method] of [['batch-delete', 'batchDelete'], ['permanently-delete', 'permanentlyDelete']]) {
    test(`${channel} is a one-line delegation`, () => {
      assert.match(handlerBody(channel), new RegExp(`=> fileOpsDelete\\.${method}\\(filePaths\\)\\);`));
    });
  }

  test('unloading one folder forgets only that folder and keeps the session', () => {
    const body = handlerBody('unload-directory');
    assert.match(body, /!libraryRegistry\.isLoadedRoot\(dirPath\) \|\| libraryRegistry\.rootCount\(\) < 2\) return false/);
    assert.match(body, /cacheService\.blockFolder\(folderPath, cacheOptions\)/);
    // removeRoot also forgets the folder's videos (library-registry.test.js).
    assert.match(body, /libraryRegistry\.removeRoot\(dirPath\)/);
    // A video another folder reaches through a link is listed again only by a rescan.
    assert.match(body, /if \(libraryRegistry\.hasFollowedLinks\(\)\) return false;/);
    assert.doesNotMatch(body, /\.clear\(\)|libraryRegistry\.reset\(\)/);
    assert.doesNotMatch(body, /scanGeneration/);
  });

  test('a video reached through a link is played or opened only while the link still leads to the scanned file', () => {
    assert.match(mainSource, /\|\| !await stillLeadsToScannedFile\(filePath\)\) \{\s+return new Response\('Access Denied'/);
    const body = mainSource.match(/async function isValidLoadedPath[\s\S]*?\n\}/)?.[0] ?? '';
    assert.match(body, /&& stillLeadsToScannedFile\(filePath\)/);
  });

  const comparableVideosBody = () => mainSource.match(/async function comparableVideos[\s\S]*?\n\}/)?.[0] ?? '';

  test('duplicate detection and partial clips take their videos through the same check', () => {
    for (const channel of ['find-duplicates', 'find-partial-clips']) {
      assert.match(handlerBody(channel), /const safeVideos = await comparableVideos\(videos\);/);
    }
  });

  test('duplicate detection skips a linked video whose link no longer leads to the scanned file', () => {
    assert.match(comparableVideosBody(), /if \(!await stillLeadsToScannedFile\(video\.path\)\) continue;/);
  });

  test('duplicate detection compares each real file once', () => {
    assert.match(comparableVideosBody(), /if \(seenRealPaths\.has\(realKey\)\) continue;/);
  });

  test('empty-folder cleanup stays inside the loaded folders and skips links', () => {
    const deleteSource = fs.readFileSync(path.join(__dirname, '../../electron/file-ops-delete.js'), 'utf8');
    const body = deleteSource.match(/async function maybeRemoveEmptyDeletedVideoFolders[\s\S]*?\n  \}/)?.[0] ?? '';
    assert.match(body, /=> isPathWithinAnyDir\(folderPath, dirs, false\)/);
    assert.match(body, /isSymbolicLink\(\)/);
  });
});
