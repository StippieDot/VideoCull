const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { NOTICES_FILE, writeThirdPartyNotices } = require('./generate-notices');

const smokeScript = path.join(__dirname, 'packaged-sqlite-smoke.js');

function runPackagedSqliteSmoke(executablePath, resourcesPath, spawn = spawnSync) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;

  const result = spawn(executablePath, [smokeScript, resourcesPath], {
    cwd: path.dirname(executablePath),
    env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Packaged better-sqlite3 smoke test failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

const REQUIRED_LEGAL_FILES = ['LICENSE.txt', NOTICES_FILE, path.join('ffmpeg', 'LICENSE.txt')];

function assertLegalFilesPresent(resourcesPath, exists = fs.existsSync) {
  const missing = REQUIRED_LEGAL_FILES.filter((name) => !exists(path.join(resourcesPath, name)));
  if (missing.length) throw new Error(`Packaged app is missing legal files: ${missing.join(', ')}`);
}

// Runs after the app folder is assembled and before the installer or Store package is built, so
// both editions ship the same generated notices.
async function afterPack(context, dependencies = {}) {
  if (context.electronPlatformName !== 'win32') return;
  const executableName = `${context.packager.appInfo.productFilename}.exe`;
  const executablePath = path.join(context.appOutDir, executableName);
  const resourcesPath = path.join(context.appOutDir, 'resources');
  const writeNotices = dependencies.writeNotices ?? writeThirdPartyNotices;
  const checkLegalFiles = dependencies.checkLegalFiles ?? assertLegalFilesPresent;
  const runSmoke = dependencies.runSmoke ?? runPackagedSqliteSmoke;
  writeNotices(resourcesPath);
  checkLegalFiles(resourcesPath);
  runSmoke(executablePath, resourcesPath);
}

module.exports = {
  afterPack,
  assertLegalFilesPresent,
  runPackagedSqliteSmoke,
};
