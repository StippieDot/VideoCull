const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { CACHE_UNAVAILABLE_CODE } = require('../../electron/cache-service');
const { normalizeDuplicateSettings } = require('../../electron/duplicate-utils');
const { processingPause } = require('../../electron/processing-pause');

const FRAME_BYTES = 64 * 96;
const modulePaths = ['duplicates', 'media-process'].map((name) => require.resolve(`../../electron/${name}`));

// FFmpeg is started through a destructured `spawn`, so the fake has to be in place while the
// modules load. Both modules are dropped from the cache again so other tests get the real thing.
function loadDuplicatesWithFakeFfmpeg(onStart = (child) => {
  child.stdout.emit('data', Buffer.alloc(FRAME_BYTES));
  child.emit('close', 0, null);
}) {
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGKILL'));
    setImmediate(() => onStart(child, args));
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

function backfillSetup(duplicates, cacheAccess, videos = [video('a'), video('b'), video('c')], settingsInput = {}) {
  const settings = normalizeDuplicateSettings({ comparisonMode: 'phash', sampleCount: 1, ...settingsInput });
  const duplicateState = {
    fingerprintKey: 'key',
    completeById: new Map(),
    failedIds: new Set(),
    comparisonRows: [],
  };
  const run = duplicates.createDuplicateRun();
  const backfill = () => duplicates.__test__.backfillFingerprints(
    videos,
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

// FFmpeg stand-in that answers by the requested times. The combined call returns nothing, which sends
// extraction to one call per sample; such a call returns a frame unless `noFrameAt(seconds)` says no.
function ffmpegByTimestamp(noFrameAt, seeks = []) {
  return (child, args) => {
    const times = args.flatMap((arg, index) => (arg === '-ss' ? [Number(args[index + 1])] : []));
    if (times.length === 1) {
      seeks.push(times[0]);
      if (!noFrameAt(times[0])) child.stdout.emit('data', Buffer.alloc(FRAME_BYTES, 128));
    }
    child.emit('close', 0, null);
  };
}

function refusedWrite() {
  return Object.assign(new Error('Cache folder is unavailable during a destructive transition'), {
    code: CACHE_UNAVAILABLE_CODE,
  });
}

test('excess FFmpeg output stops extraction without saving partial fingerprints', async () => {
  const killed = [];
  const duplicates = loadDuplicatesWithFakeFfmpeg((child) => {
    const kill = child.kill;
    child.kill = (signal) => { killed.push(signal); return kill(); };
    child.stdout.emit('data', Buffer.alloc(FRAME_BYTES + 1));
    if (killed.length === 0) child.emit('close', 0, null);
  });
  const saved = [];
  const failed = [];
  const cacheAccess = {
    saveVideoFingerprints: async (_folder, _options, id) => { saved.push(id); },
    markFingerprintFailure: async (_folder, _options, id) => { failed.push(id); },
  };
  const { backfill } = backfillSetup(duplicates, cacheAccess, [video('a')]);

  await backfill();

  assert.deepEqual(saved, []);
  assert.deepEqual(failed, ['a']);
  assert.deepEqual(killed, ['SIGKILL']);
});

test('a hung duplicate extraction is killed after 120 seconds and not stored as a failure', async () => {
  vi.useFakeTimers();
  const children = [];
  const duplicates = loadDuplicatesWithFakeFfmpeg((child) => {
    vi.spyOn(child, 'kill');
    children.push(child);
  });
  const failed = [];
  const { run, duplicateState, backfill } = backfillSetup(duplicates, {
    saveVideoFingerprints: async () => assert.fail('A hung extraction cannot save fingerprints'),
    markFingerprintFailure: async (_folder, _options, id) => { failed.push(id); },
  }, [video('a')]);
  let completed = false;
  const pending = backfill().then(() => { completed = true; }, () => {});
  try {
    await vi.advanceTimersByTimeAsync(119_999);
    assert.equal(children.length, 1);
    assert.equal(children[0].kill.mock.calls.length, 0);
    await vi.advanceTimersByTimeAsync(2);
    await vi.runAllTimersAsync();
    await pending;
    // A timeout says the drive was slow, not that the video is unreadable, so it is tried again next time.
    assert.deepEqual(failed, []);
    assert.equal(duplicateState.failedIds.size, 0);
    assert.equal(completed, true);
    assert.deepEqual(children[0].kill.mock.calls, [['SIGKILL']]);
    assert.equal(run.cancelled, false);
  } finally {
    run.cancel();
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();
  }
});

test('cancelling extraction kills only that duplicate run and records no fingerprint failure', async () => {
  const children = [];
  const duplicates = loadDuplicatesWithFakeFfmpeg((child) => {
    vi.spyOn(child, 'kill');
    children.push(child);
  });
  const saved = [];
  const failed = [];
  const cacheAccess = {
    saveVideoFingerprints: async (_folder, _options, id) => { saved.push(id); },
    markFingerprintFailure: async (_folder, _options, id) => { failed.push(id); },
  };
  const first = backfillSetup(duplicates, cacheAccess, [video('a')]);
  const second = backfillSetup(duplicates, cacheAccess, [video('b')]);
  const cancelled = first.backfill().catch((error) => error);
  const other = second.backfill();
  try {
    await vi.waitFor(() => assert.equal(children.length, 2));
    first.run.cancel();
    children[1].stdout.emit('data', Buffer.alloc(FRAME_BYTES));
    children[1].emit('close', 0, null);

    assert.ok(await cancelled instanceof duplicates.DuplicateCancelledError);
    await other;
    assert.deepEqual(saved, ['b']);
    assert.deepEqual(failed, []);
    assert.deepEqual(children[0].kill.mock.calls, [['SIGKILL']]);
    assert.equal(children[1].kill.mock.calls.length, 0);
  } finally {
    first.run.cancel();
    second.run.cancel();
    await Promise.allSettled([cancelled, other]);
  }
});

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

test('a sample position without a frame is retried nearby and otherwise stored as unreadable', async () => {
  const seeks = [];
  // Samples are at 25, 50 and 75 s: 50 s itself fails, and nothing decodes around 75 s.
  const duplicates = loadDuplicatesWithFakeFfmpeg(ffmpegByTimestamp((time) => time === 50 || (time > 74 && time < 76), seeks));
  const saved = [];
  const failed = [];
  const { duplicateState, backfill } = backfillSetup(duplicates, {
    saveVideoFingerprints: async (_folder, _options, id, fingerprints) => { saved.push({ id, fingerprints }); },
    markFingerprintFailure: async (_folder, _options, id) => { failed.push(id); },
  }, [video('a')], { sampleCount: 3 });

  await backfill();

  assert.deepEqual(seeks, [25, 50, 50.25, 75, 75.25, 74.75, 75.75, 74.25]);
  assert.deepEqual(failed, []);
  assert.equal(saved.length, 1);
  const [first, second, third] = saved[0].fingerprints;
  assert.equal(first.sampleState, undefined);
  assert.equal(second.timestampSecs, 50.25, 'a retried sample keeps the time it was read at');
  assert.match(second.phashHex, /^[0-9a-f]{16}$/);
  assert.deepEqual(
    { state: third.sampleState, hash: third.phashHex, bytes: third.grayBytes.length, time: third.timestampSecs },
    { state: 'unreadable', hash: '', bytes: 0, time: 75 },
  );
  assert.equal(duplicateState.completeById.get('a'), true);
  assert.deepEqual(duplicateState.comparisonRows.map((row) => row.sample_state), [null, null, 'unreadable']);
});

test('a video without a single readable sample is recorded as failed', async () => {
  const duplicates = loadDuplicatesWithFakeFfmpeg(ffmpegByTimestamp(() => true));
  const saved = [];
  const failed = [];
  const { backfill } = backfillSetup(duplicates, {
    saveVideoFingerprints: async (_folder, _options, id) => { saved.push(id); },
    markFingerprintFailure: async (_folder, _options, id) => { failed.push(id); },
  }, [video('a')], { sampleCount: 3 });

  await backfill();

  assert.deepEqual(saved, []);
  assert.deepEqual(failed, ['a']);
});

test('stored samples are read again when the video is now sampled at other times', async () => {
  const { getSamplingTimestamps } = require('../../electron/duplicate-utils');
  const settings = normalizeDuplicateSettings({ comparisonMode: 'phash', sampleCount: 3 });
  // Read before the frame rate was known, then at the frame-aligned times, one of them retried.
  const withoutRate = getSamplingTimestamps(100, 3, settings, null);
  const current = getSamplingTimestamps(100, 3, settings, 25);
  assert.notDeepEqual(withoutRate, current);
  for (const [times, expected] of [[withoutRate, ['a']], [[current[0], current[1] + 0.25, current[2]], []]]) {
    const duplicates = loadDuplicatesWithFakeFfmpeg();
    const saved = [];
    const { duplicateState, backfill } = backfillSetup(duplicates, {
      saveVideoFingerprints: async (_folder, _options, id) => { saved.push(id); },
      markFingerprintFailure: async () => {},
    }, [{ ...video('a'), fps: 25 }], { sampleCount: 3 });
    duplicateState.completeById.set('a', true);
    duplicateState.comparisonRows.push(...times.map((time, index) => ({ video_id: 'a', sample_index: index, timestamp_secs: time, phash_hex: '0123456789abcdef' })));

    await backfill();

    assert.deepEqual(saved, expected, `times ${times.join(', ')}`);
  }
});

test('a video with an unreadable sample is read again only when retrying failed extractions', async () => {
  for (const [retryFailedFingerprintExtraction, expected] of [[false, []], [true, ['a']]]) {
    const duplicates = loadDuplicatesWithFakeFfmpeg();
    const saved = [];
    const { duplicateState, backfill } = backfillSetup(duplicates, {
      saveVideoFingerprints: async (_folder, _options, id) => { saved.push(id); },
      markFingerprintFailure: async () => {},
    }, [video('a')], { retryFailedFingerprintExtraction });
    duplicateState.completeById.set('a', true);
    duplicateState.comparisonRows.push({ video_id: 'a', sample_index: 0, phash_hex: '', sample_state: 'unreadable' });

    await backfill();

    assert.deepEqual(saved, expected, `retry ${retryFailedFingerprintExtraction}`);
  }
});
