const assert = require('node:assert/strict');
const {
  STACKED_FRAME_BYTES,
  cropToPrimary,
  detectBorder,
  lumaRange,
  splitStackedFrame,
  stackedFrameFilter,
} = require('../../electron/duplicate-frames');

const SIZE = 64;

/** A 64x64 frame of mid gray with dark lines counted inward from each side. */
function frameWithBars({ left = 0, top = 0, right = 0, bottom = 0 } = {}) {
  const frame = Buffer.alloc(SIZE * SIZE, 120);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < left || x >= SIZE - right || y < top || y >= SIZE - bottom) frame[y * SIZE + x] = 10;
    }
  }
  return frame;
}

test('a stacked frame splits into the 32x32 compared frame and the 64x64 analysis frame', () => {
  const stacked = Buffer.alloc(STACKED_FRAME_BYTES);
  for (let row = 0; row < 32; row++) {
    for (let column = 0; column < 64; column++) stacked[row * 64 + column] = column < 32 ? row + column : 255;
  }
  stacked.fill(7, 64 * 32);

  const { primary, analysis } = splitStackedFrame(stacked);

  assert.equal(primary.length, 32 * 32);
  assert.equal(primary[0], 0);
  assert.equal(primary[31], 31);
  assert.equal(primary[32 * 31 + 31], 62);
  assert.ok(!primary.includes(255), 'the padding beside the compared frame is left out');
  assert.equal(analysis.length, 64 * 64);
  assert.ok(analysis.every((value) => value === 7));
});

test('filter labels are unique per input', () => {
  assert.notEqual(stackedFrameFilter(0), stackedFrameFilter(1));
  assert.ok(stackedFrameFilter(2).includes('[pp2][aa2]vstack'));
});

test('luma range is the highest minus the lowest value', () => {
  assert.equal(lumaRange(Buffer.from([40, 90, 41])), 50);
  assert.equal(lumaRange(Buffer.alloc(16, 200)), 0);
  assert.equal(lumaRange(Buffer.alloc(0)), 0);
});

test('letterbox and pillarbox bars are found as symmetric pairs', () => {
  const letterbox = frameWithBars({ top: 8, bottom: 8 });
  assert.deepEqual(detectBorder([letterbox, letterbox], 2), { left: 0, top: 8, right: 0, bottom: 8 });
  // One line of difference between the two sides is allowed.
  const pillarbox = frameWithBars({ left: 6, right: 7 });
  assert.deepEqual(detectBorder([pillarbox, pillarbox], 2), { left: 6, top: 0, right: 7, bottom: 0 });
});

test('the border is the smallest margin seen in any frame', () => {
  assert.deepEqual(
    detectBorder([frameWithBars({ top: 8, bottom: 8 }), frameWithBars({ top: 6, bottom: 6 })], 2),
    { left: 0, top: 6, right: 0, bottom: 6 },
  );
  // A frame without bars means the dark edges of the other frame were picture.
  assert.equal(detectBorder([frameWithBars({ top: 8, bottom: 8 }), frameWithBars()], 2), null);
});

test('a dark area on one side only is not a border', () => {
  const oneSide = frameWithBars({ top: 10 });
  assert.equal(detectBorder([oneSide, oneSide], 2), null);
  const uneven = frameWithBars({ left: 10, right: 4 });
  assert.equal(detectBorder([uneven, uneven], 2), null);
});

test('a bright object inside a bar ends the bar there', () => {
  const withLogo = frameWithBars({ top: 8, bottom: 8 });
  withLogo[3 * SIZE + 20] = 200;
  assert.equal(detectBorder([withLogo, frameWithBars({ top: 8, bottom: 8 })], 2), null);
});

test('margins that are too small or leave too little picture are rejected', () => {
  const thin = frameWithBars({ top: 2, bottom: 2 });
  assert.equal(detectBorder([thin, thin], 2), null);
  const mostlyBars = frameWithBars({ top: 23, bottom: 23 });
  assert.equal(detectBorder([mostlyBars, mostlyBars], 2), null);
});

test('a border needs the required number of frames', () => {
  const letterbox = frameWithBars({ top: 8, bottom: 8 });
  assert.equal(detectBorder([letterbox], 2), null);
  assert.deepEqual(detectBorder([letterbox], 1), { left: 0, top: 8, right: 0, bottom: 8 });
  assert.equal(detectBorder([], 1), null);
});

test('cropping keeps only the picture inside the border', () => {
  const cropped = cropToPrimary(frameWithBars({ top: 8, bottom: 8, left: 5, right: 5 }), { left: 5, top: 8, right: 5, bottom: 8 });
  assert.equal(cropped.length, 32 * 32);
  assert.ok(cropped.every((value) => value === 120));
});

test('cropping averages the analysis pixels each output pixel covers', () => {
  const gradient = Buffer.alloc(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) gradient[y * SIZE + x] = x * 2;
  }
  // Without a border every output pixel covers two columns: (4x + 4x + 2) / 2.
  const halved = cropToPrimary(gradient, { left: 0, top: 0, right: 0, bottom: 0 });
  assert.deepEqual([...halved.subarray(0, 4)], [1, 5, 9, 13]);
  // 48 columns onto 32: the first output pixel covers column 8 and half of column 9.
  const narrowed = cropToPrimary(gradient, { left: 8, top: 0, right: 8, bottom: 0 });
  assert.equal(narrowed[0], Math.round((16 + 18 * 0.5) / 1.5));
});
