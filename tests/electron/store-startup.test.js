const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
const { showWindowThenPrepareCache } = require('../../electron/store-startup');
const test = globalThis.test || nodeTest;

test('a delayed cache preflight starts only after the Store window is shown', async () => {
  let windowShown = false;
  let preflightStarted = false;
  let finishPreflight;
  const delayedPreflight = new Promise((resolve) => { finishPreflight = resolve; });

  const task = showWindowThenPrepareCache({
    showWindow: () => { windowShown = true; },
    profileMigration: {
      prepareCache: () => {
        assert.equal(windowShown, true);
        preflightStarted = true;
        return delayedPreflight;
      },
    },
  });

  assert.equal(windowShown, true);
  assert.equal(preflightStarted, false);
  await Promise.resolve();
  assert.equal(preflightStarted, true);

  let preflightFinished = false;
  task.then(() => { preflightFinished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(preflightFinished, false);

  finishPreflight({ stage: 'awaiting-cache-choice' });
  await task;
  assert.equal(preflightFinished, true);
});
