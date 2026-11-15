const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const mediaProcess = require('./media-process');
const { createDuplicateSessionCache } = require('./duplicate-session-cache');
const { processingPause } = require('./processing-pause');
const {
  normalizeDuplicateSettings,
  getDuplicateFingerprintKey,
  getSamplingTimestamps,
  calculateDctPHash,
  flipGrayBytes,
  frameDarkRatio,
  average,
  chooseSuggestedKeeper,
  durationsWithinTolerance,
  pHashSamplesByVideo,
  graySamplesByVideo,
  pHashSampleScore,
  graySampleScore,
  scoreSamples,
  isDarkSample,
  fingerprintToRow,
} = require('./duplicate-utils');
const {
  STACKED_FRAME_BYTES,
  cropToPrimary,
  detectBorder,
  lumaRange,
  splitStackedFrame,
  stackedFrameFilter,
} = require('./duplicate-frames');

const ONE_MIB = 1024 * 1024;
// Match thumbnails: allow slow seeks, but keep a hung decoder from holding a worker indefinitely.
const FRAME_EXTRACTION_TIMEOUT_MS = 120_000;
// Tried in this order when a sample position yields no frame; the thumbnail code uses the same offsets.
const SAMPLE_RETRY_OFFSETS_SECS = [0, 0.25, -0.25, 0.75, -0.75];
// SYNC NOTE: same literal as CACHE_UNAVAILABLE_CODE in cache-service.js, which is not required here
// because the cache is injected.
const CACHE_UNAVAILABLE_CODE = 'CACHE_UNAVAILABLE';
const duplicateSessionCache = createDuplicateSessionCache();

function duplicateLog(message, detail) {
  if (detail === undefined) {
    console.log(`[duplicates] ${message}`);
    return;
  }
  console.log(`[duplicates] ${message}`, detail);
}

class DuplicateCancelledError extends Error {
  constructor() {
    super('Duplicate detection cancelled');
    this.name = 'DuplicateCancelledError';
  }
}

function createDuplicateRun() {
  return {
    ...mediaProcess.createRunToken(),
    worker: null,
    cancel() {
      mediaProcess.cancelRun(this);
      processingPause.wake();
      if (this.worker) {
        try { this.worker.terminate(); } catch { /* ignore */ }
      }
    },
  };
}

function assertNotCancelled(run) {
  if (run?.cancelled) throw new DuplicateCancelledError();
}

function waitForDuplicateProcessing(run) {
  return processingPause.checkpoint(
    () => Boolean(run?.cancelled),
    () => new DuplicateCancelledError(),
  );
}

async function runDuplicateActivity(run, operation) {
  await waitForDuplicateProcessing(run);
  const finish = processingPause.beginActivity();
  try {
    return await operation();
  } finally {
    finish();
  }
}

function groupVideosByFolder(videos) {
  const groups = new Map();
  for (const video of videos) {
    const folder = path.dirname(video.path);
    const list = groups.get(folder) ?? [];
    list.push(video);
    groups.set(folder, list);
  }
  return groups;
}

function progress(sendProgress, stage, payload = {}) {
  sendProgress?.({ stage, ...payload });
}

function createQueueCursor(items) {
  let index = 0;
  return () => {
    if (index >= items.length) return null;
    const item = items[index];
    index += 1;
    return item;
  };
}

function buildGrayFrameExtractionArgs(videoPath, timestamp, executionOptions = {}) {
  const args = [
    '-v', 'error',
    '-ss', String(Math.max(0, Number(timestamp) || 0)),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', stackedFrameFilter(),
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1',
  ];
  if (executionOptions.cpuThreadsLimited !== false) {
    args.splice(args.length - 1, 0, '-threads', '1');
  }
  return args;
}

