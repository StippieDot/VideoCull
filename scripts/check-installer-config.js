const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nsis = packageJson.build?.nsis;
const win = packageJson.build?.win;
const appIcon = 'build/videocull.ico';

assert.ok(nsis, 'package.json must define build.nsis');
assert.ok(win, 'package.json must define build.win');
assert.equal(packageJson.name, 'videocull', 'package name must use the canonical lowercase identity');
assert.equal(packageJson.version, '2.2.1', 'package version must match the identity migration release');
assert.equal(packageJson.main, 'electron/bootstrap.js', 'Electron must start through the profile bootstrap');
assert.equal(packageJson.build?.appId, 'com.videocull.app', 'Windows application ID must remain stable');
assert.equal(packageJson.build?.productName, 'VideoCull', 'product name must use the canonical identity');
assert.equal(packageJson.build?.publish?.owner, 'StippieDot', 'updates must use the canonical GitHub owner');
assert.equal(win.icon, appIcon, 'Windows executable must use the VideoCull icon');
assert.equal(win.executableName, 'VideoCull', 'Windows executable must be VideoCull.exe');
assert.equal(win.artifactName, 'VideoCull.Setup.${version}.${ext}', 'installer artifact must use the canonical name');
assert.equal(nsis.oneClick, false, 'installer must remain assisted');
assert.equal(nsis.perMachine, false, 'installer must keep current-user/all-users selection');
assert.equal(nsis.allowToChangeInstallationDirectory, true, 'installer location must remain editable');
assert.equal(nsis.createDesktopShortcut, true, 'Desktop shortcut must default on');
assert.equal(nsis.createStartMenuShortcut, true, 'Start Menu shortcut must default on');
assert.equal(nsis.runAfterFinish, true, 'launch-on-finish must default on');
assert.equal(nsis.shortcutName, 'VideoCull', 'installer shortcuts must use the canonical name');
assert.equal(nsis.uninstallDisplayName, 'VideoCull ${version}', 'uninstaller display name must use the canonical name');
assert.equal(nsis.include, 'build/installer.nsh', 'custom NSIS include must be configured');
assert.equal(nsis.installerIcon, appIcon, 'installer must use the VideoCull icon');
assert.equal(nsis.uninstallerIcon, appIcon, 'uninstaller must use the VideoCull icon');
assert.ok(fs.existsSync(path.join(root, appIcon)), 'VideoCull icon file must exist');
assert.ok(
  packageJson.build?.extraResources?.some((resource) => resource.from === appIcon && resource.to === 'videocull.ico'),
  'packaged resources must include the VideoCull icon for the native window',
);
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
for (const requiredToken of ['VideoCull shortcuts', 'Video Cull.lnk', 'Video Cull.exe', 'Uninstall Video Cull.exe']) {
  assert.ok(include.includes(requiredToken), `installer include must contain migration token ${requiredToken}`);
}

console.log('Installer configuration OK.');
