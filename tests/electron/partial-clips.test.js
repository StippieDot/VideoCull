const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPictureCheckStore } = require('../../electron/picture-check-store');
const { flipGrayBytes } = require('../../electron/duplicate-utils');
const { WORDS_PER_SECOND, wordsToBuffer } = require('../../electron/audio-fingerprint');

const FRAME_BYTES = 64 * 96;
const modulePaths = ['duplicates', 'media-process', 'partial-clips'].map((name) => require.resolve(`../../electron/${name}`));

// A picture per seed: a 32×32 primary and a 64×64 analysis frame without dark edges.
function picture(seed) {
  const primary = Buffer.alloc(1024);
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) primary[row * 32 + col] = 40 + ((row * 7 * seed + col * 13 + seed * 31) % 200);
  }
  const analysis = Buffer.alloc(64 * 64);
  for (let i = 0; i < analysis.length; i++) analysis[i] = primary[(Math.floor(i / 128) * 32) + Math.floor((i % 64) / 2)];
  return { primary, analysis };
}

const check = (shortSeed, otherSeed) => ({ frame: picture(shortSeed), burst: [picture(otherSeed + 100), picture(otherSeed)] });

function loadModules(onSpawn) {
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGKILL'));
    setImmediate(() => onSpawn(child, args));
    return child;
  };
  for (const modulePath of modulePaths) delete require.cache[modulePath];
  try {
    return { duplicates: require('../../electron/duplicates'), partialClips: require('../../electron/partial-clips') };
  } finally {
    childProcess.spawn = realSpawn;
    for (const modulePath of modulePaths) delete require.cache[modulePath];
  }
}

describe('picture check of shared sound', () => {
  const { partialClips } = loadModules(() => {});
  const { judgeSegmentPictures, skipPairKeysFor } = partialClips;

  test('matching pictures confirm the stretch, others do not', () => {
    expect(judgeSegmentPictures([check(1, 1), check(2, 2), check(3, 3)])).toMatchObject({ state: 'confirmed', pictureSimilarity: 100, checks: 3 });
    expect(judgeSegmentPictures([check(1, 4), check(2, 5), check(3, 6)]).state).toBe('differentPicture');
  });

  test('fewer than two usable checks leave the stretch unconfirmed', () => {
    const dark = { frame: { primary: Buffer.alloc(1024, 2), analysis: Buffer.alloc(4096, 2) }, burst: [picture(1)] };
    const failed = { frame: null, burst: [] };
    expect(judgeSegmentPictures([check(1, 1), dark, failed])).toMatchObject({ state: 'unconfirmed', pictureSimilarity: null, checks: 1 });
    expect(judgeSegmentPictures([]).state).toBe('unconfirmed');
  });

  test('a still picture proves nothing either way', () => {
    expect(judgeSegmentPictures([check(1, 1), check(1, 1), check(1, 1)])).toMatchObject({ state: 'unconfirmed', still: true });
  });

  test('a mirrored copy is confirmed only with mirrored comparison on', () => {
    const mirrored = (seed) => {
      const { primary, analysis } = picture(seed);
      return { frame: { primary: flipGrayBytes(primary), analysis }, burst: [picture(seed)] };
    };
    const checks = [mirrored(1), mirrored(2), mirrored(3)];
    expect(judgeSegmentPictures(checks).state).toBe('differentPicture');
    expect(judgeSegmentPictures(checks, { compareFlipped: true }).state).toBe('confirmed');
  });

  test('pairs inside duplicate groups and pairs marked as not a match are skipped', () => {
    const keys = skipPairKeysFor([{ videoIds: ['c', 'a', 'b'] }], ['x|y']);
    expect([...keys].sort()).toEqual(['a|b', 'a|c', 'b|c', 'x|y']);
  });
});

