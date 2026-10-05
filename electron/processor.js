const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { processingPause } = require('./processing-pause');
const mediaProcess = require('./media-process');
const { createRunToken, cancelRun, toFfmpegInputPath } = mediaProcess;

let thumbToken = null;
let metadataToken = null;
const METADATA_SCHEMA_VERSION = 2;
const SINGLE_THUMBNAIL_VIDEO_DURATION_SECS = 10;
// A single-frame seek normally takes well under a second. These limits only stop a hung decoder,
// or a file on a very slow share, from holding a worker slot for the rest of the run.
const FRAME_EXTRACTION_TIMEOUT_MS = 120_000;
const VIDEO_EXTRACTION_BUDGET_MS = 300_000;

function parseFpsRational(value) {
  if (!value || value === '0/0') return null;
  const [rawNum, rawDen] = String(value).split('/');
  const num = Number(rawNum);
  const den = Number(rawDen);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 100) / 100;
}

function parseBitrate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

/**
 * Get duration, creation_time, codec, resolution, fps, and bitrate via ffprobe.
 */
async function getVideoMetadata(filePath, token = createRunToken()) {
  const stat = await fs.stat(filePath);
  const metadata = await mediaProcess.probe(filePath, token);
  const duration = Number(metadata.format.duration) || 0;
  const formatBitrate = parseBitrate(metadata.format.bit_rate);
  const calculatedTotalBitrate = !formatBitrate && duration > 0 && stat.size
    ? Math.round((stat.size * 8) / duration)
    : null;
  const totalBitrate = formatBitrate ?? calculatedTotalBitrate;
  // Try to extract creation_time from format tags (camera date)
  let creationTime = null;
  const tags = metadata.format.tags;
  if (tags) {
    const raw = tags.creation_time || tags.Creation_Time || tags.CREATION_TIME;
    if (raw) {
      const parsed = new Date(raw).getTime();
      // FFmpeg 9 reports an unset ASF/WMV creation date as 1970-01-01; that is "no date", not a date.
      if (!isNaN(parsed) && parsed > 0) creationTime = parsed;
    }
  }

  const streams = metadata.streams;
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const audioBitrate = parseBitrate(audioStream?.bit_rate);
  const parsedVideoBitrate = parseBitrate(videoStream?.bit_rate);
  const derivedVideoBitrate = !parsedVideoBitrate && totalBitrate && audioBitrate
    ? Math.max(0, totalBitrate - audioBitrate)
    : null;
  const fps =
    parseFpsRational(videoStream?.avg_frame_rate) ??
    parseFpsRational(videoStream?.r_frame_rate) ??
    null;

  return {
    duration,
    creationTime,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    videoBitrate: parsedVideoBitrate ?? derivedVideoBitrate,
    audioBitrate,
    totalBitrate,
    containerFormat: metadata.format.format_name ?? null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    fps,
    metadataVersion: METADATA_SCHEMA_VERSION,
    metadataCheckedAt: Date.now(),
  };
}

/**
 * Calculate N evenly-spaced timestamps.
 * Handles very short videos gracefully.
 */
function calculateTimestamps(duration, count, skipDelaySecs) {
  if (duration <= 0) return [0];

  const start = skipDelaySecs;
  const end = duration * 0.97;

  // For very short videos, or videos where the intro skip would pass the safe
  // capture range, take a single frame in the middle.
  if (duration < skipDelaySecs || end <= start) {
    return [duration * 0.5];
  }

  // Normal videos:
  const timestamps = [];

  const step = (end - start) / count;
  for (let i = 0; i < count; i++) {
    const timestamp = start + (step * 0.5) + (step * i);
    timestamps.push(Math.round(timestamp * 100) / 100);
  }
  
  return timestamps;
}

function expectedThumbnailCount(duration, count, skipDelaySecs) {
  if (duration != null && duration > 0) {
    const end = duration * 0.97;
    if (duration < SINGLE_THUMBNAIL_VIDEO_DURATION_SECS || duration < skipDelaySecs || end <= skipDelaySecs) return 1;
  }
  return count;
}

