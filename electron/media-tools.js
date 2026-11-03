// @ts-check
// Single place that resolves the FFmpeg/FFprobe binaries. The runtime folder (executables plus FFmpeg's
// shared libraries), built in StippieDot/VideoCull-FFmpeg for every platform, is fetched by
// scripts/fetch-ffmpeg.js into vendor/ffmpeg/<platform>-<arch> and packaged as resources/ffmpeg,
// outside app.asar, because child processes cannot run from inside the archive.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

/** @param {string} name @param {string} platform */
const executableName = (name, platform) => (platform === 'win32' ? `${name}.exe` : name);

/**
 * @param {{ override?: string, appDir: string, resourcesPath?: string, platform?: string, arch?: string }} location
 * @returns {string} folder that holds ffmpeg, ffprobe and their libraries
 */
function resolveMediaToolsDir({ override, appDir, resourcesPath, platform = process.platform, arch = process.arch }) {
  if (override) return override;
  // Packaged builds load this file from inside app.asar.
  return resourcesPath && appDir.includes(`${path.sep}app.asar`)
    ? path.join(resourcesPath, 'ffmpeg')
    : path.join(appDir, '..', 'vendor', 'ffmpeg', `${platform}-${arch}`);
}

const mediaToolsDir = resolveMediaToolsDir({
  // Lets tests, and packagers who ship their own FFmpeg (e.g. Flatpak), use another runtime folder.
  override: process.env.VIDEOCULL_FFMPEG_DIR,
  appDir: __dirname,
  resourcesPath: process.resourcesPath,
});
const ffmpegPath = path.join(mediaToolsDir, executableName('ffmpeg', process.platform));
const ffprobePath = path.join(mediaToolsDir, executableName('ffprobe', process.platform));

/**
 * Logs which FFmpeg build is in use, or why none is usable. Called once at startup so a broken
 * installation shows up in the log instead of as silently missing thumbnails.
 * @param {{ info: (...args: unknown[]) => void, error: (...args: unknown[]) => void }} log
 * @returns {Promise<boolean>} whether both binaries are present and start
 */
async function checkMediaTools(log) {
  const missing = [ffmpegPath, ffprobePath].filter((file) => !fs.existsSync(file));
  if (missing.length) {
    log.error('[media-tools] Missing FFmpeg binaries:', missing.join(', '));
    return false;
  }
  try {
    const { stdout } = await promisify(execFile)(ffmpegPath, ['-hide_banner', '-version'], { windowsHide: true, timeout: 10_000 });
    const version = stdout.split(/\r?\n/, 1)[0];
    log.info('[media-tools]', version, 'from', mediaToolsDir);
    return true;
  } catch (error) {
    log.error('[media-tools] FFmpeg does not start:', error);
    return false;
  }
}

module.exports = { ffmpegPath, ffprobePath, mediaToolsDir, checkMediaTools, resolveMediaToolsDir };
