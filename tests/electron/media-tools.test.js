const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveMediaToolsDir } = require('../../electron/media-tools');

test('packaged builds use the ffmpeg folder next to app.asar', () => {
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('C:\\App', 'resources', 'app.asar', 'electron'), resourcesPath: 'C:\\App\\resources' }),
    path.join('C:\\App\\resources', 'ffmpeg'),
  );
});

test('development uses vendor/ffmpeg even when Electron sets a resources path', () => {
  assert.equal(
    resolveMediaToolsDir({ appDir: path.join('D:\\repo', 'electron'), resourcesPath: 'D:\\repo\\node_modules\\electron\\dist\\resources' }),
    path.join('D:\\repo', 'vendor', 'ffmpeg'),
  );
});

test('the test override wins', () => {
  assert.equal(
    resolveMediaToolsDir({ override: 'E:\\other-build', appDir: path.join('C:\\App', 'resources', 'app.asar', 'electron'), resourcesPath: 'C:\\App\\resources' }),
    'E:\\other-build',
  );
});
