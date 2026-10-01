const { spawnSync } = require('node:child_process');
const path = require('node:path');

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

async function afterPack(context, dependencies = {}) {
  if (context.electronPlatformName !== 'win32') return;
  const executableName = `${context.packager.appInfo.productFilename}.exe`;
  const executablePath = path.join(context.appOutDir, executableName);
  const resourcesPath = path.join(context.appOutDir, 'resources');
  const runSmoke = dependencies.runSmoke ?? runPackagedSqliteSmoke;
  runSmoke(executablePath, resourcesPath);
}

module.exports = {
  afterPack,
  runPackagedSqliteSmoke,
};
