const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
let cache = null;
let cacheLoadError = null;

try {
  cache = require('./cache');
} catch (err) {
  cacheLoadError = err;
}

function insertVideo(db, id, filePath) {
  db.prepare(`
    INSERT INTO videos (id, filename, path, size_bytes, file_date, status, bookmarks, rating, favorite)
    VALUES (?, ?, ?, 0, 0, 'pending', '[]', 0, 0)
  `).run(id, path.basename(filePath), filePath);
}

function insertFingerprint(db, videoId, sampleIndex) {
  db.prepare(`
    INSERT INTO video_fingerprints
      (video_id, sample_index, timestamp_secs, phash_hex, flipped_phash_hex, gray_bytes, frame_dark_ratio, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
  `).run(
    videoId,
    sampleIndex,
    sampleIndex * 10,
    `${videoId}${sampleIndex}`.padEnd(16, '0').slice(0, 16),
    null,
    Buffer.from([sampleIndex]),
    0.1
  );
}

function buildCachedVideo(id, filePath, overrides = {}) {
  return {
    id,
    filename: path.basename(filePath),
    path: filePath,
    sizeBytes: overrides.sizeBytes ?? 0,
    date: overrides.date ?? 0,
    metadataDate: overrides.metadataDate ?? null,
    metadataCheckedAt: overrides.metadataCheckedAt ?? null,
    metadataVersion: overrides.metadataVersion ?? null,
    metadataFailedAt: overrides.metadataFailedAt ?? null,
    metadataFailureReason: overrides.metadataFailureReason ?? null,
    durationSecs: overrides.durationSecs ?? null,
    fps: overrides.fps ?? null,
    status: overrides.status ?? 'pending',
    rating: overrides.rating ?? 0,
    favorite: overrides.favorite ?? false,
    compatible: overrides.compatible ?? true,
    videoCodec: overrides.videoCodec ?? null,
    audioCodec: overrides.audioCodec ?? null,
    videoBitrate: overrides.videoBitrate ?? null,
    audioBitrate: overrides.audioBitrate ?? null,
    totalBitrate: overrides.totalBitrate ?? null,
    containerFormat: overrides.containerFormat ?? null,
    width: overrides.width ?? null,
    height: overrides.height ?? null,
    bookmarks: overrides.bookmarks ?? [],
    osThumbnail: overrides.osThumbnail ?? null,
    duplicateHash: overrides.duplicateHash ?? null,
    thumbnails: overrides.thumbnails ?? [],
  };
}

test('loadPHashRows and loadGraySampleRows batch rows and keep only complete samples', async (t) => {
  if (cacheLoadError) {
    t.skip(`better-sqlite3 is unavailable in plain node test mode: ${cacheLoadError.message}`);
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-'));
  const folderPath = path.join(tempRoot, 'library');
  await fs.mkdir(folderPath, { recursive: true });

  let db;
  try {
    db = cache.openDb(folderPath, { mode: 'centralised', centralCachePath: tempRoot });
  } catch (err) {
    if (err?.code === 'ERR_DLOPEN_FAILED') {
      t.skip(`better-sqlite3 is unavailable in plain node test mode: ${err.message}`);
      await fs.rm(tempRoot, { recursive: true, force: true });
      return;
    }
    throw err;
  }

  try {
    insertVideo(db, 'a', path.join(folderPath, 'a.mp4'));
    insertVideo(db, 'b', path.join(folderPath, 'b.mp4'));
    insertVideo(db, 'c', path.join(folderPath, 'c.mp4'));

    for (let i = 0; i < 3; i++) insertFingerprint(db, 'a', i);
    for (let i = 0; i < 2; i++) insertFingerprint(db, 'b', i);
    for (let i = 0; i < 4; i++) insertFingerprint(db, 'c', i);

    const pHashRows = cache.loadPHashRows(db, ['a', 'b', 'c'], 3);
    const grayRows = cache.loadGraySampleRows(db, ['a', 'b', 'c'], 3);

    assert.deepEqual(
      pHashRows.map((row) => `${row.video_id}:${row.sample_index}`),
      ['a:0', 'a:1', 'a:2', 'c:0', 'c:1', 'c:2']
    );
    assert.deepEqual(
      grayRows.map((row) => `${row.video_id}:${row.sample_index}`),
      ['a:0', 'a:1', 'a:2', 'c:0', 'c:1', 'c:2']
    );
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('saveCache replaces stale rows when the same path gets a new id', async () => {
  if (cacheLoadError) {
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-'));
  const folderPath = path.join(tempRoot, 'library');
  await fs.mkdir(folderPath, { recursive: true });

  let db;
  try {
    db = cache.openDb(folderPath, { mode: 'centralised', centralCachePath: tempRoot });
  } catch (err) {
    if (err?.code === 'ERR_DLOPEN_FAILED') {
      await fs.rm(tempRoot, { recursive: true, force: true });
      return;
    }
    throw err;
  }

  try {
    const filePath = path.join(folderPath, 'clip.mp4');
    cache.saveCache(db, [buildCachedVideo('old-id', filePath)]);
    insertFingerprint(db, 'old-id', 0);

    cache.saveCache(db, [buildCachedVideo('new-id', filePath, {
      sizeBytes: 42,
      thumbnails: ['thumbs/new-id/thumb_1.jpg'],
    })]);

    const rows = db.prepare('SELECT id, path, size_bytes FROM videos').all();
    const fingerprints = db.prepare('SELECT video_id FROM video_fingerprints').all();
    const thumbnails = db.prepare('SELECT video_id FROM thumbnails').all();

    assert.deepEqual(rows, [{ id: 'new-id', path: filePath, size_bytes: 42 }]);
    assert.deepEqual(fingerprints, []);
    assert.deepEqual(thumbnails, [{ video_id: 'new-id' }]);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('saveCacheChunked replaces stale rows when the same path gets a new id', async () => {
  if (cacheLoadError) {
    return;
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-'));
  const folderPath = path.join(tempRoot, 'library');
  await fs.mkdir(folderPath, { recursive: true });

  let db;
  try {
    db = cache.openDb(folderPath, { mode: 'centralised', centralCachePath: tempRoot });
  } catch (err) {
    if (err?.code === 'ERR_DLOPEN_FAILED') {
      await fs.rm(tempRoot, { recursive: true, force: true });
      return;
    }
    throw err;
  }

  try {
    const filePath = path.join(folderPath, 'clip.mp4');
    cache.saveCache(db, [buildCachedVideo('old-id', filePath)]);
    insertFingerprint(db, 'old-id', 0);

    await cache.saveCacheChunked(db, [buildCachedVideo('new-id', filePath, {
      sizeBytes: 84,
      thumbnails: ['thumbs/new-id/thumb_1.jpg'],
    })]);

    const rows = db.prepare('SELECT id, path, size_bytes FROM videos').all();
    const fingerprints = db.prepare('SELECT video_id FROM video_fingerprints').all();
    const thumbnails = db.prepare('SELECT video_id FROM thumbnails').all();

    assert.deepEqual(rows, [{ id: 'new-id', path: filePath, size_bytes: 84 }]);
    assert.deepEqual(fingerprints, []);
    assert.deepEqual(thumbnails, [{ video_id: 'new-id' }]);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
