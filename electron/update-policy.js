function configureUpdatePolicy(autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
}

// A PC shutdown right after VideoCull quits would interrupt the installer, so a scheduled update
// is skipped. The choice is not saved: the update stays downloaded and the next start offers it
// again in the update banner.
function shouldInstallUpdateOnQuit({ scheduled, ready, installInProgress, shuttingDownPc = false }) {
  return Boolean(scheduled && ready && !installInProgress && !shuttingDownPc);
}

module.exports = {
  configureUpdatePolicy,
  shouldInstallUpdateOnQuit,
};
