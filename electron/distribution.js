function getDistributionChannel(profileBootstrap) {
  return profileBootstrap?.distributionChannel === 'microsoft-store' ? 'microsoft-store' : 'direct';
}

function shouldEnableUpdates({ isDev, isE2E, distributionChannel, disableUpdates }) {
  return !isDev && !isE2E && distributionChannel !== 'microsoft-store' && !disableUpdates;
}

module.exports = { getDistributionChannel, shouldEnableUpdates };
