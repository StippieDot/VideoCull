// @ts-check
// Frame layout and per-frame measurements for duplicate fingerprints.
//
// FFmpeg returns each sample as one 64x96 gray frame: the 32x32 primary frame (the one that is hashed
// and compared) in the top-left corner, and below it a 64x64 analysis frame of the same decoded
// picture, which is used to find black bars.

const PRIMARY_SIZE = 32;
const ANALYSIS_SIZE = 64;
const STACKED_FRAME_BYTES = ANALYSIS_SIZE * (PRIMARY_SIZE + ANALYSIS_SIZE);

// Changing this chain changes every hash: raise the fingerprint key version with it.
const PRIMARY_FILTER = 'scale=32:32:flags=bicubic,setsar=1,format=gray';

// Initial values of the black-bar rule, to be confirmed on real libraries.
const BAR_LINE_MAX_LUMA = 24;
const MIN_BAR_LINES = 3;
const MAX_BAR_ASYMMETRY = 1;
const MIN_PICTURE_SHARE = 0.3;

/**
 * Filter chain that turns one video stream into the stacked frame. `suffix` keeps the labels unique
 * when several inputs share a filter graph.
 * @param {string | number} [suffix]
 */
function stackedFrameFilter(suffix = '') {
  const label = (/** @type {string} */ name) => `[${name}${suffix}]`;
  return [
    `split${label('p')}${label('a')}`,
    `${label('p')}${PRIMARY_FILTER},pad=${ANALYSIS_SIZE}:${PRIMARY_SIZE}${label('pp')}`,
    // Area averaging: bicubic overshoots next to a bright edge and would lift a bar line above the limit.
    `${label('a')}scale=${ANALYSIS_SIZE}:${ANALYSIS_SIZE}:flags=area,setsar=1,format=gray${label('aa')}`,
    `${label('pp')}${label('aa')}vstack`,
  ].join(';');
}

/**
 * @param {Buffer} stacked one stacked frame
 * @returns {{ primary: Buffer, analysis: Buffer }}
 */
function splitStackedFrame(stacked) {
  const primary = Buffer.alloc(PRIMARY_SIZE * PRIMARY_SIZE);
  for (let row = 0; row < PRIMARY_SIZE; row++) {
    stacked.copy(primary, row * PRIMARY_SIZE, row * ANALYSIS_SIZE, row * ANALYSIS_SIZE + PRIMARY_SIZE);
  }
  return { primary, analysis: stacked.subarray(ANALYSIS_SIZE * PRIMARY_SIZE, STACKED_FRAME_BYTES) };
}

/** @param {Uint8Array} grayBytes */
function lumaRange(grayBytes) {
  let min = 255;
  let max = 0;
  for (const value of grayBytes) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return grayBytes.length > 0 ? max - min : 0;
}

/**
 * Number of dark lines counted inward from each side of one analysis frame.
 * @param {Uint8Array} analysis
 */
function barLines(analysis) {
  const rowMax = new Uint8Array(ANALYSIS_SIZE);
  const columnMax = new Uint8Array(ANALYSIS_SIZE);
  for (let y = 0; y < ANALYSIS_SIZE; y++) {
    for (let x = 0; x < ANALYSIS_SIZE; x++) {
      const value = analysis[y * ANALYSIS_SIZE + x];
      if (value > rowMax[y]) rowMax[y] = value;
      if (value > columnMax[x]) columnMax[x] = value;
    }
  }
  const leading = (/** @type {Uint8Array} */ lineMax) => {
    let count = 0;
    while (count < ANALYSIS_SIZE && lineMax[count] <= BAR_LINE_MAX_LUMA) count++;
    return count;
  };
  const trailing = (/** @type {Uint8Array} */ lineMax) => {
    let count = 0;
    while (count < ANALYSIS_SIZE && lineMax[ANALYSIS_SIZE - 1 - count] <= BAR_LINE_MAX_LUMA) count++;
    return count;
  };
  return { left: leading(columnMax), top: leading(rowMax), right: trailing(columnMax), bottom: trailing(rowMax) };
}

/**
 * The black border shared by a video's frames, in 64ths of the picture, or null. A border counts
 * only as a symmetric pair (top and bottom, or left and right); a dark area on one side is picture.
 * @param {Uint8Array[]} analysisFrames frames of the decoded, non-dark samples
 * @param {number} minimumFrames how many frames must agree before a border is believed
 */
function detectBorder(analysisFrames, minimumFrames) {
  if (analysisFrames.length < Math.max(1, minimumFrames)) return null;
  const margin = { left: ANALYSIS_SIZE, top: ANALYSIS_SIZE, right: ANALYSIS_SIZE, bottom: ANALYSIS_SIZE };
  for (const frame of analysisFrames) {
    const lines = barLines(frame);
    for (const side of /** @type {const} */ (['left', 'top', 'right', 'bottom'])) {
      margin[side] = Math.min(margin[side], lines[side]);
    }
  }
  const pair = (/** @type {number} */ a, /** @type {number} */ b) => (a >= MIN_BAR_LINES && b >= MIN_BAR_LINES && Math.abs(a - b) <= MAX_BAR_ASYMMETRY ? [a, b] : [0, 0]);
  const [top, bottom] = pair(margin.top, margin.bottom);
  const [left, right] = pair(margin.left, margin.right);
  if (top + left === 0) return null;
  const minPicture = ANALYSIS_SIZE * MIN_PICTURE_SHARE;
  if (ANALYSIS_SIZE - top - bottom < minPicture || ANALYSIS_SIZE - left - right < minPicture) return null;
  return { left, top, right, bottom };
}

/**
 * The picture inside the border as a 32x32 frame, each output pixel the area-weighted average of the
 * analysis pixels it covers.
 * @param {Uint8Array} analysis
 * @param {{ left: number, top: number, right: number, bottom: number }} border
 */
function cropToPrimary(analysis, border) {
  const width = ANALYSIS_SIZE - border.left - border.right;
  const height = ANALYSIS_SIZE - border.top - border.bottom;
  const cropped = Buffer.alloc(PRIMARY_SIZE * PRIMARY_SIZE);
  for (let outY = 0; outY < PRIMARY_SIZE; outY++) {
    const y0 = border.top + (outY * height) / PRIMARY_SIZE;
    const y1 = border.top + ((outY + 1) * height) / PRIMARY_SIZE;
    for (let outX = 0; outX < PRIMARY_SIZE; outX++) {
      const x0 = border.left + (outX * width) / PRIMARY_SIZE;
      const x1 = border.left + ((outX + 1) * width) / PRIMARY_SIZE;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < y1; y++) {
        const rowWeight = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < x1; x++) {
          const weight = rowWeight * (Math.min(x + 1, x1) - Math.max(x, x0));
          sum += analysis[y * ANALYSIS_SIZE + x] * weight;
          area += weight;
        }
      }
      cropped[outY * PRIMARY_SIZE + outX] = Math.round(sum / area);
    }
  }
  return cropped;
}

module.exports = {
  ANALYSIS_SIZE,
  PRIMARY_SIZE,
  STACKED_FRAME_BYTES,
  cropToPrimary,
  detectBorder,
  lumaRange,
  splitStackedFrame,
  stackedFrameFilter,
};
