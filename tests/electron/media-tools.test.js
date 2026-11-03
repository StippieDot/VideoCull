const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveMediaToolsDir } = require('../../electron/media-tools');

test('packaged builds use the ffmpeg folder next to app.asar', () => {
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('C:\\App', 'resources', 'app.asar', 'electron'), resourcesPath: 'C:\\App\\resources', platform: 'win32' }),
    path.join('C:\\App\\resources', 'ffmpeg'),
  );
});

test('development uses this platform\'s vendor/ffmpeg folder even when Electron sets a resources path', () => {
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('D:\\repo', 'electron'), resourcesPath: 'D:\\repo\\node_modules\\electron\\dist\\resources', platform: 'win32', arch: 'x64' }),
    path.join('D:\\repo', 'vendor', 'ffmpeg', 'win32-x64'),
  );
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('/repo', 'electron'), platform: 'darwin', arch: 'arm64' }),
    path.join('/repo', 'vendor', 'ffmpeg', 'darwin-arm64'),
  );
});

test('the test override wins', () => {
  assert.equal(
    resolveMediaToolsDir({ override: 'E:\\other-build', appDir: path.join('C:\\App', 'resources', 'app.asar', 'electron'), resourcesPath: 'C:\\App\\resources' }),
    'E:\\other-build',
  );
});
