const path = require('path');

const SERVABLE_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.ogg', '.ogv', '.mov', '.mkv', '.m4v',
]);

const COMPAT_UNSUPPORTED_EXTS = new Set([
  '.wmv', '.asf', '.avi', '.flv', '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.vob', '.divx',
  '.3gp', '.3g2', '.mxf', '.dv',
]);
const COMPAT_UNSUPPORTED_CODECS = new Set([
  'wmv1', 'wmv2', 'wmv3', 'vc1', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'mpeg2video',
  'prores', 'h263', 'dvvideo', 'theora',
]);
const COMPAT_SUPPORTED_CODECS = new Set([
  'h264', 'avc', 'avc1', 'hevc', 'h265', 'hvc1', 'av1', 'av01', 'vp8', 'vp9', 'mpeg4', 'mp4v',
]);
const COMPAT_SUPPORTED_FORMATS = ['mp4', 'mov', 'matroska', 'webm', 'ogg', '3gp', '3g2', 'm4a', 'mj2'];
const COMPAT_WEB_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.mkv', '.m4v'];
const VALID_VIDEO_ID = /^[0-9a-f]{16}$/;

function hasAnyCompatFormat(containerFormat, tokens) {
  const parts = (containerFormat || '').toLowerCase().split(',').map((part) => part.trim());
  return tokens.some((token) => parts.includes(token));
}

function detectCompatibility(containerFormat, videoCodec, filePath) {
  const extMatch = (filePath || '').match(/\.[^.\\/]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const codec = (videoCodec || '').toLowerCase();

  if (COMPAT_UNSUPPORTED_EXTS.has(ext) || COMPAT_UNSUPPORTED_CODECS.has(codec)) return false;
  if (codec) {
    if (!COMPAT_SUPPORTED_CODECS.has(codec)) return false;
    if (hasAnyCompatFormat(containerFormat, COMPAT_SUPPORTED_FORMATS)) return true;
    if (hasAnyCompatFormat(containerFormat, ['asf', 'avi', 'flv', 'mpegts', 'mpeg', 'vob'])) return false;
    return COMPAT_WEB_EXTS.includes(ext);
  }
  if (hasAnyCompatFormat(containerFormat, COMPAT_SUPPORTED_FORMATS)) return true;
  if (COMPAT_WEB_EXTS.includes(ext) && !containerFormat) return true;
  if (hasAnyCompatFormat(containerFormat, ['asf', 'avi', 'flv', 'mpegts', 'mpeg', 'vob'])) return false;
  return false;
}

async function canServeThumbPath({
  filePath,
  activeCacheRoots,
  isPathWithinAnyDir,
}) {
  if (!filePath?.toLowerCase().endsWith('.jpg')) return false;
  if (!activeCacheRoots || activeCacheRoots.size === 0) return false;
  return isPathWithinAnyDir(filePath, activeCacheRoots);
}

function canServeVideoPath({
  filePath,
  knownVideoPaths,
  isServableVideoPath,
}) {
  return Boolean(filePath && knownVideoPaths?.has(filePath) && isServableVideoPath(filePath));
}

function getRangeDetails(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return { hasRange: false, start: 0, end: fileSize - 1, chunkSize: fileSize, valid: true };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return { hasRange: true, valid: false, error: 'Malformed Range header.' };
  }

  let start;
  let end;
  if (match[1] === '' && match[2] === '') {
    return { hasRange: true, valid: false, error: 'Range start and end are both empty.' };
  }

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { hasRange: true, valid: false, error: 'Invalid suffix byte range.' };
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? fileSize - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return { hasRange: true, valid: false, start, end, error: 'Requested range is outside the file.' };
  }

  end = Math.min(end, fileSize - 1);
  return { hasRange: true, start, end, chunkSize: end - start + 1, valid: true };
}

function getFilePathFromProtocolRequest(request, scheme) {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'local' && url.pathname.length > 1) {
      return decodeURIComponent(url.pathname.slice(1));
    }
  } catch {
    // Fall through to the legacy parser below.
  }

  return decodeURIComponent(request.url.slice(`${scheme}:///`.length));
}

function getDriveKeyForPath(targetPath) {
  return path.parse(path.resolve(targetPath)).root.replace(/[\\/]$/, '').toUpperCase();
}

function isSqliteCorruptionError(err) {
  return (
    err?.code === 'SQLITE_CORRUPT' ||
    err?.code === 'SQLITE_CORRUPT_INDEX' ||
    err?.code === 'SQLITE_NOTADB' ||
    /database disk image is malformed|file is not a database/i.test(String(err?.message || err))
  );
}

