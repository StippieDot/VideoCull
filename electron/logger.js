const log = require('electron-log');
const path = require('node:path');

function configureStoreFileLogging(logger, profileBootstrap, pathImpl = path) {
  if (profileBootstrap?.distributionChannel !== 'microsoft-store') return;
  const logsPath = profileBootstrap.storage?.logs;
  if (!logsPath) throw new Error('Store logging requires a package-scoped logs path.');
  logger.transports.file.resolvePathFn = ({ fileName }) => pathImpl.join(logsPath, fileName);
}

configureStoreFileLogging(log, globalThis.__VIDEOCULL_PROFILE_BOOTSTRAP__);

log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB per file
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.console.format = '[{level}] {text}';

module.exports = log;
module.exports.configureStoreFileLogging = configureStoreFileLogging;
