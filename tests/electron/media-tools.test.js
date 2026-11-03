const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveMediaToolsDir } = require('../../electron/media-tools');

test('packaged builds use the ffmpeg folder next to app.asar', () => {
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('C:\\App', 'resources', 'app.asar', 'electron'), resourcesPath: 'C:\\App\\resources', platform: 'win32' }),
    path.join('C:\\App\\resources', 'ffmpeg'),
  );
});

test('development uses vendor/ffmpeg even when Electron sets a resources path', () => {
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('D:\\repo', 'electron'), resourcesPath: 'D:\\repo\\node_modules\\electron\\dist\\resources', platform: 'win32' }),
    path.join('D:\\repo', 'vendor', 'ffmpeg'),
  );
});

test('the test override wins', () => {
  assert.equal(
    resolveMediaToolsDir({ override: 'E:\\other-build', appDir: path.join('C:\\App', 'resources', 'app.asar', 'electron'), resourcesPath: 'C:\\App\\resources' }),
    'E:\\other-build',
  );
});

test('macOS and Linux fall back to a system FFmpeg when none is bundled', () => {
  const installed = new Set([path.join('/opt/homebrew/bin', 'ffmpeg'), path.join('/opt/homebrew/bin', 'ffprobe')]);
  const resolve = (exists) => resolveMediaToolsDir({
    appDir: path.join('/repo', 'electron'), platform: 'darwin', pathEnv: '', exists,
  });
  assert.equal(resolve((file) => installed.has(file)), '/opt/homebrew/bin');
  // A bundled folder wins over the system install.
  const bundled = path.join('/repo', 'vendor', 'ffmpeg');
  assert.equal(resolve((file) => installed.has(file) || file.startsWith(bundled)), bundled);
  // Nothing installed: the bundled path is reported, so the startup check names what is missing.
  assert.equal(resolve(() => false), bundled);
});
