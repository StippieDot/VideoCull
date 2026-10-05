const assert = require('node:assert/strict');
const { createPowerManager } = require('../../electron/power-manager');

function setup() {
  const calls = [];
  let paused = false;
  let nextId = 1;
  const manager = createPowerManager({
    startBlocker: () => {
      const id = nextId++;
      calls.push(`start ${id}`);
      return id;
    },
    stopBlocker: (id) => calls.push(`stop ${id}`),
    isPaused: () => paused,
  });
  return { manager, calls, setPaused: (value) => { paused = value; manager.pauseChanged(); } };
}

test('keeps the PC awake from the first piece of work until the last one ends', () => {
  const { manager, calls } = setup();
  const endMetadata = manager.beginWork();
  const endThumbnails = manager.beginWork();
  endMetadata();
  endMetadata();
  assert.equal(manager.isKeepingAwake(), true);
  endThumbnails();
  assert.equal(manager.isKeepingAwake(), false);
  assert.deepEqual(calls, ['start 1', 'stop 1']);
});

test('lets the PC sleep while processing is paused or the setting is off', () => {
  const { manager, calls, setPaused } = setup();
  const end = manager.beginWork();
  setPaused(true);
  assert.equal(manager.isKeepingAwake(), false);
  setPaused(false);
  manager.setKeepAwake(false);
  assert.equal(manager.isKeepingAwake(), false);
  manager.setKeepAwake(true);
  end();
  assert.deepEqual(calls, ['start 1', 'stop 1', 'start 2', 'stop 2', 'start 3', 'stop 3']);
});

test('tracked work releases the blocker even when it fails', async () => {
  const { manager } = setup();
  await assert.rejects(manager.trackWork(async () => {
    assert.equal(manager.isKeepingAwake(), true);
    throw new Error('probe failed');
  }));
  assert.equal(manager.isKeepingAwake(), false);
});
