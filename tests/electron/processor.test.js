const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('fluent-ffmpeg');

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

test('metadata cancellation suppresses callbacks after an in-flight probe finishes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-cancel-'));
  const videoPath = path.join(tempDir, 'clip.mp4');
  await fs.writeFile(videoPath, 'not a real video');
  const originalFfprobe = ffmpeg.ffprobe;

  try {
    ffmpeg.ffprobe = (_filePath, callback) => {
      setTimeout(() => callback(null, {
        format: { duration: 12, bit_rate: '1200', tags: {} },
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 320, height: 240, avg_frame_rate: '25/1' }],
      }), 20);
    };

    let progressCount = 0;
    let readyCount = 0;
    const run = processMetadata([
      { id: 'a', path: videoPath, filename: 'clip.mp4', thumbnails: [], durationSecs: null },
    ], {}, () => {
      progressCount += 1;
    }, () => {
      readyCount += 1;
    });
    cancelMetadata();
    await run;

    assert.equal(progressCount, 0);
    assert.equal(readyCount, 0);
  } finally {
    ffmpeg.ffprobe = originalFfprobe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('metadata pause blocks new probes and resumes the queue once', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-pause-'));
  const videoPath = path.join(tempDir, 'clip.mp4');
  await fs.writeFile(videoPath, 'not a real video');
  const originalFfprobe = ffmpeg.ffprobe;
  let probeCount = 0;

  try {
    ffmpeg.ffprobe = (_filePath, callback) => {
      probeCount += 1;
      callback(null, { format: { duration: 12, tags: {} }, streams: [] });
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
    ffmpeg.ffprobe = originalFfprobe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('metadata probe failures are reported so the retry backoff can be recorded', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-metadata-failure-'));
  const videoPath = path.join(tempDir, 'broken.mp4');
  await fs.writeFile(videoPath, 'not a real video');
  const originalFfprobe = ffmpeg.ffprobe;

  try {
    ffmpeg.ffprobe = (_filePath, callback) => callback(new Error('ffprobe failed'));

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
    ffmpeg.ffprobe = originalFfprobe;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
