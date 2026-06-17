const assert = require('node:assert/strict');

const {
  canRevealInExplorerPath,
  canServeThumbPath,
  canServeVideoPath,
  filterLoadedDeletionPaths,
  filterValidCacheSaveVideos,
  isKnownLoadedFilePath,
  cacheRelevantSettingsChanged,
  detectCompatibility,
  escapeHtml,
  formatBytes,
  formatDuration,
  getDriveKeyForPath,
  getFilePathFromProtocolRequest,
  getRangeDetails,
  isFolderInsideSync,
  isSameFolderSync,
  isServableVideoPath,
  isSqliteCorruptionError,
  listExistingMigrationTargets,
  listMissingDescendantCacheFolders,
  normalizeReportRoots,
  removeEmptyDeletedVideoFolders,
  summarizeMediaProbeError,
  thumbAbsolute,
  thumbRelative,
  videoForDb,
} = require('../../electron/main-helpers');

describe('compatibility detection', () => {
  test('allows formats the renderer can play directly', () => {
    assert.equal(detectCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'D:\\clip.mp4'), true);
    assert.equal(detectCompatibility('', '', 'D:\\clip.webm'), true);
    assert.equal(detectCompatibility('ogg', 'vp9', 'D:\\clip.ogg'), true);
    assert.equal(detectCompatibility('ogg', 'vp9', 'D:\\clip.ogv'), true);
  });

  test('rejects unsupported containers and codecs before the app tries to play them', () => {
    assert.equal(detectCompatibility('asf', 'h264', 'D:\\clip.wmv'), false);
    assert.equal(detectCompatibility('matroska,webm', 'prores', 'D:\\clip.mkv'), false);
    assert.equal(detectCompatibility('avi', 'vp9', 'D:\\clip.avi'), false);
    assert.equal(detectCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'D:\\clip.3gp'), false);
    assert.equal(detectCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'D:\\clip.3g2'), false);
    assert.equal(detectCompatibility('mxf', 'mpeg4', 'D:\\clip.mxf'), false);
    assert.equal(detectCompatibility('dv', 'dvvideo', 'D:\\clip.dv'), false);
  });
});

describe('HTTP range parsing', () => {
  test('serves the full file when no range header is present', () => {
    assert.deepEqual(getRangeDetails(null, 100), {
      hasRange: false,
      start: 0,
      end: 99,
      chunkSize: 100,
      valid: true,
    });
  });

  test('supports suffix byte ranges used by media players', () => {
    assert.deepEqual(getRangeDetails('bytes=-25', 100), {
      hasRange: true,
      start: 75,
      end: 99,
      chunkSize: 25,
      valid: true,
    });
  });

  test('clamps oversized explicit ranges to the end of the file', () => {
    assert.deepEqual(getRangeDetails('bytes=10-500', 100), {
      hasRange: true,
      start: 10,
      end: 99,
      chunkSize: 90,
      valid: true,
    });
  });

  test('rejects malformed or impossible ranges', () => {
    assert.equal(getRangeDetails('bytes=-0', 100).valid, false);
    assert.equal(getRangeDetails('bytes=100-101', 100).valid, false);
    assert.equal(getRangeDetails('nope', 100).error, 'Malformed Range header.');
  });
});

