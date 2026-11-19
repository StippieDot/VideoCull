// Partial clip detection: finds videos that contain a stretch of another video. The sound of every video
// is read once and kept (audio-fingerprint.js); shared stretches are found by sound (sound-search.js in
// partial-clips-worker.js) and each one is then checked with pictures, because two videos can share a
// soundtrack and nothing else; those verdicts are kept too (picture-check-store.js). Runs only when
// asked, never as part of a duplicate run.
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const mediaProcess = require('./media-process');
const { processingPause } = require('./processing-pause');
const duplicates = require('./duplicates');
const {
  AUDIO_FINGERPRINT_KEY,
  WORDS_PER_SECOND,
  buildAudioExtractionArgs,
  isNoAudioError,
  wordsFromBuffer,
  wordsToBuffer,
} = require('./audio-fingerprint');
const { calculateDctPHash, flipGrayBytes, frameDarkRatio, parsePHashWords, pHashSimilarity, popcount32 } = require('./duplicate-utils');
const { cropToPrimary, detectBorder, lumaRange } = require('./duplicate-frames');
const { buildIndex, pairKey, relationsFromWindows, unionLength } = require('./sound-search');
const { pictureCheckKey } = require('./picture-check-store');

// A long file read at disk speed keeps producing sound; this only catches a decoder that stopped.
const SOUND_IDLE_TIMEOUT_MS = 120_000;
// Sound shorter than one search window (10 s) is not searched.
const MIN_TRACK_WORDS = 81;
const CHECK_POSITIONS = [0.25, 0.5, 0.75];
const CHECK_EDGE_SECS = 1;
// Around each check time of the other video: 25 frames at 30 fps, ± 0.4 s, since sound places the
// stretch to about 0.1 s. Measured: at 5 fps a letterboxed excerpt scored 85 % (its fast scenes fall
// between the frames), at 30 fps 97 %.
const CONFIRM_BURST = { leadSecs: 0.4, fps: 30, count: 25 };
const MIN_USABLE_CHECKS = 2;
// Independent of the duplicate threshold: pHash in both comparison methods, since Visual scores of
// unrelated pictures run too high to tell them apart.
const PICTURE_CONFIRM_SIMILARITY = 90;
const DARK_FRAME_RATIO = 0.8;
const BLANK_FRAME_MAX_LUMA_RANGE = 12;
// Check frames closer than this many bits to each other show a still, which proves nothing.
const STILL_MAX_HASH_DISTANCE = 6;
const HYPOTHESES = [[false, false], [true, false], [false, true], [true, true]];

function progress(sendProgress, stage, current, total) {
  sendProgress?.({ stage, current, total });
}

function groupByFolder(videos) {
  const groups = new Map();
  for (const video of videos) {
    const folder = path.dirname(video.path);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(video);
  }
  return groups;
}

function rethrowIfStopped(err, run) {
  if (err instanceof duplicates.DuplicateCancelledError || run?.cancelled) throw new duplicates.DuplicateCancelledError();
  if (err?.code === duplicates.CACHE_UNAVAILABLE_CODE) {
    run.cancel();
    throw new duplicates.DuplicateCancelledError();
  }
}

/** One worker that turns PCM into words, used for one video after another. */
function createSoundLane() {
  const worker = new Worker(path.join(__dirname, 'audio-fingerprint-worker.js'));
  return {
    worker,
    finish() {
      return new Promise((resolve, reject) => {
        worker.once('message', (message) => {
          if (message.type === 'done') resolve({ words: message.words, state: message.state });
          else reject(new Error(message.message));
        });
        worker.postMessage({ type: 'end' });
      });
    },
    close() {
      worker.terminate().catch(() => {});
    },
  };
}

async function fingerprintSound(lane, video, run, executionOptions) {
  const args = buildAudioExtractionArgs(mediaProcess.toFfmpegInputPath(video.path));
  if (executionOptions.cpuThreadsLimited !== false) args.splice(args.length - 1, 0, '-threads', '1');
  await duplicates.waitForDuplicateProcessing(run);
  lane.worker.postMessage({ type: 'start' });
  // Not one long activity: a whole file can take minutes, and Pause must take effect at once. While
  // paused the read stops after the current chunk and FFmpeg waits; cancelling ends it.
  await mediaProcess.runFfmpeg(args, run, {
    timeoutMs: SOUND_IDLE_TIMEOUT_MS,
    onStdout: (chunk) => {
      lane.worker.postMessage({ type: 'chunk', bytes: chunk });
      if (processingPause.getState().status !== 'running') return duplicates.waitForDuplicateProcessing(run);
      return undefined;
    },
  });
  duplicates.assertNotCancelled(run);
  return lane.finish();
}