describe('finding partial clips', () => {
  function words(seconds, seed) {
    let state = seed;
    return Uint32Array.from({ length: Math.round(seconds * WORDS_PER_SECOND) }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state || 1;
    });
  }

  function storedSound(entries) {
    const saved = [];
    return {
      saved,
      loadAudioFingerprints: async (_folder, _options, ids) => ids.filter((id) => entries[id]).map((id) => ({
        video_id: id, state: 'ok', words: wordsToBuffer(entries[id]), word_count: entries[id].length,
      })),
      saveAudioFingerprint: async (...args) => { saved.push(args); },
    };
  }

  const video = (id, durationSecs) => ({ id, path: `P:\\${id}.mp4`, durationSecs });

  test('stored sound is reused, and a stretch with matching pictures is a partial clip', async () => {
    const spawns = [];
    const { duplicates, partialClips } = loadModules((child, args) => {
      spawns.push(args);
      // Each request returns a picture that depends on the requested second, as moving footage would.
      const count = Number(args[args.indexOf('-frames:v') + 1]) || 1;
      const seconds = Number(args[args.indexOf('-ss') + 1]);
      const stacked = Buffer.alloc(FRAME_BYTES, 128);
      const { primary } = picture(1 + (Math.round(seconds) % 7));
      for (let row = 0; row < 32; row++) primary.copy(stacked, row * 64, row * 32, row * 32 + 32);
      child.stdout.emit('data', Buffer.concat(Array.from({ length: count }, () => stacked)));
      child.emit('close', 0, null);
    });
    const source = words(120, 1);
    const cache = storedSound({ src: source, clip: source.slice(Math.round(40 * WORDS_PER_SECOND), Math.round(70 * WORDS_PER_SECOND)) });
    const result = await partialClips.findPartialClips({
      videos: [video('src', 120), video('clip', 30)],
      settings: { retryFailedFingerprintExtraction: false, compareFlipped: false },
      cacheAccess: cache,
      cacheOptions: {},
      run: duplicates.createDuplicateRun(),
    });
    // Sound came from the cache: only picture checks ran.
    expect(cache.saved).toEqual([]);
    expect(spawns.length).toBeGreaterThan(0);
    expect(spawns.every((args) => !args.includes('s16le'))).toBe(true);
    expect(result.stats).toMatchObject({ soundRead: 0, candidates: 1 });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]).toMatchObject({ aId: 'src', bId: 'clip', shorterId: 'clip' });
    expect(Math.round(result.clips[0].segments[0].startA)).toBe(40);
  });

  test('picture verdicts are kept, so a second run reads no frames until a file changes', async () => {
    const spawns = [];
    const { duplicates, partialClips } = loadModules((child, args) => {
      spawns.push(args);
      const count = Number(args[args.indexOf('-frames:v') + 1]) || 1;
      const seconds = Number(args[args.indexOf('-ss') + 1]);
      const stacked = Buffer.alloc(FRAME_BYTES, 128);
      const { primary } = picture(1 + (Math.round(seconds) % 7));
      for (let row = 0; row < 32; row++) primary.copy(stacked, row * 64, row * 32, row * 32 + 32);
      child.stdout.emit('data', Buffer.concat(Array.from({ length: count }, () => stacked)));
      child.emit('close', 0, null);
    });
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'picture-checks-'));
    const writeJsonFile = async (name, data, root) => fs.promises.writeFile(path.join(root, name), JSON.stringify(data));
    const source = words(120, 1);
    const cache = storedSound({ src: source, clip: source.slice(Math.round(40 * WORDS_PER_SECOND), Math.round(70 * WORDS_PER_SECOND)) });
    const find = (videos) => partialClips.findPartialClips({
      videos,
      settings: { compareFlipped: false },
      cacheAccess: cache,
      cacheOptions: {},
      // A new store each time reads what the run before saved.
      pictureChecks: createPictureCheckStore({ rootDir, writeJsonFile }),
      run: duplicates.createDuplicateRun(),
    });
    try {
      const first = await find([{ ...video('src', 120), date: 1 }, { ...video('clip', 30), date: 1 }]);
      const firstSpawns = spawns.length;
      expect(firstSpawns).toBeGreaterThan(0);
      const second = await find([{ ...video('src', 120), date: 1 }, { ...video('clip', 30), date: 1 }]);
      expect(spawns.length).toBe(firstSpawns);
      expect(second.clips).toEqual(first.clips);
      await find([{ ...video('src', 120), date: 1 }, { ...video('clip', 30), date: 2 }]);
      expect(spawns.length).toBeGreaterThan(firstSpawns);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('pairs to skip are not searched, and a cancelled run stops', async () => {
    const { duplicates, partialClips } = loadModules((child) => child.emit('close', 0, null));
    const source = words(60, 2);
    const cache = storedSound({ a: source, b: source.slice(0, Math.round(20 * WORDS_PER_SECOND)) });
    const args = { videos: [video('a', 60), video('b', 20)], settings: {}, cacheAccess: cache, cacheOptions: {} };
    const skipped = await partialClips.findPartialClips({ ...args, skipPairKeys: new Set(['a|b']), run: duplicates.createDuplicateRun() });
    expect(skipped.clips).toEqual([]);
    expect(skipped.stats.candidates).toBe(0);

    const run = duplicates.createDuplicateRun();
    run.cancel();
    await expect(partialClips.findPartialClips({ ...args, run })).rejects.toBeInstanceOf(duplicates.DuplicateCancelledError);
  });
});