async function isNonemptyFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function getReusableThumbnailPaths(existingNames, videoThumbDir, expectedCount) {
  const jpgNames = existingNames.filter((name) => name.toLowerCase().endsWith('.jpg'));
  if (jpgNames.length !== expectedCount) return null;

  const existingByLowerName = new Map(jpgNames.map((name) => [name.toLowerCase(), name]));
  const expectedNames = Array.from(
    { length: expectedCount },
    (_, index) => `thumb_${String(index + 1).padStart(2, '0')}.jpg`
  );
  const reusablePaths = expectedNames.map((name) => {
    const existingName = existingByLowerName.get(name);
    return existingName ? path.join(videoThumbDir, existingName) : null;
  });
  if (reusablePaths.some((filePath) => filePath === null)) return null;

  const completePaths = reusablePaths;
  const nonempty = await Promise.all(completePaths.map((filePath) => isNonemptyFile(filePath)));
  return nonempty.every(Boolean) ? completePaths : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForProcessing(token) {
  return processingPause.checkpoint(
    () => Boolean(token?.cancelled),
    () => new Error('Cancelled'),
  );
}

async function runProcessingActivity(token, operation) {
  await waitForProcessing(token);
  const finish = processingPause.beginActivity();
  try {
    return await operation();
  } finally {
    finish();
  }
}

function getGpuCooldownMs(config = {}) {
  if (!config.hardwareAccel) return 0;
  const configured = Number(config.gpuCooldownMs);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(10000, configured);
  }
  return 1250;
}

function getGpuCooldownBatchSize(config = {}, concurrentLimit) {
  if (!config.hardwareAccel) return 0;
  const configured = Number(config.gpuCooldownBatchSize);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.max(concurrentLimit, Math.min(2000, configured));
  }
  const thumbsPerVideo = Math.max(1, Number(config.thumbsPerVideo) || 6);
  const frameBudget = Math.max(75, Math.floor(1200 / thumbsPerVideo));
  return Math.max(concurrentLimit, Math.min(500, frameBudget));
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

/**
 * Fast seeking (-ss before -i). Same arguments, in the same order, that the previous
 * fluent-ffmpeg command builder produced.
 */
function buildFrameArgs(videoPath, seekTime, outputPath, config) {
  const args = ['-ss', String(seekTime)];
  if (config.hardwareAccel) args.push('-hwaccel', 'auto');
  args.push('-i', toFfmpegInputPath(videoPath), '-y', '-vframes', '1', '-filter:v', 'scale=320:-1', '-q:v', '5');
  // Limit CPU threads to prevent massive spikes when processing parallel
  if (config.cpuThreadsLimited !== false) args.push('-threads', '1');
  args.push(outputPath);
  return args;
}

/**
 * Shared by every frame attempt of one video (slots, retries and the t=0 fallback), so one
 * troublesome file holds a worker for at most this long. Only time spent inside attempts counts:
 * a pause between frames must not use up the budget of a healthy video.
 */
function createExtractionBudget() {
  return { remainingMs: VIDEO_EXTRACTION_BUDGET_MS, timedOut: false };
}

/**
 * Extract a single frame from a video at a given timestamp, retrying at nearby offsets.
 * After any attempt times out, no further attempts are made for this video: a decoder that hung
 * once on a file usually hangs again at the next offset.
 */
async function extractFrame(videoPath, timestamp, outputPath, config, token, budget) {
  const attempts = Array.from(new Set([
    timestamp,
    Math.max(0, timestamp + 0.25),
    Math.max(0, timestamp - 0.25),
    Math.max(0, timestamp + 0.75),
    Math.max(0, timestamp - 0.75),
  ]));

  for (let attemptIndex = 0; ; attemptIndex++) {
    if (token.cancelled) throw new Error('Cancelled');
    if (budget.timedOut || budget.remainingMs <= 0) {
      budget.timedOut = true;
      throw new Error('Frame extraction stopped for this video after a timeout');
    }
    const startedAt = Date.now();
    try {
      await mediaProcess.runFfmpeg(
        buildFrameArgs(videoPath, attempts[attemptIndex], outputPath, config),
        token,
        { timeoutMs: Math.min(FRAME_EXTRACTION_TIMEOUT_MS, budget.remainingMs) },
      );
      return outputPath;
    } catch (err) {
      if (err?.code === 'ETIMEDOUT') budget.timedOut = true;
      if (budget.timedOut || attemptIndex >= attempts.length - 1 || token.cancelled) throw err;
    } finally {
      budget.remainingMs -= Date.now() - startedAt;
    }
  }
}

/**
 * Generate all thumbnails for a single video.
 * Returns { thumbnails: string[], durationSecs: number }.
 */
