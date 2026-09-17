function shouldRunStoreProfileMigration(profileBootstrap) {
  return profileBootstrap?.distributionChannel === 'microsoft-store'
    && profileBootstrap.sharedPersistentProfile !== true;
}

function showWindowThenPrepareCache(options) {
  options.showWindow();
  if (!options.profileMigration) return null;

  const task = Promise.resolve().then(() => options.profileMigration.prepareCache());
  task.catch((error) => options.onCacheError?.(error));
  return task;
}

module.exports = { shouldRunStoreProfileMigration, showWindowThenPrepareCache };
