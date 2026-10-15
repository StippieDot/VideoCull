const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { CACHE_UNAVAILABLE_CODE } = require('../../electron/cache-service');
const { normalizeDuplicateSettings } = require('../../electron/duplicate-utils');
const { processingPause } = require('../../electron/processing-pause');

const FRAME_BYTES = 32 * 32;
const modulePaths = ['duplicates', 'media-process'].map((name) => require.resolve(`../../electron/${name}`));

// FFmpeg is started through a destructured `spawn`, so the fake has to be in place while the
// modules load. Both modules are dropped from the cache again so other tests get the real thing.
function loadDuplicatesWithFakeFfmpeg() {
  const realSpawn = childProcess.spawn;
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGKILL'));
    setImmediate(() => {
      child.stdout.emit('data', Buffer.alloc(FRAME_BYTES));
      child.emit('close', 0, null);
    });
    return child;
  };
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  try {
    return require('../../electron/duplicates');
  } finally {
    childProcess.spawn = realSpawn;
    for (const modulePath of modulePaths) delete require.cache[modulePath];
  }
}

function video(id) {
  return { id, filename: `${id}.mp4`, path: `P:\\${id}.mp4`, durationSecs: 100 };
}

function backfillSetup(duplicates, cacheAccess) {
  const settings = normalizeDuplicateSettings({ comparisonMode: 'phash', sampleCount: 1 });
  const duplicateState = {
    fingerprintKey: 'key',
    completeById: new Map(),
    failedIds: new Set(),
    comparisonRows: [],
  };
  const run = duplicates.createDuplicateRun();
  const backfill = () => duplicates.__test__.backfillFingerprints(
    [video('a'), video('b'), video('c')],
    duplicateState,
    settings,
    run,
    undefined,
    2,
    {},
    cacheAccess,
    {},
  );
  return { run, duplicateState, backfill };
}

function refusedWrite() {
  return Object.assign(new Error('Cache folder is unavailable during a destructive transition'), {
    code: CACHE_UNAVAILABLE_CODE,
  });
}

test('a fingerprint write refused by the cache stops the run like a cancellation', async () => {
  const duplicates = loadDuplicatesWithFakeFfmpeg();
  const failureMarks = [];
  const cacheAccess = {
    saveVideoFingerprints: async () => { throw refusedWrite(); },
    markFingerprintFailure: async (...args) => { failureMarks.push(args); },
  };
  const { run, duplicateState, backfill } = backfillSetup(duplicates, cacheAccess);

  await assert.rejects(backfill(), duplicates.DuplicateCancelledError);

  assert.equal(run.cancelled, true);
  assert.deepEqual(failureMarks, []);
  assert.equal(duplicateState.failedIds.size, 0);
});

test('other fingerprint write errors still count as a failure of that video', async () => {
  const duplicates = loadDuplicatesWithFakeFfmpeg();
  const failureMarks = [];
  const cacheAccess = {
    saveVideoFingerprints: async () => { throw new Error('disk full'); },
    markFingerprintFailure: async (_folder, _options, videoId) => { failureMarks.push(videoId); },
  };
  const { run, duplicateState, backfill } = backfillSetup(duplicates, cacheAccess);

  await backfill();

  assert.equal(run.cancelled, false);
  assert.deepEqual(failureMarks.sort(), ['a', 'b', 'c']);
  assert.deepEqual([...duplicateState.failedIds].sort(), ['a', 'b', 'c']);
});

test('cancelling a duplicate run leaves a user pause in place', () => {
  const duplicates = loadDuplicatesWithFakeFfmpeg();
  const run = duplicates.createDuplicateRun();
  processingPause.pause();
  try {
    run.cancel();
    assert.notEqual(processingPause.getState().status, 'running');
  } finally {
    processingPause.resume();
  }
});
