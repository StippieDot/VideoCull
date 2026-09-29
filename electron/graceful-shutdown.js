function createProducerTracker() {
  const active = new Set();

  function track(operation) {
    const promise = Promise.resolve().then(operation);
    active.add(promise);
    void promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  }

  async function drain() {
    while (active.size > 0) {
      await Promise.allSettled(Array.from(active));
    }
  }

  return { track, drain };
}

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

module.exports = { createGracefulShutdown, createProducerTracker };
