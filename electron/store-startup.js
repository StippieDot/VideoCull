function showWindowThenPrepareCache(options) {
  options.showWindow();
  if (!options.profileMigration) return null;

  const task = Promise.resolve().then(() => options.profileMigration.prepareCache());
  task.catch((error) => options.onCacheError?.(error));
  return task;
}

module.exports = { showWindowThenPrepareCache };
