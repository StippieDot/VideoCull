// @ts-check
// Stored duplicate results: one JSON file per session in the app's data folder, so the groups of a
// session come back when it is opened again. A file holds video IDs and scores, never paths, and only
// what the renderer needs to rebuild the groups from their pairs.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathKey } = require('./path-key');

const RESULTS_FORMAT_VERSION = 1;
const RESULTS_FOLDER = 'duplicate-results';
const KEPT_SESSIONS = 10;
// Generous for a large library, small enough that a broken renderer cannot fill the disk.
const MAX_VIDEOS = 1_000_000;
const MAX_GROUPS = 500_000;
const MAX_PAIRS_PER_GROUP = 10_000;
const MAX_PARTIAL_CLIPS = 500_000;
const MAX_SEGMENTS_PER_CLIP = 1_000;

const VIDEO_ID = /^[0-9a-f]{16}$/;
const GROUP_ID = /^dup-[0-9a-f]{16}$/;
const MATCH_TYPES = new Set(['exact', 'phash', 'visual']);
const GROUP_MATCH_TYPES = new Set(['exact', 'phash', 'visual', 'mixed']);
const PICTURE_STATES = new Set(['confirmed', 'differentPicture', 'unconfirmed']);

/**
 * File name for a session: its folders (compared as the file system compares paths), whether
 * subfolders were included, and the scope of the run.
 * @param {{ folders: string[], includeSubfolders: boolean, scope: 'all' | 'filtered' }} session
 */
function sessionFileName(session) {
  const folders = session.folders.map((folder) => pathKey(folder)).sort();
  const key = JSON.stringify([folders, Boolean(session.includeSubfolders), session.scope]);
  return `${crypto.createHash('sha1').update(key).digest('hex')}.json`;
}

/** @param {unknown} value @returns {value is number} */
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** @param {unknown} value */
function sanitizePair(value) {
  if (!value || typeof value !== 'object') return null;
  const pair = /** @type {Record<string, unknown>} */ (value);
  if (!VIDEO_ID.test(String(pair.aId)) || !VIDEO_ID.test(String(pair.bId)) || pair.aId === pair.bId) return null;
  if (!isFiniteNumber(pair.similarity) || pair.similarity < 0 || pair.similarity > 100) return null;
  if (!MATCH_TYPES.has(String(pair.matchType))) return null;
  return {
    aId: String(pair.aId),
    bId: String(pair.bId),
    similarity: pair.similarity,
    matchType: String(pair.matchType),
    comparedSamples: Number.isInteger(pair.comparedSamples) ? pair.comparedSamples : null,
    confidence: pair.confidence === 'low' ? 'low' : 'normal',
    static: pair.static === true,
    borderAdjusted: pair.borderAdjusted === true,
    flipped: pair.flipped === true,
    partialFingerprint: pair.partialFingerprint === true,
    timingAdjusted: pair.timingAdjusted === true,
  };
}

/** @param {unknown} value @param {Set<string>} members */
function sanitizeUnreadableSamples(value, members) {
  if (!value || typeof value !== 'object') return {};
  /** @type {Record<string, Array<{ index: number, percent: number | null }>>} */
  const result = {};
  for (const [videoId, samples] of Object.entries(value)) {
    if (!members.has(videoId) || !Array.isArray(samples)) continue;
    result[videoId] = samples
      .filter((sample) => sample && Number.isInteger(sample.index) && sample.index >= 0 && sample.index < 64)
      .map((sample) => ({ index: sample.index, percent: isFiniteNumber(sample.percent) ? sample.percent : null }));
  }
  return result;
}

/** @param {unknown} value */
function sanitizeGroup(value) {
  if (!value || typeof value !== 'object') return null;
  const group = /** @type {Record<string, unknown>} */ (value);
  if (!GROUP_ID.test(String(group.id)) || !Array.isArray(group.videoIds) || !Array.isArray(group.pairs)) return null;
  const videoIds = Array.from(new Set(group.videoIds.map(String)));
  if (videoIds.length < 2 || !videoIds.every((id) => VIDEO_ID.test(id))) return null;
  const members = new Set(videoIds);
  if (group.pairs.length > MAX_PAIRS_PER_GROUP) return null;
  const pairs = [];
  for (const entry of group.pairs) {
    const pair = sanitizePair(entry);
    if (pair && members.has(pair.aId) && members.has(pair.bId)) pairs.push(pair);
  }
  if (pairs.length === 0) return null;
  const manualKeeper = typeof group.manualSuggestedKeeperId === 'string' && members.has(group.manualSuggestedKeeperId)
    ? group.manualSuggestedKeeperId
    : null;
  return {
    id: String(group.id),
    videoIds,
    pairs,
    manualSuggestedKeeperId: manualKeeper,
    sampleCount: Number.isInteger(group.sampleCount) ? group.sampleCount : 0,
    matchType: GROUP_MATCH_TYPES.has(String(group.matchType)) ? String(group.matchType) : 'phash',
    unreadableSamples: sanitizeUnreadableSamples(group.unreadableSamples, members),
  };
}

/** @param {unknown} value */
function sanitizePercent(value) {
  return isFiniteNumber(value) && value >= 0 && value <= 100 ? value : null;
}

