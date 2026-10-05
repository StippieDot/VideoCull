const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mediaProcess = require('../../electron/media-process');

const { processVideos, processMetadata, cancelMetadata, cancelThumbnails, __test } = require('../../electron/processor');
const { processingPause } = require('../../electron/processing-pause');

test('videos under 10 seconds only expect one thumbnail', () => {
  assert.equal(__test.expectedThumbnailCount(9.99, 6, 3), 1);
  assert.equal(__test.expectedThumbnailCount(10, 6, 3), 6);
});

test('videos under 10 seconds still generate the normal thumbnail count when capture range is valid', () => {
  assert.equal(__test.calculateTimestamps(9, 6, 3).length, 6);
});

test('videos shorter than the intro skip still generate one midpoint timestamp', () => {
  assert.deepEqual(__test.calculateTimestamps(2, 6, 3), [1]);
});

test('thumbnail cancellation marks the active thumbnail run token', async () => {
  await processVideos([], 'D:\\thumbs', {}, null, null);
  const token = __test.getThumbToken();

  assert.equal(token?.cancelled, false);
  cancelThumbnails();
  assert.equal(token?.cancelled, true);
});

test('thumbnail reuse requires the exact expected filenames and nonempty files', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-thumb-reuse-'));

  try {
    await fs.writeFile(path.join(tempDir, 'thumb_01.jpg'), 'one');
    await fs.writeFile(path.join(tempDir, 'thumb_02.jpg'), 'two');
    assert.deepEqual(
      await __test.getReusableThumbnailPaths(['thumb_02.jpg', 'thumb_01.jpg'], tempDir, 2),
      [path.join(tempDir, 'thumb_01.jpg'), path.join(tempDir, 'thumb_02.jpg')]
    );

    await fs.writeFile(path.join(tempDir, 'thumb_02.jpg'), '');
    assert.equal(await __test.getReusableThumbnailPaths(['thumb_01.jpg', 'thumb_02.jpg'], tempDir, 2), null);

    await fs.writeFile(path.join(tempDir, 'thumb_02.jpg'), 'two');
    assert.equal(
      await __test.getReusableThumbnailPaths(['thumb_01.jpg', 'thumb_02.jpg', 'stale.jpg'], tempDir, 2),
      null
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('cancelling metadata during a running probe cancels that probe and suppresses its callbacks', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-cancel-'));
  const videoPath = path.join(tempDir, 'clip.mp4');
  await fs.writeFile(videoPath, 'not a real video');
  const originalProbe = mediaProcess.probe;

  try {
    let probeToken = null;
    let finishProbe;
    let signalProbeStarted;
    const probeStarted = new Promise((resolve) => { signalProbeStarted = resolve; });
    mediaProcess.probe = (_filePath, token) => {
      probeToken = token;
      signalProbeStarted();
      return new Promise((resolve) => { finishProbe = resolve; });
    };

    let progressCount = 0;
    let readyCount = 0;
    let failedCount = 0;
    const run = processMetadata([
      { id: 'a', path: videoPath, filename: 'clip.mp4', thumbnails: [], durationSecs: null },
    ], {}, () => {
      progressCount += 1;
    }, () => {
      readyCount += 1;
    }, () => {
      failedCount += 1;
    });
    await probeStarted;
    assert.equal(probeToken.cancelled, false);

    cancelMetadata();
    assert.equal(probeToken.cancelled, true, 'the running probe receives the cancellation');

    // A probe that still completes after cancellation must not be reported.
    finishProbe({ format: { duration: 12, tags: {} }, streams: [] });
    await run;

    assert.equal(progressCount, 0);
    assert.equal(readyCount, 0);
    assert.equal(failedCount, 0);
  } finally {
    mediaProcess.probe = originalProbe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('metadata pause blocks new probes and resumes the queue once', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-pause-'));
  const videoPath = path.join(tempDir, 'clip.mp4');
  await fs.writeFile(videoPath, 'not a real video');
  const originalProbe = mediaProcess.probe;
  let probeCount = 0;

  try {
    mediaProcess.probe = async () => {
      probeCount += 1;
      return { format: { duration: 12, tags: {} }, streams: [] };
    };
    processingPause.pause();
    const run = processMetadata([
      { id: 'a', path: videoPath, filename: 'clip.mp4', thumbnails: [], durationSecs: null },
    ], {}, null, () => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(probeCount, 0);
    assert.deepEqual(processingPause.getState(), { status: 'paused' });

    processingPause.resume();
    await run;
    assert.equal(probeCount, 1);
  } finally {
    processingPause.resume();
    mediaProcess.probe = originalProbe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('metadata probe failures are reported so the retry backoff can be recorded', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-failure-'));
  const videoPath = path.join(tempDir, 'broken.mp4');
  await fs.writeFile(videoPath, 'not a real video');
  const originalProbe = mediaProcess.probe;

  try {
    mediaProcess.probe = async () => { throw new Error('ffprobe failed'); };

    const readyIds = [];
    const failed = [];
    await processMetadata([
      { id: 'broken', path: videoPath, filename: 'broken.mp4', thumbnails: [], durationSecs: null },
    ], {}, null, (videoId) => {
      readyIds.push(videoId);
    }, (videoId, error) => {
      failed.push({ videoId, message: error.message });
    });

    assert.deepEqual(readyIds, []);
    assert.deepEqual(failed, [{ videoId: 'broken', message: 'ffprobe failed' }]);
  } finally {
    mediaProcess.probe = originalProbe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('a timed-out frame stops every further extraction attempt for that video', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-thumb-timeout-'));
  const originalRunFfmpeg = mediaProcess.runFfmpeg;
  const timeouts = [];

  try {
    mediaProcess.runFfmpeg = async (_args, _token, options) => {
      timeouts.push(options.timeoutMs);
      throw Object.assign(new Error('ffmpeg.exe timed out'), { code: 'ETIMEDOUT' });
    };
    const ready = [];
    const progress = [];

    await processVideos(
      [{ id: 'hung', path: path.join(tempDir, 'hung.mp4'), filename: 'hung.mp4', thumbnails: [], durationSecs: 120 }],
      tempDir,
      { thumbsPerVideo: 6, maxConcurrent: 1 },
      (data) => progress.push(data),
      (id, thumbnails) => ready.push({ id, thumbnails }),
    );

    // One attempt only: no offset retries, no remaining slots, no t=0 fallback.
    assert.equal(timeouts.length, 1);
    assert.ok(timeouts[0] > 0 && timeouts[0] <= 120_000);
    // The video still completes (without thumbnails) so the run moves on.
    assert.deepEqual(ready, [{ id: 'hung', thumbnails: [] }]);
    assert.deepEqual(progress, [{ current: 1, total: 1 }]);
  } finally {
    mediaProcess.runFfmpeg = originalRunFfmpeg;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('the extraction budget counts only time spent extracting, not pauses between frames', async () => {
  const originalRunFfmpeg = mediaProcess.runFfmpeg;
  const originalNow = Date.now;
  let now = 1_000_000;
  const timeouts = [];
  try {
    Date.now = () => now;
    const budget = __test.createExtractionBudget();
    // Ten minutes paused before the next frame.
    now += 10 * 60_000;
    mediaProcess.runFfmpeg = async (_args, _token, options) => {
      timeouts.push(options.timeoutMs);
      now += 200_000;
      if (timeouts.length === 1) throw new Error('decode error');
    };
    const token = { cancelled: false };
    assert.equal(await __test.extractFrame('a.mp4', 10, 'out.jpg', {}, token, budget), 'out.jpg');
    // Full per-frame limit first, then what is left of the 5 minutes after one 200 s attempt.
    assert.deepEqual(timeouts, [120_000, 100_000]);
    assert.equal(budget.remainingMs, 300_000 - 400_000);
  } finally {
    Date.now = originalNow;
    mediaProcess.runFfmpeg = originalRunFfmpeg;
  }
});

test('an epoch-zero creation date is treated as no camera date', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-epoch-'));
  const videoPath = path.join(tempDir, 'old.wmv');
  await fs.writeFile(videoPath, 'not a real video');
  const originalProbe = mediaProcess.probe;
  try {
    const probeWithDate = (creation_time) => async () => ({ format: { duration: 5, tags: { creation_time } }, streams: [] });

    mediaProcess.probe = probeWithDate('1970-01-01T00:00:00.000000Z');
    assert.equal((await __test.getVideoMetadata(videoPath)).creationTime, null);

    mediaProcess.probe = probeWithDate('2024-01-02T03:04:05.000000Z');
    assert.equal((await __test.getVideoMetadata(videoPath)).creationTime, Date.parse('2024-01-02T03:04:05Z'));
  } finally {
    mediaProcess.probe = originalProbe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
