const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path.replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('@ffprobe-installer/ffprobe').path.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const path = require('path');
const fs = require('fs/promises');
const os = require('os');

let currentToken = null;

function parseFpsRational(value) {
  if (!value || value === '0/0') return null;
  const [rawNum, rawDen] = String(value).split('/');
  const num = Number(rawNum);
  const den = Number(rawDen);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 100) / 100;
}

/**
 * Get duration, creation_time, codec, resolution, and fps via ffprobe.
 */
function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration || 0;
      // Try to extract creation_time from format tags (camera date)
      let creationTime = null;
      const tags = metadata?.format?.tags;
      if (tags) {
        const raw = tags.creation_time || tags.Creation_Time || tags.CREATION_TIME;
        if (raw) {
          const parsed = new Date(raw).getTime();
          if (!isNaN(parsed)) creationTime = parsed;
        }
      }

      const streams = metadata?.streams ?? [];
      const videoStream = streams.find((stream) => stream.codec_type === 'video');
      const audioStream = streams.find((stream) => stream.codec_type === 'audio');
      const fps =
        parseFpsRational(videoStream?.avg_frame_rate) ??
        parseFpsRational(videoStream?.r_frame_rate) ??
        null;

      resolve({
        duration,
        creationTime,
        videoCodec: videoStream?.codec_name ?? null,
        audioCodec: audioStream?.codec_name ?? null,
        width: videoStream?.width ?? null,
        height: videoStream?.height ?? null,
        fps,
      });
    });
  });
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
    if (duration < skipDelaySecs || end <= skipDelaySecs) return 1;
  }
  return count;
}

const activeCommands = new Set();

