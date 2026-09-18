const crypto = require('node:crypto');
const net = require('node:net');

const PRODUCT_GUARD_KEY = 'StippieDot.VideoCull:edition-guard:v1';

function createEditionGuardName(productKey = PRODUCT_GUARD_KEY, cryptoImpl = crypto) {
  const hash = cryptoImpl.createHash('sha256').update(productKey).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\LOCAL\\VideoCull-EditionGuard-${hash}`;
}

function shouldAcquireEditionGuard({ isPackaged, platform, isE2E }) {
  return Boolean(isPackaged) && platform === 'win32' && !isE2E;
}

function acquireEditionGuard(options = {}) {
  const enabled = shouldAcquireEditionGuard({
    isPackaged: options.isPackaged,
    platform: options.platform ?? process.platform,
    isE2E: options.isE2E,
  });
  if (!enabled) return Promise.resolve(null);

  const netImpl = options.netImpl ?? net;
  const pipeName = options.pipeName ?? createEditionGuardName();
  return new Promise((resolve, reject) => {
    const server = netImpl.createServer((socket) => socket.end('VideoCull is already running.'));
    const onError = (error) => {
      server.removeListener('listening', onListening);
      try { server.close(); } catch { /* The server never started. */ }
      const guardError = new Error(
        error?.code === 'EADDRINUSE'
          ? 'Another VideoCull edition is already running in this Windows login session.'
          : `VideoCull could not acquire its cross-edition guard: ${error?.message || 'unknown error'}`,
      );
      guardError.code = error?.code === 'EADDRINUSE' ? 'VIDEOCULL_ALREADY_RUNNING' : 'VIDEOCULL_GUARD_FAILED';
      guardError.cause = error;
      reject(guardError);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      server.on('error', () => {});
      resolve({ pipeName, server });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(pipeName);
  });
}

function closeEditionGuard(guard) {
  if (!guard?.server) return;
  try { guard.server.close(); } catch { /* Process teardown also releases the pipe. */ }
}

module.exports = {
  PRODUCT_GUARD_KEY,
  acquireEditionGuard,
  closeEditionGuard,
  createEditionGuardName,
  shouldAcquireEditionGuard,
};
