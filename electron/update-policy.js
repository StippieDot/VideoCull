function configureUpdatePolicy(autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
}

// A PC shutdown right after VideoCull quits would interrupt the installer, so a scheduled update
// waits for the next time VideoCull closes.
function shouldInstallUpdateOnQuit({ scheduled, ready, installInProgress, shuttingDownPc = false }) {
  return Boolean(scheduled && ready && !installInProgress && !shuttingDownPc);
}

module.exports = {
  configureUpdatePolicy,
  shouldInstallUpdateOnQuit,
};