/** @param {unknown} value */
function sanitizePartialClip(value) {
  if (!value || typeof value !== 'object') return null;
  const clip = /** @type {Record<string, unknown>} */ (value);
  if (!VIDEO_ID.test(String(clip.aId)) || !VIDEO_ID.test(String(clip.bId)) || clip.aId === clip.bId) return null;
  if (clip.shorterId !== clip.aId && clip.shorterId !== clip.bId) return null;
  if ((clip.relation !== 'partial' && clip.relation !== 'audioOnly') || !PICTURE_STATES.has(String(clip.state))) return null;
  if (!Array.isArray(clip.segments) || clip.segments.length === 0 || clip.segments.length > MAX_SEGMENTS_PER_CLIP) return null;
  const segments = [];
  for (const segment of clip.segments) {
    if (!segment || ![segment.startA, segment.startB, segment.lengthSecs].every((n) => isFiniteNumber(n) && n >= 0)) return null;
    if (!PICTURE_STATES.has(String(segment.pictureState))) return null;
    segments.push({
      startA: segment.startA,
      startB: segment.startB,
      lengthSecs: segment.lengthSecs,
      soundSimilarity: sanitizePercent(segment.soundSimilarity) ?? 0,
      pictureState: String(segment.pictureState),
      pictureSimilarity: sanitizePercent(segment.pictureSimilarity),
    });
  }
  return {
    aId: String(clip.aId),
    bId: String(clip.bId),
    relation: clip.relation,
    state: String(clip.state),
    shorterId: String(clip.shorterId),
    segments,
    coverage: isFiniteNumber(clip.coverage) && clip.coverage >= 0 && clip.coverage <= 1 ? clip.coverage : null,
    soundSimilarity: sanitizePercent(clip.soundSimilarity) ?? 0,
    pictureSimilarity: sanitizePercent(clip.pictureSimilarity),
  };
}

/**
 * Keeps only known fields of a results payload, or returns null when its shape is wrong. Used on
 * what the renderer sends and on what is read back from disk.
 * @param {unknown} value
 */
function sanitizeResults(value) {
  if (!value || typeof value !== 'object') return null;
  const results = /** @type {Record<string, unknown>} */ (value);
  if (results.version !== RESULTS_FORMAT_VERSION) return null;
  if (typeof results.settingsKey !== 'string' || results.settingsKey.length > 4096) return null;
  if (!isFiniteNumber(results.createdAt)) return null;
  if (results.scope !== 'all' && results.scope !== 'filtered') return null;
  if (!Array.isArray(results.videos) || results.videos.length > MAX_VIDEOS) return null;
  if (!Array.isArray(results.groups) || results.groups.length > MAX_GROUPS) return null;
  const videos = [];
  for (const video of results.videos) {
    if (!video || !VIDEO_ID.test(String(video.id)) || !isFiniteNumber(video.sizeBytes) || !isFiniteNumber(video.date)) return null;
    videos.push({ id: String(video.id), sizeBytes: video.sizeBytes, date: video.date });
  }
  const groups = [];
  for (const entry of results.groups) {
    const group = sanitizeGroup(entry);
    if (group) groups.push(group);
  }
  // Optional: absent in files written before partial clips existed.
  const partialClips = [];
  if (Array.isArray(results.partialClips) && results.partialClips.length <= MAX_PARTIAL_CLIPS) {
    for (const entry of results.partialClips) {
      const clip = sanitizePartialClip(entry);
      if (clip) partialClips.push(clip);
    }
  }
  return {
    version: RESULTS_FORMAT_VERSION,
    createdAt: results.createdAt,
    settingsKey: results.settingsKey,
    scope: results.scope,
    videos,
    groups,
    ...(partialClips.length > 0 ? { partialClips } : {}),
  };
}

/**
 * @param {{ rootDir: string, writeJsonFile: (fileName: string, data: unknown, rootPath: string) => Promise<void> }} options
 *   `writeJsonFile` is main's atomic writer, so an interrupted save keeps the previous file.
 */
function createDuplicateResultsStore({ rootDir, writeJsonFile }) {
  const folder = path.join(rootDir, RESULTS_FOLDER);

  async function keepNewest() {
    const names = (await fs.readdir(folder).catch(() => [])).filter((name) => name.endsWith('.json'));
    if (names.length <= KEPT_SESSIONS) return;
    const dated = await Promise.all(names.map(async (name) => ({
      name,
      mtime: (await fs.stat(path.join(folder, name)).catch(() => null))?.mtimeMs ?? 0,
    })));
    dated.sort((a, b) => b.mtime - a.mtime);
    await Promise.all(dated.slice(KEPT_SESSIONS).map(({ name }) => fs.rm(path.join(folder, name), { force: true })));
  }

  return {
    /** @param {Parameters<typeof sessionFileName>[0]} session @param {unknown} results */
    async save(session, results) {
      const sanitized = sanitizeResults(results);
      if (!sanitized) return false;
      await fs.mkdir(folder, { recursive: true });
      await writeJsonFile(sessionFileName(session), sanitized, folder);
      await keepNewest();
      return true;
    },
    /**
     * The stored results of a session, or null. A file that cannot be read as results is removed,
     * so it is not tried again on every load.
     * @param {Parameters<typeof sessionFileName>[0]} session
     */
    async load(session) {
      const filePath = path.join(folder, sessionFileName(session));
      let text;
      try {
        text = await fs.readFile(filePath, 'utf8');
      } catch {
        return null;
      }
      let parsed = null;
      try {
        parsed = sanitizeResults(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (!parsed) await fs.rm(filePath, { force: true });
      return parsed;
    },
    /** @param {Parameters<typeof sessionFileName>[0]} session */
    async remove(session) {
      await fs.rm(path.join(folder, sessionFileName(session)), { force: true });
    },
    async clearAll() {
      await fs.rm(folder, { recursive: true, force: true });
    },
  };
}

module.exports = { RESULTS_FORMAT_VERSION, createDuplicateResultsStore, sanitizeResults, sessionFileName };
