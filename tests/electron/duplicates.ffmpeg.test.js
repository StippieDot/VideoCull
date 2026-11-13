const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ffmpegPath } = require('../../electron/media-tools');
const { __test__ } = require('../../electron/duplicates');

const FRAME_BYTES = 32 * 32;
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
