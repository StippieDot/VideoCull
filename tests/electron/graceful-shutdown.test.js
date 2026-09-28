const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const { createGracefulShutdown } = require('../../electron/graceful-shutdown');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

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