describe('custom protocol paths', () => {
  test('decodes the local-host protocol form into a filesystem path', () => {
    assert.equal(
      getFilePathFromProtocolRequest({ url: 'videocull://local/D:/Media/clip%201.mp4' }, 'videocull'),
      'D:/Media/clip 1.mp4'
    );
  });

  test('decodes the legacy triple-slash protocol form into a filesystem path', () => {
    assert.equal(
      getFilePathFromProtocolRequest({ url: 'videocull:///D:/Media/clip%201.mp4' }, 'videocull'),
      'D:/Media/clip 1.mp4'
    );
  });

  test('only serves thumbnails from active cache roots with jpg extensions', async () => {
    assert.equal(await canServeThumbPath({
      filePath: 'D:\\cache\\thumbs\\clip.jpg',
      activeCacheRoots: new Set(['D:\\cache']),
      isPathWithinAnyDir: async (target, dirs) => {
        for (const dir of dirs) {
          if (target.startsWith(`${dir}\\`)) return true;
        }
        return false;
      },
    }), true);

    assert.equal(await canServeThumbPath({
      filePath: 'D:\\cache\\thumbs\\clip.png',
      activeCacheRoots: new Set(['D:\\cache']),
      isPathWithinAnyDir: async () => true,
    }), false);

    assert.equal(await canServeThumbPath({
      filePath: 'D:\\other\\thumbs\\clip.jpg',
      activeCacheRoots: new Set(['D:\\cache']),
      isPathWithinAnyDir: async () => false,
    }), false);
  });

  test('only serves video protocol requests for known servable files', () => {
    assert.equal(canServeVideoPath({
      filePath: 'D:\\media\\clip.mp4',
      knownVideoPaths: new Set(['D:\\media\\clip.mp4']),
      isServableVideoPath,
    }), true);

    assert.equal(canServeVideoPath({
      filePath: 'D:\\media\\clip.ogg',
      knownVideoPaths: new Set(['D:\\media\\clip.ogg']),
      isServableVideoPath,
    }), true);

    assert.equal(canServeVideoPath({
      filePath: 'D:\\media\\clip.ogv',
      knownVideoPaths: new Set(['D:\\media\\clip.ogv']),
      isServableVideoPath,
    }), true);

    assert.equal(canServeVideoPath({
      filePath: 'D:\\media\\clip.txt',
      knownVideoPaths: new Set(['D:\\media\\clip.txt']),
      isServableVideoPath,
    }), false);

    assert.equal(canServeVideoPath({
      filePath: 'D:\\media\\unknown.mp4',
      knownVideoPaths: new Set(['D:\\media\\clip.mp4']),
      isServableVideoPath,
    }), false);

    assert.equal(canServeVideoPath({
      filePath: 'D:\\media\\legacy.avi',
      knownVideoPaths: new Set(['D:\\media\\legacy.avi']),
      isServableVideoPath,
    }), false);
  });
});

describe('cache path helpers', () => {
  test('normalizes drive and folder identity comparisons', () => {
    assert.equal(getDriveKeyForPath('d:\\media\\clip.mp4'), 'D:');
    assert.equal(isFolderInsideSync('D:\\media\\clips', 'D:\\media'), true);
    assert.equal(isFolderInsideSync('D:\\media', 'D:\\media'), false);
    assert.equal(isSameFolderSync('D:\\media\\', 'd:/media'), true);
  });

  test('stores thumbnails relative to the cache root whenever possible', () => {
    const cacheRoot = 'D:\\cache';
    const absoluteThumb = thumbAbsolute('thumbs\\a\\thumb_01.jpg', cacheRoot);
    assert.equal(absoluteThumb, 'D:\\cache\\thumbs\\a\\thumb_01.jpg');
    assert.equal(thumbRelative(absoluteThumb, cacheRoot), 'thumbs\\a\\thumb_01.jpg');
    assert.equal(thumbRelative('D:\\other\\thumb.jpg', cacheRoot), 'D:\\other\\thumb.jpg');

    const dbVideo = videoForDb({
      id: 'a',
      thumbnails: [absoluteThumb, 'thumbs\\a\\thumb_02.jpg'],
    }, cacheRoot);
    assert.deepEqual(dbVideo.thumbnails, ['thumbs\\a\\thumb_01.jpg', 'thumbs\\a\\thumb_02.jpg']);
  });
});

