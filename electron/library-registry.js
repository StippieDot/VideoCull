// @ts-check
const path = require('node:path');
const { pathKey } = require('./path-key');
const { isFolderInsideSync, isSameFolderSync } = require('./main-helpers');

/**
 * Main's record of what the current session has loaded: the opened folders and every video a scan
 * listed, with its ID, file identity and (for videos reached through a link) the file itself.
 * Every IPC handler that takes a file path validates against it, so identity checks happen only
 * in main. `reset()` is the only way to throw the whole session away.
 */
function createLibraryRegistry() {
  /** @type {Set<string>} */
  let roots = new Set();
  /** @type {Set<string>} */
  const knownPaths = new Set();
  /** @type {Map<string, string>} */
  const idsByPath = new Map();
  /** @type {Map<string, any>} */
  const identitiesByPath = new Map();
  // Videos reached through a link or junction: shown path -> the file itself, which delete acts on.
  /** @type {Map<string, string>} */
  const realPathsByPath = new Map();
  // Real path key -> the shown path that owns it, so folders that reach one file list it once.
  /** @type {Map<string, string>} */
  const realPathOwners = new Map();
  // Links and junctions the scans followed (path as shown -> real target); containment trusts paths
  // through these besides the loaded folders.
  /** @type {Map<string, string>} */
  const followedLinks = new Map();

  /** @param {string} filePath */
  function forget(filePath) {
    knownPaths.delete(filePath);
    idsByPath.delete(filePath);
    identitiesByPath.delete(filePath);
    realPathOwners.delete(pathKey(realPathsByPath.get(filePath) ?? filePath));
    realPathsByPath.delete(filePath);
  }

  return {
    reset() {
      roots = new Set();
      knownPaths.clear();
      idsByPath.clear();
      identitiesByPath.clear();
      realPathsByPath.clear();
      realPathOwners.clear();
      followedLinks.clear();
    },
    /** A copy, so callers cannot add or remove folders behind the registry's back. */
    loadedRoots: () => new Set(roots),
    rootCount: () => roots.size,
    /** @param {string} dirPath */
    isLoadedRoot: (dirPath) => roots.has(dirPath),
    /** @param {string} dirPath */
    addRoot(dirPath) {
      roots.add(dirPath);
    },
    /**
     * Drops one folder and the videos listed under it.
     * @param {string} dirPath
     */
    removeRoot(dirPath) {
      roots.delete(dirPath);
      for (const videoPath of [...knownPaths]) {
        const folder = path.dirname(videoPath);
        if (isSameFolderSync(folder, dirPath) || isFolderInsideSync(folder, dirPath)) forget(videoPath);
      }
    },
    /**
     * Links a scan followed, so containment checks trust paths through them.
     * @param {Array<{ link: string, target: string }> | undefined} links
     */
    recordFollowedLinks(links) {
      for (const { link, target } of links ?? []) followedLinks.set(link, target);
    },
    hasFollowedLinks: () => followedLinks.size > 0,
    followedLinks: () => followedLinks,
    /**
     * Records a scan's videos and returns those that are new to the session. A file another loaded
     * folder already reaches (through a link) is listed once; a second entry would be paired with
     * itself as a duplicate, and deleting "the copy" deletes the only one.
     * @template {{ path: string, id: string, fileIdentity?: any }} T
     * @param {T[]} videos
     * @param {Map<string, string>} scannedRealPaths shown path -> real path, for the scanned videos
     * @returns {T[]}
     */
    recordScanned(videos, scannedRealPaths) {
      const kept = videos.filter((video) => {
        const key = pathKey(scannedRealPaths.get(video.path) ?? video.path);
        const owner = realPathOwners.get(key);
        if (owner && owner !== video.path) return false;
        realPathOwners.set(key, video.path);
        return true;
      });
      for (const video of kept) {
        knownPaths.add(video.path);
        idsByPath.set(video.path, video.id);
        identitiesByPath.set(video.path, video.fileIdentity);
        const realPath = scannedRealPaths.get(video.path);
        if (realPath && realPath !== video.path) realPathsByPath.set(video.path, realPath);
      }
      return kept;
    },
    forget,
    /** @param {string} filePath */
    isKnownPath: (filePath) => knownPaths.has(filePath),
    knownPathCount: () => knownPaths.size,
    /** @param {string} filePath */
    idFor: (filePath) => idsByPath.get(filePath),
    /** @param {string} filePath */
    identityFor: (filePath) => identitiesByPath.get(filePath),
    /**
     * The file itself for a video reached through a link, else undefined.
     * @param {string} filePath
     */
    scannedRealPathFor: (filePath) => realPathsByPath.get(filePath),
  };
}

module.exports = { createLibraryRegistry };
