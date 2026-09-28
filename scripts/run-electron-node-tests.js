const { spawnSync } = require('node:child_process');

const testFiles = process.argv.slice(2);
if (testFiles.length === 0) throw new Error('At least one test file is required.');

const result = spawnSync(require('electron'), ['--test', ...testFiles], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