/**
 * The sound of every video: stored words, or read now for videos that have none. Returns a map from
 * video ID to `{ state, words }`, and how many videos were read.
 */
async function readSound(videos, settings, run, sendProgress, maxConcurrency, executionOptions, cacheAccess, cacheOptions) {
  const sound = new Map();
  const missing = [];
  for (const [folder, folderVideos] of groupByFolder(videos)) {
    await duplicates.waitForDuplicateProcessing(run);
    const rows = await cacheAccess.loadAudioFingerprints(folder, cacheOptions, folderVideos.map((video) => video.id), AUDIO_FINGERPRINT_KEY);
    for (const row of rows) {
      if (row.state === 'failed' && settings.retryFailedFingerprintExtraction) continue;
      sound.set(row.video_id, { state: row.state, words: row.state === 'ok' ? wordsFromBuffer(row.words) : null });
    }
    for (const video of folderVideos) if (!sound.has(video.id)) missing.push(video);
  }

  progress(sendProgress, 'Reading sound', 0, missing.length);
  let current = 0;
  let next = 0;
  const laneCount = Math.max(1, Math.min(Math.floor(maxConcurrency) || 1, missing.length));
  const lanes = Array.from({ length: missing.length > 0 ? laneCount : 0 }, () => createSoundLane());
  try {
    await Promise.all(lanes.map(async (lane) => {
      while (next < missing.length) {
        await duplicates.waitForDuplicateProcessing(run);
        const video = missing[next++];
        let entry = null;
        try {
          const { words, state } = await fingerprintSound(lane, video, run, executionOptions);
          entry = { state, words: state === 'ok' ? words : null };
        } catch (err) {
          rethrowIfStopped(err, run);
          // A slow drive is not stored, so the video is read again next time; FFmpeg finding no audio
          // track is a property of the file.
          if (err?.code !== 'ETIMEDOUT') entry = { state: isNoAudioError(err) ? 'noAudio' : 'failed', words: null };
        }
        if (entry) {
          try {
            await cacheAccess.saveAudioFingerprint(path.dirname(video.path), cacheOptions, video.id, AUDIO_FINGERPRINT_KEY, entry.state, entry.words ? wordsToBuffer(entry.words) : null);
          } catch (err) {
            rethrowIfStopped(err, run);
          }
          sound.set(video.id, entry);
        }
        current++;
        progress(sendProgress, 'Reading sound', current, missing.length);
      }
    }));
  } finally {
    for (const lane of lanes) lane.close();
  }
  return { sound, read: missing.length };
}

/** One shard of the sound search in a worker; resolves with its matching windows. */
function runSearchShard(workerData, run, onProgress) {
  return new Promise((resolve, reject) => {
    const pauseHandle = processingPause.createWorkerPauseHandle();
    const worker = new Worker(path.join(__dirname, 'partial-clips-worker.js'), {
      workerData: { ...workerData, pauseSignal: pauseHandle.buffer },
    });
    let settled = false;
    const finish = (error, pairs) => {
      if (settled) return;
      settled = true;
      pauseHandle.release();
      if (error) reject(error);
      else resolve(pairs);
    };
    run.searchWorkers.add(worker);
    worker.on('message', (message) => {
      if (message.type === 'progress') onProgress(message.done);
      else if (message.type === 'paused') pauseHandle.markPaused();
      else if (message.type === 'done') finish(null, message.pairs);
      else if (message.type === 'error') finish(new Error(message.message));
    });
    worker.on('error', (err) => finish(run.cancelled ? new duplicates.DuplicateCancelledError() : err));
    worker.on('exit', (code) => {
      run.searchWorkers.delete(worker);
      if (run.cancelled) finish(new duplicates.DuplicateCancelledError());
      else if (code !== 0) finish(new Error(`Partial clip worker exited with ${code}`));
    });
  });
}

/**
 * The shared-sound search, split over `workerCount` workers that read one copy of the words and the
 * index in shared memory. Each shard searches every n-th video; together they find the same pairs as
 * one search.
 */
