const { createServer } = require('vite');
const { spawn } = require('child_process');
const path = require('path');

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
