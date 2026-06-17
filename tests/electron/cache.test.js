const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = globalThis.test || nodeTest;
let cache = null;
let cacheLoadError = null;

try {
  cache = require('../../electron/cache');
} catch (err) {
  cacheLoadError = err;
}

function skipIfCacheUnavailable(t, err = cacheLoadError) {
  if (!err) return false;
  t.skip(`better-sqlite3 is unavailable in plain node test mode: ${err.message}`);
  return true;
}

async function openTempCacheDb(t) {
  if (skipIfCacheUnavailable(t)) return null;

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-cache-'));
  const folderPath = path.join(tempRoot, 'library');
  await fs.mkdir(folderPath, { recursive: true });

  try {
    const db = cache.openDb(folderPath, { mode: 'centralised', centralCachePath: tempRoot });
    return { tempRoot, folderPath, db };
  } catch (err) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    if (skipIfCacheUnavailable(t, err?.code === 'ERR_DLOPEN_FAILED' ? err : null)) {
      return null;
    }
    throw err;
  }
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
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

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

test('fingerprint reads ignore rows created for different extraction settings', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    insertVideo(db, 'a', path.join(folderPath, 'a.mp4'));
    const fingerprint = {
      sampleIndex: 0,
      timestampSecs: 10,
      phashHex: 'ffff000000000000',
      flippedPHashHex: null,
      grayBytes: Buffer.from([1]),
      frameDarkRatio: 0.1,
    };

    cache.saveVideoFingerprints(db, 'a', [fingerprint], { fingerprintKey: 'samples:3:even' });

    assert.equal(cache.getFingerprintCounts(db, ['a'], 1, { fingerprintKey: 'samples:3:even' }).get('a'), true);
    assert.equal(cache.getFingerprintCounts(db, ['a'], 1, { fingerprintKey: 'samples:5:center' }).get('a'), undefined);
    assert.equal(cache.loadPHashRows(db, ['a'], 1, { fingerprintKey: 'samples:5:center' }).length, 0);
    assert.equal(cache.loadGraySampleRows(db, ['a'], 1, { fingerprintKey: 'samples:5:center' }).length, 0);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('fingerprint failures are scoped to the extraction settings key', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    insertVideo(db, 'a', path.join(folderPath, 'a.mp4'));

    cache.markFingerprintFailure(db, 'a', { fingerprintKey: 'samples:3:even' });

    assert.equal(cache.loadFingerprintFailureIds(db, ['a'], { fingerprintKey: 'samples:3:even' }).has('a'), true);
    assert.equal(cache.loadFingerprintFailureIds(db, ['a'], { fingerprintKey: 'samples:5:center' }).has('a'), false);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('saveCache replaces stale rows when the same path gets a new id', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

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

test('saveCacheChunked replaces stale rows when the same path gets a new id', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

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

test('saveCacheChunked round-trips cached video metadata, bookmarks, and thumbnails', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    const filePath = path.join(folderPath, 'trip.mp4');
    const cachedVideo = buildCachedVideo('trip-1', filePath, {
      sizeBytes: 987654,
      date: 1_710_000_000_000,
      metadataDate: 1_710_000_000_123,
      metadataCheckedAt: 1_710_000_000_456,
      metadataVersion: 3,
      durationSecs: 91.5,
      fps: 29.97,
      status: 'keep',
      rating: 4,
      favorite: true,
      compatible: false,
      videoCodec: 'h264',
      audioCodec: 'aac',
      videoBitrate: 2_500_000,
      audioBitrate: 192_000,
      totalBitrate: 2_692_000,
      containerFormat: 'mp4',
      width: 1920,
      height: 1080,
      bookmarks: [12.5, 45, 88.25],
      osThumbnail: 'D:\\Thumbs\\trip.jpg',
      duplicateHash: 'dup-trip-1',
      thumbnails: [
        'thumbs/trip-1/thumb_1.jpg',
        'thumbs/trip-1/thumb_2.jpg',
      ],
    });

    await cache.saveCacheChunked(db, [cachedVideo]);

    const loadedMap = cache.loadCacheMap(db);
    const reloaded = loadedMap.get('trip-1');

    assert.equal(loadedMap.size, 1);
    assert.ok(reloaded);
    assert.equal(reloaded.path, filePath);
    assert.equal(reloaded.status, 'keep');
    assert.equal(reloaded.rating, 4);
    assert.equal(reloaded.favorite, true);
    assert.equal(reloaded.compatible, false);
    assert.equal(reloaded.durationSecs, 91.5);
    assert.equal(reloaded.fps, 29.97);
    assert.equal(reloaded.videoCodec, 'h264');
    assert.equal(reloaded.audioCodec, 'aac');
    assert.equal(reloaded.videoBitrate, 2_500_000);
    assert.equal(reloaded.audioBitrate, 192_000);
    assert.equal(reloaded.totalBitrate, 2_692_000);
    assert.equal(reloaded.containerFormat, 'mp4');
    assert.equal(reloaded.width, 1920);
    assert.equal(reloaded.height, 1080);
    assert.equal(reloaded.metadataVersion, 3);
    assert.equal(reloaded.metadataDate, 1_710_000_000_123);
    assert.equal(reloaded.metadataCheckedAt, 1_710_000_000_456);
    assert.equal(reloaded.duplicateHash, 'dup-trip-1');
    assert.equal(reloaded.osThumbnail, 'D:\\Thumbs\\trip.jpg');
    assert.deepEqual(reloaded.bookmarks, [12.5, 45, 88.25]);
    assert.deepEqual(reloaded.thumbnails, [
      'thumbs/trip-1/thumb_1.jpg',
      'thumbs/trip-1/thumb_2.jpg',
    ]);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('loadCacheMap can selectively hydrate requested video ids', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    cache.saveCache(db, [
      buildCachedVideo('keep-a', path.join(folderPath, 'keep-a.mp4'), {
        status: 'keep',
        durationSecs: 11,
        thumbnails: [
          'thumbs/keep-a/thumb_2.jpg',
          'thumbs/keep-a/thumb_1.jpg',
        ],
      }),
      buildCachedVideo('skip-b', path.join(folderPath, 'skip-b.mp4'), {
        status: 'delete',
        durationSecs: 22,
        thumbnails: ['thumbs/skip-b/thumb_1.jpg'],
      }),
      buildCachedVideo('keep-c', path.join(folderPath, 'keep-c.mp4'), {
        status: 'pending',
        durationSecs: 33,
        thumbnails: ['thumbs/keep-c/thumb_1.jpg'],
      }),
    ]);

    const loadedMap = cache.loadCacheMap(db, ['keep-c', 'keep-a', 'missing']);

    assert.deepEqual(Array.from(loadedMap.keys()).sort(), ['keep-a', 'keep-c']);
    assert.equal(loadedMap.get('keep-a')?.status, 'keep');
    assert.equal(loadedMap.get('keep-c')?.durationSecs, 33);
    assert.deepEqual(loadedMap.get('keep-a')?.thumbnails, [
      'thumbs/keep-a/thumb_1.jpg',
      'thumbs/keep-a/thumb_2.jpg',
    ]);
    assert.equal(loadedMap.has('skip-b'), false);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('updateVideoMetadataBatch applies metadata updates transactionally for multiple videos', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    insertVideo(db, 'a', path.join(folderPath, 'a.mp4'));
    insertVideo(db, 'b', path.join(folderPath, 'b.mp4'));
    db.prepare('UPDATE videos SET metadata_failed_at = 123, metadata_failure_reason = ? WHERE id IN (?, ?)')
      .run('old failure', 'a', 'b');

    cache.updateVideoMetadataBatch(db, [
      {
        videoId: 'a',
        metadataDate: 1000,
        metadataCheckedAt: 2000,
        metadataVersion: 2,
        durationSecs: 12.5,
        fps: 29.97,
        videoCodec: 'h264',
        audioCodec: 'aac',
        videoBitrate: 2_000_000,
        audioBitrate: 128_000,
        totalBitrate: 2_128_000,
        containerFormat: 'mp4',
        width: 1920,
        height: 1080,
      },
      {
        videoId: 'b',
        metadataDate: 3000,
        metadataCheckedAt: 4000,
        metadataVersion: 2,
        durationSecs: 45,
        fps: 60,
        videoCodec: 'hevc',
        audioCodec: 'aac',
        videoBitrate: 5_000_000,
        audioBitrate: 192_000,
        totalBitrate: 5_192_000,
        containerFormat: 'mov',
        width: 3840,
        height: 2160,
      },
    ]);

    const rows = db.prepare(`
      SELECT id, metadata_date, metadata_checked_at, metadata_version, metadata_failed_at, metadata_failure_reason,
             duration_secs, fps, video_codec, audio_codec, video_bitrate, audio_bitrate, total_bitrate,
             container_format, width, height
      FROM videos
      ORDER BY id
    `).all();

    assert.equal(rows[0].metadata_failed_at, null);
    assert.equal(rows[0].metadata_failure_reason, null);
    assert.equal(rows[0].metadata_date, 1000);
    assert.equal(rows[0].metadata_checked_at, 2000);
    assert.equal(rows[0].metadata_version, 2);
    assert.equal(rows[0].video_codec, 'h264');
    assert.equal(rows[1].metadata_failed_at, null);
    assert.equal(rows[1].metadata_failure_reason, null);
    assert.equal(rows[1].metadata_date, 3000);
    assert.equal(rows[1].metadata_checked_at, 4000);
    assert.equal(rows[1].metadata_version, 2);
    assert.equal(rows[1].video_codec, 'hevc');
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('markMetadataFailuresBatch records failure state for multiple videos', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    insertVideo(db, 'a', path.join(folderPath, 'a.mp4'));
    insertVideo(db, 'b', path.join(folderPath, 'b.mp4'));

    cache.markMetadataFailuresBatch(db, [
      { videoId: 'a', reason: 'ffprobe failed' },
      { videoId: 'b', reason: 'stream missing' },
    ]);

    const rows = db.prepare('SELECT id, metadata_failed_at, metadata_failure_reason FROM videos ORDER BY id').all();
    assert.equal(typeof rows[0].metadata_failed_at, 'number');
    assert.equal(rows[0].metadata_failure_reason, 'ffprobe failed');
    assert.equal(typeof rows[1].metadata_failed_at, 'number');
    assert.equal(rows[1].metadata_failure_reason, 'stream missing');
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('pruneStaleVideosBefore removes videos not touched by the latest folder sync and cascades artifacts', async (t) => {
  const setup = await openTempCacheDb(t);
  if (!setup) return;
  const { tempRoot, folderPath, db } = setup;

  try {
    const stalePath = path.join(folderPath, 'stale.mp4');
    const keepPath = path.join(folderPath, 'keep.mp4');
    cache.saveCache(db, [
      buildCachedVideo('stale-id', stalePath, {
        thumbnails: ['thumbs/stale-id/thumb_1.jpg'],
      }),
      buildCachedVideo('keep-id', keepPath, {
        thumbnails: ['thumbs/keep-id/thumb_1.jpg'],
      }),
    ], { updatedAt: 10 });
    insertFingerprint(db, 'stale-id', 0);
    insertFingerprint(db, 'keep-id', 0);

    cache.saveCache(db, [
      buildCachedVideo('keep-id', keepPath, {
        status: 'keep',
        thumbnails: ['thumbs/keep-id/thumb_1.jpg'],
      }),
    ], { updatedAt: 20 });

    const removed = cache.pruneStaleVideosBefore(db, 20);
    const rows = db.prepare('SELECT id FROM videos ORDER BY id').all();
    const thumbnails = db.prepare('SELECT video_id FROM thumbnails ORDER BY video_id').all();
    const fingerprints = db.prepare('SELECT video_id FROM video_fingerprints ORDER BY video_id').all();

    assert.deepEqual(removed, ['stale-id']);
    assert.deepEqual(rows, [{ id: 'keep-id' }]);
    assert.deepEqual(thumbnails, [{ video_id: 'keep-id' }]);
    assert.deepEqual(fingerprints, [{ video_id: 'keep-id' }]);
  } finally {
    cache.closeDb();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