describe('cache safety checks', () => {
  test('detects when cache settings changed in a way that requires different storage paths', () => {
    assert.equal(
      cacheRelevantSettingsChanged(
        { cacheLocation: 'centralised', centralCachePath: null, perDriveCachePaths: {} },
        { cacheLocation: 'centralised', centralCachePath: null, perDriveCachePaths: {} }
      ),
      false
    );
    assert.equal(
      cacheRelevantSettingsChanged(
        { cacheLocation: 'centralised', centralCachePath: null, perDriveCachePaths: {} },
        { cacheLocation: 'per-drive', centralCachePath: null, perDriveCachePaths: {} }
      ),
      true
    );
  });

  test('recognizes SQLite corruption errors that should trigger recovery logic', () => {
    assert.equal(isSqliteCorruptionError({ code: 'SQLITE_CORRUPT' }), true);
    assert.equal(isSqliteCorruptionError(new Error('file is not a database')), true);
    assert.equal(isSqliteCorruptionError(new Error('network timeout')), false);
  });

  test('detects cache migration targets that would be overwritten', async () => {
    const conflicts = await listExistingMigrationTargets({
      moves: [
        { source: 'D:\\old\\cache.db', target: 'E:\\new\\cache.db', kind: 'db' },
        { source: 'D:\\old\\cache.db-wal', target: 'E:\\new\\cache.db-wal', kind: 'wal' },
        { source: 'D:\\old\\missing-shm', target: 'E:\\new\\cache.db-shm', kind: 'shm' },
      ],
      pathExists: async (target) => (
        target === 'D:\\old\\cache.db' ||
        target === 'D:\\old\\cache.db-wal' ||
        target === 'E:\\new\\cache.db'
      ),
    });

    assert.deepEqual(conflicts, [
      { source: 'D:\\old\\cache.db', target: 'E:\\new\\cache.db', kind: 'db' },
    ]);
  });

  test('finds only descendant cache folders that no longer exist on disk', async () => {
    const missing = await listMissingDescendantCacheFolders({
      rootFolder: 'D:\\Media',
      knownCacheFolders: [
        'D:\\Media',
        'D:\\Media\\Keep',
        'D:\\Media\\Missing',
        'D:\\Media\\Deep\\MissingToo',
        'D:\\Other',
      ],
      statPath: async (target) => {
        if (target === 'D:\\Media\\Keep') {
          return { isDirectory: () => true };
        }
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    });

    assert.deepEqual(missing, ['D:\\Media\\Missing', 'D:\\Media\\Deep\\MissingToo']);
  });

  test('does not treat inaccessible descendant cache folders as missing', async () => {
    const missing = await listMissingDescendantCacheFolders({
      rootFolder: 'D:\\Media',
      knownCacheFolders: ['D:\\Media\\Missing', 'D:\\Media\\Inaccessible'],
      statPath: async (target) => {
        if (target === 'D:\\Media\\Missing') {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        }
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });

    assert.deepEqual(missing, ['D:\\Media\\Missing']);
  });

  test('skips cleanup candidates that still resolve to directories', async () => {
    const missing = await listMissingDescendantCacheFolders({
      rootFolder: 'D:\\Media',
      knownCacheFolders: ['D:\\Media\\Keep', 'D:\\Media\\FileLike'],
      statPath: async (target) => ({
        isDirectory: () => target === 'D:\\Media\\Keep',
      }),
    });

    assert.deepEqual(missing, ['D:\\Media\\FileLike']);
  });

  test('allows file operations only for known videos that still belong to a loaded root', async () => {
    const loadedDirectories = new Set(['D:\\loaded']);
    const knownVideoPaths = new Set(['D:\\loaded\\clip.mp4', 'D:\\stale\\clip.mp4']);

    assert.equal(await isKnownLoadedFilePath({
      filePath: 'D:\\loaded\\clip.mp4',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async (target, dirs) => {
        for (const dir of dirs) {
          if (target.startsWith(`${dir}\\`)) return true;
        }
        return false;
      },
    }), true);

    assert.equal(await isKnownLoadedFilePath({
      filePath: 'D:\\loaded\\unknown.mp4',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async () => true,
    }), false);

    assert.equal(await isKnownLoadedFilePath({
      filePath: 'D:\\stale\\clip.mp4',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async () => false,
    }), false);
  });

  test('keeps only loaded-session paths for batch deletion and reports rejected paths', async () => {
    const rejections = [];
    const result = await filterLoadedDeletionPaths({
      filePaths: ['D:\\loaded\\keep.mp4', 'D:\\outside\\nope.mp4'],
      isValidLoadedPath: async (filePath) => filePath === 'D:\\loaded\\keep.mp4',
      onReject: (filePath) => rejections.push(filePath),
    });

    assert.deepEqual(result, ['D:\\loaded\\keep.mp4']);
    assert.deepEqual(rejections, ['D:\\outside\\nope.mp4']);
  });

  test('allows reveal-in-explorer only for paths in the loaded session scope', async () => {
    const loadedDirectories = new Set(['D:\\loaded']);
    const knownVideoPaths = new Set(['D:\\loaded\\clip.mp4']);

    assert.equal(await canRevealInExplorerPath({
      filePath: 'D:\\loaded\\clip.mp4',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async () => true,
      statPath: async () => ({ isFile: () => false, isDirectory: () => false }),
    }), true);

    assert.equal(await canRevealInExplorerPath({
      filePath: 'D:\\loaded\\folder',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async (target, dirs) => {
        for (const dir of dirs) {
          if (target.startsWith(`${dir}\\`)) return true;
        }
        return false;
      },
      statPath: async () => ({ isFile: () => false, isDirectory: () => false }),
    }), true);

    assert.equal(await canRevealInExplorerPath({
      filePath: 'D:\\recent\\folder',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async () => false,
      statPath: async () => ({ isFile: () => false, isDirectory: () => true }),
    }), false);

    assert.equal(await canRevealInExplorerPath({
      filePath: 'D:\\missing\\folder',
      knownVideoPaths,
      loadedDirectories,
      isPathWithinAnyDir: async () => false,
      statPath: async () => {
        throw new Error('missing');
      },
    }), false);

    assert.equal(await canRevealInExplorerPath({
      filePath: 'D:\\stale\\clip.mp4',
      knownVideoPaths: new Set(['D:\\stale\\clip.mp4']),
      loadedDirectories,
      isPathWithinAnyDir: async () => false,
      statPath: async () => ({ isFile: () => true, isDirectory: () => false }),
    }), false);
  });
});

describe('empty folder cleanup safety', () => {
  test('removes only immediate parent folders with an atomic empty-folder remove', async () => {
    const removed = await removeEmptyDeletedVideoFolders({
      deletedFilePaths: [
        'D:\\Media\\Trip\\Day1\\clip.mp4',
        'D:\\Media\\Busy\\clip.mp4',
        'D:\\Other\\outside.mp4',
      ],
      loadedDirectories: new Set(['D:\\Media']),
      isPathWithinAnyDir: async (target, dirs) => {
        for (const dir of dirs) {
          if (target === dir || target.startsWith(`${dir}\\`)) return true;
        }
        return false;
      },
      removeDir: async (target) => {
        if (target === 'D:\\Media\\Trip\\Day1') return;
        throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' });
      },
    });

    assert.deepEqual(Array.from(removed), ['D:\\Media\\Trip\\Day1']);
  });

  test('does not walk upward and remove ancestor folders after child cleanup', async () => {
    const removeCalls = [];
    await removeEmptyDeletedVideoFolders({
      deletedFilePaths: ['D:\\Media\\Trip\\Day1\\clip.mp4'],
      loadedDirectories: new Set(['D:\\Media']),
      isPathWithinAnyDir: async () => true,
      removeDir: async (target) => {
        removeCalls.push(target);
      },
    });

    assert.deepEqual(removeCalls, ['D:\\Media\\Trip\\Day1']);
  });

  test('quietly skips expected cleanup failures', async () => {
    const warnings = [];
    const codes = ['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EPERM', 'EACCES', 'EBUSY'];
    const removed = await removeEmptyDeletedVideoFolders({
      deletedFilePaths: codes.map((code) => `D:\\Media\\${code}\\clip.mp4`),
      loadedDirectories: new Set(['D:\\Media']),
      isPathWithinAnyDir: async () => true,
      removeDir: async (target) => {
        const code = String(target).split(/[\\/]/).pop();
        throw Object.assign(new Error(code), { code });
      },
      onWarn: (message) => warnings.push(message),
    });

    assert.equal(removed.size, 0);
    assert.deepEqual(warnings, []);
  });
});

describe('cache save payload safety', () => {
  test('rejects cache writes for unloaded directories before touching any video records', async () => {
    const rejections = [];
    const result = await filterValidCacheSaveVideos({
      dirPath: 'D:\\missing',
      loadedDirectories: new Set(['D:\\loaded']),
      videos: [{ id: '0123456789abcdef', path: 'D:\\loaded\\clip.mp4' }],
      isKnownVideoRecord: () => true,
      isPathWithinDir: async () => true,
      onReject: (reason, detail) => rejections.push({ reason, detail }),
    });

    assert.deepEqual(result, []);
    assert.deepEqual(rejections, [{ reason: 'unloaded-directory', detail: 'D:\\missing' }]);
  });

  test('keeps only known video records with valid ids inside the loaded save root', async () => {
    const rejections = [];
    const videos = [
      { id: 'not-hex', path: 'D:\\loaded\\bad-id.mp4' },
      { id: '0123456789abcdef', path: 'D:\\loaded\\unknown.mp4' },
      { id: 'fedcba9876543210', path: 'D:\\other\\outside.mp4' },
      { id: '0011223344556677', path: 'D:\\loaded\\ok.mp4' },
    ];

    const result = await filterValidCacheSaveVideos({
      dirPath: 'D:\\loaded',
      loadedDirectories: new Set(['D:\\loaded']),
      videos,
      isKnownVideoRecord: (video) => video.path !== 'D:\\loaded\\unknown.mp4',
      isPathWithinDir: async (candidate, baseDir) => candidate.startsWith(`${baseDir}\\`),
      onReject: (reason, detail) => rejections.push({ reason, detail }),
    });

    assert.deepEqual(result, [{ id: '0011223344556677', path: 'D:\\loaded\\ok.mp4' }]);
    assert.deepEqual(rejections, [
      { reason: 'invalid-id', detail: 'not-hex' },
      { reason: 'unknown-record', detail: 'D:\\loaded\\unknown.mp4' },
      { reason: 'outside-root', detail: 'D:\\other\\outside.mp4' },
    ]);
  });
});

describe('display formatting', () => {
  test('escapes HTML before inserting user-visible report content', () => {
    assert.equal(escapeHtml('<video title="x">&</video>'), '&lt;video title=&quot;x&quot;&gt;&amp;&lt;/video&gt;');
  });

  test('formats byte counts and durations for review output', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1536), '2 KB');
    assert.equal(formatDuration(null), '--:--');
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(3661), '1:01:01');
  });

  test('keeps only servable video paths and valid report roots', () => {
    assert.equal(isServableVideoPath('D:\\clip.MP4'), true);
    assert.equal(isServableVideoPath('D:\\clip.txt'), false);
    assert.deepEqual(
      normalizeReportRoots(['D:\\media', '', null, 'D:\\clips']),
      ['D:\\media', 'D:\\clips'].map((value) => require('path').resolve(value))
    );
  });
});

describe('ffprobe error summaries', () => {
  test('explains missing-file errors without the extended Windows path prefix', () => {
    assert.equal(
      summarizeMediaProbeError(new Error('ffprobe failed\n\\\\?\\D:\\missing.mp4: No such file or directory')),
      'File not available to ffprobe: D:\\missing.mp4: No such file or directory'
    );
  });

  test('labels permission failures clearly', () => {
    assert.equal(
      summarizeMediaProbeError(new Error('Permission denied')),
      'Permission denied: Permission denied'
    );
  });

  test('labels invalid-media failures clearly', () => {
    assert.equal(
      summarizeMediaProbeError(new Error('Invalid data found when processing input')),
      'Invalid media data: Invalid data found when processing input'
    );
  });
});
