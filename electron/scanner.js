const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.m4v', '.ts', '.mts', '.mpg', '.mpeg',
  '.asf', '.m2ts', '.divx', '.ogv', '.3gp', '.3g2', '.mxf', '.dv',
]);
const SCAN_PROGRESS_BATCH_SIZE = 25;

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

/**
 * Recursively walk a directory and collect video file info.
 * @param {string} dirPath - Root directory to scan.
 * @param {boolean} includeSubfolders - Whether to recurse into subdirectories.
 * @param {function} onProgress - Callback with { found, current, currentFile }.
 * @returns {Promise<Array>} - Array of video objects.
 */
async function scanDirectory(dirPath, includeSubfolders, onProgress) {
  const videos = [];
  let found = 0;
  const progressReporter = createProgressReporter(onProgress);

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip inaccessible directories
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Skip our own cache/thumb directories
      if (entry.isDirectory() && (entry.name === '.video-cull-thumbs' || entry.name === '.videocull' || entry.name === '.video-cull-cache.json')) {
        continue;
      }

      if (entry.isDirectory() && includeSubfolders) {
        await walk(fullPath);
      } else if (entry.isFile() && isVideoFile(entry.name)) {
        try {
          const stat = await fs.stat(fullPath);
          found++;

          const video = {
            id: makeVideoId(fullPath, stat.size),
            filename: entry.name,
            path: fullPath,
            sizeBytes: stat.size,
            date: stat.mtimeMs,
            durationSecs: null, // Will be filled by processor
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

          videos.push(video);

          progressReporter.report(found, entry.name);
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  await walk(dirPath);
  progressReporter.flush();
  return videos;
}

module.exports = { scanDirectory };
