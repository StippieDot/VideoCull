function createGracefulShutdown({ prepare, drain, closeCache, quit, installUpdate, onError }) {
  let phase = 'idle';
  let completion = null;
  let installOptions = null;

  function request(options = {}) {
    if (options.installOptions) installOptions = options.installOptions;
    if (phase === 'complete') return true;
    if (completion) return false;

    phase = 'draining';
    prepare();
    completion = Promise.resolve()
      .then(drain)
      .then(closeCache)
      .catch((error) => onError(error))
      .then(() => {
        phase = 'complete';
        if (installOptions) installUpdate(installOptions);
        else quit();
      });
    return false;
  }

  return {
    request,
    completion: () => completion ?? Promise.resolve(),
    phase: () => phase,
  };
}

module.exports = { createGracefulShutdown };
