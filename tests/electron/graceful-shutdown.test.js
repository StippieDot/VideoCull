const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const { createGracefulShutdown, createProducerTracker } = require('../../electron/graceful-shutdown');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('an accepted review-state operation drains before cache close', async () => {
  const reviewWrite = deferred();
  const producers = createProducerTracker();
  const events = [];
  let isQuitting = false;

  const saveReviewState = () => {
    if (isQuitting) return Promise.resolve(false);
    return producers.track(async () => {
      events.push('review:start');
      await reviewWrite.promise;
      events.push('review:end');
      return true;
    });
  };
  const shutdown = createGracefulShutdown({
    prepare: () => {
      isQuitting = true;
      events.push('prepare');
    },
    drain: async () => {
      events.push('drain');
      await producers.drain();
    },
    closeCache: () => events.push('cache'),
    quit: () => events.push('quit'),
    installUpdate: () => events.push('install'),
    onError: (error) => events.push(`error:${error.message}`),
  });

  const acceptedSave = saveReviewState();
  assert.equal(shutdown.request(), false);
  assert.equal(await saveReviewState(), false);
  await Promise.resolve();
  assert.deepEqual(events, ['prepare', 'review:start', 'drain']);

  reviewWrite.resolve();
  assert.equal(await acceptedSave, true);
  await shutdown.completion();
  assert.deepEqual(events, ['prepare', 'review:start', 'drain', 'review:end', 'cache', 'quit']);
});

test('graceful shutdown drains producers and cache before allowing recursive quit', async () => {
  const producer = deferred();
  const cache = deferred();
  const events = [];
  const shutdown = createGracefulShutdown({
    prepare: () => events.push('prepare'),
    drain: async () => { events.push('drain'); await producer.promise; },
    closeCache: async () => { events.push('cache'); await cache.promise; },
    quit: () => events.push('quit'),
    installUpdate: () => events.push('install'),
    onError: (error) => events.push(`error:${error.message}`),
  });

  assert.equal(shutdown.request(), false);
  assert.equal(shutdown.request(), false);
  await Promise.resolve();
  assert.deepEqual(events, ['prepare', 'drain']);
  producer.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['prepare', 'drain', 'cache']);
  cache.resolve();
  await shutdown.completion();
  assert.deepEqual(events, ['prepare', 'drain', 'cache', 'quit']);
  assert.equal(shutdown.request(), true);
});

test('update installation waits for shutdown and failures do not trap the app', async () => {
  const events = [];
  const shutdown = createGracefulShutdown({
    prepare: () => events.push('prepare'),
    drain: async () => events.push('drain'),
    closeCache: async () => { throw new Error('worker unavailable'); },
    quit: () => events.push('quit'),
    installUpdate: (options) => events.push(`install:${options.isSilent}:${options.isForceRunAfter}`),
    onError: (error) => events.push(`error:${error.message}`),
  });

  assert.equal(shutdown.request({ installOptions: { isSilent: false, isForceRunAfter: true } }), false);
  await shutdown.completion();
  assert.deepEqual(events, [
    'prepare',
    'drain',
    'error:worker unavailable',
    'install:false:true',
  ]);
  assert.equal(shutdown.request(), true);
});
