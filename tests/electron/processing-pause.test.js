const assert = require('node:assert/strict');
const { ProcessingPauseController } = require('../../electron/processing-pause');

test('reports pausing until active work drains and resumes blocked checkpoints once', async () => {
  const controller = new ProcessingPauseController();
  const states = [];
  controller.subscribe((state) => states.push(state.status));
  const finish = controller.beginActivity();

  assert.deepEqual(controller.pause(), { status: 'pausing' });
  let resumed = 0;
  const waiting = controller.checkpoint().then(() => { resumed += 1; });
  finish();
  assert.deepEqual(controller.getState(), { status: 'paused' });

  controller.resume();
  await waiting;
  assert.equal(resumed, 1);
  assert.deepEqual(states, ['pausing', 'paused', 'running']);
});

test('a cancelled paused checkpoint wakes without resuming other work', async () => {
  const controller = new ProcessingPauseController();
  let cancelled = false;
  controller.pause();
  const waiting = controller.checkpoint(
    () => cancelled,
    () => new Error('stopped'),
  );

  cancelled = true;
  controller.wake();
  await assert.rejects(waiting, /stopped/);
  assert.deepEqual(controller.getState(), { status: 'paused' });
});
