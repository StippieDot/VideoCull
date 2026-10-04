// @ts-check
// Single place that resolves the bundled FFmpeg/FFprobe binaries. The runtime folder (executables
// plus FFmpeg's DLLs) is fetched by scripts/fetch-ffmpeg.js into vendor/ffmpeg and packaged as
// resources/ffmpeg, outside app.asar, because child processes cannot run from inside the archive.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

/**
 * @param {{ override?: string, appDir: string, resourcesPath?: string }} location
 * @returns {string} folder that holds ffmpeg.exe, ffprobe.exe and their DLLs
 */
function resolveMediaToolsDir({ override, appDir, resourcesPath }) {
  if (override) return override;
  // Packaged builds load this file from inside app.asar.
  if (resourcesPath && appDir.includes(`${path.sep}app.asar`)) return path.join(resourcesPath, 'ffmpeg');
  return path.join(appDir, '..', 'vendor', 'ffmpeg');
}

const mediaToolsDir = resolveMediaToolsDir({
  // Tests only: lets a test run against another runtime folder.
  override: process.env.VIDEOCULL_FFMPEG_DIR,
  appDir: __dirname,
  resourcesPath: process.resourcesPath,
});
const ffmpegPath = path.join(mediaToolsDir, 'ffmpeg.exe');
const ffprobePath = path.join(mediaToolsDir, 'ffprobe.exe');

/**
 * Logs which FFmpeg build is in use, or why none is usable. Called once at startup so a broken
 * installation shows up in the log instead of as silently missing thumbnails.
 * @param {{ info: (...args: unknown[]) => void, error: (...args: unknown[]) => void }} log
 * @returns {Promise<boolean>} whether both binaries are present and start
 */
async function checkMediaTools(log) {
  const missing = [ffmpegPath, ffprobePath].filter((file) => !fs.existsSync(file));
  if (missing.length) {
    log.error('[media-tools] Missing bundled binaries:', missing.join(', '));
    return false;
  }
  try {
    const { stdout } = await promisify(execFile)(ffmpegPath, ['-hide_banner', '-version'], { windowsHide: true, timeout: 10_000 });
    const version = stdout.split(/\r?\n/, 1)[0];
    log.info('[media-tools]', version, 'from', mediaToolsDir);
    return true;
  } catch (error) {
    log.error('[media-tools] Bundled FFmpeg does not start:', error);
    return false;
  }
}

module.exports = { ffmpegPath, ffprobePath, mediaToolsDir, checkMediaTools, resolveMediaToolsDir };
