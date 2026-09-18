const { spawnSync } = require('node:child_process');
const path = require('node:path');
const packageJson = require('../package.json');
const product = require('../product.json');
const { validateStoreVersion } = require('./store-version');

const root = path.resolve(__dirname, '..');
const expectedVersion = validateStoreVersion(
  packageJson.version,
  product.microsoftStore?.lastSubmittedVersion,
  { strict: true },
);
const packagePath = path.join(root, 'release', `VideoCull.Store.${packageJson.version}.x64.appx`);
const result = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  path.join(root, 'scripts', 'validate-store-appx.ps1'),
  '-PackagePath',
  packagePath,
  '-ExpectedVersion',
  expectedVersion,
], {
  cwd: root,
  shell: false,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
