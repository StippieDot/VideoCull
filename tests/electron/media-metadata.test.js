// Runs the bundled FFmpeg/FFprobe against generated clips, so a toolchain or transport change that
// alters what getVideoMetadata reports fails here.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const { ffmpegPath } = require('../../electron/media-tools');
const { processVideos, __test } = require('../../electron/processor');

const execFileAsync = promisify(execFile);
let tempDir;

async function makeClip(name, args) {
  const output = path.join(tempDir, name);
  await execFileAsync(ffmpegPath, ['-v', 'error', '-y', ...args, output], { windowsHide: true });
  return output;
}

function stable(meta) {
  const { metadataCheckedAt, ...rest } = meta;
  assert.equal(typeof metadataCheckedAt, 'number');
  return rest;
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videocull-media-metadata-'));
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('reports codecs, size, frame rate, bitrates and camera date for an MP4 with audio', async () => {
  const clip = await makeClip('h264-aac.mp4', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k',
    '-metadata', 'creation_time=2024-01-02T03:04:05Z',
  ]);

  const meta = stable(await __test.getVideoMetadata(clip));

  assert.equal(meta.videoCodec, 'h264');
  assert.equal(meta.audioCodec, 'aac');
  assert.equal(meta.containerFormat, 'mov,mp4,m4a,3gp,3g2,mj2');
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 240);
  assert.equal(meta.fps, 25);
  assert.equal(meta.creationTime, Date.parse('2024-01-02T03:04:05Z'));
  assert.ok(Math.abs(meta.duration - 2) < 0.1, `duration ${meta.duration}`);
  assert.ok(meta.totalBitrate > 0);
  assert.ok(meta.videoBitrate > 0);
  assert.ok(meta.audioBitrate > 0);
  assert.equal(meta.metadataVersion, 2);
});

test('reports a Matroska file without audio and without a camera date', async () => {
  const clip = await makeClip('mpeg4.mkv', [
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=30',
    '-t', '1', '-c:v', 'mpeg4',
  ]);

  const meta = stable(await __test.getVideoMetadata(clip));

  assert.equal(meta.videoCodec, 'mpeg4');
  assert.equal(meta.audioCodec, null);
  assert.equal(meta.audioBitrate, null);
  assert.equal(meta.containerFormat, 'matroska,webm');
  assert.equal(meta.width, 160);
  assert.equal(meta.height, 120);
  assert.equal(meta.fps, 30);
  assert.equal(meta.creationTime, null);
  assert.ok(Math.abs(meta.duration - 1) < 0.1, `duration ${meta.duration}`);
  // Matroska has no per-stream bitrate, so the total is derived from file size and duration.
  assert.ok(meta.totalBitrate > 0);
});

test('rejects a file that is not a video', async () => {
  const bogus = path.join(tempDir, 'not-a-video.mp4');
  await fs.writeFile(bogus, 'not a real video');

  await assert.rejects(() => __test.getVideoMetadata(bogus));
});

test('extracts every thumbnail slot from a real clip', async () => {
  const clip = await makeClip('thumbs.mp4', [
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25',
    '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  ]);
  const thumbRoot = path.join(tempDir, 'thumbs');
  const ready = [];

  await processVideos(
    [{ id: 'clip', path: clip, filename: 'thumbs.mp4', thumbnails: [], durationSecs: 12 }],
    thumbRoot,
    { thumbsPerVideo: 6, skipIntroDelaySecs: 1, maxConcurrent: 1 },
    null,
    (id, thumbnails) => ready.push({ id, thumbnails }),
  );

  assert.equal(ready.length, 1);
  assert.equal(ready[0].thumbnails.length, 6);
  for (const thumbnail of ready[0].thumbnails) {
    assert.ok((await fs.stat(thumbnail)).size > 0, thumbnail);
  }
});
