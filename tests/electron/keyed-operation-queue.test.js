const assert = require('node:assert/strict');
const { createKeyedOperationQueue } = require('../../electron/keyed-operation-queue');

test('serializes work for one key and releases it after the final operation', async () => {
  const queue = createKeyedOperationQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = queue.run('folder-a', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });
  const second = queue.run('folder-a', async () => {
    events.push('second:start');
    events.push('second:end');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  assert.equal(queue.pendingCount(), 1);

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  assert.equal(queue.pendingCount(), 0);
});

test('allows different keys to make progress independently', async () => {
  const queue = createKeyedOperationQueue();
  const events = [];
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });

  const first = queue.run('folder-a', async () => {
    events.push('a:start');
    await gateA;
    events.push('a:end');
  });
  const second = queue.run('folder-b', async () => {
    events.push('b');
  });

  await second;
  assert.deepEqual(events, ['a:start', 'b']);
  releaseA();
  await first;
});

test('continues queued work after a failed operation and still releases the key', async () => {
  const queue = createKeyedOperationQueue();
  const events = [];

  const failed = queue.run('folder-a', async () => {
    events.push('failed');
    throw new Error('expected');
  });
  const recovered = queue.run('folder-a', async () => {
    events.push('recovered');
  });

  await assert.rejects(failed, /expected/);
  await recovered;

  assert.deepEqual(events, ['failed', 'recovered']);
  assert.equal(queue.pendingCount(), 0);
});
