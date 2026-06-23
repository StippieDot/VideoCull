const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nsis = packageJson.build?.nsis;

assert.ok(nsis, 'package.json must define build.nsis');
assert.equal(nsis.oneClick, false, 'installer must remain assisted');
assert.equal(nsis.perMachine, false, 'installer must keep current-user/all-users selection');
assert.equal(nsis.allowToChangeInstallationDirectory, true, 'installer location must remain editable');
assert.equal(nsis.createDesktopShortcut, true, 'Desktop shortcut must default on');
assert.equal(nsis.createStartMenuShortcut, true, 'Start Menu shortcut must default on');
assert.equal(nsis.runAfterFinish, true, 'launch-on-finish must default on');
assert.equal(nsis.include, 'build/installer.nsh', 'custom NSIS include must be configured');
assert.equal(nsis.installerHeader, 'build/installerHeader.bmp', 'custom installer header must be configured');

function assertBitmap(relativePath, expectedWidth, expectedHeight) {
  const filePath = path.join(root, relativePath);
  assert.ok(fs.existsSync(filePath), `${relativePath} must exist`);
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(0, 2).toString('ascii'), 'BM', `${relativePath} must be a BMP file`);
  assert.equal(data.readInt32LE(18), expectedWidth, `${relativePath} must be ${expectedWidth}px wide`);
  assert.equal(Math.abs(data.readInt32LE(22)), expectedHeight, `${relativePath} must be ${expectedHeight}px high`);
}

assertBitmap('build/installerSidebar.bmp', 164, 314);
assertBitmap('build/installerHeader.bmp', 150, 57);

const includePath = path.join(root, nsis.include);
assert.ok(fs.existsSync(includePath), 'custom NSIS include must exist');
const include = fs.readFileSync(includePath, 'utf8');
for (const requiredToken of ['nsDialogs.nsh', 'customPageAfterChangeDir', 'customInstall']) {
  assert.ok(include.includes(requiredToken), `installer include must contain ${requiredToken}`);
}

console.log('Installer configuration OK.');