async function generateThumbnailsForVideo(video, thumbDir, config, token, options = {}) {
  const THUMB_COUNT = Math.max(1, Number(config.thumbsPerVideo) || 6);
  const skipDelay = config.skipIntroDelaySecs !== undefined ? config.skipIntroDelaySecs : 3;

  const videoThumbDir = path.join(thumbDir, video.id);
  await fs.mkdir(videoThumbDir, { recursive: true });
  let duration = video.durationSecs;
  let creationTime = video.metadataDate ?? null;
  let videoCodec = video.videoCodec ?? null;
  let audioCodec = video.audioCodec ?? null;
  let videoBitrate = video.videoBitrate ?? null;
  let audioBitrate = video.audioBitrate ?? null;
  let totalBitrate = video.totalBitrate ?? null;
  let containerFormat = video.containerFormat ?? null;
  let width = video.width ?? null;
  let height = video.height ?? null;
  let fps = video.fps ?? null;

  try {
    const existing = await fs.readdir(videoThumbDir);
    if (!options.forceRegenerate) {
      const expectedCount = expectedThumbnailCount(duration, THUMB_COUNT, skipDelay);
      const reusablePaths = await getReusableThumbnailPaths(existing, videoThumbDir, expectedCount);
      if (reusablePaths) {
        return {
          thumbnails: reusablePaths,
          durationSecs: duration,
          creationTime,
          videoCodec,
          audioCodec,
          videoBitrate,
          audioBitrate,
          totalBitrate,
          containerFormat,
          width,
          height,
          fps,
        };
      }
    }
    // Incomplete or explicitly requested regeneration: clean up and rebuild.
    for (const f of existing) {
      try { await fs.unlink(path.join(videoThumbDir, f)); } catch { /* ignore */ }
    }
  } catch {
    // Directory doesn't exist yet
  }

  const timestamps = calculateTimestamps(duration, THUMB_COUNT, skipDelay);
  const thumbnails = [];
  const budget = createExtractionBudget();

  // Extract frames sequentially within each video. Overall parallelism is handled
  // by processVideos(), so maxConcurrent now maps to active FFmpeg commands.
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    if (token.cancelled) throw new Error('Cancelled');
    const outputPath = path.join(videoThumbDir, `thumb_${String(i + 1).padStart(2, '0')}.jpg`);
    try {
      await runProcessingActivity(token, () => extractFrame(video.path, timestamp, outputPath, config, token, budget));
      if (await isNonemptyFile(outputPath)) {
        thumbnails.push({ index: i, path: outputPath });
      }
    } catch {
      // Frame extraction failed — continue with remaining frames
    }
  }
  
  if (token.cancelled) throw new Error('Cancelled');

  // Keep output order stable even if a future extraction strategy changes ordering.
  thumbnails.sort((a, b) => a.index - b.index);
  const finalPaths = thumbnails.map(t => t.path);

  // If we got zero thumbnails, try one last desperate attempt at timestamp 0
  if (finalPaths.length === 0) {
    const fallbackPath = path.join(videoThumbDir, 'thumb_01.jpg');
    try {
      await runProcessingActivity(token, () => extractFrame(video.path, 0, fallbackPath, config, token, budget));
      if (await isNonemptyFile(fallbackPath)) {
        finalPaths.push(fallbackPath);
      }
    } catch { /* truly can't generate thumbnails for this video */ }
  }

  if (token.cancelled) throw new Error('Cancelled');

  return { thumbnails: finalPaths, durationSecs: duration, creationTime, videoCodec, audioCodec, videoBitrate, audioBitrate, totalBitrate, containerFormat, width, height, fps };
}

async function readMetadataForVideo(video, token) {
  const meta = await getVideoMetadata(video.path, token);

  return {
    thumbnails: video.thumbnails ?? [],
    durationSecs: meta.duration,
    creationTime: meta.creationTime,
    videoCodec: meta.videoCodec,
    audioCodec: meta.audioCodec,
    videoBitrate: meta.videoBitrate,
    audioBitrate: meta.audioBitrate,
    totalBitrate: meta.totalBitrate,
    containerFormat: meta.containerFormat,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    metadataVersion: meta.metadataVersion,
    metadataCheckedAt: meta.metadataCheckedAt,
  };
}

/**
 * Process a batch of videos with limited concurrency.
 */
function getConcurrentLimit(config = {}) {
  if (config.maxConcurrent === 'auto') {
    const cpuCount = os.cpus().length || 4;
    const freeMemGb = os.freemem() / (1024 ** 3);
    const cpuBased = config.cpuThreadsLimited === false
      ? Math.max(1, Math.floor(cpuCount / 2))
      : Math.max(2, Math.ceil(cpuCount * 1.25));
    const memBased = Math.max(1, Math.floor((freeMemGb - 1.5) / 0.25));
    return Math.max(1, Math.min(24, Math.min(cpuBased, memBased)));
  }
  if (config.maxConcurrent > 0) {
    return Math.max(1, Math.min(32, config.maxConcurrent));
  }
  return 3;
}

