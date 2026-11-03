// @ts-check
// Single place that resolves the FFmpeg/FFprobe binaries. On Windows the runtime folder (executables
// plus FFmpeg's DLLs) is fetched by scripts/fetch-ffmpeg.js into vendor/ffmpeg and packaged as
// resources/ffmpeg, outside app.asar, because child processes cannot run from inside the archive.
// macOS and Linux use the FFmpeg the user installed, unless a bundled folder is present.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

// Apps started from Finder or a desktop launcher do not inherit the shell PATH, so the usual
// Homebrew and distribution folders are searched by name.
const SYSTEM_TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

/** @param {string} name @param {string} platform */
const executableName = (name, platform) => (platform === 'win32' ? `${name}.exe` : name);

/**
 * @param {{
 *   override?: string, appDir: string, resourcesPath?: string,
 *   platform?: string, pathEnv?: string, exists?: (file: string) => boolean,
 * }} location
 * @returns {string} folder that holds ffmpeg and ffprobe (on Windows also their DLLs)
 */
function resolveMediaToolsDir({ override, appDir, resourcesPath, platform = process.platform, pathEnv = process.env.PATH ?? '', exists = fs.existsSync }) {
  if (override) return override;
  // Packaged builds load this file from inside app.asar.
  const bundled = resourcesPath && appDir.includes(`${path.sep}app.asar`)
    ? path.join(resourcesPath, 'ffmpeg')
    : path.join(appDir, '..', 'vendor', 'ffmpeg');
  if (platform === 'win32') return bundled;
  // shortcut: macOS and Linux rely on a system FFmpeg; bundle one when its version causes reports.
  const candidates = [bundled, ...SYSTEM_TOOL_DIRS, ...pathEnv.split(path.delimiter)].filter(Boolean);
  return candidates.find((dir) => exists(path.join(dir, 'ffmpeg')) && exists(path.join(dir, 'ffprobe'))) ?? bundled;
}

const mediaToolsDir = resolveMediaToolsDir({
  // Tests only: lets a test run against another runtime folder.
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
