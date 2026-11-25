const assert = require('node:assert/strict');
const { createProcessingRuns } = require('../../electron/processing-runs');

function setup() {
  const log = [];
  let clock = 0;
  const runs = createProcessingRuns({
    liftPause: () => log.push('lift-pause'),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  const fakeRun = (kind, extra = {}) => ({ kind, cancel: () => log.push(`cancel:${kind}`), ...extra });
  return { runs, log, fakeRun };
}

test('invalidateSession cancels every kind of run, supersedes scans and lifts the pause', () => {
  const { runs, log, fakeRun } = setup();
  const token = runs.beginScan();
  for (const kind of ['metadata', 'thumbnails', 'duplicate']) runs.register(fakeRun(kind));
  runs.invalidateSession();
  assert.deepEqual(log, ['cancel:metadata', 'cancel:thumbnails', 'cancel:duplicate', 'lift-pause']);
  assert.equal(runs.isScanCurrent(token), false);
  assert.equal(runs.isRunning('duplicate'), false);
});

test('a new run of a kind cancels the previous one; finish only forgets its own run', () => {
  const { runs, log, fakeRun } = setup();
  const first = runs.register(fakeRun('duplicate'));
  const second = runs.register(fakeRun('duplicate'));
  assert.deepEqual(log, ['cancel:duplicate']);
  first.finish();
  assert.equal(runs.isRunning('duplicate'), true);
  second.finish();
  assert.equal(runs.isRunning('duplicate'), false);
});

test('cancelKinds cancels without lifting the pause and reports whether it did anything', () => {
  const { runs, log, fakeRun } = setup();
  runs.register(fakeRun('thumbnails'));
  assert.equal(runs.cancelKinds('metadata', 'thumbnails'), true);
  assert.equal(runs.cancelKinds('thumbnails'), false);
  assert.deepEqual(log, ['cancel:thumbnails']);
});

test('shutdown stops work, refuses new producers and drains the running ones', async () => {
  const { runs, log, fakeRun } = setup();
  runs.register(fakeRun('metadata'));
  let release;
  const pending = runs.trackProducer(() => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  runs.beginShutdown();
  assert.deepEqual(log, ['cancel:metadata', 'lift-pause']);
  assert.equal(runs.isShuttingDown(), true);
  assert.equal(await runs.trackProducer(async () => 'ran'), false);
  let drained = false;
  const drain = runs.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  release('done');
  await drain;
  assert.equal(await pending, 'done');
});

test('skipFiles reaches every run and never cancels or lifts the pause', () => {
  const { runs, log, fakeRun } = setup();
  const skipped = [];
  runs.register(fakeRun('metadata', { skipFiles: (paths) => skipped.push(...paths) }));
  runs.register(fakeRun('duplicate'));
  runs.skipFiles(['a.mp4']);
  assert.deepEqual(skipped, ['a.mp4']);
  assert.deepEqual(log, []);
});

test('waitUntilIdle returns at once when nothing is active', async () => {
  const { runs, fakeRun } = setup();
  runs.register(fakeRun('metadata', { isFileActive: () => false }));
  assert.deepEqual(await runs.waitUntilIdle(['a.mp4'], 10_000), []);
});

test('waitUntilIdle returns once the file is released', async () => {
  const { runs, fakeRun } = setup();
  let polls = 0;
  runs.register(fakeRun('thumbnails', { isFileActive: (p) => p === 'a.mp4' && ++polls < 3 }));
  assert.deepEqual(await runs.waitUntilIdle(['a.mp4', 'b.mp4'], 10_000), []);
});

test('waitUntilIdle reports files still busy after the timeout', async () => {
  const { runs, fakeRun } = setup();
  runs.register(fakeRun('thumbnails', { isFileActive: (p) => p === 'b.mp4' }));
  assert.deepEqual(await runs.waitUntilIdle(['a.mp4', 'b.mp4'], 200), ['b.mp4']);
});
