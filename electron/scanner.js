const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createFileIdentity } = require('./main-helpers');

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

/** Windows paths compare without regard to case. Kept in step with `folderKey` in src/sessions.ts. */
function realPathKey(realPath) {
  return path.resolve(realPath).toLowerCase();
}

async function statVideoEntries(entries, statPath = fs.stat) {
  const results = new Array(entries.length).fill(null);

  for (let start = 0; start < entries.length; start += SCAN_FILE_STAT_BATCH_SIZE) {
    const batch = entries.slice(start, start + SCAN_FILE_STAT_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async ({ entryName, fullPath, realPath = fullPath }) => {
      try {
        const stat = await statPath(fullPath);
        return {
          id: makeVideoId(fullPath, stat.size),
          filename: entryName,
          path: fullPath,
          // The file itself when `path` goes through a link or junction; delete acts on this.
          realPath,
          sizeBytes: stat.size,
          date: stat.mtimeMs,
          fileIdentity: createFileIdentity(stat),
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
 * @param {{ followLinks?: boolean }} [options] - `followLinks` (default off) walks symbolic links and
 *   junctions, including ones whose target is outside `dirPath`.
 * @returns {Promise<Array>|Promise<{ videos: Array, visitedDirs: Array<string>, incompleteDirs: Array<string>, linkTargets: Array<string> }>} - Scan results.
 */
async function scanDirectory(dirPath, includeSubfolders, onProgress, options = {}) {
  const videos = [];
  const visitedDirs = options.includeVisitedDirs ? [] : null;
  const readDir = typeof options.readdir === 'function' ? options.readdir : fs.readdir;
  const statPath = typeof options.statPath === 'function' ? options.statPath : fs.stat;
  const followLinks = options.followLinks === true;
  // Every folder and video is listed once, by its real path: this stops link loops, and a video
  // reached twice would otherwise be paired with itself as a duplicate and deleted as the "copy".
  const walkedRealDirs = new Set();
  const seenRealFiles = new Set();
  // Real paths of the link targets this scan followed; only these are trusted outside `dirPath`.
  const linkTargets = new Set();
  const summary = {
    skippedDirectoryCount: 0,
    skippedDirectorySamples: [],
    skippedFileCount: 0,
    skippedFileSamples: [],
  };
  // Folders where a file could not be read: their cache rows must not be pruned as missing.
  const incompleteDirs = new Set();
  const assertNotCancelled = typeof options.assertNotCancelled === 'function'
    ? options.assertNotCancelled
    : () => {};
  let found = 0;
  const progressReporter = createProgressReporter(onProgress);

  const skipFile = (filePath, reason) => {
    summary.skippedFileCount += 1;
    if (summary.skippedFileSamples.length < 5) summary.skippedFileSamples.push(reason ? { path: filePath, reason } : { path: filePath });
  };

  async function walk(currentDir, realDir) {
    assertNotCancelled();
    const realDirKey = realPathKey(realDir);
    if (walkedRealDirs.has(realDirKey)) return;
    walkedRealDirs.add(realDirKey);
    let entries;
    try {
      entries = await readDir(currentDir, { withFileTypes: true });
    } catch (err) {
      summary.skippedDirectoryCount += 1;
      if (summary.skippedDirectorySamples.length < 5) {
        summary.skippedDirectorySamples.push({
          path: currentDir,
          reason: err?.code || err?.message || 'unknown',
        });
      }
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
      const scannedVideos = await statVideoEntries(batch, options.statPath);
      assertNotCancelled();
      for (let i = 0; i < scannedVideos.length; i += 1) {
        const video = scannedVideos[i];
        if (!video) {
          incompleteDirs.add(currentDir);
          skipFile(batch[i].fullPath);
          continue;
        }
        found += 1;
        videos.push(video);
        progressReporter.report(found, batch[i].entryName);
      }
    };

    for (const entry of entries) {
      assertNotCancelled();
      const fullPath = path.join(currentDir, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      let realPath = path.join(realDir, entry.name);

      // Skip our own cache/thumb directories
      if (isDirectory && (entry.name === '.video-cull-thumbs' || entry.name === '.videocull' || entry.name === '.video-cull-cache.json')) {
        continue;
      }

      // Junctions and symbolic links are only `isSymbolicLink()`; the target decides folder or file.
      // Every link is checked, so one that points at nothing is reported even when it would not be scanned.
      if (entry.isSymbolicLink?.()) {
        if (!followLinks) continue;
        try {
          const stat = await statPath(fullPath);
          realPath = await fs.realpath(fullPath);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          incompleteDirs.add(currentDir);
          skipFile(fullPath, 'broken-link');
          continue;
        }
        if ((isDirectory && includeSubfolders) || (isFile && isVideoFile(entry.name))) linkTargets.add(realPath);
      }

      if (isDirectory && includeSubfolders) {
        await flushPendingVideoEntries();
        assertNotCancelled();
        await walk(fullPath, realPath);
      } else if (isFile && isVideoFile(entry.name)) {
        const realFileKey = realPathKey(realPath);
        if (seenRealFiles.has(realFileKey)) continue;
        seenRealFiles.add(realFileKey);
        pendingVideoEntries.push({ entryName: entry.name, fullPath, realPath });
        if (pendingVideoEntries.length >= SCAN_FILE_STAT_BATCH_SIZE) {
          await flushPendingVideoEntries();
        }
      }
    }

    await flushPendingVideoEntries();
  }

  assertNotCancelled();
  const realRoot = await fs.realpath(dirPath).catch(() => path.resolve(dirPath));
  await walk(dirPath, realRoot);
  assertNotCancelled();
  progressReporter.flush();
  return visitedDirs
    ? { videos, visitedDirs, incompleteDirs: Array.from(incompleteDirs), summary, linkTargets: Array.from(linkTargets) }
    : videos;
}

module.exports = {
  scanDirectory,
  realPathKey,
  __test__: {
    createProgressReporter,
    statVideoEntries,
    SCAN_FILE_STAT_BATCH_SIZE,
  },
};
