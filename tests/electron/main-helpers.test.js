const assert = require('node:assert/strict');

const {
  filterValidCacheSaveVideos,
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
  normalizeReportRoots,
  summarizeMediaProbeError,
  thumbAbsolute,
  thumbRelative,
  videoForDb,
} = require('../../electron/main-helpers');

describe('compatibility detection', () => {
  test('allows formats the renderer can play directly', () => {
    assert.equal(detectCompatibility('mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'D:\\clip.mp4'), true);
    assert.equal(detectCompatibility('', '', 'D:\\clip.webm'), true);
  });

  test('rejects unsupported containers and codecs before the app tries to play them', () => {
    assert.equal(detectCompatibility('asf', 'h264', 'D:\\clip.wmv'), false);
    assert.equal(detectCompatibility('matroska,webm', 'prores', 'D:\\clip.mkv'), false);
    assert.equal(detectCompatibility('avi', 'vp9', 'D:\\clip.avi'), false);
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
