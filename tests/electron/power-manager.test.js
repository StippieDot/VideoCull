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

function setupWithFinish() {
  const timers = new Map();
  let nextTimer = 1;
  let clock = 0;
  const performed = [];
  const manager = createPowerManager({
    startBlocker: () => 1,
    stopBlocker: () => {},
    isPaused: () => false,
    performFinishAction: (action) => performed.push(action),
    setTimer: (callback, ms) => {
      const id = nextTimer++;
      timers.set(id, { callback, at: clock + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    now: () => clock,
    idleGraceMs: 15_000,
    countdownMs: 60_000,
  });
  // Runs due timers in time order, including timers that earlier callbacks schedule.
  const advance = (ms) => {
    const target = clock + ms;
    for (;;) {
      const [due] = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at);
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].callback();
    }
    clock = target;
  };
  return { manager, performed, advance };
}

test('the finish action runs once after processing stays idle, then resets', () => {
  const { manager, performed, advance } = setupWithFinish();
  const endMetadata = manager.beginWork();
  assert.equal(manager.setFinishAction('sleep').finishAction, 'sleep');
  endMetadata();

  // The next stage starts within the grace period: nothing happens yet.
  advance(5_000);
  const endThumbnails = manager.beginWork();
  advance(30_000);
  endThumbnails();

  advance(15_000);
  assert.deepEqual(manager.getState().countdown, { action: 'sleep', endsAt: 50_000 + 60_000 });
  advance(60_000);
  assert.deepEqual(performed, ['sleep']);
  assert.equal(manager.getState().finishAction, 'none');

  // A later run does not trigger it again.
  manager.beginWork()();
  advance(120_000);
  assert.deepEqual(performed, ['sleep']);
});

test('the finish action can only be chosen while processing runs', () => {
  const { manager } = setupWithFinish();
  assert.equal(manager.setFinishAction('shutdown').finishAction, 'none');
  const end = manager.beginWork();
  assert.equal(manager.setFinishAction('reboot').finishAction, 'none');
  assert.equal(manager.setFinishAction('shutdown').finishAction, 'shutdown');
  end();
});

test('cancelling during the countdown disarms the finish action', () => {
  const { manager, performed, advance } = setupWithFinish();
  const end = manager.beginWork();
  manager.setFinishAction('shutdown');
  end();
  advance(15_000 + 30_000);
  assert.notEqual(manager.getState().countdown, null);
  manager.cancelFinishAction();
  advance(120_000);
  assert.deepEqual(performed, []);
  assert.deepEqual(manager.getState(), { processing: false, finishAction: 'none', countdown: null });
});

test('work that starts during the countdown postpones the finish action', () => {
  const { manager, performed, advance } = setupWithFinish();
  const endScan = manager.beginWork();
  manager.setFinishAction('sleep');
  endScan();
  advance(15_000 + 30_000);
  const endRescan = manager.beginWork();
  assert.deepEqual(manager.getState(), { processing: true, finishAction: 'sleep', countdown: null });
  advance(200_000);
  assert.deepEqual(performed, []);
  endRescan();
  advance(15_000 + 60_000);
  assert.deepEqual(performed, ['sleep']);
});

test('shutdown never forces apps with unsaved work to close, and sleep does not hibernate', () => {
  const { powerCommand } = require('../../electron/system-power');
  const shutdown = powerCommand('shutdown');
  assert.match(shutdown.file, /System32[\\/]shutdown\.exe$/i);
  assert.deepEqual(shutdown.args, ['/s', '/t', '0']);
  const sleep = powerCommand('sleep');
  assert.match(sleep.args.at(-1), /SetSuspendState\('Suspend', \$false, \$false\)/);
});