function thumbnailIndex(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/thumb[_-]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function compareThumbnailPaths(a, b) {
  const aIndex = thumbnailIndex(a);
  const bIndex = thumbnailIndex(b);
  if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
    return aIndex - bIndex;
  }
  return path.basename(a).localeCompare(path.basename(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Extract a single frame from a video at a given timestamp.
 * Uses fast seeking (-ss before -i) via fluent-ffmpeg's seekInput().
 */
function extractFrame(videoPath, timestamp, outputPath, config, token) {
  return new Promise((resolve, reject) => {
    const outOpts = ['-q:v', '5'];
    // Limit CPU threads to prevent massive spikes when processing parallel
    if (config.cpuThreadsLimited !== false) {
      outOpts.push('-threads', '1');
    }

    const createCommand = (seekTime) => {
      let command = ffmpeg(videoPath).seekInput(seekTime).frames(1);
      if (config.hardwareAccel) {
        command = command.inputOptions(['-hwaccel', 'auto']);
      }
      return command.outputOptions(outOpts).videoFilters(`scale=320:-1`);
    };

    const attempts = Array.from(new Set([
      timestamp,
      Math.max(0, timestamp + 0.25),
      Math.max(0, timestamp - 0.25),
      Math.max(0, timestamp + 0.75),
      Math.max(0, timestamp - 0.75),
    ]));

    const runCommand = (attemptIndex = 0) => {
      if (token.cancelled) {
        reject(new Error('Cancelled'));
        return;
      }
      const seekTime = attempts[attemptIndex];
      const cmd = createCommand(seekTime);
      activeCommands.add(cmd);
      cmd.output(outputPath)
        .on('end', () => { activeCommands.delete(cmd); resolve(outputPath); })
        .on('error', (err) => {
          activeCommands.delete(cmd);
          if (attemptIndex < attempts.length - 1 && !token.cancelled) {
            runCommand(attemptIndex + 1);
          } else {
            reject(err);
          }
        })
        .run();
    };

    runCommand();
  });
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
  let creationTime = null;
  let videoCodec = video.videoCodec ?? null;
  let audioCodec = video.audioCodec ?? null;
  let width = video.width ?? null;
  let height = video.height ?? null;
  let fps = video.fps ?? null;
  const needsMetadata = () => !duration || !videoCodec || !width || !height || fps === null;

  try {
    const existing = await fs.readdir(videoThumbDir);
    if (!options.forceRegenerate) {
      // Reuse cached thumbnail files only when the set is complete for the current
      // thumbnail count. Partial sets usually mean a previous run was interrupted.
      const jpgs = existing.filter((f) => f.endsWith('.jpg')).sort(compareThumbnailPaths);
      if (needsMetadata()) {
        try {
          const meta = await getVideoMetadata(video.path);
          duration = meta.duration;
          creationTime = meta.creationTime;
          videoCodec = meta.videoCodec;
          audioCodec = meta.audioCodec;
          width = meta.width;
          height = meta.height;
          fps = meta.fps;
        } catch { duration = duration ?? 0; }
      }
      const expectedCount = expectedThumbnailCount(duration, THUMB_COUNT, skipDelay);
      const usableJpgs = jpgs.slice(0, expectedCount);
      if (usableJpgs.length >= expectedCount) {
        const usablePaths = usableJpgs.map((f) => path.join(videoThumbDir, f));
        return {
          thumbnails: usablePaths,
          durationSecs: duration,
          creationTime,
          videoCodec,
          audioCodec,
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

  // Get duration + metadata date
  if (needsMetadata()) {
    try {
      const meta = await getVideoMetadata(video.path);
      duration = meta.duration;
      creationTime = meta.creationTime;
      videoCodec = meta.videoCodec;
      audioCodec = meta.audioCodec;
      width = meta.width;
      height = meta.height;
      fps = meta.fps;
    } catch {
      duration = duration ?? 0;
    }
  }

  const timestamps = calculateTimestamps(duration, THUMB_COUNT, skipDelay);
  const thumbnails = [];

  // Extract frames sequentially within each video. Overall parallelism is handled
  // by processVideos(), so maxConcurrent now maps to active FFmpeg commands.
  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];
    if (token.cancelled) throw new Error('Cancelled');
    const outputPath = path.join(videoThumbDir, `thumb_${String(i + 1).padStart(2, '0')}.jpg`);
    try {
      await extractFrame(video.path, timestamp, outputPath, config, token);
      const stat = await fs.stat(outputPath);
      if (stat.size > 0) {
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
      await extractFrame(video.path, 0, fallbackPath, config, token);
      const stat = await fs.stat(fallbackPath);
      if (stat.size > 0) {
        finalPaths.push(fallbackPath);
      }
    } catch { /* truly can't generate thumbnails for this video */ }
  }

  return { thumbnails: finalPaths, durationSecs: duration, creationTime, videoCodec, audioCodec, width, height, fps };
}

async function readMetadataForVideo(video) {
  let duration = video.durationSecs;
  let creationTime = null;
  let videoCodec = video.videoCodec ?? null;
  let audioCodec = video.audioCodec ?? null;
  let width = video.width ?? null;
  let height = video.height ?? null;
  let fps = video.fps ?? null;

  try {
    const meta = await getVideoMetadata(video.path);
    duration = meta.duration;
    creationTime = meta.creationTime;
    videoCodec = meta.videoCodec;
    audioCodec = meta.audioCodec;
    width = meta.width;
    height = meta.height;
    fps = meta.fps;
  } catch {
    duration = duration ?? 0;
  }

  return {
    thumbnails: video.thumbnails ?? [],
    durationSecs: duration,
    creationTime,
    videoCodec,
    audioCodec,
    width,
    height,
    fps,
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
  const token = { cancelled: false };
  currentToken = token;
  const total = videos.length;
  let current = 0;
  const targetThumbCount = Math.max(1, Number(config.thumbsPerVideo) || 6);

  const concurrentLimit = getConcurrentLimit(config);
  const cooldownMs = getGpuCooldownMs(config);
  const cooldownBatchSize = getGpuCooldownBatchSize(config, concurrentLimit);

  for (let batchStart = 0; batchStart < videos.length && !token.cancelled; batchStart += cooldownBatchSize || videos.length) {
    const batchEnd = cooldownBatchSize
      ? Math.min(batchStart + cooldownBatchSize, videos.length)
      : videos.length;
    const queue = videos.slice(batchStart, batchEnd);
    const workers = [];
    const workerCount = Math.min(concurrentLimit, queue.length);

    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !token.cancelled) {
            const video = queue.shift();
            if (!video) break;
            try {
              const hasCompleteCachedThumbs = !options.forceRegenerate && Array.isArray(video.thumbnails) && video.thumbnails.length >= targetThumbCount;
              const needsMetadataOnly = hasCompleteCachedThumbs && (
                !video.videoCodec ||
                !video.width ||
                !video.height ||
                video.fps === null ||
                video.fps === undefined
              );
              const videoThumbRoot = typeof thumbDir === 'function' ? thumbDir(video) : thumbDir;
              const result = needsMetadataOnly
                ? await readMetadataForVideo(video)
                : await generateThumbnailsForVideo(video, videoThumbRoot, config, token, options);
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
    }
  }
}

function cancelProcessing() {
  if (currentToken) currentToken.cancelled = true;
  for (const cmd of activeCommands) {
    try {
      cmd.kill('SIGKILL');
    } catch (e) {
      // ignore
    }
  }
  activeCommands.clear();
}

module.exports = { processVideos, cancelProcessing, getConcurrentLimit };
