const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.m4v', '.ts', '.mts', '.mpg', '.mpeg',
  '.asf', '.m2ts', '.divx', '.ogv', '.3gp', '.3g2', '.mxf', '.dv',
]);
const SCAN_PROGRESS_BATCH_SIZE = 25;
const SCAN_FILE_STAT_BATCH_SIZE = 8;

function isVideoFile(filename) {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function makeVideoId(filePath, sizeBytes) {
  return crypto.createHash('md5').update(`${filePath}:${sizeBytes}`).digest('hex').slice(0, 16);
}

function makeDuplicateHash(sizeBytes, durationSecs) {
  // Coarse duplicate detection: same file size implies likely duplicate
  return crypto.createHash('md5').update(`${sizeBytes}`).digest('hex').slice(0, 12);
}

function createProgressReporter(onProgress) {
  let lastReportedFound = 0;
  let pendingProgress = null;

  return {
    report(found, currentFile) {
      if (!onProgress) return;
      pendingProgress = { found, currentFile };
      if (found === 1 || found - lastReportedFound >= SCAN_PROGRESS_BATCH_SIZE) {
        onProgress(pendingProgress);
        lastReportedFound = found;
        pendingProgress = null;
      }
    },
    flush() {
      if (!onProgress || !pendingProgress) return;
      if (pendingProgress.found === lastReportedFound) return;
      onProgress(pendingProgress);
      lastReportedFound = pendingProgress.found;
      pendingProgress = null;
    },
  };
}

async function statVideoEntries(entries, statPath = fs.stat) {
  const results = new Array(entries.length).fill(null);

  for (let start = 0; start < entries.length; start += SCAN_FILE_STAT_BATCH_SIZE) {
    const batch = entries.slice(start, start + SCAN_FILE_STAT_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async ({ entryName, fullPath }) => {
      try {
        const stat = await statPath(fullPath);
        return {
          id: makeVideoId(fullPath, stat.size),
          filename: entryName,
          path: fullPath,
          sizeBytes: stat.size,
          date: stat.mtimeMs,
          durationSecs: null,
          duplicateHash: makeDuplicateHash(stat.size, null),
          status: 'pending',
          thumbnails: [],
          rating: 0,
          favorite: false,
          compatible: true,
          videoCodec: null,
          audioCodec: null,
          containerFormat: null,
          width: null,
          height: null,
          fps: null,
        };
      } catch {
        return null;
      }
    }));

    for (let i = 0; i < batchResults.length; i += 1) {
      results[start + i] = batchResults[i];
    }
  }

  return results;
}

/**
 * Recursively walk a directory and collect video file info.
 * @param {string} dirPath - Root directory to scan.
 * @param {boolean} includeSubfolders - Whether to recurse into subdirectories.
 * @param {function} onProgress - Callback with { found, current, currentFile }.
 * @returns {Promise<Array>|Promise<{ videos: Array, visitedDirs: Array<string> }>} - Scan results.
 */
async function scanDirectory(dirPath, includeSubfolders, onProgress, options = {}) {
  const videos = [];
  const visitedDirs = options.includeVisitedDirs ? [] : null;
  const assertNotCancelled = typeof options.assertNotCancelled === 'function'
    ? options.assertNotCancelled
    : () => {};
  let found = 0;
  const progressReporter = createProgressReporter(onProgress);

  async function walk(currentDir) {
    assertNotCancelled();
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip inaccessible directories
    }
    assertNotCancelled();
    visitedDirs?.push(currentDir);

    let pendingVideoEntries = [];
    const flushPendingVideoEntries = async () => {
      assertNotCancelled();
      if (pendingVideoEntries.length === 0) return;
      const batch = pendingVideoEntries;
      pendingVideoEntries = [];
      const scannedVideos = await statVideoEntries(batch);
      assertNotCancelled();
      for (let i = 0; i < scannedVideos.length; i += 1) {
        const video = scannedVideos[i];
        if (!video) continue;
        found += 1;
        videos.push(video);
        progressReporter.report(found, batch[i].entryName);
      }
    };

    for (const entry of entries) {
      assertNotCancelled();
      const fullPath = path.join(currentDir, entry.name);

      // Skip our own cache/thumb directories
      if (entry.isDirectory() && (entry.name === '.video-cull-thumbs' || entry.name === '.videocull' || entry.name === '.video-cull-cache.json')) {
        continue;
      }

      if (entry.isDirectory() && includeSubfolders) {
        await flushPendingVideoEntries();
        assertNotCancelled();
        await walk(fullPath);
      } else if (entry.isFile() && isVideoFile(entry.name)) {
        pendingVideoEntries.push({ entryName: entry.name, fullPath });
        if (pendingVideoEntries.length >= SCAN_FILE_STAT_BATCH_SIZE) {
          await flushPendingVideoEntries();
        }
      }
    }

    await flushPendingVideoEntries();
  }

  assertNotCancelled();
  await walk(dirPath);
  assertNotCancelled();
  progressReporter.flush();
  return visitedDirs ? { videos, visitedDirs } : videos;
}

module.exports = {
  scanDirectory,
  __test__: {
    createProgressReporter,
    statVideoEntries,
    SCAN_FILE_STAT_BATCH_SIZE,
  },
};