function cacheRelevantSettingsChanged(oldSettings = {}, newSettings = {}) {
  return (
    oldSettings.cacheLocation !== newSettings.cacheLocation ||
    (oldSettings.centralCachePath || null) !== (newSettings.centralCachePath || null) ||
    JSON.stringify(oldSettings.perDriveCachePaths || {}) !== JSON.stringify(newSettings.perDriveCachePaths || {})
  );
}

async function filterValidCacheSaveVideos({
  dirPath,
  loadedDirectories,
  videos,
  isKnownVideoRecord,
  isPathWithinDir,
  onReject = () => {},
}) {
  if (!dirPath || typeof dirPath !== 'string' || !loadedDirectories?.has(dirPath)) {
    onReject('unloaded-directory', dirPath);
    return [];
  }
  if (!Array.isArray(videos)) return [];

  const safeVideos = [];
  for (const video of videos) {
    if (!video || !VALID_VIDEO_ID.test(String(video.id || ''))) {
      onReject('invalid-id', video?.id);
      continue;
    }
    if (!isKnownVideoRecord(video)) {
      onReject('unknown-record', video.path);
      continue;
    }
    if (!await isPathWithinDir(video.path, dirPath)) {
      onReject('outside-root', video.path);
      continue;
    }
    safeVideos.push(video);
  }

  return safeVideos;
}

async function isKnownLoadedFilePath({
  filePath,
  knownVideoPaths,
  loadedDirectories,
  isPathWithinAnyDir,
}) {
  if (!filePath || !knownVideoPaths?.has(filePath)) return false;
  if (!loadedDirectories || loadedDirectories.size === 0) return false;
  return isPathWithinAnyDir(filePath, loadedDirectories);
}

async function filterLoadedDeletionPaths({
  filePaths,
  isValidLoadedPath,
  onReject = () => {},
}) {
  const validPaths = [];
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    if (await isValidLoadedPath(filePath)) {
      validPaths.push(filePath);
    } else {
      onReject(filePath);
    }
  }
  return validPaths;
}

async function canRevealInExplorerPath({
  filePath,
  knownVideoPaths,
  loadedDirectories,
  isPathWithinAnyDir,
  statPath,
}) {
  if (!filePath) return false;
  if (knownVideoPaths?.has(filePath)) return true;
  if (loadedDirectories?.size > 0 && await isPathWithinAnyDir(filePath, loadedDirectories)) return true;
  try {
    const stats = await statPath(filePath);
    return stats.isFile() || stats.isDirectory();
  } catch {
    return false;
  }
}

function isFolderInsideSync(childFolder, parentFolder) {
  const child = path.resolve(childFolder).toLowerCase();
  const parent = path.resolve(parentFolder).toLowerCase();
  return child !== parent && child.startsWith(parent + path.sep);
}

function isSameFolderSync(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function thumbAbsolute(relPath, cacheRootDir) {
  if (!relPath || path.isAbsolute(relPath)) return relPath;
  return path.join(cacheRootDir, relPath);
}

function thumbRelative(absPath, cacheRootDir) {
  if (!absPath || !path.isAbsolute(absPath)) return absPath;
  const rel = path.relative(cacheRootDir, absPath);
  return rel.startsWith('..') ? absPath : rel;
}

function videoForDb(video, cacheRootDir) {
  return { ...video, thumbnails: video.thumbnails?.map((thumb) => thumbRelative(thumb, cacheRootDir)) ?? [] };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function summarizeMediaProbeError(err) {
  const raw = err?.message || String(err);
  const stripExtendedWindowsPrefix = (value) => String(value)
    .replace(/\\\\\?\\UNC\\/g, '\\\\')
    .replace(/\\\\\?\\/g, '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const finalLine = stripExtendedWindowsPrefix(lines[lines.length - 1] || raw);
  if (/no such file or directory/i.test(finalLine)) return `File not available to ffprobe: ${finalLine}`;
  if (/permission denied/i.test(finalLine)) return `Permission denied: ${finalLine}`;
  if (/invalid data found/i.test(finalLine)) return `Invalid media data: ${finalLine}`;
  return finalLine.slice(0, 500);
}

function normalizeReportRoots(dirPaths) {
  return (Array.isArray(dirPaths) ? dirPaths : [dirPaths])
    .filter((dirPath) => typeof dirPath === 'string' && dirPath.length > 0)
    .map((dirPath) => path.resolve(dirPath));
}

function isServableVideoPath(filePath) {
  return SERVABLE_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

module.exports = {
  canServeThumbPath,
  canServeVideoPath,
  canRevealInExplorerPath,
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
  hasAnyCompatFormat,
  isFolderInsideSync,
  isSameFolderSync,
  isServableVideoPath,
  isSqliteCorruptionError,
  normalizeReportRoots,
  summarizeMediaProbeError,
  thumbAbsolute,
  thumbRelative,
  videoForDb,
};
