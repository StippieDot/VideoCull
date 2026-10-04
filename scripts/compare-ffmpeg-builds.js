// Compares two FFmpeg runtime folders on the same videos, using VideoCull's own code paths:
// metadata (getVideoMetadata), a thumbnail at the middle of the video, and duplicate fingerprints
// (gray frames + pHash at the default sampling). Run before switching the bundled FFmpeg build.
//
//   node scripts/compare-ffmpeg-builds.js --old <dir> --new <dir> <video or folder>...
//
// Each folder must contain ffmpeg.exe and ffprobe.exe. Exits non-zero when a fingerprint falls
// below the default duplicate threshold, or when a read succeeds with only one of the builds.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.mts', '.m2ts', '.flv', '.3gp']);
const METADATA_FIELDS = ['duration', 'creationTime', 'videoCodec', 'audioCodec', 'videoBitrate', 'audioBitrate', 'totalBitrate', 'containerFormat', 'width', 'height', 'fps'];
const GRAY_FRAME_BYTES = 32 * 32;

function listVideos(inputs) {
  const videos = [];
  for (const input of inputs) {
    if (fs.statSync(input).isFile()) {
      videos.push(path.resolve(input));
      continue;
    }
    for (const name of fs.readdirSync(input)) {
      if (VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())) videos.push(path.resolve(input, name));
    }
  }
  return videos;
}

function runToBuffer(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(stderr || `exit ${code}`))));
  });
}

const firstLine = (error) => String(error?.message ?? error).trim().split('\n').pop();

// Child mode: measures every video with the build in VIDEOCULL_FFMPEG_DIR and prints JSON.
async function measure(videos) {
  const { ffmpegPath } = require('../electron/media-tools');
  const processor = require('../electron/processor');
  const { __test__: duplicates } = require('../electron/duplicates');
  const { getSamplingTimestamps, calculateDctPHash, normalizeDuplicateSettings } = require('../electron/duplicate-utils');
  const settings = normalizeDuplicateSettings({});
  const thumbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videocull-compare-'));
  const results = {};
  try {
    for (const [index, video] of videos.entries()) {
      const result = {};
      try {
        result.metadata = await processor.__test.getVideoMetadata(video);
      } catch (error) {
        result.metadataError = firstLine(error);
      }
      const duration = result.metadata?.duration ?? 0;
      const thumb = path.join(thumbDir, `${index}.jpg`);
      try {
        execFileSync(ffmpegPath, processor.__test.buildFrameArgs(video, duration * 0.5, thumb, {}), { stdio: 'ignore', windowsHide: true });
        result.thumbBytes = fs.statSync(thumb).size;
      } catch {
        result.thumbBytes = 0;
      }
      const timestamps = getSamplingTimestamps(duration, settings.sampleCount, settings);
      try {
        const raw = await runToBuffer(ffmpegPath, duplicates.buildGrayFramesExtractionArgs(video, timestamps, {}));
        if (raw.length < timestamps.length * GRAY_FRAME_BYTES) throw new Error(`only ${raw.length} bytes of frames`);
        result.phashes = timestamps.map((_, i) => calculateDctPHash(raw.subarray(i * GRAY_FRAME_BYTES, (i + 1) * GRAY_FRAME_BYTES)));
      } catch (error) {
        result.fingerprintError = firstLine(error);
      }
      results[video] = result;
    }
  } finally {
    fs.rmSync(thumbDir, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify(results));
}

function measureWith(ffmpegDir, videos) {
  const output = execFileSync(process.execPath, [__filename, '--measure', ...videos], {
    env: { ...process.env, VIDEOCULL_FFMPEG_DIR: path.resolve(ffmpegDir) },
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(output.toString('utf8'));
}

function onlyOneFailed(label, oldError, newError, lines) {
  if (Boolean(oldError) === Boolean(newError)) return false;
  lines.push(`${label}: old ${oldError ?? 'ok'} / new ${newError ?? 'ok'}`);
  return true;
}

function compare(oldResults, newResults) {
  const { pHashSimilarity, normalizeDuplicateSettings } = require('../electron/duplicate-utils');
  const threshold = normalizeDuplicateSettings({}).finalSimilarityThreshold;
  let problems = 0;
  for (const video of Object.keys(newResults)) {
    const a = oldResults[video];
    const b = newResults[video];
    const lines = [];
    if (onlyOneFailed('metadata', a.metadataError, b.metadataError, lines)) problems++;
    else if (a.metadata && b.metadata) {
      for (const field of METADATA_FIELDS) {
        if (a.metadata[field] !== b.metadata[field]) lines.push(`${field}: ${a.metadata[field]} -> ${b.metadata[field]}`);
      }
    }
    if (onlyOneFailed('thumbnail', a.thumbBytes ? null : 'failed', b.thumbBytes ? null : 'failed', lines)) problems++;
    if (onlyOneFailed('fingerprint', a.fingerprintError, b.fingerprintError, lines)) problems++;
    else if (a.phashes && b.phashes) {
      const similarities = a.phashes.map((hash, i) => pHashSimilarity(hash, b.phashes[i]));
      const below = Math.min(...similarities) < threshold;
      if (below) problems++;
      lines.push(`pHash similarity per sample: ${similarities.map((s) => s.toFixed(1)).join(', ')}%${below ? ` (below the ${threshold}% threshold)` : ''}`);
    }
    console.log(`\n${path.basename(video)}\n  ${lines.join('\n  ')}`);
  }
  console.log(`\n${Object.keys(newResults).length} videos, ${problems} problem(s).`);
  return problems;
}

if (process.argv[2] === '--measure') {
  measure(process.argv.slice(3)).catch((error) => { console.error(error); process.exit(1); });
} else {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const oldDir = take('--old');
  const newDir = take('--new');
  if (!oldDir || !newDir || !args.length) {
    console.error('Usage: node scripts/compare-ffmpeg-builds.js --old <dir> --new <dir> <video or folder>...');
    process.exit(2);
  }
  const videos = listVideos(args);
  process.exitCode = compare(measureWith(oldDir, videos), measureWith(newDir, videos)) ? 1 : 0;
}
