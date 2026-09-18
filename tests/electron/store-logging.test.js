const assert = require('node:assert/strict');
const path = require('node:path');
const { test: nodeTest } = require('node:test');
const { configureStoreFileLogging } = require('../../electron/logger');

const test = globalThis.test || nodeTest;

test('Store logging writes to the package runtime log directory', () => {
  const logger = { transports: { file: {} } };
  const logs = path.join('C:\\Package', 'LocalCache', 'logs');

  configureStoreFileLogging(logger, {
    distributionChannel: 'microsoft-store',
    storage: { logs },
  }, path.win32);

  assert.equal(
    logger.transports.file.resolvePathFn({ fileName: 'main.log' }),
    path.win32.join(logs, 'main.log'),
  );
});

test('direct logging keeps the electron-log default resolver', () => {
  const originalResolver = () => 'default';
  const logger = { transports: { file: { resolvePathFn: originalResolver } } };

  configureStoreFileLogging(logger, { distributionChannel: 'direct' }, path.win32);

  assert.equal(logger.transports.file.resolvePathFn, originalResolver);
});
