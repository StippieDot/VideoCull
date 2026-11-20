const {
  SAMPLE_RATE,
  WORDS_PER_SECOND,
  classifyWords,
  createAudioWordStream,
  isNoAudioError,
  wordsFromBuffer,
  wordsToBuffer,
} = require('../../electron/audio-fingerprint');

/** 16-bit PCM of `seconds`, from `sample(t)` in -1..1. */
function pcm(seconds, sample) {
  const count = Math.round(seconds * SAMPLE_RATE);
  const buffer = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / SAMPLE_RATE))) * 32000), i * 2);
  return buffer;
}

// A melody: a new pair of notes every 0.3 s, chosen by a fixed pseudo-random sequence.
function melody(seconds, seed = 1, volume = 1) {
  let state = seed;
  const notes = Array.from({ length: Math.ceil(seconds / 0.3) + 1 }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return [110 * 2 ** ((state % 36) / 12), 220 * 2 ** (((state >> 8) % 24) / 12)];
  });
  return pcm(seconds, (t) => {
    const [a, b] = notes[Math.floor(t / 0.3)];
    return volume * (0.4 * Math.sin(2 * Math.PI * a * t) + 0.3 * Math.sin(2 * Math.PI * b * t));
  });
}

function wordsOf(buffer, chunkSize = buffer.length) {
  const stream = createAudioWordStream();
  for (let offset = 0; offset < buffer.length; offset += chunkSize) stream.push(buffer.subarray(offset, offset + chunkSize));
  return stream.finish();
}

function popcount(x) {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

describe('sound fingerprint words', () => {
  test('words do not depend on how the sound arrives', () => {
    const sound = melody(12);
    const whole = wordsOf(sound);
    expect(whole.length).toBeGreaterThan(11 * WORDS_PER_SECOND);
    // Odd chunk sizes split samples between chunks.
    expect(wordsOf(sound, 1001)).toEqual(whole);
    expect(wordsOf(sound, 65537)).toEqual(whole);
  });

  test('music is ok, a steady tone is repetitive, silence is silent', () => {
    expect(classifyWords(wordsOf(melody(20)))).toBe('ok');
    expect(classifyWords(wordsOf(pcm(20, (t) => 0.5 * Math.sin(2 * Math.PI * 440 * t))))).toBe('repetitive');
    const silence = wordsOf(pcm(20, () => 0));
    expect(silence.every((word) => word === 0)).toBe(true);
    expect(classifyWords(silence)).toBe('silent');
    expect(classifyWords(new Uint32Array(0))).toBe('silent');
  });

  test('a quieter copy of the same sound gives nearly the same words, other music does not', () => {
    const loud = wordsOf(melody(10, 7));
    const similarity = (other) => {
      let same = 0;
      for (let i = 0; i < loud.length; i++) same += 32 - popcount(loud[i] ^ other[i]);
      return same / (loud.length * 32);
    };
    expect(similarity(wordsOf(melody(10, 7, 0.3)))).toBeGreaterThan(0.95);
    expect(similarity(wordsOf(melody(10, 99)))).toBeLessThan(0.75);
  });

  test('words are stored as bytes and read back unchanged', () => {
    const words = Uint32Array.from([0, 1, 0xffffffff, 0x80000001]);
    expect(wordsFromBuffer(wordsToBuffer(words))).toEqual(words);
    expect(wordsFromBuffer(null)).toEqual(new Uint32Array(0));
    // As the cache worker delivers it: a plain Uint8Array.
    expect(wordsFromBuffer(new Uint8Array(wordsToBuffer(words)))).toEqual(words);
  });

  test('FFmpeg reporting no audio track is recognised', () => {
    expect(isNoAudioError(new Error('Stream map \'0:a:0\' matches no streams.'))).toBe(true);
    expect(isNoAudioError(new Error('ffmpeg exited with code 1\nInvalid data found'))).toBe(false);
  });
});