async function searchSharedSound(tracks, skipPairKeys, workerCount, run, sendProgress) {
  const words = new Uint32Array(new SharedArrayBuffer(tracks.reduce((sum, track) => sum + track.words.length, 0) * 4));
  const layout = [];
  let start = 0;
  const shared = tracks.map((track) => {
    words.set(track.words, start);
    layout.push({ start, length: track.words.length });
    start += track.words.length;
    return { id: track.id, words: words.subarray(start - track.words.length, start) };
  });
  const index = buildIndex(shared, { shared: true });
  const shardCount = Math.max(1, Math.min(Math.floor(workerCount) || 1, tracks.length));
  const doneByShard = new Array(shardCount).fill(0);
  const report = () => progress(sendProgress, 'Searching partial clips', doneByShard.reduce((sum, done) => sum + done, 0), tracks.length);
  report();
  // Cancelling the run ends every shard.
  run.searchWorkers = new Set();
  run.worker = { terminate: () => { for (const worker of run.searchWorkers) worker.terminate(); } };
  try {
    const shards = await Promise.all(doneByShard.map((_, i) => runSearchShard(
      { words: words.buffer, layout, index, shard: [i, shardCount] },
      run,
      (done) => {
        doneByShard[i] = done;
        report();
      },
    ).then((pairs) => {
      doneByShard[i] = Math.ceil((tracks.length - i) / shardCount);
      report();
      return pairs;
    })));
    return relationsFromWindows(shared, shards, skipPairKeys);
  } finally {
    // After a failed shard the others are stopped too.
    run.worker.terminate();
    run.worker = null;
  }
}

/**
 * The verdict on one shared stretch from its picture checks: `{ frame, burst }` per check time, the
 * frame of the shorter video and the frames of the other around the same moment. Confirmed with at
 * least two usable checks averaging 90 % or more under one border choice; different pictures below
 * that; could not be checked with fewer usable checks or when the shorter video shows a still. With
 * `compareFlipped` the mirrored picture of the shorter video counts too.
 */
