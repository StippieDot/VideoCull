const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  path.join(root, 'scripts', 'generate-appx-assets.ps1'),
]);
run(process.execPath, [path.join(root, 'scripts', 'check-store-config.js')]);
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
run(
  process.execPath,
  [
    path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
    '--win',
    'appx',
    '--x64',
    '--publish',
    'never',
    '--config.electronDist=node_modules/electron/dist',
  ],
  { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
);
run(process.execPath, [path.join(root, 'scripts', 'validate-store-package.js')]);
