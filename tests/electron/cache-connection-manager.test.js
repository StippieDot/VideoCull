const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const test = globalThis.test || nodeTest;
const {
  connectionLimitsForMemory,
  createCacheConnectionManager,
} = require('../../electron/cache-connection-manager');

function fakeDb(name, events) {
  return { close: () => events.push(`close:${name}`) };
}

test('selects generous bounded limits from installed memory', () => {
  const gib = 1024 ** 3;
  assert.deepEqual(connectionLimitsForMemory(8 * gib), { warmTarget: 128, hardIdleCap: 256, globalCap: 512 });
  assert.deepEqual(connectionLimitsForMemory(16 * gib), { warmTarget: 256, hardIdleCap: 512, globalCap: 1024 });
  assert.deepEqual(connectionLimitsForMemory(32 * gib), { warmTarget: 512, hardIdleCap: 1024, globalCap: 2048 });
});

test('released connections remain warm and are reused', async () => {
  const events = [];
  const manager = createCacheConnectionManager({ limits: { warmTarget: 1, hardIdleCap: 2, globalCap: 3 } });
  const first = await manager.acquire('a', () => fakeDb('a', events));
  assert.equal(manager.release('a'), true);
  const second = await manager.acquire('a', () => fakeDb('replacement', events));

  assert.equal(second, first);
  assert.equal(manager.getStats().reused, 1);
  assert.deepEqual(events, []);
  manager.closeAll();
});

test('hard idle cap evicts least recently released connection', async () => {
  const events = [];
  const manager = createCacheConnectionManager({ limits: { warmTarget: 1, hardIdleCap: 2, globalCap: 4 } });
  for (const key of ['a', 'b', 'c']) {
    await manager.acquire(key, () => fakeDb(key, events));
    manager.release(key);
  }

  assert.deepEqual(events, ['close:a']);
  assert.equal(manager.getStats().idleConnections, 2);
  manager.closeAll();
});

test('global cap queues work when every connection is active and honors priority', async () => {
  const events = [];
  const manager = createCacheConnectionManager({ limits: { warmTarget: 1, hardIdleCap: 2, globalCap: 1 } });
  await manager.acquire('active', () => fakeDb('active', events));
  const background = manager.acquire('background', () => fakeDb('background', events), 'background');
  const interactive = manager.acquire('interactive', () => fakeDb('interactive', events), 'interactive');

  manager.release('active');
  const interactiveDb = await interactive;
  assert.ok(interactiveDb);
  assert.deepEqual(events, ['close:active']);
  manager.release('interactive');
  await background;
  manager.release('background');
  manager.closeAll();
});

test('idle trimming closes a bounded batch down toward the warm target', async () => {
  const events = [];
  let clock = 0;
  const manager = createCacheConnectionManager({
    limits: { warmTarget: 1, hardIdleCap: 4, globalCap: 4 },
    inactivityMs: 100,
    trimIntervalMs: 10,
    trimBatchSize: 2,
    now: () => clock,
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
  });
  for (const key of ['a', 'b', 'c', 'd']) {
    await manager.acquire(key, () => fakeDb(key, events));
    manager.release(key);
  }
  clock = 100;
  manager.runScheduledTrim();

  assert.deepEqual(events, ['close:a', 'close:b']);
  assert.equal(manager.getStats().idleConnections, 2);
  manager.closeAll();
});