function judgeSegmentPictures(checks, { compareFlipped = false } = {}) {
  const usable = checks.filter((check) => check.frame && check.burst.length > 0
    && frameDarkRatio(check.frame.primary) < DARK_FRAME_RATIO
    && lumaRange(check.frame.primary) > BLANK_FRAME_MAX_LUMA_RANGE);
  if (usable.length < MIN_USABLE_CHECKS) return { state: 'unconfirmed', pictureSimilarity: null, checks: usable.length };

  const hashes = usable.map((check) => parsePHashWords(calculateDctPHash(check.frame.primary)));
  const still = hashes.every((hash, i) => hashes.every((other, j) => (
    i === j || popcount32(hash[0] ^ other[0]) + popcount32(hash[1] ^ other[1]) < STILL_MAX_HASH_DISTANCE
  )));
  if (still) return { state: 'unconfirmed', pictureSimilarity: null, checks: usable.length, still: true };

  const borderShort = detectBorder(usable.map((check) => check.frame.analysis), MIN_USABLE_CHECKS);
  const borderOther = detectBorder(usable.flatMap((check) => check.burst.map((frame) => frame.analysis)), MIN_USABLE_CHECKS);
  // Hashes per check, for the full picture and, with bars, for the picture inside them.
  const shortHashes = (crop) => usable.map((check) => {
    const picture = crop ? cropToPrimary(check.frame.analysis, borderShort) : check.frame.primary;
    return compareFlipped ? [calculateDctPHash(picture), calculateDctPHash(flipGrayBytes(picture))] : [calculateDctPHash(picture)];
  });
  const otherHashes = (crop) => usable.map((check) => check.burst.map((frame) => calculateDctPHash(crop ? cropToPrimary(frame.analysis, borderOther) : frame.primary)));
  const hashed = {
    short: [shortHashes(false), borderShort ? shortHashes(true) : null],
    other: [otherHashes(false), borderOther ? otherHashes(true) : null],
  };
  let best = 0;
  for (const [cropShort, cropOther] of HYPOTHESES) {
    const short = hashed.short[Number(cropShort)];
    const other = hashed.other[Number(cropOther)];
    if (!short || !other) continue;
    const scores = short.map((variants, i) => Math.max(...variants.flatMap((hash) => other[i].map((frameHash) => pHashSimilarity(hash, frameHash)))));
    best = Math.max(best, scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }
  const pictureSimilarity = Math.round(best * 10) / 10;
  return { state: pictureSimilarity >= PICTURE_CONFIRM_SIMILARITY ? 'confirmed' : 'differentPicture', pictureSimilarity, checks: usable.length };
}

/** The picture verdict of one stretch; `readAll` is false when a frame could not be read. */
async function checkSegmentPictures(shorter, other, segment, settings, run, executionOptions) {
  const checks = [];
  let readAll = true;
  for (const position of CHECK_POSITIONS) {
    await duplicates.waitForDuplicateProcessing(run);
    const time = Math.min(
      Math.max(segment.startShort + position * segment.lengthSecs, segment.startShort + CHECK_EDGE_SECS),
      segment.startShort + segment.lengthSecs - CHECK_EDGE_SECS,
    );
    let frame = null;
    let burst = [];
    try {
      frame = await duplicates.extractGrayFrame(shorter.path, time, run, executionOptions);
      burst = await duplicates.extractBurstFrames(other.path, segment.startOther + (time - segment.startShort), run, executionOptions, CONFIRM_BURST);
    } catch (err) {
      // A frame that cannot be read only makes this check unusable.
      rethrowIfStopped(err, run);
      readAll = false;
    }
    checks.push({ frame, burst });
  }
  return { ...judgeSegmentPictures(checks, { compareFlipped: settings.compareFlipped }), readAll };
}

/** Like `checkSegmentPictures`, with verdicts from earlier runs reused and new complete ones kept. */
async function storedSegmentPictures(pictureChecks, shorter, other, segment, settings, run, executionOptions) {
  const key = pictureCheckKey(shorter, other, segment, settings.compareFlipped);
  const stored = pictureChecks?.get(key);
  if (stored) {
    pictureChecks.set(key, stored);
    return stored;
  }
  const picture = await checkSegmentPictures(shorter, other, segment, settings, run, executionOptions);
  // A read that failed (a slow network drive, a file being written) may work next time.
  if (picture.readAll) pictureChecks?.set(key, picture);
  return picture;
}

const round = (value) => Math.round(value * 10) / 10;

/** Relation, state and evidence of one pair whose segments were checked with pictures. */
function describeRelation(found, shorter, segments) {
  const states = segments.map((segment) => segment.pictureState);
  const state = states.includes('confirmed') ? 'confirmed' : states.includes('differentPicture') ? 'differentPicture' : 'unconfirmed';
  const checked = segments.filter((segment) => segment.pictureSimilarity !== null);
  const shorterDuration = Number(shorter.durationSecs) || 0;
  // A stretch of the shorter video that occurs twice in the other one counts once.
  const startShort = shorter.id === found.aId ? 'startA' : 'startB';
  const covered = unionLength(segments.map((segment) => [segment[startShort], segment[startShort] + segment.lengthSecs]));
  return {
    aId: found.aId,
    bId: found.bId,
    relation: state === 'confirmed' ? 'partial' : 'audioOnly',
    state,
    shorterId: shorter.id,
    segments,
    coverage: shorterDuration > 0 ? Math.round(Math.min(1, covered / shorterDuration) * 1000) / 1000 : null,
    soundSimilarity: Math.round(found.soundSimilarity * 1000) / 10,
    pictureSimilarity: checked.length > 0
      ? round(checked.reduce((sum, segment) => sum + segment.pictureSimilarity, 0) / checked.length)
      : null,
  };
}

async function checkRelations(found, byId, settings, run, sendProgress, maxConcurrency, executionOptions, pictureChecks) {
  const clips = [];
  let checked = 0;
  let next = 0;
  progress(sendProgress, 'Checking pictures', 0, found.length);
  await pictureChecks?.load();
  // Saved along the way like fingerprints, so a cancelled or crashed run keeps what it checked.
  const checkpointEveryMs = settings.checkpointIntervalMinutes > 0
    ? Math.max(15000, settings.checkpointIntervalMinutes * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  let lastCheckpoint = Date.now();
  const laneCount = Math.max(1, Math.min(Math.floor(maxConcurrency) || 1, found.length));
  try {
    await Promise.all(Array.from({ length: found.length > 0 ? laneCount : 0 }, async () => {
      while (next < found.length) {
        const relation = found[next++];
        const a = byId.get(relation.aId);
        const b = byId.get(relation.bId);
        const aShorter = (Number(a.durationSecs) || Infinity) <= (Number(b.durationSecs) || Infinity);
        const [shorter, other] = aShorter ? [a, b] : [b, a];
        const segments = [];
        for (const segment of relation.segments) {
          const picture = await storedSegmentPictures(pictureChecks, shorter, other, {
            startShort: aShorter ? segment.startA : segment.startB,
            startOther: aShorter ? segment.startB : segment.startA,
            lengthSecs: segment.lengthSecs,
          }, settings, run, executionOptions);
          segments.push({
            startA: round(segment.startA),
            startB: round(segment.startB),
            lengthSecs: round(segment.lengthSecs),
            soundSimilarity: round(segment.similarity * 100),
            pictureState: picture.state,
            pictureSimilarity: picture.pictureSimilarity,
          });
        }
        const clip = describeRelation(relation, shorter, segments);
        // The same footage and sound throughout is a duplicate, which the duplicate run reports.
        if (!(relation.fullCoverage && clip.state === 'confirmed')) clips.push(clip);
        checked++;
        progress(sendProgress, 'Checking pictures', checked, found.length);
        if (Date.now() - lastCheckpoint >= checkpointEveryMs) {
          lastCheckpoint = Date.now();
          await pictureChecks?.save();
        }
      }
    }));
  } finally {
    await pictureChecks?.save();
  }
  return clips;
}

function longerDuration(clip, byId) {
  return Math.max(Number(byId.get(clip.aId)?.durationSecs) || 0, Number(byId.get(clip.bId)?.durationSecs) || 0);
}

/**
 * Finds partial clips among `videos`. `skipPairKeys` holds pairs that are already duplicates or were
 * marked as not a match. Progress stages: Reading sound, Searching partial clips, Checking pictures.
 */
async function findPartialClips({ videos, settings, skipPairKeys = new Set(), cacheAccess, cacheOptions, pictureChecks = null, maxConcurrency = 2, executionOptions = {}, run, sendProgress }) {
  const safeVideos = Array.isArray(videos) ? videos.filter((video) => video?.id && video?.path) : [];
  const byId = new Map(safeVideos.map((video) => [video.id, video]));
  const timings = {};
  let started = Date.now();
  const { sound, read } = await readSound(safeVideos, settings, run, sendProgress, maxConcurrency, executionOptions, cacheAccess, cacheOptions);
  timings.soundMs = Date.now() - started;
  duplicates.assertNotCancelled(run);

  const states = { ok: 0, noAudio: 0, silent: 0, repetitive: 0, failed: 0 };
  let storedWords = 0;
  const tracks = [];
  for (const video of safeVideos) {
    const entry = sound.get(video.id);
    if (!entry) continue;
    states[entry.state] = (states[entry.state] ?? 0) + 1;
    if (entry.state !== 'ok' || !entry.words) continue;
    storedWords += entry.words.length;
    if (entry.words.length >= MIN_TRACK_WORDS) tracks.push({ id: video.id, words: entry.words });
  }

  started = Date.now();
  // Pure computation, so as many workers as the processing setting allows, but not more than cores.
  const searchWorkers = Math.min(maxConcurrency, os.cpus().length || 1);
  const found = tracks.length >= 2 ? await searchSharedSound(tracks, skipPairKeys, searchWorkers, run, sendProgress) : [];
  timings.searchMs = Date.now() - started;
  duplicates.assertNotCancelled(run);

  started = Date.now();
  const clips = await checkRelations(found, byId, settings, run, sendProgress, maxConcurrency, executionOptions, pictureChecks);
  timings.picturesMs = Date.now() - started;
  duplicates.assertNotCancelled(run);

  clips.sort((x, y) => longerDuration(y, byId) - longerDuration(x, byId) || x.aId.localeCompare(y.aId) || x.bId.localeCompare(y.bId));
  return {
    clips,
    stats: {
      videos: safeVideos.length,
      soundRead: read,
      soundStates: states,
      // 4 bytes per word, about 32 bytes per second of sound.
      soundBytes: storedWords * 4,
      soundSeconds: Math.round(storedWords / WORDS_PER_SECOND),
      candidates: found.length,
      partial: clips.filter((clip) => clip.relation === 'partial').length,
      audioOnly: clips.filter((clip) => clip.relation === 'audioOnly').length,
      ...timings,
    },
  };
}

/** Pairs inside the current duplicate groups and pairs marked as not a match: never searched. */
function skipPairKeysFor(groups, ignoredPairs) {
  const keys = new Set(ignoredPairs ?? []);
  for (const group of groups ?? []) {
    const ids = Array.isArray(group?.videoIds) ? group.videoIds : [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) keys.add(pairKey(ids[i], ids[j]));
  }
  return keys;
}

module.exports = { findPartialClips, judgeSegmentPictures, skipPairKeysFor };
