function configureUpdatePolicy(autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
}

function shouldInstallUpdateOnQuit({ scheduled, ready, installInProgress }) {
  return Boolean(scheduled && ready && !installInProgress);
}

module.exports = {
  configureUpdatePolicy,
  shouldInstallUpdateOnQuit,
};
