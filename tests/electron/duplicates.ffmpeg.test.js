const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ffmpegPath } = require('../../electron/media-tools');
const { __test__ } = require('../../electron/duplicates');
const { getSamplingTimestamps } = require('../../electron/duplicate-utils');

const { detectBorder, splitStackedFrame } = require('../../electron/duplicate-frames');

const FRAME_BYTES = 64 * 96;
// Runs only where the bundled FFmpeg has been fetched (npm run fetch:ffmpeg or a dev checkout).
const hasFfmpeg = fs.existsSync(ffmpegPath);

function run(args) {
  return execFileSync(ffmpegPath, args, { windowsHide: true, maxBuffer: 1 << 24 });
}

test.skipIf(!hasFfmpeg)('one FFmpeg call returns every requested sample, identical to single-frame extraction', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-frames-'));
  const clip = path.join(folder, 'clip.mp4');
  try {
    run(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-t', '10', '-pix_fmt', 'yuv420p', clip]);
    for (const count of [1, 2, 3, 4, 5, 7, 9]) {
      const timestamps = Array.from({ length: count }, (_, index) => Math.round(((10 * (index + 1)) / (count + 1)) * 100) / 100);
      const together = run(__test__.buildGrayFramesExtractionArgs(clip, timestamps));
      assert.equal(together.length, count * FRAME_BYTES, `${count} samples`);
      timestamps.forEach((timestamp, index) => {
        const single = run(__test__.buildGrayFramesExtractionArgs(clip, [timestamp]));
        assert.ok(
          single.equals(together.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES)),
          `sample ${index + 1} of ${count}`,
        );
      });
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}, 60_000);

test.skipIf(!hasFfmpeg)('a file and its remux with another time base are sampled at the same frames', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-frames-'));
  const clip = path.join(folder, 'clip.mp4');
  const remux = path.join(folder, 'remux.mp4');
  try {
    // testsrc2 draws a frame counter, so neighbouring frames differ.
    run(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24', '-t', '10', '-pix_fmt', 'yuv420p', clip]);
    run(['-v', 'error', '-i', clip, '-c', 'copy', '-video_track_timescale', '24', remux]);
    const frames = (file, timestamps) => run(__test__.buildGrayFramesExtractionArgs(file, timestamps));
    const aligned = getSamplingTimestamps(10, 9, {}, 24);
    assert.ok(frames(clip, aligned).equals(frames(remux, aligned)));
    // Just after a frame boundary the same seek lands one frame apart; this is what the alignment prevents.
    const unaligned = [1.01, 5.22];
    assert.ok(!frames(clip, unaligned).equals(frames(remux, unaligned)));
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}, 60_000);

test.skipIf(!hasFfmpeg)('the compared 32x32 frame is unchanged by the added analysis frame, which shows the black bars', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-frames-'));
  const clip = path.join(folder, 'letterbox.mp4');
  try {
    // 320x180 picture with 30-pixel bars above and below: 8 of 64 lines each.
    run(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25', '-t', '4', '-vf', 'pad=320:240:0:30', '-pix_fmt', 'yuv420p', clip]);
    const analysisFrames = [];
    for (const timestamp of [1, 2, 3]) {
      const { primary, analysis } = splitStackedFrame(run(__test__.buildGrayFramesExtractionArgs(clip, [timestamp])));
      const before = run(['-v', 'error', '-ss', String(timestamp), '-i', clip, '-frames:v', '1',
        '-vf', 'scale=32:32:flags=bicubic,setsar=1,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', '-threads', '1', 'pipe:1']);
      assert.ok(primary.equals(before), `frame at ${timestamp} s`);
      analysisFrames.push(analysis);
    }
    assert.deepEqual(detectBorder(analysisFrames, 2), { left: 0, top: 8, right: 0, bottom: 8 });
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}, 60_000);
