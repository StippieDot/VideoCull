const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = globalThis.test || nodeTest;
const cache = require('../../electron/cache');
const log = require('../../electron/logger');

log.transports.console.level = false;
log.transports.file.level = false;

async function openTempCacheDb() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-migration-'));
  const folderPath = path.join(tempRoot, 'library');
  await fs.mkdir(folderPath, { recursive: true });

  let db;
  try {
    db = cache.openDb(folderPath, { mode: 'centralised', centralCachePath: tempRoot });
  } catch (err) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw err;
  }

  return { tempRoot, folderPath, db };
}

test('migrateJsonIfNeeded imports legacy JSON review decisions and deletes the old cache file', async () => {
  const setup = await openTempCacheDb();
  const { tempRoot, folderPath, db } = setup;
  const jsonPath = path.join(folderPath, '.video-cull-cache.json');
  const filePath = path.join(folderPath, 'clip.mp4');

  try {
    await fs.writeFile(jsonPath, JSON.stringify({
      videos: [
        {
          id: 'legacy-video',
          filename: 'clip.mp4',
          path: filePath,
          status: 'keep',
          bookmarks: [12.5, 48],
          durationSecs: 999,
          thumbnails: ['thumbs/legacy-video/thumb_1.jpg'],
        },
      ],
    }), 'utf8');

    await cache.migrateJsonIfNeeded(folderPath, db);

    const videos = cache.loadCacheVideos(db);
    assert.equal(videos.length, 1);
    assert.deepEqual(videos[0], {
      id: 'legacy-video',
      filename: 'clip.mp4',
      path: filePath,
      sizeBytes: 0,
      date: null,
      status: 'keep',
      durationSecs: null,
      fps: null,
      metadataDate: null,
      metadataCheckedAt: null,
      metadataVersion: null,
      metadataFailedAt: null,
      metadataFailureReason: null,
      thumbnails: [],
      bookmarks: [12.5, 48],
      duplicateHash: null,
      rating: 0,
      favorite: false,
      compatible: true,
      videoCodec: null,
      audioCodec: null,
      videoBitrate: null,
      audioBitrate: null,
      totalBitrate: null,
      containerFormat: null,
      width: null,
      height: null,
      osThumbnail: null,
      fileSignatureQuick: null,
      fileSignatureFull: null,
      signatureUpdatedAt: null,
    });
    await assert.rejects(fs.access(jsonPath));
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('migrateJsonIfNeeded deletes corrupt legacy JSON caches without importing garbage', async () => {
  const setup = await openTempCacheDb();
  const { tempRoot, folderPath, db } = setup;
  const jsonPath = path.join(folderPath, '.video-cull-cache.json');

  try {
    await fs.writeFile(jsonPath, '{not-json', 'utf8');

    await cache.migrateJsonIfNeeded(folderPath, db);

    assert.deepEqual(cache.loadCacheVideos(db), []);
    await assert.rejects(fs.access(jsonPath));
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
