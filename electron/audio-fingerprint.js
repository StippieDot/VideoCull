// Sound fingerprint for partial clip detection: one 32-bit word per analysis frame of the first audio
// track, mono at 11,025 Hz. Each word records which of 32 fixed pairs of pitch classes is the louder
// one, so it survives re-encoding and volume changes. Measured on the test collection: related excerpts
// match at 94–98 % of bits at the right offset, unrelated sound at most about 60 %.

const SAMPLE_RATE = 11025;
const FRAME_SIZE = 4096;
// About 8.08 words per second.
const HOP_SIZE = 1365;
const WORDS_PER_SECOND = SAMPLE_RATE / HOP_SIZE;
// Bump when the words of the same sound would change.
const AUDIO_FINGERPRINT_KEY = 'chroma32-h1365-v1';
// At least this share of zero words: the track is silent.
const SILENT_ZERO_SHARE = 0.5;
// Below this share of distinct words the track repeats one sound (a tone, a drone). Measured: 0.02 for
// a tone, 0.83 and more for speech and music.
const REPETITIVE_DISTINCT_SHARE = 0.2;
const SILENCE_ENERGY = 1e-10;

const HANN = Float64Array.from({ length: FRAME_SIZE }, (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1))));
// Pitch class of each FFT bin between 27.5 Hz (A0) and 3520 Hz, or -1 outside that range.
const PITCH_CLASS_OF_BIN = Int8Array.from({ length: FRAME_SIZE / 2 }, (_, i) => {
  const frequency = (i * SAMPLE_RATE) / FRAME_SIZE;
  if (i === 0 || frequency < 27.5 || frequency > 3520) return -1;
  return Math.floor(12 * Math.log2(frequency / 27.5)) % 12;
});
// The 32 comparisons: neighbouring classes, a minor third apart, and a tritone apart.
const PAIRS = [
  ...Array.from({ length: 12 }, (_, i) => [i, (i + 1) % 12]),
  ...Array.from({ length: 12 }, (_, i) => [i, (i + 3) % 12]),
  ...Array.from({ length: 8 }, (_, i) => [i, (i + 6) % 12]),
];
const SMOOTHING = [0.25, 0.5, 1, 0.5, 0.25];

// In-place radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/**
 * Turns signed 16-bit little-endian mono PCM, pushed in chunks of any size, into words. The words do
 * not depend on how the input was chunked.
 */
function createAudioWordStream() {
  let samples = new Float64Array(FRAME_SIZE * 4);
  let sampleCount = 0;
  let carry = null;
  const chromas = [];
  const words = [];
  const re = new Float64Array(FRAME_SIZE);
  const im = new Float64Array(FRAME_SIZE);

  function chromaOfFrame(offset) {
    for (let i = 0; i < FRAME_SIZE; i++) {
      re[i] = samples[offset + i] * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    const chroma = new Float64Array(12);
    for (let i = 1; i < FRAME_SIZE / 2; i++) {
      const pitchClass = PITCH_CLASS_OF_BIN[i];
      if (pitchClass >= 0) chroma[pitchClass] += re[i] * re[i] + im[i] * im[i];
    }
    return chroma;
  }

  function emitWord() {
    const smoothed = new Float64Array(12);
    for (let t = 0; t < SMOOTHING.length; t++) {
      for (let j = 0; j < 12; j++) smoothed[j] += chromas[t][j] * SMOOTHING[t];
    }
    let energy = 0;
    for (let j = 0; j < 12; j++) energy += smoothed[j] * smoothed[j];
    let word = 0;
    // Silence stays 0, which the search treats as no information.
    if (energy >= SILENCE_ENERGY) {
      for (let b = 0; b < PAIRS.length; b++) if (smoothed[PAIRS[b][0]] > smoothed[PAIRS[b][1]]) word |= 1 << b;
    }
    words.push(word >>> 0);
  }

  function appendSamples(bytes) {
    const count = bytes.length >> 1;
    if (sampleCount + count > samples.length) {
      const grown = new Float64Array(Math.max(samples.length * 2, sampleCount + count));
      grown.set(samples.subarray(0, sampleCount));
      samples = grown;
    }
    for (let i = 0; i < count; i++) samples[sampleCount + i] = bytes.readInt16LE(i * 2) / 32768;
    sampleCount += count;
  }

  function processFrames() {
    let offset = 0;
    while (offset + FRAME_SIZE <= sampleCount) {
      chromas.push(chromaOfFrame(offset));
      if (chromas.length > SMOOTHING.length) chromas.shift();
      if (chromas.length === SMOOTHING.length) emitWord();
      offset += HOP_SIZE;
    }
    // Keep the samples the next frame still needs.
    samples.copyWithin(0, offset, sampleCount);
    sampleCount -= offset;
  }

  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      let bytes = chunk;
      if (carry) {
        bytes = Buffer.concat([carry, chunk]);
        carry = null;
      }
      if (bytes.length % 2 === 1) {
        carry = bytes.subarray(bytes.length - 1);
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      appendSamples(bytes);
      processFrames();
    },
    /** @returns {Uint32Array} */
    finish() {
      return Uint32Array.from(words);
    },
  };
}

/** 'ok', 'silent' or 'repetitive'; only 'ok' tracks take part in the sound search. */
function classifyWords(words) {
  if (words.length === 0) return 'silent';
  let zeros = 0;
  for (const word of words) if (word === 0) zeros++;
  if (zeros / words.length >= SILENT_ZERO_SHARE) return 'silent';
  if (new Set(words).size / words.length < REPETITIVE_DISTINCT_SHARE) return 'repetitive';
  return 'ok';
}

/** Words as stored: little-endian bytes. */
function wordsToBuffer(words) {
  const buffer = Buffer.alloc(words.length * 4);
  for (let i = 0; i < words.length; i++) buffer.writeUInt32LE(words[i], i * 4);
  return buffer;
}

// Takes any Uint8Array: rows from the cache worker arrive as plain Uint8Arrays, not Buffers.
function wordsFromBuffer(buffer) {
  const words = new Uint32Array(Math.floor((buffer?.length ?? 0) / 4));
  if (words.length === 0) return words;
  const view = new DataView(buffer.buffer, buffer.byteOffset, words.length * 4);
  for (let i = 0; i < words.length; i++) words[i] = view.getUint32(i * 4, true);
  return words;
}

/** ffmpeg arguments that write the first audio track as mono 16-bit PCM at the fingerprint's rate. */
function buildAudioExtractionArgs(inputPath) {
  return ['-v', 'error', '-i', inputPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'];
}

/** FFmpeg's message when the file has no audio track to map. */
function isNoAudioError(error) {
  return /matches no streams|does not contain any stream/i.test(error?.message ?? '');
}

module.exports = {
  AUDIO_FINGERPRINT_KEY,
  SAMPLE_RATE,
  WORDS_PER_SECOND,
  buildAudioExtractionArgs,
  classifyWords,
  createAudioWordStream,
  isNoAudioError,
  wordsFromBuffer,
  wordsToBuffer,
};
