const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test: nodeTest } = require('node:test');
const { installPinnedFfmpeg, downloadUrl } = require('../../scripts/fetch-ffmpeg');
const test = globalThis.test || nodeTest;

const archive = Buffer.from('pretend zip');
const pin = {
  repository: 'StippieDot/VideoCull-FFmpeg',
  tag: 'ffmpeg-9.0.2-r1',
  asset: 'videocull-ffmpeg-9.0.2-r1-win64.zip',
  sha256: crypto.createHash('sha256').update(archive).digest('hex'),
};

function tempVendor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-fetch-ffmpeg-'));
  return { vendorDir: path.join(dir, 'ffmpeg'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function fakeExtract(files = ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt']) {
  return (_zipPath, targetDir) => {
    for (const file of files) fs.writeFileSync(path.join(targetDir, file), file);
  };
}

test('downloads the pinned release asset from the toolchain repository', () => {
  assert.equal(
    downloadUrl(pin),
    'https://github.com/StippieDot/VideoCull-FFmpeg/releases/download/ffmpeg-9.0.2-r1/videocull-ffmpeg-9.0.2-r1-win64.zip',
  );
});

test('installs a matching archive once and skips it while the pin is unchanged', async () => {
  const { vendorDir, cleanup } = tempVendor();
  try {
    const downloads = [];
    const io = { download: async (url) => { downloads.push(url); return archive; }, extract: fakeExtract() };

    assert.equal(await installPinnedFfmpeg(pin, vendorDir, io), 'installed');
    assert.equal(await installPinnedFfmpeg(pin, vendorDir, io), 'current');
    assert.equal(downloads.length, 1);
    assert.ok(fs.existsSync(path.join(vendorDir, 'ffprobe.exe')));
  } finally {
    cleanup();
  }
});

test('refuses an archive whose hash differs and leaves the existing folder untouched', async () => {
  const { vendorDir, cleanup } = tempVendor();
  try {
    fs.mkdirSync(vendorDir);
    fs.writeFileSync(path.join(vendorDir, 'ffmpeg.exe'), 'previous build');
    let extracted = false;

    await assert.rejects(
      installPinnedFfmpeg(pin, vendorDir, {
        download: async () => Buffer.from('tampered'),
        extract: () => { extracted = true; },
      }),
      /hash mismatch/,
    );
    assert.equal(extracted, false);
    assert.equal(fs.readFileSync(path.join(vendorDir, 'ffmpeg.exe'), 'utf8'), 'previous build');
  } finally {
    cleanup();
  }
});

test('refuses an archive without both executables and the license', async () => {
  const { vendorDir, cleanup } = tempVendor();
  try {
    await assert.rejects(
      installPinnedFfmpeg(pin, vendorDir, { download: async () => archive, extract: fakeExtract(['ffmpeg.exe']) }),
      /lacks ffprobe\.exe/,
    );
    assert.equal(fs.existsSync(vendorDir), false);
  } finally {
    cleanup();
  }
});
