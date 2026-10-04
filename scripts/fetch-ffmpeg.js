// @ts-check
// Installs the pinned FFmpeg runtime (ffmpeg-toolchain.json) into vendor/ffmpeg, where development
// runs and packaging pick it up. Runs on npm install; does nothing when the pinned build is already
// in place. The archive's SHA-256 must match before anything is extracted.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const MARKER = '.toolchain-sha256';

/**
 * @typedef {{ repository: string, tag: string, asset: string, sha256: string }} ToolchainPin
 */

/** @param {ToolchainPin} pin */
function downloadUrl(pin) {
  return `https://github.com/${pin.repository}/releases/download/${pin.tag}/${pin.asset}`;
}

/** @param {Buffer} data */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {ToolchainPin} pin
 * @param {string} vendorDir
 * @param {{
 *   download: (url: string) => Promise<Buffer>,
 *   extract: (zipPath: string, targetDir: string) => void,
 *   log?: (message: string) => void,
 * }} io
 * @returns {Promise<'current' | 'installed'>}
 */
async function installPinnedFfmpeg(pin, vendorDir, io) {
  const log = io.log ?? (() => {});
  const marker = path.join(vendorDir, MARKER);
  if (fs.existsSync(path.join(vendorDir, 'ffmpeg.exe')) && readIfExists(marker) === pin.sha256) return 'current';

  const url = downloadUrl(pin);
  log(`Downloading ${url}`);
  const data = await io.download(url);
  const actual = sha256(data);
  if (actual !== pin.sha256) {
    throw new Error(`FFmpeg archive hash mismatch for ${pin.asset}: expected ${pin.sha256}, got ${actual}`);
  }

  // Extract next to the target and swap, so an interrupted install never leaves a half folder.
  const staging = `${vendorDir}.staging`;
  const zipPath = `${vendorDir}.zip`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(zipPath, data);
  try {
    io.extract(zipPath, staging);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
  for (const required of ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt']) {
    if (!fs.existsSync(path.join(staging, required))) throw new Error(`FFmpeg archive lacks ${required}`);
  }
  fs.writeFileSync(path.join(staging, MARKER), pin.sha256);
  fs.rmSync(vendorDir, { recursive: true, force: true });
  fs.renameSync(staging, vendorDir);
  log(`Installed ${pin.tag} into ${path.relative(root, vendorDir)}`);
  return 'installed';
}

/** @param {string} file */
function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** @param {string} url */
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/** @param {string} zipPath @param {string} targetDir */
function extractWithTar(zipPath, targetDir) {
  // Windows 10+ ships bsdtar, which reads zip archives. Called by full path because a GNU tar
  // earlier on PATH (Git for Windows, MSYS2) cannot.
  const tar = process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const result = spawnSync(tar, ['-xf', zipPath, '-C', targetDir], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar exited with code ${result.status}`);
}

if (require.main === module) {
  /** @type {ToolchainPin} */
  const pin = JSON.parse(fs.readFileSync(path.join(root, 'ffmpeg-toolchain.json'), 'utf8'));
  installPinnedFfmpeg(pin, path.join(root, 'vendor', 'ffmpeg'), {
    download,
    extract: extractWithTar,
    log: (message) => console.log(`[fetch-ffmpeg] ${message}`),
  }).catch((error) => {
    console.error(`[fetch-ffmpeg] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { installPinnedFfmpeg, downloadUrl };
