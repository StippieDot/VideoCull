const { createServer } = require('vite');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Wayland shells ignore the icon a window sets and take it from the desktop entry whose
 * StartupWMClass matches the app ID ("videocull", from desktopName in package.json). A packaged
 * build gets that entry when it is installed; in development nothing provides one, so the shell
 * shows a generic icon. This hidden entry only supplies the icon and never shows in the app list.
 */
function ensureLinuxDevDesktopEntry(repoRoot, electronPath) {
  if (process.platform !== 'linux') return;
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const file = path.join(dataHome, 'applications', 'videocull-dev.desktop');
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=VideoCull (development)',
    `Exec="${electronPath}" "${repoRoot}"`,
    `Icon=${path.join(repoRoot, 'src', 'assets', 'videocull-icon.png')}`,
    'StartupWMClass=videocull',
    'NoDisplay=true',
    '',
  ].join('\n');
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === entry) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, entry);
  } catch (error) {
    console.warn(`Could not write ${file}; the window may show a generic icon:`, error.message);
  }
}

async function main() {
  const repoRoot = path.join(__dirname, '..');
  const server = await createServer({
    configFile: path.join(repoRoot, 'vite.config.js'),
    server: { port: 5173 },
  });

  await server.listen();

  const resolvedPort = server.config.server.port;
  const address = server.httpServer?.address();
  const port =
    typeof address === 'object' && address && 'port' in address
      ? address.port
      : resolvedPort;

  console.log(`\n  Vite dev server running on http://localhost:${port}\n`);

  const electronPath = require('electron');
  ensureLinuxDevDesktopEntry(repoRoot, electronPath);
  const electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, VITE_DEV_SERVER_PORT: String(port) },
  });

  const shutdown = (code = 0) => {
    electron.kill();
    void server.close();
    process.exit(code);
  };

  electron.on('close', (code) => {
    void server.close();
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

main().catch((error) => {
  console.error('Dev launcher failed:', error);
  process.exit(1);
});
