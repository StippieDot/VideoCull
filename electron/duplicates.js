const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path.replace('app.asar', 'app.asar.unpacked');
const cache = require('./cache');
const {
  normalizeDuplicateSettings,
  getSamplingTimestamps,
  calculateDctPHash,
  flipGrayBytes,
  frameDarkRatio,
  average,
  chooseSuggestedKeeper,
} = require('./duplicate-utils');

const ONE_MIB = 1024 * 1024;
const FRAME_BYTE_COUNT = 32 * 32;

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
    cancelled: false,
    worker: null,
    commands: new Set(),
    cancel() {
      this.cancelled = true;
      if (this.worker) {
        try { this.worker.terminate(); } catch { /* ignore */ }
      }
      for (const child of this.commands) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
      this.commands.clear();
    },
  };
}

function assertNotCancelled(run) {
  if (run?.cancelled) throw new DuplicateCancelledError();
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

async function fullFileHash(video) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(video.path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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

async function findExactGroups(videos, dbByFolder, run, sendProgress) {
  duplicateLog('Starting exact duplicate pass', { videos: videos.length });
  progress(sendProgress, 'Checking exact matches', { current: 0, total: videos.length });
  const signatureById = new Map();
  for (const [folder, folderVideos] of groupVideosByFolder(videos)) {
    const db = dbByFolder.get(folder);
    if (!db) continue;
    for (const row of cache.loadSignatureRows(db, folderVideos.map((video) => video.id))) {
      signatureById.set(row.id, row);
    }
  }
  const bySize = groupBy(videos.filter((video) => video.sizeBytes > 0), (video) => String(video.sizeBytes));
  const exactGroups = [];
  let processed = 0;
  let quickCacheHits = 0;
  let fullCacheHits = 0;

  for (const sameSize of bySize.values()) {
    assertNotCancelled(run);
    if (sameSize.length < 2) {
      processed += sameSize.length;
      continue;
    }

    const quickRows = [];
    for (const video of sameSize) {
      assertNotCancelled(run);
      const db = dbByFolder.get(path.dirname(video.path));
      const cached = signatureById.get(video.id);
      const quick = cached?.file_signature_quick || await quickSignature(video);
      if (cached?.file_signature_quick) quickCacheHits++;
      if (db && !cached?.file_signature_quick) cache.updateVideoSignatures(db, video.id, { quick });
      quickRows.push({ video, quick, cachedFull: cached?.file_signature_full || null });
      processed++;
      if (processed % 20 === 0) progress(sendProgress, 'Checking exact matches', { current: processed, total: videos.length });
    }

    for (const quickGroup of groupBy(quickRows, (row) => row.quick).values()) {
      if (quickGroup.length < 2) continue;
      const fullRows = [];
      for (const row of quickGroup) {
        assertNotCancelled(run);
        const full = row.cachedFull || await fullFileHash(row.video);
        if (row.cachedFull) fullCacheHits++;
        const db = dbByFolder.get(path.dirname(row.video.path));
        if (db && !row.cachedFull) cache.updateVideoSignatures(db, row.video.id, { quick: row.quick, full });
        fullRows.push({ video: row.video, full });
      }
      for (const fullGroup of groupBy(fullRows, (row) => row.full).values()) {
        if (fullGroup.length >= 2) exactGroups.push(fullGroup.map((row) => row.video.id));
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

function extractGrayFrame(videoPath, timestamp, run) {
  return new Promise((resolve, reject) => {
    assertNotCancelled(run);
    const args = [
      '-v', 'error',
      '-ss', String(Math.max(0, timestamp)),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', 'scale=32:32:flags=bicubic,format=gray',
      '-f', 'rawvideo',
      '-pix_fmt', 'gray',
      'pipe:1',
    ];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    run.commands.add(child);
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      run.commands.delete(child);
      reject(err);
    });
    child.on('close', (code) => {
      run.commands.delete(child);
      if (run.cancelled) {
        reject(new DuplicateCancelledError());
        return;
      }
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer.length < FRAME_BYTE_COUNT) {
        reject(new Error(stderr || `FFmpeg returned ${code}`));
        return;
      }
      resolve(buffer.subarray(0, FRAME_BYTE_COUNT));
    });
  });
}

async function buildFingerprintsForVideo(video, settings, run) {
  const timestamps = getSamplingTimestamps(video.durationSecs, settings.sampleCount, settings);
  const fingerprints = [];
  for (let i = 0; i < timestamps.length; i++) {
    assertNotCancelled(run);
    const grayBytes = await extractGrayFrame(video.path, timestamps[i], run);
    const flippedGrayBytes = flipGrayBytes(grayBytes);
    fingerprints.push({
      sampleIndex: i,
      timestampSecs: timestamps[i],
      phashHex: calculateDctPHash(grayBytes),
      flippedPHashHex: calculateDctPHash(flippedGrayBytes),
      grayBytes,
      frameDarkRatio: frameDarkRatio(grayBytes),
    });
  }
  return fingerprints;
}

async function backfillFingerprints(videos, dbByFolder, settings, run, sendProgress, maxConcurrency = 2) {
  const byFolder = groupVideosByFolder(videos);
  const missing = [];
  let skippedFailed = 0;
  for (const [folder, folderVideos] of byFolder) {
    const db = dbByFolder.get(folder);
    if (!db) continue;
    const completeById = cache.getFingerprintCounts(db, settings.sampleCount, { requireFlipped: settings.compareFlipped });
    const failedIds = settings.retryFailedFingerprintExtraction
      ? new Set()
      : cache.loadFingerprintFailureIds(db, folderVideos.map((video) => video.id));
    for (const video of folderVideos) {
      if (!completeById.get(video.id) && !failedIds.has(video.id)) missing.push(video);
      else if (!completeById.get(video.id) && failedIds.has(video.id)) skippedFailed++;
    }
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
  const workerCount = Math.max(1, Math.min(Math.floor(maxConcurrency) || 1, queue.length || 1));
  duplicateLog('Fingerprint workers starting', { workers: workerCount });

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      assertNotCancelled(run);
      const video = queue.shift();
      if (!video) break;
      try {
        const fingerprints = await buildFingerprintsForVideo(video, settings, run);
        const db = dbByFolder.get(path.dirname(video.path));
        if (db) {
          cache.saveVideoFingerprints(db, video.id, fingerprints);
          saved++;
        } else {
          failed++;
          if (failureExamples.length < 8) {
            failureExamples.push({
              filename: video.filename,
              path: video.path,
              error: 'No cache database for folder',
            });
          }
        }
      } catch (err) {
        if (err instanceof DuplicateCancelledError) throw err;
        const db = dbByFolder.get(path.dirname(video.path));
        if (db) cache.markFingerprintFailure(db, video.id);
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

function loadAllPHashes(videos, dbByFolder, settings) {
  const rows = [];
  for (const [folder, folderVideos] of groupVideosByFolder(videos)) {
    const db = dbByFolder.get(folder);
    if (!db) continue;
    rows.push(...cache.loadPHashRows(db, folderVideos.map((video) => video.id), settings.sampleCount));
  }
  return rows;
}

function loadAllGrayRows(videos, dbByFolder, settings) {
  const rows = [];
  for (const [folder, folderVideos] of groupVideosByFolder(videos)) {
    const db = dbByFolder.get(folder);
    if (!db) continue;
    rows.push(...cache.loadGraySampleRows(db, folderVideos.map((video) => video.id), settings.sampleCount));
  }
  return rows;
}

function runPHashWorker(videos, phashRows, settings, run, sendProgress) {
  return new Promise((resolve, reject) => {
    duplicateLog('Starting pHash comparison worker', {
      videos: videos.length,
      fingerprints: phashRows.length,
      similarity: settings.finalSimilarityThreshold,
    });
    progress(sendProgress, 'Comparing pHashes', { current: 0, total: 0 });
    const worker = new Worker(path.join(__dirname, 'duplicate-worker.js'), {
      workerData: {
        videos: videos.map((video) => ({
          id: video.id,
          durationSecs: video.durationSecs,
        })),
        phashRows,
        settings,
      },
    });
    run.worker = worker;
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        progress(sendProgress, 'Comparing pHashes', { current: message.compared, total: message.total });
      } else if (message.type === 'done') {
        run.worker = null;
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
        reject(new Error(message.message));
      }
    });
    worker.on('error', (err) => {
      run.worker = null;
      if (run.cancelled) reject(new DuplicateCancelledError());
      else reject(err);
    });
    worker.on('exit', (code) => {
      run.worker = null;
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
    progress(sendProgress, 'Finding candidates', { current: 0, total: 0 });
    progress(sendProgress, 'Confirming visual matches', { current: 0, total: 0 });
    const worker = new Worker(path.join(__dirname, 'visual-worker.js'), {
      workerData: {
        videos: videos.map((video) => ({
          id: video.id,
          durationSecs: video.durationSecs,
        })),
        grayRows,
        settings,
      },
    });
    run.worker = worker;
    worker.on('message', (message) => {
      if (message.type === 'progress') {
        progress(sendProgress, 'Finding candidates', { current: message.compared, total: message.total });
        progress(sendProgress, 'Confirming visual matches', { current: message.compared, total: message.total });
      } else if (message.type === 'done') {
        run.worker = null;
        progress(sendProgress, 'Finding candidates', { current: message.total, total: message.total });
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
        reject(new Error(message.message));
      }
    });
    worker.on('error', (err) => {
      run.worker = null;
      if (run.cancelled) reject(new DuplicateCancelledError());
      else reject(err);
    });
    worker.on('exit', (code) => {
      run.worker = null;
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

function splitDaisyChainGroups(candidateGroups, directSimilarity, threshold) {
  const splitGroups = [];
  let groupsSplit = 0;
  let removedSingletons = 0;

  for (const candidate of candidateGroups) {
    const ids = Array.from(candidate.ids);
    const splitIds = splitDaisyChainIds(ids, directSimilarity, threshold);
    if (splitIds.length === 1 && splitIds[0].length === ids.length) {
      splitGroups.push(candidate);
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
      });
    }
  }

  return { groups: splitGroups, stats: { groupsSplit, removedSingletons } };
}

function buildGroups(exactGroups, matchedPairs, videosById, settings) {
  const ignoredPairKeys = new Set(settings.ignoredDuplicatePairs ?? []);
  const isIgnoredPair = (aId, bId) => ignoredPairKeys.has(storedPairKey(aId, bId));
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
  );
  if (daisyChainStats.groupsSplit > 0 || daisyChainStats.removedSingletons > 0) {
    duplicateLog('Daisy-chain validation complete', daisyChainStats);
  }

  const groups = [];
  let groupIndex = 1;
  for (const candidate of validatedGroups) {
    const ids = Array.from(candidate.ids);
    if (ids.length < 2) continue;
    const videos = ids.map((id) => videosById.get(id)).filter(Boolean);
    const keeper = chooseSuggestedKeeper(videos, settings);
    const similarities = [];
    const exactVideoIds = new Set();
    let hasExact = false;
    let fuzzyMatchType = null;
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
          similarities.push(matched.similarity);
          fuzzyMatchType = fuzzyMatchType && fuzzyMatchType !== matched.matchType ? 'mixed' : matched.matchType;
        }
      }
    }
    const matchType = hasExact && fuzzyMatchType ? 'mixed' : hasExact ? 'exact' : fuzzyMatchType || settings.comparisonMode;
    const comparisonLabel = matchType === 'phash' ? 'pHash average' : 'visual average';
    groups.push({
      id: `dup-${groupIndex++}`,
      videoIds: ids,
      similarity: Math.round(average(similarities) * 10) / 10,
      matchType,
      suggestedKeeperId: keeper?.id ?? null,
      exactVideoIds: Array.from(exactVideoIds),
      reason: matchType === 'exact'
        ? 'Exact file match'
        : matchType === 'mixed'
          ? 'Exact and similarity matches in one group'
          : `Whole-video ${comparisonLabel} >= ${settings.finalSimilarityThreshold}%`,
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

async function findDuplicates({ videos, settings: rawSettings, cacheOptions, openDb, maxConcurrency, run, sendProgress }) {
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

  const dbByFolder = new Map();
  for (const folder of groupVideosByFolder(safeVideos).keys()) {
    dbByFolder.set(folder, await openDb(folder, cacheOptions));
  }
  duplicateLog('Cache databases ready', { folders: dbByFolder.size });

  const exactGroups = await findExactGroups(safeVideos, dbByFolder, run, sendProgress);
  await backfillFingerprints(safeVideos, dbByFolder, settings, run, sendProgress, maxConcurrency);
  assertNotCancelled(run);
  let similarityPairs = [];
  if (settings.comparisonMode === 'phash') {
    const phashRows = loadAllPHashes(safeVideos, dbByFolder, settings);
    const expectedRows = safeVideos.length * settings.sampleCount;
    duplicateLog('pHash rows loaded', {
      rows: phashRows.length,
      expectedRows,
      missingRows: Math.max(0, expectedRows - phashRows.length),
      missingVideosApprox: Math.ceil(Math.max(0, expectedRows - phashRows.length) / settings.sampleCount),
    });
    const pHashPairs = await runPHashWorker(safeVideos, phashRows, settings, run, sendProgress);
    similarityPairs = pHashPairs.map((pair) => ({
      ...pair,
      similarity: pair.pHashSimilarity,
      matchType: 'phash',
    }));
  } else {
    assertNotCancelled(run);
    const grayRows = loadAllGrayRows(safeVideos, dbByFolder, settings);
    duplicateLog('Gray sample rows loaded', { rows: grayRows.length });
    similarityPairs = await runVisualWorker(safeVideos, grayRows, settings, run, sendProgress);
  }
  assertNotCancelled(run);
  progress(sendProgress, 'Building groups', { current: 0, total: 1 });
  const groups = buildGroups(exactGroups, similarityPairs, videosById, settings);
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

module.exports = {
  DuplicateCancelledError,
  createDuplicateRun,
  findDuplicates,
  __test__: {
    buildGroups,
    splitDaisyChainIds,
  },
};
