// @ts-check
// Picture checks of partial clip candidates, kept between runs. A check depends only on the two files, the
// shared stretch and whether mirrored pictures count, so a stored verdict stands until a file changes:
// the key holds each file's ID (path and size) and modification time.
const fs = require('fs/promises');
const path = require('path');

const FILE_NAME = 'partial-clip-picture-checks.json';
// Bump when the picture check would judge the same stretch differently (partial-clips.js).
const FORMAT_VERSION = 1;
// The verdicts used least recently go first.
const MAX_ENTRIES = 100_000;
const STATES = new Set(['confirmed', 'differentPicture', 'unconfirmed']);

/**
 * @param {{ id: string, date?: number }} shorter
 * @param {{ id: string, date?: number }} other
 * @param {{ startShort: number, startOther: number, lengthSecs: number }} segment
 * @param {boolean} compareFlipped
 */
function pictureCheckKey(shorter, other, segment, compareFlipped) {
  return [
    `${shorter.id}@${shorter.date ?? ''}`,
    `${other.id}@${other.date ?? ''}`,
    segment.startShort.toFixed(2),
    segment.startOther.toFixed(2),
    segment.lengthSecs.toFixed(2),
    compareFlipped ? 'f' : '',
  ].join('|');
}

/** @param {unknown} value @returns {value is [string, string, number | null]} */
function isEntry(value) {
  return Array.isArray(value) && value.length === 3 && typeof value[0] === 'string'
    && STATES.has(value[1]) && (value[2] === null || (typeof value[2] === 'number' && Number.isFinite(value[2])));
}

/**
 * @param {{
 *   rootDir: string,
 *   writeJsonFile: (fileName: string, data: unknown, rootPath: string) => Promise<void>,
 *   onError?: (error: unknown) => void,
 * }} options `writeJsonFile` is main's atomic writer, so an interrupted save keeps the previous file.
 */
function createPictureCheckStore({ rootDir, writeJsonFile, onError = () => {} }) {
  /** @type {Map<string, { state: string, pictureSimilarity: number | null }> | null} */
  let entries = null;
  let changed = false;

  return {
    async load() {
      if (entries) return;
      entries = new Map();
      try {
        const stored = JSON.parse(await fs.readFile(path.join(rootDir, FILE_NAME), 'utf8'));
        if (stored?.version !== FORMAT_VERSION || !Array.isArray(stored.entries)) return;
        for (const entry of stored.entries) {
          if (isEntry(entry)) entries.set(entry[0], { state: entry[1], pictureSimilarity: entry[2] });
        }
      } catch (error) {
        // No file yet is the normal start; anything else is reported and the checks run again.
        if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') onError(error);
      }
    },
    /** @param {string} key */
    get(key) {
      return entries?.get(key) ?? null;
    },
    /** @param {string} key @param {{ state: string, pictureSimilarity: number | null }} verdict */
    set(key, verdict) {
      if (!entries) return;
      // Re-inserted, so the verdicts used most recently are the last to go.
      entries.delete(key);
      entries.set(key, { state: verdict.state, pictureSimilarity: verdict.pictureSimilarity });
      changed = true;
    },
    /** Writes new verdicts; a failed write is reported and tried again at the next save. */
    async save() {
      if (!entries || !changed) return;
      changed = false;
      const kept = [...entries].slice(-MAX_ENTRIES);
      try {
        await writeJsonFile(FILE_NAME, { version: FORMAT_VERSION, entries: kept.map(([key, v]) => [key, v.state, v.pictureSimilarity]) }, rootDir);
      } catch (error) {
        changed = true;
        onError(error);
      }
    },
    async clear() {
      entries = null;
      changed = false;
      await fs.rm(path.join(rootDir, FILE_NAME), { force: true });
    },
  };
}

module.exports = { createPictureCheckStore, pictureCheckKey };