async function processVideos(videos, thumbDir, config, onProgress, onVideoReady, options = {}) {
  const token = createRunToken();
  thumbToken = token;
  const total = videos.length;
  let current = 0;
  const concurrentLimit = getConcurrentLimit(config);
  const cooldownMs = getGpuCooldownMs(config);
  const cooldownBatchSize = getGpuCooldownBatchSize(config, concurrentLimit);

  for (let batchStart = 0; batchStart < videos.length && !token.cancelled; batchStart += cooldownBatchSize || videos.length) {
    const batchEnd = cooldownBatchSize
      ? Math.min(batchStart + cooldownBatchSize, videos.length)
      : videos.length;
    const queue = videos.slice(batchStart, batchEnd);
    const takeNextVideo = createQueueCursor(queue);
    const workers = [];
    const workerCount = Math.min(concurrentLimit, queue.length);

    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          while (!token.cancelled) {
            try {
              await waitForProcessing(token);
            } catch (err) {
              if (token.cancelled) break;
              throw err;
            }
            const video = takeNextVideo();
            if (!video) break;
            try {
              const videoThumbRoot = typeof thumbDir === 'function' ? thumbDir(video) : thumbDir;
              const result = await generateThumbnailsForVideo(video, videoThumbRoot, config, token, options);
              current++;
              if (onProgress) onProgress({ current, total });
              if (onVideoReady) {
                await onVideoReady(
                  video.id,
                  result.thumbnails,
                  result.durationSecs,
                  result.creationTime,
                  result.videoCodec,
                  result.audioCodec,
                  result.videoBitrate,
                  result.audioBitrate,
                  result.totalBitrate,
                  result.containerFormat,
                  result.width,
                  result.height,
                  result.fps
                );
              }
            } catch (err) {
              if (err.message === 'Cancelled') break;
              current++;
              if (onProgress) onProgress({ current, total });
            }
          }
        })()
      );
    }

    await Promise.all(workers);
    if (cooldownMs > 0 && batchEnd < videos.length && !token.cancelled) {
      await sleep(cooldownMs);
      if (token.cancelled) break;
      await waitForProcessing(token);
    }
  }
}

async function processMetadata(videos, config, onProgress, onVideoReady, onVideoFailed) {
  const token = createRunToken();
  metadataToken = token;
  const total = videos.length;
  let current = 0;
  const concurrentLimit = getConcurrentLimit(config);
  const queue = [...videos];
  const takeNextVideo = createQueueCursor(queue);
  const workers = [];
  const workerCount = Math.min(concurrentLimit, queue.length);

  for (let i = 0; i < workerCount; i++) {
    workers.push((async () => {
      while (!token.cancelled) {
        try {
          await waitForProcessing(token);
        } catch (err) {
          if (token.cancelled) break;
          throw err;
        }
        const video = takeNextVideo();
        if (!video) break;
        try {
          const result = await runProcessingActivity(token, () => readMetadataForVideo(video, token));
          if (token.cancelled) break;
          current++;
          if (onProgress) onProgress({ current, total });
          if (onVideoReady) {
            await onVideoReady(video.id, result);
          }
        } catch (err) {
          if (token.cancelled || err.message === 'Cancelled') break;
          current++;
          if (onProgress) onProgress({ current, total });
          if (onVideoFailed) {
            await onVideoFailed(video.id, err);
          }
        }
      }
    })());
  }

  await Promise.all(workers);
}

function cancelThumbnails() {
  cancelRun(thumbToken);
  processingPause.wake();
}

function cancelMetadata() {
  cancelRun(metadataToken);
  processingPause.wake();
}

/** Cancel all pipelines — used on quit and full rescan. */
function cancelProcessing() {
  cancelThumbnails();
  cancelMetadata();
  processingPause.resume();
}

module.exports = {
  processVideos,
  processMetadata,
  cancelProcessing,
  cancelThumbnails,
  cancelMetadata,
  getConcurrentLimit,
  METADATA_SCHEMA_VERSION,
  __test: {
    toFfmpegInputPath,
    getVideoMetadata,
    buildFrameArgs,
    createExtractionBudget,
    extractFrame,
    parseFpsRational,
    parseBitrate,
    calculateTimestamps,
    expectedThumbnailCount,
    getGpuCooldownMs,
    getGpuCooldownBatchSize,
    createQueueCursor,
    getReusableThumbnailPaths,
    isNonemptyFile,
    getThumbToken: () => thumbToken,
  },
};
