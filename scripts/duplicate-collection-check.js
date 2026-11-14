// Runs duplicate detection without the app window on a folder of videos, using the real FFmpeg and an
// in-memory cache, so results can be compared before and after a change to the duplicate engine.
//
//   node scripts/duplicate-collection-check.js <folder> [--mode phash|visual] [--samples <n>] [--snapshot <file>]
//   node scripts/duplicate-collection-check.js --diff <before.json> <after.json>
//
// When <folder> holds a manifest.json written by scripts/duplicate-test-media/build.js, every file is
// compared with its expected relation. --snapshot writes the found groups; --diff lists the groups
// that were added or removed between two snapshots.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.wmv', '.mpg', '.ts']);

/**
 * Stands in for the folder databases: the four operations a duplicate run needs, kept in memory.
 */
function createMemoryCache() {
  const fingerprints = new Map();
  const failures = new Map();
  const signatures = new Map();
  return {
    async loadDuplicateFolderState(_folder, _options, videoIds, settings) {
      const completeEntries = [];
      const failedIds = [];
      const comparisonRows = [];
      for (const videoId of videoIds) {
        const stored = fingerprints.get(videoId);
        if (stored?.key === settings.fingerprintKey) {
          completeEntries.push([videoId, true]);
          comparisonRows.push(...stored.rows);
        }
        if (failures.get(videoId) === settings.fingerprintKey) failedIds.push(videoId);
      }
      return {
        videoIds,
        signatureRows: videoIds.map((videoId) => signatures.get(videoId)).filter(Boolean),
        completeEntries,
        failedIds,
        mode: settings.comparisonMode,
        comparisonRows,
      };
    },
    async updateVideoSignatures(_folder, _options, videoId, update) {
      const previous = signatures.get(videoId) ?? { id: videoId };
      signatures.set(videoId, {
        ...previous,
        file_signature_quick: update.quick ?? previous.file_signature_quick ?? null,
        file_signature_full: update.full ?? previous.file_signature_full ?? null,
      });
    },
    async saveVideoFingerprints(_folder, _options, videoId, rows, key) {
      failures.delete(videoId);
      fingerprints.set(videoId, {
        key,
        rows: rows.map((row) => ({
          video_id: videoId,
          sample_index: row.sampleIndex,
          phash_hex: row.phashHex,
          flipped_phash_hex: row.flippedPHashHex ?? null,
          gray_bytes: row.grayBytes,
          frame_dark_ratio: row.frameDarkRatio ?? null,
        })),
      });
    },
    async markFingerprintFailure(_folder, _options, videoId, key) {
      failures.set(videoId, key);
    },
  };
}

function listVideos(folder) {
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

function probeVideo(ffprobePath, folder, filename) {
  const filePath = path.join(folder, filename);
  const stat = fs.statSync(filePath);
  let info = {};
  try {
    info = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], {
      windowsHide: true,
      maxBuffer: 1 << 24,
    }).toString());
  } catch {
    // An unreadable file still takes part, as it would in the app; it simply has no metadata.
  }
  const videoStream = (info.streams ?? []).find((stream) => stream.codec_type === 'video');
  const audioStream = (info.streams ?? []).find((stream) => stream.codec_type === 'audio');
  const frameRate = String(videoStream?.avg_frame_rate ?? '').split('/');
  return {
    // Same identity rule as the scanner: path and size.
    id: crypto.createHash('md5').update(`${filePath}:${stat.size}`).digest('hex').slice(0, 16),
    filename,
    path: filePath,
    sizeBytes: stat.size,
    date: stat.mtimeMs,
    durationSecs: Number(info.format?.duration) || 0,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    // Rounded to 0.01 as the app stores it.
    fps: Math.round((Number(frameRate[0]) / Number(frameRate[1])) * 100) / 100 || null,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    bitrate: Number(info.format?.bit_rate) || null,
  };
}

/**
 * Compares found groups with a manifest. `groupOf` maps a filename to its group, or undefined.
 * A file is expected in its seed's group when its relation to the seed is `exact` or `sameSpan`.
 */
function compareWithManifest(manifest, groupOf) {
  const referenceBySeed = new Map();
  for (const entry of manifest.files) {
    if (!referenceBySeed.has(entry.seed)) referenceBySeed.set(entry.seed, entry.file);
  }
  const together = (a, b) => {
    const group = groupOf(a);
    return group !== undefined && group === groupOf(b);
  };
  const rows = [];
  for (const entry of manifest.files) {
    const reference = referenceBySeed.get(entry.seed);
    if (reference === entry.file) continue;
    const expected = entry.expect === 'exact' || entry.expect === 'sameSpan';
    const found = together(entry.file, reference);
    rows.push({
      kind: entry.expect,
      a: entry.file,
      b: reference,
      expected,
      found,
      needs: entry.needs ?? null,
      similarity: found ? groupOf(entry.file).similarity : null,
    });
  }
  for (const pair of manifest.negatives ?? []) {
    const found = together(pair.a, pair.b);
    rows.push({ kind: 'none', a: pair.a, b: pair.b, expected: false, found, needs: null, similarity: found ? groupOf(pair.a).similarity : null });
  }
  for (const pair of manifest.measuredOnly ?? []) {
    const found = together(pair.a, pair.b);
    rows.push({ kind: 'measured', a: pair.a, b: pair.b, expected: null, found, needs: null, similarity: found ? groupOf(pair.a).similarity : null });
  }
  const judged = rows.filter((row) => row.expected !== null);
  return {
    rows,
    summary: {
      found: judged.filter((row) => row.expected && row.found).length,
      missed: judged.filter((row) => row.expected && !row.found).length,
      wrong: judged.filter((row) => !row.expected && row.found).length,
      correctlyApart: judged.filter((row) => !row.expected && !row.found).length,
    },
  };
}