function buildGrayFramesExtractionArgs(videoPath, timestamps, executionOptions = {}) {
  const safeTimestamps = Array.isArray(timestamps) ? timestamps : [];
  if (safeTimestamps.length <= 1) {
    return buildGrayFrameExtractionArgs(videoPath, safeTimestamps[0] ?? 0, executionOptions);
  }

  const args = ['-v', 'error'];
  for (const timestamp of safeTimestamps) {
    args.push('-ss', String(Math.max(0, Number(timestamp) || 0)), '-i', videoPath);
  }

  const filters = [];
  for (let i = 0; i < safeTimestamps.length; i++) {
    filters.push(`[${i}:v]${stackedFrameFilter(i)},trim=end_frame=1,setpts=PTS-STARTPTS[v${i}]`);
  }
  filters.push(`${safeTimestamps.map((_, i) => `[v${i}]`).join('')}concat=n=${safeTimestamps.length}:v=1:a=0[out]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    // Each input contributes one frame with timestamp 0. Without passthrough FFmpeg's frame-rate
    // sync drops the "duplicates", so more than 3 samples returned only 3 frames.
    '-fps_mode', 'passthrough',
    '-frames:v', String(safeTimestamps.length),
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
  );
  if (executionOptions.cpuThreadsLimited !== false) {
    args.push('-threads', '1');
  }
  args.push('pipe:1');
  return args;
}

function shouldFallbackToSingleFrameExtraction(error) {
  const message = error?.message || String(error || '');
  return /FFmpeg returned 0/i.test(message) || /concat/i.test(message) || /Invalid argument/i.test(message);
}

async function readFileChunk(filePath, start, length) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function quickSignature(video) {
  const size = Number(video.sizeBytes) || 0;
  const hash = crypto.createHash('sha256');
  hash.update(String(size));
  if (size <= ONE_MIB * 2) {
    hash.update(await fs.readFile(video.path));
  } else {
    hash.update(await readFileChunk(video.path, 0, ONE_MIB));
    const middleStart = Math.max(0, Math.floor(size / 2) - Math.floor(ONE_MIB / 2));
    hash.update(await readFileChunk(video.path, middleStart, ONE_MIB));
  }
  return hash.digest('hex');
}

async function fullFileHash(video, run) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(video.path, 'r');
  const buffer = Buffer.alloc(4 * ONE_MIB);
  let position = 0;
  try {
    while (true) {
      const { bytesRead } = await runDuplicateActivity(run, () => handle.read(buffer, 0, buffer.length, position));
      if (bytesRead === 0) break;
      hash.update(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function splitExactCandidatesByDuration(videos, settings) {
  if (videos.length < 2) return [videos];
  if (!settings) return [videos];
  if (videos.some((video) => Number(video.durationSecs ?? 0) <= 0)) return [videos];
  const sorted = [...videos].sort((a, b) => Number(a.durationSecs) - Number(b.durationSecs));
  const groups = [];
  let current = [sorted[0]];
  for (let index = 1; index < sorted.length; index++) {
    const video = sorted[index];
    if (durationsWithinTolerance(current[current.length - 1], video, settings)) {
      current.push(video);
      continue;
    }
    groups.push(current);
    current = [video];
  }
  groups.push(current);
  return groups;
}

async function loadDuplicateCacheState(videos, settings, run, cacheAccess, cacheOptions) {
  const fingerprintKey = getDuplicateFingerprintKey(settings);
  const mode = settings.comparisonMode;
  duplicateSessionCache.beginFingerprintSettings(fingerprintKey);

  const signatureById = new Map();
  const completeById = new Map();
  const failedIds = new Set();
  const comparisonRows = [];

  for (const [folderPath, folderVideos] of groupVideosByFolder(videos)) {
    await waitForDuplicateProcessing(run);
    const videoIds = folderVideos.map((video) => video.id);
    let snapshot;
    if (!duplicateSessionCache.hasFolder(videoIds, mode)) {
      const workerState = await cacheAccess.loadDuplicateFolderState(folderPath, cacheOptions, videoIds, {
        fingerprintKey,
        sampleCount: settings.sampleCount,
        comparisonMode: mode,
      });
      const loaded = {
        ...workerState,
        completeById: new Map(workerState.completeEntries),
        failedIds: new Set(workerState.failedIds),
      };
      snapshot = duplicateSessionCache.rememberFolder(loaded);
    }

    snapshot ??= duplicateSessionCache.folderSnapshot(videoIds, mode);
    for (const row of snapshot.signatureRows) signatureById.set(row.id, row);
    for (const [videoId, complete] of snapshot.completeById) completeById.set(videoId, complete);
    for (const videoId of snapshot.failedIds) failedIds.add(videoId);
    comparisonRows.push(...snapshot.comparisonRows);
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { fingerprintKey, signatureById, completeById, failedIds, comparisonRows };
}

async function findExactGroups(videos, duplicateState, settings, run, sendProgress, cacheAccess, cacheOptions) {
  duplicateLog('Starting exact duplicate pass', { videos: videos.length });
  progress(sendProgress, 'Checking exact matches', { current: 0, total: videos.length });
  const signatureById = duplicateState.signatureById;
  const bySize = groupBy(videos.filter((video) => video.sizeBytes > 0), (video) => String(video.sizeBytes));
  const exactGroups = [];
  let processed = 0;
  let quickCacheHits = 0;
  let fullCacheHits = 0;

  for (const sameSize of bySize.values()) {
    await waitForDuplicateProcessing(run);
    if (sameSize.length < 2) {
      processed += sameSize.length;
      continue;
    }

    for (const durationGroup of splitExactCandidatesByDuration(sameSize, settings)) {
      await waitForDuplicateProcessing(run);
      if (durationGroup.length < 2) {
        processed += durationGroup.length;
        continue;
      }

      const quickRows = [];
      for (const video of durationGroup) {
        await waitForDuplicateProcessing(run);
        const cached = signatureById.get(video.id);
        const quick = cached?.file_signature_quick || await runDuplicateActivity(run, () => quickSignature(video));
        if (cached?.file_signature_quick) quickCacheHits++;
        if (!cached?.file_signature_quick) {
          assertNotCancelled(run);
          await cacheAccess.updateVideoSignatures(path.dirname(video.path), cacheOptions, video.id, { quick });
          duplicateSessionCache.updateSignature(video.id, { quick });
        }
        quickRows.push({ video, quick, cachedFull: cached?.file_signature_full || null });
        processed++;
        if (processed % 20 === 0) progress(sendProgress, 'Checking exact matches', { current: processed, total: videos.length });
      }

      for (const quickGroup of groupBy(quickRows, (row) => row.quick).values()) {
        if (quickGroup.length < 2) continue;
        const fullRows = [];
        for (const row of quickGroup) {
          await waitForDuplicateProcessing(run);
          const full = row.cachedFull || await fullFileHash(row.video, run);
          if (row.cachedFull) fullCacheHits++;
          if (!row.cachedFull) {
            assertNotCancelled(run);
            await cacheAccess.updateVideoSignatures(
              path.dirname(row.video.path),
              cacheOptions,
              row.video.id,
              { quick: row.quick, full },
            );
            duplicateSessionCache.updateSignature(row.video.id, { quick: row.quick, full });
          }
          fullRows.push({ video: row.video, full });
        }
        for (const fullGroup of groupBy(fullRows, (row) => row.full).values()) {
          if (fullGroup.length >= 2) exactGroups.push(fullGroup.map((row) => row.video.id));
        }
      }
    }
  }

  progress(sendProgress, 'Checking exact matches', { current: videos.length, total: videos.length });
  duplicateLog('Exact duplicate pass complete', {
    groups: exactGroups.length,
    quickCacheHits,
    fullCacheHits,
  });
  return exactGroups;
}

async function extractGrayFramesWithArgs(args, expectedFrameCount, run) {
  return runDuplicateActivity(run, async () => {
    assertNotCancelled(run);
    const expectedBytes = expectedFrameCount * STACKED_FRAME_BYTES;
    let buffer;
    try {
      buffer = await mediaProcess.runFfmpeg(args, run, {
        timeoutMs: FRAME_EXTRACTION_TIMEOUT_MS,
        maxStdoutBytes: expectedBytes,
      });
    } catch (error) {
      assertNotCancelled(run);
      throw error;
    }
    if (buffer.length < expectedBytes) throw new Error('FFmpeg returned 0');
    const frames = [];
    for (let i = 0; i < expectedFrameCount; i++) {
      const start = i * STACKED_FRAME_BYTES;
      frames.push(splitStackedFrame(buffer.subarray(start, start + STACKED_FRAME_BYTES)));
    }
    return frames;
  });
}

function extractGrayFrame(videoPath, timestamp, run, executionOptions) {
  const args = buildGrayFrameExtractionArgs(videoPath, timestamp, executionOptions);
  return extractGrayFramesWithArgs(args, 1, run).then((frames) => frames[0]);
}

function extractGrayFrames(videoPath, timestamps, run, executionOptions) {
  const expectedFrameCount = Math.max(1, Array.isArray(timestamps) ? timestamps.length : 0);
  const args = buildGrayFramesExtractionArgs(videoPath, timestamps, executionOptions);
  return extractGrayFramesWithArgs(args, expectedFrameCount, run);
}

// `frames` holds `{ primary, analysis }` per sample, or null for a position that could not be decoded.
// Such a position keeps its row, marked unreadable and with empty values, so the fingerprint is
// complete and the video is not extracted again on every run.
function buildFingerprintsFromGrayFrames(frames, timestamps) {
  const darkRatios = frames.map((frame) => (frame ? frameDarkRatio(frame.primary) : null));
  // Black bars are judged over the whole video, so that one scene with dark edges is not a border.
  const border = detectBorder(
    frames
      .filter((frame, index) => frame && !isDarkSample({ darkRatio: darkRatios[index] }))
      .map((frame) => frame.analysis),
    timestamps.length > 1 ? 2 : 1,
  );
  const fingerprints = [];
  for (let i = 0; i < timestamps.length; i++) {
    const frame = frames[i];
    if (!frame) {
      fingerprints.push({
        sampleIndex: i,
        timestampSecs: timestamps[i],
        phashHex: '',
        flippedPHashHex: null,
        grayBytes: Buffer.alloc(0),
        frameDarkRatio: null,
        sampleState: 'unreadable',
      });
      continue;
    }
    const cropped = border ? cropToPrimary(frame.analysis, border) : null;
    fingerprints.push({
      sampleIndex: i,
      timestampSecs: timestamps[i],
      phashHex: calculateDctPHash(frame.primary),
      // Always stored, so turning on mirrored comparison needs no new fingerprints.
      flippedPHashHex: calculateDctPHash(flipGrayBytes(frame.primary)),
      grayBytes: frame.primary,
      frameDarkRatio: darkRatios[i],
      lumaRange: lumaRange(frame.primary),
      // The picture without its black bars, stored beside the full frame; not compared yet.
      borderLtrb: border ? [border.left, border.top, border.right, border.bottom].join(',') : null,
      cropPHashHex: cropped ? calculateDctPHash(cropped) : null,
      cropFlippedPHashHex: cropped ? calculateDctPHash(flipGrayBytes(cropped)) : null,
      cropGrayBytes: cropped,
    });
  }
  return fingerprints;
}

// Returns the frame and the time it was read at, or null when no nearby time yields a frame.
async function extractSampleWithRetries(videoPath, timestamp, run, executionOptions) {
  for (const offset of SAMPLE_RETRY_OFFSETS_SECS) {
    const attemptTimestamp = Math.max(0, timestamp + offset);
    try {
      return {
        frame: await extractGrayFrame(videoPath, attemptTimestamp, run, executionOptions),
        timestamp: attemptTimestamp,
      };
    } catch (err) {
      // Only "no frame came back" is about this position. Cancellation, a timeout or an unopenable
      // file ends the whole video, as before.
      if (!shouldFallbackToSingleFrameExtraction(err)) throw err;
    }
  }
  return null;
}

async function buildFingerprintsForVideo(video, settings, run, executionOptions) {
  let timestamps = getSamplingTimestamps(video.durationSecs, settings.sampleCount, settings, video.fps);
  let grayFrames;
  try {
    grayFrames = await extractGrayFrames(video.path, timestamps, run, executionOptions);
  } catch (err) {
    if (!shouldFallbackToSingleFrameExtraction(err)) throw err;
    duplicateLog('Falling back to single-frame fingerprint extraction', {
      filename: video.filename,
      path: video.path,
      sampleCount: timestamps.length,
      reason: err?.message || String(err),
    });
    const samples = [];
    for (const timestamp of timestamps) {
      assertNotCancelled(run);
      samples.push(await extractSampleWithRetries(video.path, timestamp, run, executionOptions));
    }
    if (samples.every((sample) => !sample)) throw new Error('FFmpeg returned no frame at any sample position');
    grayFrames = samples.map((sample) => sample?.frame ?? null);
    timestamps = samples.map((sample, index) => sample?.timestamp ?? timestamps[index]);
  }
  assertNotCancelled(run);
  return runDuplicateActivity(
    run,
    () => buildFingerprintsFromGrayFrames(grayFrames, timestamps),
  );
}

async function backfillFingerprints(videos, duplicateState, settings, run, sendProgress, maxConcurrency = 2, executionOptions = {}, cacheAccess, cacheOptions) {
  const fingerprintKey = duplicateState.fingerprintKey;
  const missing = [];
  let skippedFailed = 0;
  const unreadableVideoIds = new Set(duplicateState.comparisonRows
    .filter((row) => row.sample_state === 'unreadable')
    .map((row) => row.video_id));
  for (const video of videos) {
    const complete = duplicateState.completeById.get(video.id)
      && !(settings.retryFailedFingerprintExtraction && unreadableVideoIds.has(video.id));
    const failedPreviously = !settings.retryFailedFingerprintExtraction && duplicateState.failedIds.has(video.id);
    if (!complete && !failedPreviously) missing.push(video);
    else if (!complete && failedPreviously) skippedFailed++;
  }

  progress(sendProgress, 'Building fingerprints', { current: 0, total: missing.length });
  duplicateLog('Fingerprint backfill prepared', {
    missing: missing.length,
    skippedFailed,
    sampleCount: settings.sampleCount,
    compareFlipped: settings.compareFlipped,
    retryFailed: settings.retryFailedFingerprintExtraction,
  });
  let current = 0;
  let saved = 0;
  let failed = 0;
  const failureExamples = [];
  const checkpointEveryMs = settings.checkpointIntervalMinutes > 0
    ? Math.max(15000, settings.checkpointIntervalMinutes * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  let lastCheckpoint = Date.now();
  const queue = [...missing];
  const takeNextVideo = createQueueCursor(queue);
  const workerCount = Math.max(1, Math.min(Math.floor(maxConcurrency) || 1, queue.length || 1));
  duplicateLog('Fingerprint workers starting', { workers: workerCount });

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      await waitForDuplicateProcessing(run);
      const video = takeNextVideo();
      if (!video) break;
      try {
        const fingerprints = await buildFingerprintsForVideo(video, settings, run, executionOptions);
        assertNotCancelled(run);
        await cacheAccess.saveVideoFingerprints(
          path.dirname(video.path),
          cacheOptions,
          video.id,
          fingerprints,
          fingerprintKey,
        );
        duplicateSessionCache.rememberFingerprints(video.id, fingerprints, settings.comparisonMode);
        duplicateState.completeById.set(video.id, true);
        duplicateState.failedIds.delete(video.id);
        duplicateState.comparisonRows = duplicateState.comparisonRows.filter((row) => row.video_id !== video.id);
        duplicateState.comparisonRows.push(...fingerprints.map((fingerprint) => fingerprintToRow(video.id, fingerprint)));
        saved++;
      } catch (err) {
        if (err instanceof DuplicateCancelledError) throw err;
        // The cache refuses every write while it is closed for a reset, migration or shutdown. That
        // says nothing about this video, so stop all workers instead of marking it as failed.
        if (err?.code === CACHE_UNAVAILABLE_CODE) {
          run.cancel();
          throw new DuplicateCancelledError();
        }
        // Same rule as metadata reads: a timeout means the drive was slow, not that the video is
        // unreadable, so it is not stored and the video is tried again on the next run.
        if (!run?.cancelled && err?.code !== 'ETIMEDOUT') {
          try {
            await cacheAccess.markFingerprintFailure(
              path.dirname(video.path),
              cacheOptions,
              video.id,
              fingerprintKey,
            );
            duplicateSessionCache.rememberFingerprintFailure(video.id);
            duplicateState.failedIds.add(video.id);
          } catch (markError) {
            duplicateLog('Could not record fingerprint failure', {
              path: video.path,
              error: markError?.message || String(markError),
            });
          }
        }
        failed++;
        if (failureExamples.length < 8) {
          failureExamples.push({
            filename: video.filename,
            path: video.path,
            error: err?.message || String(err),
          });
        }
      }
      current++;
      progress(sendProgress, 'Building fingerprints', { current, total: missing.length });
      await new Promise((resolve) => setImmediate(resolve));
      if (Date.now() - lastCheckpoint >= checkpointEveryMs) {
        lastCheckpoint = Date.now();
        duplicateLog('Fingerprint checkpoint reached', { processed: current });
      }
    }
  });

  await Promise.all(workers);
  duplicateLog('Fingerprint backfill complete', {
    processed: current,
    saved,
    failed,
    failureExamples,
  });
}

function createSimilarityRevalidator(settings, comparisonData = null) {
  if (!comparisonData?.mode || !Array.isArray(comparisonData.rows)) return null;
  const phash = comparisonData.mode === 'phash';
  if (!phash && comparisonData.mode !== 'visual') return null;

  const samplesByVideo = phash
    ? pHashSamplesByVideo(comparisonData.rows, settings.sampleCount)
    : graySamplesByVideo(comparisonData.rows, settings.sampleCount);
  const sampleScore = phash ? pHashSampleScore : graySampleScore(settings);
  const scoreOptions = { firstSampleOnly: phash && settings.phashFirstSampleOnly };
  const computeSimilarity = (aId, bId, enforceThreshold) => {
    const samplesA = samplesByVideo.get(aId);
    const samplesB = samplesByVideo.get(bId);
    if (!samplesA || !samplesB) return undefined;
    const result = scoreSamples(samplesA, samplesB, settings, sampleScore, scoreOptions);
    if (!result) return null;
    return !enforceThreshold || result.similarity >= settings.finalSimilarityThreshold ? result.similarity : null;
  };
  const revalidateSimilarity = (aId, bId) => computeSimilarity(aId, bId, true);
  revalidateSimilarity.score = (aId, bId) => computeSimilarity(aId, bId, false);
  return revalidateSimilarity;
}

function runPHashWorker(videos, phashRows, settings, run, sendProgress) {
  return new Promise((resolve, reject) => {
    duplicateLog('Starting pHash comparison worker', {
      videos: videos.length,
      fingerprints: phashRows.length,
      similarity: settings.finalSimilarityThreshold,
    });
    progress(sendProgress, 'Comparing pHashes', { current: 0, total: 0 });
    const pauseHandle = processingPause.createWorkerPauseHandle();
    const worker = new Worker(path.join(__dirname, 'duplicate-worker.js'), {
      workerData: {
        videos: videos.map((video) => ({
          id: video.id,
          durationSecs: video.durationSecs,
        })),
        phashRows,
        settings,
        pauseSignal: pauseHandle.buffer,
      },
    });
    run.worker = worker;
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        progress(sendProgress, 'Comparing pHashes', { current: message.compared, total: message.total });
      } else if (message.type === 'paused') {
        pauseHandle.markPaused();
      } else if (message.type === 'done') {
        run.worker = null;
        pauseHandle.release();
        progress(sendProgress, 'Comparing pHashes', { current: message.total, total: message.total });
        duplicateLog('pHash comparison complete', {
          compared: message.compared,
          possiblePairs: message.total,
          pairs: message.pairs?.length ?? 0,
          bucketed: message.bucketed,
          buckets: message.bucketCount,
          unknownDurationCount: message.unknownDurationCount,
        });
        resolve(message.pairs ?? []);
      } else if (message.type === 'error') {
        run.worker = null;
        pauseHandle.release();
        reject(new Error(message.message));
      }
    });
    worker.on('error', (err) => {
      run.worker = null;
      pauseHandle.release();
      if (run.cancelled) reject(new DuplicateCancelledError());
      else reject(err);
    });
    worker.on('exit', (code) => {
      run.worker = null;
      pauseHandle.release();
      if (run.cancelled) reject(new DuplicateCancelledError());
      else if (code !== 0) reject(new Error(`Duplicate worker exited with ${code}`));
    });
  });
}

function runVisualWorker(videos, grayRows, settings, run, sendProgress) {
  return new Promise((resolve, reject) => {
    duplicateLog('Starting visual comparison worker', {
      videos: videos.length,
      graySamples: grayRows.length,
      similarity: settings.finalSimilarityThreshold,
      durationTolerancePercent: settings.durationTolerancePercent,
    });
    progress(sendProgress, 'Confirming visual matches', { current: 0, total: 0 });
    const pauseHandle = processingPause.createWorkerPauseHandle();
    const worker = new Worker(path.join(__dirname, 'visual-worker.js'), {
      workerData: {
        videos: videos.map((video) => ({
          id: video.id,
          durationSecs: video.durationSecs,
        })),
        grayRows,
        settings,
        pauseSignal: pauseHandle.buffer,
      },
    });
    run.worker = worker;
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        progress(sendProgress, 'Confirming visual matches', { current: message.compared, total: message.total });
      } else if (message.type === 'paused') {
        pauseHandle.markPaused();
      } else if (message.type === 'done') {
        run.worker = null;
        pauseHandle.release();
        progress(sendProgress, 'Confirming visual matches', { current: message.total, total: message.total });
        duplicateLog('Visual comparison worker complete', {
          compared: message.compared,
          possiblePairs: message.total,
          pairs: message.pairs?.length ?? 0,
          bucketed: message.bucketed,
          buckets: message.bucketCount,
        });
        resolve(message.pairs ?? []);
      } else if (message.type === 'error') {
        run.worker = null;
        pauseHandle.release();
        reject(new Error(message.message));
      }
    });
    worker.on('error', (err) => {
      run.worker = null;
      pauseHandle.release();
      if (run.cancelled) reject(new DuplicateCancelledError());
      else reject(err);
    });
    worker.on('exit', (code) => {
      run.worker = null;
      pauseHandle.release();
      if (run.cancelled) reject(new DuplicateCancelledError());
      else if (code !== 0) reject(new Error(`Visual duplicate worker exited with ${code}`));
    });
  });
}

/** In-memory pair key using null-byte separator (can't appear in video IDs). */
function internalPairKey(aId, bId) {
  return aId < bId ? `${aId}\0${bId}` : `${bId}\0${aId}`;
}

/** Persisted pair key using pipe separator — stored in settings JSON. */
function storedPairKey(aId, bId) {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function buildExactRepresentativeIndex(exactGroups, videos, settings) {
  const ignoredPairKeys = new Set(settings?.ignoredDuplicatePairs ?? []);
  const orderById = new Map(videos.map((video, index) => [video.id, index]));
  const videosById = new Map(videos.map((video) => [video.id, video]));
  const representativeByVideoId = new Map();
  const membersByRepresentativeId = new Map();

  for (const ids of exactGroups) {
    const pending = new Set(ids.filter((id) => orderById.has(id)));
    while (pending.size > 0) {
      const start = pending.values().next().value;
      const stack = [start];
      const component = [];
      pending.delete(start);

      while (stack.length > 0) {
        const currentId = stack.pop();
        component.push(currentId);
        for (const otherId of [...pending]) {
          if (ignoredPairKeys.has(storedPairKey(currentId, otherId))) continue;
          pending.delete(otherId);
          stack.push(otherId);
        }
      }

      if (component.length < 2) continue;
      component.sort((aId, bId) => (orderById.get(aId) ?? 0) - (orderById.get(bId) ?? 0));
      const representativeId = component[0];
      membersByRepresentativeId.set(representativeId, component);
      for (const videoId of component) representativeByVideoId.set(videoId, representativeId);
    }
  }

  const representativeVideos = [];
  const seenRepresentatives = new Set();
  for (const video of videos) {
    const representativeId = representativeByVideoId.get(video.id) ?? video.id;
    if (!membersByRepresentativeId.has(representativeId)) {
      membersByRepresentativeId.set(representativeId, [video.id]);
      representativeByVideoId.set(video.id, representativeId);
    }
    if (seenRepresentatives.has(representativeId)) continue;
    seenRepresentatives.add(representativeId);
    representativeVideos.push(video.id === representativeId
      ? video
      : videosById.get(representativeId) || video);
  }

  return {
    representativeVideos,
    representativeByVideoId,
    membersByRepresentativeId,
  };
}

function expandRepresentativePairs(pairs, membersByRepresentativeId) {
  const expanded = [];
  const seenPairs = new Set();

  for (const pair of pairs) {
    const memberIdsA = membersByRepresentativeId.get(pair.aId) ?? [pair.aId];
    const memberIdsB = membersByRepresentativeId.get(pair.bId) ?? [pair.bId];
    for (const aId of memberIdsA) {
      for (const bId of memberIdsB) {
        if (aId === bId) continue;
        const key = internalPairKey(aId, bId);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        expanded.push({ ...pair, aId, bId });
      }
    }
  }

  return expanded;
}

function connectionScore(aId, bId, directSimilarity, threshold) {
  const similarity = directSimilarity(aId, bId);
  return similarity !== null && similarity >= threshold ? similarity : null;
}

function pruneWeakDaisyChainMembers(ids, directSimilarity, threshold) {
  const active = [...ids];
  const pruned = [];

  while (active.length >= 3) {
    const requiredConnections = Math.ceil((active.length - 1) / 2);
    const scored = active.map((id) => {
      let connections = 0;
      let totalSimilarity = 0;
      for (const otherId of active) {
        if (otherId === id) continue;
        const score = connectionScore(id, otherId, directSimilarity, threshold);
        if (score !== null) {
          connections++;
          totalSimilarity += score;
        }
      }
      return { id, connections, totalSimilarity };
    });

    const weakest = [...scored].sort((a, b) => {
      if (a.connections !== b.connections) return a.connections - b.connections;
      if (a.totalSimilarity !== b.totalSimilarity) return a.totalSimilarity - b.totalSimilarity;
      return String(a.id).localeCompare(String(b.id));
    })[0];

    if (!weakest || weakest.connections >= requiredConnections) break;
    active.splice(active.indexOf(weakest.id), 1);
    pruned.push(weakest.id);
  }

  return { coreIds: active, prunedIds: pruned };
}

function connectedComponents(ids, directSimilarity, threshold) {
  const remaining = new Set(ids);
  const components = [];

  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const stack = [start];
    const component = [];
    remaining.delete(start);

    while (stack.length > 0) {
      const id = stack.pop();
      component.push(id);
      for (const otherId of [...remaining]) {
        if (connectionScore(id, otherId, directSimilarity, threshold) === null) continue;
        remaining.delete(otherId);
        stack.push(otherId);
      }
    }

    components.push(component);
  }

  return components;
}

function splitDaisyChainIds(ids, directSimilarity, threshold) {
  if (ids.length < 3) return [ids];

  const { coreIds, prunedIds } = pruneWeakDaisyChainMembers(ids, directSimilarity, threshold);
  const groups = [];
  if (coreIds.length >= 2) groups.push(coreIds);

  for (const component of connectedComponents(prunedIds, directSimilarity, threshold)) {
    if (component.length < 2) continue;
    const nestedGroups = splitDaisyChainIds(component, directSimilarity, threshold);
    for (const nested of nestedGroups) {
      if (nested.length >= 2) groups.push(nested);
    }
  }

  return groups.length > 0 ? groups : [];
}

function splitDaisyChainGroups(candidateGroups, directSimilarity, threshold, revalidateSimilarity = null) {
  const splitGroups = [];
  let groupsSplit = 0;
  let removedSingletons = 0;

  for (const candidate of candidateGroups) {
    const ids = Array.from(candidate.ids);
    const usedRevalidation = ids.length >= 3 && Boolean(revalidateSimilarity);
    const similarityForValidation = usedRevalidation
      ? (aId, bId) => {
          const recomputed = revalidateSimilarity(aId, bId);
          return recomputed === undefined ? directSimilarity(aId, bId) : recomputed;
        }
      : directSimilarity;
    const splitIds = splitDaisyChainIds(ids, similarityForValidation, threshold);
    if (splitIds.length === 1 && splitIds[0].length === ids.length) {
      splitGroups.push({ ...candidate, usedRevalidation });
      continue;
    }

    groupsSplit++;
    const retainedIds = new Set(splitIds.flat());
    removedSingletons += ids.filter((id) => !retainedIds.has(id)).length;
    for (const groupIds of splitIds) {
      splitGroups.push({
        ids: new Set(groupIds),
        representativeId: groupIds.includes(candidate.representativeId)
          ? candidate.representativeId
          : groupIds[0],
        usedRevalidation,
      });
    }
  }

  return { groups: splitGroups, stats: { groupsSplit, removedSingletons } };
}

function stableDuplicateGroupId(ids) {
  return `dup-${crypto.createHash('sha1').update([...ids].sort().join('\0')).digest('hex').slice(0, 16)}`;
}

function buildGroups(exactGroups, matchedPairs, videosById, settings, options = {}) {
  const ignoredPairKeys = new Set(settings.ignoredDuplicatePairs ?? []);
  const isIgnoredPair = (aId, bId) => ignoredPairKeys.has(storedPairKey(aId, bId));
  const revalidateScore = typeof options.revalidateSimilarity?.score === 'function'
    ? options.revalidateSimilarity.score
    : null;
  const exactPairKeys = new Set();
  const exactPairs = [];
  for (const ids of exactGroups) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (isIgnoredPair(ids[i], ids[j])) continue;
        exactPairKeys.add(internalPairKey(ids[i], ids[j]));
        exactPairs.push({
          aId: ids[i],
          bId: ids[j],
          similarity: 100,
          matchType: 'exact',
        });
      }
    }
  }
  const matchedByPair = new Map();
  for (const pair of matchedPairs) {
    if (isIgnoredPair(pair.aId, pair.bId)) continue;
    matchedByPair.set(internalPairKey(pair.aId, pair.bId), pair);
  }

  const directSimilarity = (aId, bId) => {
    const key = internalPairKey(aId, bId);
    if (exactPairKeys.has(key)) return 100;
    return matchedByPair.get(key)?.similarity ?? null;
  };

  const candidateGroups = [];
  const groupByVideo = new Map();
  const addVideoToGroup = (group, videoId) => {
    group.ids.add(videoId);
    groupByVideo.set(videoId, group);
  };
  const groupCanAcceptVideo = (group, videoId) => {
    for (const existingId of group.ids) {
      if (isIgnoredPair(existingId, videoId)) return false;
    }
    return true;
  };
  const groupsCanMerge = (groupA, groupB) => {
    for (const idA of groupA.ids) {
      for (const idB of groupB.ids) {
        if (isIgnoredPair(idA, idB)) return false;
      }
    }
    return true;
  };

  const allPairs = [
    ...exactPairs,
    ...Array.from(matchedByPair.values()),
  ].sort((a, b) => b.similarity - a.similarity);

  for (const pair of allPairs) {
    const groupA = groupByVideo.get(pair.aId);
    const groupB = groupByVideo.get(pair.bId);

    if (groupA && groupB) {
      if (groupA === groupB) continue;
      if (!groupsCanMerge(groupA, groupB)) continue;
      const representativeScore = directSimilarity(groupA.representativeId, groupB.representativeId);
      if (representativeScore === null || representativeScore < settings.finalSimilarityThreshold) continue;
      for (const videoId of groupB.ids) addVideoToGroup(groupA, videoId);
      candidateGroups.splice(candidateGroups.indexOf(groupB), 1);
      continue;
    }

    if (groupA || groupB) {
      const target = groupA || groupB;
      const newVideoId = groupA ? pair.bId : pair.aId;
      if (!groupCanAcceptVideo(target, newVideoId)) continue;
      const representativeScore = directSimilarity(target.representativeId, newVideoId);
      if (representativeScore === null || representativeScore < settings.finalSimilarityThreshold) continue;
      addVideoToGroup(target, newVideoId);
      continue;
    }

    const group = { ids: new Set(), representativeId: pair.aId };
    addVideoToGroup(group, pair.aId);
    addVideoToGroup(group, pair.bId);
    candidateGroups.push(group);
  }

  const { groups: validatedGroups, stats: daisyChainStats } = splitDaisyChainGroups(
    candidateGroups,
    directSimilarity,
    settings.finalSimilarityThreshold,
    options.revalidateSimilarity ?? null,
  );
  if (daisyChainStats.groupsSplit > 0 || daisyChainStats.removedSingletons > 0) {
    duplicateLog('Daisy-chain validation complete', daisyChainStats);
  }

  // The representative gate above keeps out a video, or a whole smaller group, that misses the one
  // representative while matching most members. Each is admitted to the group in which every one of
  // its videos matches at least half of the members, as the validation above requires, and at least
  // two of them, so that a single match never joins anything.
  const revalidate = options.revalidateSimilarity;
  // A grown group has three or more members, so recomputed scores apply as in the validation.
  const admissionSimilarity = revalidate
    ? (aId, bId) => {
        const recomputed = revalidate(aId, bId);
        return recomputed === undefined ? directSimilarity(aId, bId) : recomputed;
      }
    : directSimilarity;
  const groupedIds = new Set(validatedGroups.flatMap((group) => [...group.ids]));
  const ungrouped = [...new Set(allPairs.flatMap((pair) => [pair.aId, pair.bId]))]
    .filter((id) => !groupedIds.has(id))
    .sort()
    .map((id) => ({ ids: new Set([id]) }));
  const joiners = [...ungrouped, ...validatedGroups].sort((a, b) => a.ids.size - b.ids.size);
  for (const joiner of joiners) {
    let best = null;
    for (const group of validatedGroups) {
      if (group === joiner || group.ids.size < 2 || group.ids.size < joiner.ids.size) continue;
      if (!groupsCanMerge(group, joiner)) continue;
      const required = Math.max(2, Math.ceil(group.ids.size / 2));
      let fewestConnections = Infinity;
      for (const videoId of joiner.ids) {
        let connections = 0;
        for (const memberId of group.ids) {
          if (connectionScore(videoId, memberId, admissionSimilarity, settings.finalSimilarityThreshold) !== null) connections++;
        }
        fewestConnections = Math.min(fewestConnections, connections);
        if (connections < required) break;
      }
      if (fewestConnections >= required && fewestConnections > (best?.connections ?? 0)) {
        best = { group, connections: fewestConnections };
      }
    }
    if (!best) continue;
    for (const videoId of joiner.ids) best.group.ids.add(videoId);
    best.group.usedRevalidation = Boolean(revalidate);
    // Emptied, so it is neither listed as a group nor joined by a later one.
    joiner.ids = new Set();
  }

  const groups = [];
  for (const candidate of validatedGroups) {
    const ids = Array.from(candidate.ids);
    if (ids.length < 2) continue;
    const videos = ids.map((id) => videosById.get(id)).filter(Boolean);
    const keeper = chooseSuggestedKeeper(videos, settings);
    const similarities = [];
    const exactVideoIds = new Set();
    let hasExact = false;
    let fuzzyMatchType = null;
    const resolveGroupPairSimilarity = (aId, bId) => {
      if (!candidate.usedRevalidation || !revalidateScore) return directSimilarity(aId, bId);
      const recomputed = revalidateScore(aId, bId);
      return recomputed === undefined ? directSimilarity(aId, bId) : recomputed;
    };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = internalPairKey(ids[i], ids[j]);
        if (exactPairKeys.has(key)) {
          similarities.push(100);
          hasExact = true;
          exactVideoIds.add(ids[i]);
          exactVideoIds.add(ids[j]);
        }
        const matched = matchedByPair.get(key);
        if (matched) {
          const resolvedSimilarity = resolveGroupPairSimilarity(ids[i], ids[j]);
          if (resolvedSimilarity !== null) similarities.push(resolvedSimilarity);
          fuzzyMatchType = fuzzyMatchType && fuzzyMatchType !== matched.matchType ? 'mixed' : matched.matchType;
        }
      }
    }
    const matchType = hasExact && fuzzyMatchType ? 'mixed' : hasExact ? 'exact' : fuzzyMatchType || settings.comparisonMode;
    const comparisonLabel = matchType === 'phash' ? 'pHash' : 'Visual';
    groups.push({
      id: stableDuplicateGroupId(ids),
      videoIds: ids,
      // The weakest matched pair, rounded down, so filtering groups by this score
      // behaves like scanning at that threshold.
      similarity: similarities.length > 0
        ? Math.floor(similarities.reduce((min, value) => Math.min(min, value), Infinity) * 10 + 1e-9) / 10
        : 0,
      averageSimilarity: Math.round(average(similarities) * 10) / 10,
      matchType,
      suggestedKeeperId: keeper?.id ?? null,
      exactVideoIds: Array.from(exactVideoIds),
      reason: matchType === 'exact'
        ? 'Exact file match'
        : matchType === 'mixed'
          ? 'Exact and similarity matches in one group'
          : `${comparisonLabel}: every matched pair >= ${settings.finalSimilarityThreshold}%`,
    });
  }

  return groups.sort((a, b) => {
    if (a.matchType === b.matchType) return b.similarity - a.similarity;
    if (a.matchType === 'exact') return -1;
    if (b.matchType === 'exact') return 1;
    return 0;
  });
}

function deriveVideos(videos, groups) {
  const groupByVideo = new Map();
  for (const group of groups) {
    for (const videoId of group.videoIds) groupByVideo.set(videoId, group);
  }
  return videos.map((video) => {
    const group = groupByVideo.get(video.id);
    if (!group) {
      return {
        id: video.id,
        duplicateGroupId: null,
        duplicateSimilarity: null,
        duplicateMatchType: null,
        duplicateSuggestedKeeper: false,
        duplicateExact: false,
        duplicateGroupSize: 0,
        duplicateMatchReason: null,
      };
    }
    return {
      id: video.id,
      duplicateGroupId: group.id,
      duplicateSimilarity: group.similarity,
      duplicateMatchType: group.matchType,
      duplicateSuggestedKeeper: group.suggestedKeeperId === video.id,
      duplicateExact: group.matchType === 'exact' || Boolean(group.exactVideoIds?.includes(video.id)),
      duplicateGroupSize: group.videoIds.length,
      duplicateMatchReason: group.reason,
    };
  });
}

async function findDuplicates({ videos, settings: rawSettings, cacheAccess, cacheOptions, maxConcurrency, executionOptions, run, sendProgress }) {
  const settings = normalizeDuplicateSettings(rawSettings);
  const safeVideos = Array.isArray(videos) ? videos.filter((video) => video?.id && video?.path) : [];
  const videosById = new Map(safeVideos.map((video) => [video.id, video]));
  duplicateLog('Run started', {
    videos: safeVideos.length,
    method: settings.comparisonMode,
    sampleCount: settings.sampleCount,
    similarity: settings.finalSimilarityThreshold,
  });
  progress(sendProgress, 'Preparing', { current: 0, total: safeVideos.length });

  const duplicateState = await loadDuplicateCacheState(safeVideos, settings, run, cacheAccess, cacheOptions);
  duplicateLog('Cache data ready', { folders: groupVideosByFolder(safeVideos).size });

  const exactGroups = await findExactGroups(safeVideos, duplicateState, settings, run, sendProgress, cacheAccess, cacheOptions);
  const representativeIndex = buildExactRepresentativeIndex(exactGroups, safeVideos, settings);
  const representativeVideos = representativeIndex.representativeVideos;
  duplicateLog('Representative reduction prepared', {
    videos: safeVideos.length,
    representatives: representativeVideos.length,
    reducedBy: safeVideos.length - representativeVideos.length,
  });
  await backfillFingerprints(
    representativeVideos,
    duplicateState,
    settings,
    run,
    sendProgress,
    maxConcurrency,
    executionOptions,
    cacheAccess,
    cacheOptions,
  );
  assertNotCancelled(run);
  let similarityPairs = [];
  let comparisonData = null;
  const representativeIds = new Set(representativeVideos.map((video) => video.id));
  const comparisonRows = duplicateState.comparisonRows.filter((row) => representativeIds.has(row.video_id));
  if (settings.comparisonMode === 'phash') {
    const phashRows = comparisonRows;
    comparisonData = { mode: 'phash', rows: phashRows };
    const expectedRows = representativeVideos.length * settings.sampleCount;
    duplicateLog('pHash rows loaded', {
      rows: phashRows.length,
      expectedRows,
      missingRows: Math.max(0, expectedRows - phashRows.length),
      missingVideosApprox: Math.ceil(Math.max(0, expectedRows - phashRows.length) / settings.sampleCount),
    });
    const pHashPairs = await runPHashWorker(representativeVideos, phashRows, settings, run, sendProgress);
    similarityPairs = expandRepresentativePairs(pHashPairs.map((pair) => ({
      ...pair,
      similarity: pair.pHashSimilarity,
      matchType: 'phash',
    })), representativeIndex.membersByRepresentativeId);
  } else {
    assertNotCancelled(run);
    const grayRows = comparisonRows;
    comparisonData = { mode: 'visual', rows: grayRows };
    duplicateLog('Gray sample rows loaded', { rows: grayRows.length });
    const visualPairs = await runVisualWorker(representativeVideos, grayRows, settings, run, sendProgress);
    similarityPairs = expandRepresentativePairs(visualPairs, representativeIndex.membersByRepresentativeId);
  }
  assertNotCancelled(run);
  progress(sendProgress, 'Building groups', { current: 0, total: 1 });
  const groups = buildGroups(exactGroups, similarityPairs, videosById, settings, {
    revalidateSimilarity: createSimilarityRevalidator(settings, comparisonData),
  });
  progress(sendProgress, 'Building groups', { current: 1, total: 1 });
  const result = {
    groups,
    videos: deriveVideos(safeVideos, groups),
    settings,
    stats: {
      groupCount: groups.length,
      duplicateVideoCount: groups.reduce((sum, group) => sum + group.videoIds.length, 0),
      exactGroupCount: groups.filter((group) => group.matchType === 'exact').length,
      similarityGroupCount: groups.filter((group) => group.matchType !== 'exact').length,
    },
  };
  duplicateLog('Run complete', result.stats);
  return result;
}

function rememberDuplicateSignatures(videos) {
  duplicateSessionCache.rememberSignatures(Array.isArray(videos) ? videos : []);
}

function forgetDuplicateVideos(videoIds) {
  duplicateSessionCache.deleteVideos(Array.isArray(videoIds) ? videoIds : []);
}

function clearDuplicateSessionCache() {
  duplicateSessionCache.clear();
}

module.exports = {
  DuplicateCancelledError,
  clearDuplicateSessionCache,
  createDuplicateRun,
  findDuplicates,
  forgetDuplicateVideos,
  rememberDuplicateSignatures,
  __test__: {
    backfillFingerprints,
    buildGroups,
    buildExactRepresentativeIndex,
    buildFingerprintsFromGrayFrames,
    buildGrayFramesExtractionArgs,
    shouldFallbackToSingleFrameExtraction,
    expandRepresentativePairs,
    findExactGroups,
    loadDuplicateCacheState,
    splitDaisyChainIds,
  },
};
