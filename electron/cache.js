const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const log = require('./logger');

// better-sqlite3 is a native module unpacked from asar — require it directly.
const Database = require('better-sqlite3');

const OLD_CACHE_FILE = '.video-cull-cache.json';

function thumbnailIndex(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/thumb[_-]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function compareThumbnailPaths(a, b) {
  const aIndex = thumbnailIndex(a);
  const bIndex = thumbnailIndex(b);
  if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
    return aIndex - bIndex;
  }
  return path.basename(a).localeCompare(path.basename(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function orderedThumbnails(thumbnails) {
  return Array.isArray(thumbnails) ? [...thumbnails].sort(compareThumbnailPaths) : [];
}

// ── Path helpers ──────────────────────────────────────────────────────────

/**
 * Convert an absolute folder path to a safe SQLite DB filename.
 * e.g. "C:\Users\Matthijs\Videos\Footage" → "C_Users_Matthijs_Videos_Footage.db"
 */
function sanitizePathForFilename(folderPath) {
  return folderPath
    .replace(/:/g, '')             // remove drive colon
    .replace(/[/\\]+/g, '_')       // separators → _
    .replace(/[^a-zA-Z0-9_.-]/g, '_') // anything else → _
    .replace(/_+/g, '_')           // collapse consecutive _
    .replace(/^_|_$/g, '');        // trim leading/trailing _
}

/**
 * Returns the absolute path to the SQLite DB file for a given folder.
 * All cache reads/writes must go through this function.
 * cacheRootDir — the parent cache directory (e.g. %APPDATA%\Video-Cull\cache).
 * In P3, this will gain a `mode` parameter for per-drive vs centralised.
 */
function getDriveKey(folderPath) {
  const parsed = path.parse(path.resolve(folderPath));
  return parsed.root.replace(/[\\/]$/, '').toUpperCase();
}

function getDefaultPerDriveRoot(folderPath, username) {
  const parsed = path.parse(path.resolve(folderPath));
  const driveRoot = parsed.root;
  if (process.platform !== 'win32') {
    return path.join(driveRoot || path.sep, '.videocull', 'cache');
  }

  const userRoot = path.join(driveRoot, 'Users', username || '');
  if (username && fsSync.existsSync(userRoot)) {
    return path.join(userRoot, '.videocull', 'cache');
  }
  return path.join(driveRoot, '.videocull', 'cache');
}

function normalizeCacheOptions(cacheOptions) {
  if (typeof cacheOptions === 'string') {
    return {
      mode: 'centralised',
      defaultCentralRoot: cacheOptions,
      centralCachePath: null,
      perDriveCachePaths: {},
      username: '',
    };
  }
  return {
    mode: cacheOptions?.mode || cacheOptions?.cacheLocation || 'centralised',
    defaultCentralRoot: cacheOptions?.defaultCentralRoot,
    centralCachePath: cacheOptions?.centralCachePath || null,
    perDriveCachePaths: cacheOptions?.perDriveCachePaths || {},
    username: cacheOptions?.username || '',
  };
}

function resolveCachePaths(folderPath, cacheOptions) {
  const options = normalizeCacheOptions(cacheOptions);
  const folderKey = sanitizePathForFilename(folderPath);
  const mode = options.mode;

  if (mode === 'distributed') {
    const cacheRootDir = path.join(folderPath, '.videocull');
    fsSync.mkdirSync(cacheRootDir, { recursive: true });
    return {
      mode,
      folderKey,
      cacheRootDir,
      dbPath: path.join(cacheRootDir, 'cache.db'),
      thumbRootDir: path.join(cacheRootDir, 'thumbs'),
    };
  }

  let cacheRootDir;
  if (mode === 'per-drive') {
    const driveKey = getDriveKey(folderPath);
    cacheRootDir = options.perDriveCachePaths[driveKey] || getDefaultPerDriveRoot(folderPath, options.username);
  } else {
    cacheRootDir = options.centralCachePath || options.defaultCentralRoot;
  }

  fsSync.mkdirSync(cacheRootDir, { recursive: true });
  return {
    mode,
    folderKey,
    cacheRootDir,
    dbPath: path.join(cacheRootDir, `${folderKey}.db`),
    thumbRootDir: path.join(cacheRootDir, 'thumbs', folderKey),
  };
}

function resolveCachePath(folderPath, cacheOptions) {
  return resolveCachePaths(folderPath, cacheOptions).dbPath;
}

// ── Schema ────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS videos (
    id                TEXT PRIMARY KEY,
    filename          TEXT NOT NULL,
    path              TEXT UNIQUE NOT NULL,
    size_bytes        INTEGER,
    file_date         INTEGER,
    metadata_date     INTEGER,
    duration_secs     REAL,
    fps               REAL,
    duplicate_hash    TEXT,
    status            TEXT DEFAULT 'pending',
    rating            INTEGER DEFAULT 0,
    favorite          INTEGER DEFAULT 0,
    compatible        INTEGER DEFAULT 1,
    video_codec       TEXT,
    audio_codec       TEXT,
    width             INTEGER,
    height            INTEGER,
    bookmarks         TEXT,
    os_thumbnail_path TEXT,
    updated_at        INTEGER
  );

  CREATE TABLE IF NOT EXISTS thumbnails (
    video_id  TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    idx       INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    PRIMARY KEY (video_id, idx)
  );

  CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
  CREATE INDEX IF NOT EXISTS idx_videos_duplicate_hash ON videos(duplicate_hash);
  CREATE INDEX IF NOT EXISTS idx_videos_metadata_date ON videos(metadata_date);
`;

// ── DB lifecycle ──────────────────────────────────────────────────────────

const _dbByPath = new Map();

/**
 * Open (or reuse) the SQLite database for a folder.
 * Creates the cache directory and schema if they don't exist.
 * cacheRootDir — computed by main.js from app.getPath('userData').
 * Returns the open Database instance.
 */
function openDb(folderPath, cacheOptions) {
  const dbPath = resolveCachePath(folderPath, cacheOptions);

  const existing = _dbByPath.get(dbPath);
  if (existing) return existing;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  _dbByPath.set(dbPath, db);
  log.info(`[cache] Opened DB for: ${folderPath}`);
  return db;
}

function closeDbPath(dbPath) {
  const db = _dbByPath.get(dbPath);
  if (!db) return;
  try { db.close(); } catch { /* ignore */ }
  _dbByPath.delete(dbPath);
}

/** Close all open DB connections. Call on app quit or before broad migrations. */
function closeDb() {
  for (const dbPath of Array.from(_dbByPath.keys())) {
    closeDbPath(dbPath);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────

/**
 * Load all cached videos from the DB as a Map<id, cachedVideo>.
 * Returns an empty Map if the DB has no rows yet.
 */
function loadCacheVideos(db) {
  const rows = db.prepare('SELECT * FROM videos').all();
  const thumbRows = db.prepare(
    'SELECT video_id, file_path FROM thumbnails ORDER BY video_id, idx'
  ).all();

  const thumbsByVideoId = new Map();
  for (const row of thumbRows) {
    const list = thumbsByVideoId.get(row.video_id) ?? [];
    list.push(row.file_path);
    thumbsByVideoId.set(row.video_id, list);
  }

  const map = new Map();
  let withThumbs = 0;
  let nonPending = 0;
  for (const row of rows) {
    const thumbs = orderedThumbnails(thumbsByVideoId.get(row.id));
    if (thumbs.length > 0) withThumbs++;
    if (row.status && row.status !== 'pending') nonPending++;
    map.set(row.id, {
      id: row.id,
      filename: row.filename,
      path: row.path,
      sizeBytes: row.size_bytes ?? 0,
      date: row.file_date ?? null,
      status: row.status || 'pending',
      durationSecs: row.duration_secs ?? null,
      fps: row.fps ?? null,
      metadataDate: row.metadata_date ?? null,
      thumbnails: thumbs,
      bookmarks: row.bookmarks ? JSON.parse(row.bookmarks) : [],
      duplicateHash: row.duplicate_hash ?? null,
      rating: row.rating ?? 0,
      favorite: Boolean(row.favorite),
      compatible: row.compatible !== 0,
      videoCodec: row.video_codec ?? null,
      audioCodec: row.audio_codec ?? null,
      width: row.width ?? null,
      height: row.height ?? null,
      osThumbnail: row.os_thumbnail_path ?? null,
    });
  }
  log.info(`[cache] loadCacheMap: ${rows.length} videos, ${withThumbs} with thumbs, ${nonPending} non-pending`);
  return Array.from(map.values());
}

function loadCacheMap(db) {
  const videos = loadCacheVideos(db);
  const map = new Map();
  for (const video of videos) {
    map.set(video.id, video);
  }
  return map;
}

// ── Write ─────────────────────────────────────────────────────────────────

/**
 * Upsert all videos in a single transaction.
 * Used for status changes and bookmark updates — no progress IPC needed.
 */
function saveCache(db, videos) {
  const upsertVideo = db.prepare(`
    INSERT INTO videos
      (id, filename, path, size_bytes, file_date, metadata_date,
       duration_secs, fps, status, rating, favorite, compatible,
       video_codec, audio_codec, width, height, bookmarks,
       os_thumbnail_path, duplicate_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filename    = excluded.filename,
      path        = excluded.path,
      size_bytes  = excluded.size_bytes,
      file_date   = excluded.file_date,
      metadata_date = COALESCE(excluded.metadata_date, metadata_date),
      duration_secs = COALESCE(excluded.duration_secs, duration_secs),
      fps = COALESCE(excluded.fps, fps),
      status      = excluded.status,
      rating = excluded.rating,
      favorite = excluded.favorite,
      compatible = excluded.compatible,
      video_codec = COALESCE(excluded.video_codec, video_codec),
      audio_codec = COALESCE(excluded.audio_codec, audio_codec),
      width = COALESCE(excluded.width, width),
      height = COALESCE(excluded.height, height),
      bookmarks   = excluded.bookmarks,
      os_thumbnail_path = COALESCE(excluded.os_thumbnail_path, os_thumbnail_path),
      duplicate_hash = excluded.duplicate_hash,
      updated_at  = excluded.updated_at
  `);
  const deleteThumbs = db.prepare('DELETE FROM thumbnails WHERE video_id = ?');
  const insertThumb = db.prepare(
    'INSERT INTO thumbnails (video_id, idx, file_path) VALUES (?, ?, ?)'
  );

  const upsertAll = db.transaction((vids) => {
    for (const v of vids) {
      upsertVideo.run(
        v.id, v.filename, v.path, v.sizeBytes,
        v.date ?? null, v.metadataDate ?? null,
        v.durationSecs ?? null, v.fps ?? null, v.status,
        v.rating ?? 0, v.favorite ? 1 : 0, v.compatible === false ? 0 : 1,
        v.videoCodec ?? null, v.audioCodec ?? null,
        v.width ?? null, v.height ?? null,
        v.bookmarks?.length ? JSON.stringify(v.bookmarks) : null,
        v.osThumbnail ?? null,
        v.duplicateHash ?? null,
        Date.now()
      );
      if (Array.isArray(v.thumbnails)) {
        deleteThumbs.run(v.id);
        const thumbs = orderedThumbnails(v.thumbnails);
        for (let i = 0; i < thumbs.length; i++) {
          insertThumb.run(v.id, i, thumbs[i]);
        }
      }
    }
  });

  upsertAll(videos);
}

/**
 * Chunked upsert with optional progress callback.
 * Use for bulk operations (initial scan, JSON migration) where IPC progress
 * messages need to flush between chunks.
 * Yields the event loop between chunks via setImmediate so IPC messages flush.
 */
async function saveCacheChunked(db, videos, onProgress) {
  const upsertVideo = db.prepare(`
    INSERT INTO videos
      (id, filename, path, size_bytes, file_date, metadata_date,
       duration_secs, fps, status, rating, favorite, compatible,
       video_codec, audio_codec, width, height, bookmarks,
       os_thumbnail_path, duplicate_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filename    = excluded.filename,
      path        = excluded.path,
      size_bytes  = excluded.size_bytes,
      file_date   = excluded.file_date,
      metadata_date = COALESCE(excluded.metadata_date, metadata_date),
      duration_secs = COALESCE(excluded.duration_secs, duration_secs),
      fps = COALESCE(excluded.fps, fps),
      status      = excluded.status,
      rating = excluded.rating,
      favorite = excluded.favorite,
      compatible = excluded.compatible,
      video_codec = COALESCE(excluded.video_codec, video_codec),
      audio_codec = COALESCE(excluded.audio_codec, audio_codec),
      width = COALESCE(excluded.width, width),
      height = COALESCE(excluded.height, height),
      bookmarks   = excluded.bookmarks,
      os_thumbnail_path = COALESCE(excluded.os_thumbnail_path, os_thumbnail_path),
      duplicate_hash = excluded.duplicate_hash,
      updated_at  = excluded.updated_at
  `);
  const deleteThumbs = db.prepare('DELETE FROM thumbnails WHERE video_id = ?');
  const insertThumb = db.prepare(
    'INSERT INTO thumbnails (video_id, idx, file_path) VALUES (?, ?, ?)'
  );

  const CHUNK_SIZE = 500;

  const insertChunk = db.transaction((chunk) => {
    for (const v of chunk) {
      upsertVideo.run(
        v.id, v.filename, v.path, v.sizeBytes,
        v.date ?? null, v.metadataDate ?? null,
        v.durationSecs ?? null, v.fps ?? null, v.status,
        v.rating ?? 0, v.favorite ? 1 : 0, v.compatible === false ? 0 : 1,
        v.videoCodec ?? null, v.audioCodec ?? null,
        v.width ?? null, v.height ?? null,
        v.bookmarks?.length ? JSON.stringify(v.bookmarks) : null,
        v.osThumbnail ?? null,
        v.duplicateHash ?? null,
        Date.now()
      );
      if (Array.isArray(v.thumbnails)) {
        deleteThumbs.run(v.id);
        const thumbs = orderedThumbnails(v.thumbnails);
        for (let i = 0; i < thumbs.length; i++) {
          insertThumb.run(v.id, i, thumbs[i]);
        }
      }
    }
  });

  for (let i = 0; i < videos.length; i += CHUNK_SIZE) {
    insertChunk(videos.slice(i, i + CHUNK_SIZE));
    if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, videos.length), videos.length);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function deleteVideosByIds(db, videoIds) {
  if (!videoIds.length) return;

  const deleteThumbs = db.prepare('DELETE FROM thumbnails WHERE video_id = ?');
  const deleteVideo = db.prepare('DELETE FROM videos WHERE id = ?');
  const deleteAll = db.transaction((ids) => {
    for (const id of ids) {
      deleteThumbs.run(id);
      deleteVideo.run(id);
    }
  });
  deleteAll(videoIds);
}

// ── JSON migration ────────────────────────────────────────────────────────

/**
 * If an old JSON cache file exists in folderPath, import status and bookmarks
 * into the open SQLite DB, then delete the JSON file.
 *
 * Only status and bookmarks are imported — durationSecs and thumbnails are
 * intentionally skipped so they are regenerated fresh from ffprobe.
 *
 * Safe to call on every scan — does nothing if no JSON cache exists.
 */
async function migrateJsonIfNeeded(folderPath, db) {
  const jsonPath = path.join(folderPath, OLD_CACHE_FILE);

  let raw;
  try {
    raw = await fs.readFile(jsonPath, 'utf-8');
  } catch {
    return; // no JSON cache — nothing to do
  }

  let cache;
  try {
    cache = JSON.parse(raw);
  } catch {
    log.warn('[cache] JSON cache corrupted, deleting:', jsonPath);
    await fs.unlink(jsonPath).catch(() => {});
    return;
  }

  if (!cache?.videos?.length) {
    await fs.unlink(jsonPath).catch(() => {});
    return;
  }

  // Insert skeleton rows first so the UPDATE below has rows to target.
  // The scan-directory handler will overwrite with fresh filesystem data anyway.
  const insertSkeleton = db.prepare(`
    INSERT OR IGNORE INTO videos (id, filename, path, status, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateImported = db.prepare(`
    UPDATE videos SET status = ?, bookmarks = ? WHERE id = ?
  `);

  const importAll = db.transaction((cachedVideos) => {
    for (const v of cachedVideos) {
      if (!v.id || !v.path) continue;
      insertSkeleton.run(
        v.id,
        v.filename || path.basename(v.path),
        v.path,
        v.status || 'pending',
        Date.now()
      );
      updateImported.run(
        v.status || 'pending',
        v.bookmarks?.length ? JSON.stringify(v.bookmarks) : null,
        v.id
      );
    }
  });

  importAll(cache.videos);
  log.info(`[cache] Migrated ${cache.videos.length} entries from JSON cache`);

  await fs.unlink(jsonPath).catch(() => {});
}

// ── Delete ────────────────────────────────────────────────────────────────

/**
 * Delete the SQLite DB file for a folder (used by clear-cache).
 * Closes the connection first if it's the active DB.
 */
function deleteDb(folderPath, cacheOptions) {
  log.warn(`[cache] deleteDb called for: ${folderPath}`);
  log.warn(`[cache] deleteDb stack:\n${new Error().stack}`);

  const dbPath = resolveCachePath(folderPath, cacheOptions);
  closeDbPath(dbPath);
  try {
    fsSync.unlinkSync(dbPath);
  } catch {
    // Already gone — fine
  }

  // Also remove WAL sidecar files if present
  for (const ext of ['-wal', '-shm']) {
    try { fsSync.unlinkSync(dbPath + ext); } catch { /* ignore */ }
  }
}

module.exports = {
  resolveCachePaths,
  resolveCachePath,
  openDb,
  closeDb,
  loadCacheVideos,
  loadCacheMap,
  saveCache,
  saveCacheChunked,
  deleteVideosByIds,
  migrateJsonIfNeeded,
  deleteDb,
};