function toSnapshot(groups, videosById, folder) {
  return groups
    .map((group) => ({
      similarity: group.similarity,
      matchType: group.matchType,
      files: group.videoIds.map((videoId) => path.relative(folder, videosById.get(videoId).path)).sort(),
    }))
    .sort((a, b) => a.files.join('|').localeCompare(b.files.join('|')));
}

function diffSnapshots(before, after) {
  const key = (group) => group.files.join('|');
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));
  return {
    added: after.filter((group) => !beforeKeys.has(key(group))),
    removed: before.filter((group) => !afterKeys.has(key(group))),
  };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function runCheck(folder, mode, snapshotFile, sampleCount) {
  const { ffprobePath } = require('../electron/media-tools');
  const duplicates = require('../electron/duplicates');
  const filenames = listVideos(folder);
  const videos = filenames.map((filename) => probeVideo(ffprobePath, folder, filename));
  const videosById = new Map(videos.map((video) => [video.id, video]));

  const stageStartedAt = new Map();
  // The engine logs every step; keep this script's own output readable.
  const realLog = console.log;
  console.log = () => {};
  const startedAt = Date.now();
  let result;
  try {
    result = await duplicates.findDuplicates({
      videos,
      settings: { comparisonMode: mode, ...(sampleCount ? { sampleCount } : {}) },
      cacheAccess: createMemoryCache(),
      cacheOptions: {},
      maxConcurrency: 4,
      executionOptions: {},
      run: duplicates.createDuplicateRun(),
      sendProgress: (update) => {
        if (update?.stage && !stageStartedAt.has(update.stage)) stageStartedAt.set(update.stage, Date.now());
      },
    });
  } finally {
    console.log = realLog;
  }
  const finishedAt = Date.now();

  console.log(`${videos.length} videos, ${result.groups.length} groups, method ${mode}, ${finishedAt - startedAt} ms`);
  const stages = [...stageStartedAt.entries()];
  stages.forEach(([stage, time], index) => {
    console.log(`  ${stage.padEnd(28)} ${(stages[index + 1]?.[1] ?? finishedAt) - time} ms`);
  });

  const manifestPath = path.join(folder, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const groupByFile = new Map();
    for (const group of result.groups) {
      for (const videoId of group.videoIds) groupByFile.set(videosById.get(videoId).filename, group);
    }
    const { rows, summary } = compareWithManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), (file) => groupByFile.get(file));
    console.log('\nverdict   expect    similarity  pair');
    for (const row of rows) {
      const verdict = row.expected === null ? 'info' : row.expected === row.found ? 'ok' : row.expected ? 'MISSED' : 'WRONG';
      const note = row.needs ? `  (needs ${row.needs})` : '';
      console.log(`${verdict.padEnd(8)}  ${row.kind.padEnd(8)}  ${String(row.similarity ?? '-').padStart(10)}  ${row.a} / ${row.b}${note}`);
    }
    console.log(`\nfound ${summary.found}, missed ${summary.missed}, wrong ${summary.wrong}, correctly apart ${summary.correctlyApart}`);
  }

  if (snapshotFile) {
    fs.writeFileSync(snapshotFile, `${JSON.stringify(toSnapshot(result.groups, videosById, folder), null, 2)}\n`);
    console.log(`\nSnapshot written to ${snapshotFile}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const diffIndex = args.indexOf('--diff');
  if (diffIndex !== -1) {
    const [before, after] = [args[diffIndex + 1], args[diffIndex + 2]].map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    const { added, removed } = diffSnapshots(before, after);
    for (const group of added) console.log(`added    ${group.similarity}  ${group.files.join(' | ')}`);
    for (const group of removed) console.log(`removed  ${group.similarity}  ${group.files.join(' | ')}`);
    console.log(`${added.length} added, ${removed.length} removed`);
    return;
  }
  const folder = args.find((arg, index) => !arg.startsWith('--') && !['--mode', '--snapshot', '--samples'].includes(args[index - 1]));
  if (!folder) {
    console.error('Usage: node scripts/duplicate-collection-check.js <folder> [--mode phash|visual] [--samples <n>] [--snapshot <file>]');
    process.exitCode = 1;
    return;
  }
  await runCheck(path.resolve(folder), option(args, '--mode') === 'visual' ? 'visual' : 'phash', option(args, '--snapshot'), Number(option(args, '--samples')) || undefined);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { compareWithManifest, createMemoryCache, diffSnapshots };
