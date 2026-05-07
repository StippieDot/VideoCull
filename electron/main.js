const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { scanDirectory } = require('./scanner');
const { processVideos, cancelProcessing, getConcurrentLimit } = require('./processor');
const cache = require('./cache');
const log = require('./logger');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
if (isDev) app.setPath('userData', app.getPath('userData') + '-dev');
let mainWindow;
let currentScanDir = null;
let currentScanDirs = new Set();
let defaultCentralCacheRoot = null; // set after app ready
let activeCacheRoots = new Set();
let isQuitting = false;
const activeBatchIntervals = new Set();
let menuBarHiddenForVideoFullscreen = false;

// Set of known valid video paths, populated on every scan-directory call.
// All IPC handlers that accept file paths validate against this set.
const knownVideoPaths = new Set();

/**
 * Returns true if `candidate` resolves to `baseDir` or a path inside it.
 * First does a fast path.resolve check (catches ../ traversal), then follows
 * symlinks with fs.realpath to prevent symlink-based directory traversal.
 * If the candidate file doesn't exist yet (e.g. thumbnail not generated),
 * the path.resolve check is sufficient â€” the caller's file read will 404.
 */
async function isPathWithinDir(candidate, baseDir) {
  const resolved = path.resolve(candidate);
  const resolvedBase = path.resolve(baseDir);

  const isSameOrInside = (targetPath, rootPath) => {
    const relative = path.relative(rootPath, targetPath);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  };

  // Fast check: deny immediately if the normalised path escapes the base dir.
  // path.relative handles drive roots like "D:\" correctly; string prefix checks
  // can accidentally require "D:\\" and reject every child on the drive.
  if (!isSameOrInside(resolved, resolvedBase)) {
    return false;
  }

  // Symlink check: follow real paths for files that exist
  try {
    const real = await fs.realpath(candidate);
    const realBase = await fs.realpath(baseDir).catch(() => resolvedBase);
    return isSameOrInside(real, realBase);
  } catch {
    // Candidate doesn't exist (e.g. thumbnail still being generated).
    // path.resolve check above already passed â€” allow it through.
    return true;
  }
}

function getRangeDetails(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return { hasRange: false, start: 0, end: fileSize - 1, chunkSize: fileSize, valid: true };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return { hasRange: true, valid: false, error: 'Malformed Range header.' };
  }

  let start;
  let end;
  if (match[1] === '' && match[2] === '') {
    return { hasRange: true, valid: false, error: 'Range start and end are both empty.' };
  }

  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { hasRange: true, valid: false, error: 'Invalid suffix byte range.' };
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? fileSize - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return { hasRange: true, valid: false, start, end, error: 'Requested range is outside the file.' };
  }

  end = Math.min(end, fileSize - 1);
  return { hasRange: true, start, end, chunkSize: end - start + 1, valid: true };
}

function getFilePathFromProtocolRequest(request, scheme) {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'local' && url.pathname.length > 1) {
      return decodeURIComponent(url.pathname.slice(1));
    }
  } catch {
    // Fall through to the legacy parser below.
  }

  return decodeURIComponent(request.url.slice(`${scheme}:///`.length));
}

function canSendToRenderer() {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    !mainWindow.webContents.isDestroyed()
  );
}

function sendToRenderer(channel, payload) {
  if (!canSendToRenderer()) {
    return false;
  }

  try {
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch (err) {
    return false;
  }
}

function folderDisplayName(folderPath) {
  return path.basename(path.resolve(folderPath)) || folderPath;
}

function setVideoFullscreenMenuState(fullscreen) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  menuBarHiddenForVideoFullscreen = Boolean(fullscreen);
  mainWindow.setAutoHideMenuBar(menuBarHiddenForVideoFullscreen);
  mainWindow.setMenuBarVisibility(!menuBarHiddenForVideoFullscreen);
  return true;
}

// â”€â”€ Window â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    menuBarHiddenForVideoFullscreen = false;
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// â”€â”€ Custom Protocol for serving thumbnail images and videos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const customProtocolSchemes = [
  { scheme: 'thumb', privileges: { standard: true, secure: true, bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'video', privileges: { standard: true, secure: true, bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
];
protocol.registerSchemesAsPrivileged(customProtocolSchemes);

app.whenReady().then(() => {
  defaultCentralCacheRoot = path.join(app.getPath('userData'), 'video-cache');

  protocol.handle('thumb', async (request) => {
    let filePath = getFilePathFromProtocolRequest(request, 'thumb');

    // On Windows, ensure the path starts with drive letter
    if (process.platform === 'win32' && !filePath.match(/^[a-zA-Z]:/)) {
      filePath = filePath.replace(/^\//, '');
    }

    // Security: only serve .jpg files inside the current scan dir's thumb folder
    if (!filePath.toLowerCase().endsWith('.jpg')) {
      return new Response('Access Denied', { status: 403 });
    }
    if (activeCacheRoots.size === 0) {
      return new Response('Access Denied', { status: 403 });
    }
    if (!await isPathWithinAnyDir(filePath, activeCacheRoots)) {
      return new Response('Access Denied', { status: 403 });
    }
    
    try {
      const buffer = await require('fs').promises.readFile(filePath);
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, immutable',
        }
      });
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  });

  protocol.handle('video', async (request) => {
    let filePath;
    try {
      filePath = getFilePathFromProtocolRequest(request, 'video');
    } catch (err) {
      return new Response('Bad Request', { status: 400 });
    }

    // On Windows, ensure the path starts with drive letter
    if (process.platform === 'win32' && !filePath.match(/^[a-zA-Z]:/)) {
      filePath = filePath.replace(/^\//, '');
    }

    // Security: only serve files inside the current scan directory
    if (currentScanDirs.size === 0 || !await isPathWithinAnyDir(filePath, currentScanDirs)) {
      return new Response('Access Denied', { status: 403 });
    }

    try {
      const { createReadStream, statSync } = require('fs');
      // For video streaming we need to manually handle range requests to support seeking.
      // We use a large highWaterMark (5MB) to drastically reduce IPC overhead and prevent buffering.
      const { Readable } = require('stream');
      const stats = statSync(filePath);
      const fileSize = stats.size;
      const range = request.headers.get('range');

      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'video/mp4';
      if (ext === '.webm') contentType = 'video/webm';
      else if (ext === '.ogg') contentType = 'video/ogg';

      const highWaterMark = 5 * 1024 * 1024; // 5MB chunks
      const rangeDetails = getRangeDetails(range, fileSize);

      if (!rangeDetails.valid) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: {
            'Content-Range': `bytes */${fileSize}`,
            'Accept-Ranges': 'bytes',
          }
        });
      }

      if (rangeDetails.hasRange) {
        const { start, end, chunkSize } = rangeDetails;
        const fileStream = createReadStream(filePath, { start, end, highWaterMark });
        const webStream = Readable.toWeb(fileStream);

        const responseHeaders = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': contentType,
        };
        return new Response(webStream, {
          status: 206,
          headers: responseHeaders
        });
      } else {
        const fileStream = createReadStream(filePath, { highWaterMark });
        const webStream = Readable.toWeb(fileStream);
        const responseHeaders = {
          'Content-Length': fileSize.toString(),
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        };
        return new Response(webStream, {
          status: 200,
          headers: responseHeaders
        });
      }
    } catch (e) {
      log.error('[video://] Protocol error:', e);
      return new Response('Not Found', { status: 404 });
    }
  });

  createWindow();
  setApplicationMenu();
  pruneDistributedIndex().catch((err) => log.warn('[cache] Failed to prune distributed index:', err));
  if (!isDev) setupAutoUpdater();
});

function setApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToRenderer('menu-action', 'open-settings')
        },
        { type: 'separator' },
        {
          label: 'Open Directory...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToRenderer('menu-action', 'open-directory')
        },
        {
          label: 'Rescan Directory',
          accelerator: 'F5',
          click: () => sendToRenderer('menu-action', 'rescan-directory')
        },
        {
          label: 'Clear Cache & Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => sendToRenderer('menu-action', 'clear-cache')
        },
        {
          label: 'Export Report...',
          id: 'export-report',
          enabled: false,
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendToRenderer('menu-action', 'export-report')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Actions',
      submenu: [
        {
          label: 'Undo Last Action',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendToRenderer('menu-action', 'undo')
        },
        {
          label: 'Delete All Marked Videos',
          accelerator: 'CmdOrCtrl+Backspace',
          click: () => sendToRenderer('menu-action', 'delete-all')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => sendToRenderer('menu-action', 'zoom-in')
        },
        {
          label: 'Zoom In (Alt)',
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          click: () => sendToRenderer('menu-action', 'zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendToRenderer('menu-action', 'zoom-out')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggledevtools' }] : [])
      ]
    },
    {
      label: 'Video',
      submenu: [
        {
          label: 'Reveal in Explorer',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendToRenderer('menu-action', 'reveal-video')
        },
        {
          label: 'Play Externally',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendToRenderer('menu-action', 'play-external')
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setExportReportEnabled(enabled) {
  const menu = Menu.getApplicationMenu();
  const item = menu?.getMenuItemById('export-report');
  if (item) item.enabled = enabled;
}

ipcMain.on('set-export-report-available', (_event, enabled) => {
  setExportReportEnabled(Boolean(enabled));
});

ipcMain.handle('set-video-fullscreen', (_event, fullscreen) => {
  return setVideoFullscreenMenuState(Boolean(fullscreen));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  cancelProcessing();
  for (const interval of activeBatchIntervals) {
    clearInterval(interval);
  }
  activeBatchIntervals.clear();
  cache.closeDb();
});

// â”€â”€ Cache constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Legacy directory name â€” only used to locate old thumbnails during migration.
// New thumbnails are written to cacheRootDir/thumbs/<folderKey>/ from P0 onwards,
// where folderKey matches the DB filename (same sanitization).
const THUMB_DIR = '.video-cull-thumbs';
const CONFIG_FILE = 'settings.json';
const CACHE_INDEX_FILE = 'cache-index.json';
const DISTRIBUTED_INDEX_FILE = 'distributed-index.json';
const ATOMIC_SAVE_SYNC_LIMIT = 1000;

async function readJsonFile(fileName, fallback) {
  try {
    const data = await fs.readFile(path.join(app.getPath('userData'), fileName), 'utf8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(fileName, data) {
  await fs.writeFile(path.join(app.getPath('userData'), fileName), JSON.stringify(data, null, 2), 'utf8');
}

async function getCacheOptions() {
  const config = await readJsonFile(CONFIG_FILE, {});

  return {
    mode: config.cacheLocation || 'centralised',
    defaultCentralRoot: defaultCentralCacheRoot,
    centralCachePath: config.centralCachePath || null,
    perDriveCachePaths: config.perDriveCachePaths || {},
    username: os.userInfo().username,
  };
}

/** Returns the resolved cache paths for a loaded folder. */
function getCachePaths(dirPath, cacheOptions) {
  return cache.resolveCachePaths(dirPath, cacheOptions);
}

function normalizeCacheSettings(settings = {}) {
  return {
    mode: settings.cacheLocation || 'centralised',
    defaultCentralRoot: defaultCentralCacheRoot,
    centralCachePath: settings.centralCachePath || null,
    perDriveCachePaths: settings.perDriveCachePaths || {},
    username: os.userInfo().username,
  };
}

async function registerCacheFolder(folderPath, cachePaths) {
  const index = await readJsonFile(CACHE_INDEX_FILE, { knownFolders: [] });
  const knownFolders = Array.isArray(index.knownFolders) ? index.knownFolders : [];
  if (!knownFolders.includes(folderPath)) {
    knownFolders.push(folderPath);
    await writeJsonFile(CACHE_INDEX_FILE, { ...index, knownFolders });
  }

  if (cachePaths.mode === 'distributed') {
    const distributed = await readJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: [] });
    const knownDistributedPaths = Array.isArray(distributed.knownDistributedPaths) ? distributed.knownDistributedPaths : [];
    if (!knownDistributedPaths.includes(folderPath)) {
      knownDistributedPaths.push(folderPath);
      await writeJsonFile(DISTRIBUTED_INDEX_FILE, { ...distributed, knownDistributedPaths });
    }
  }
}

async function pruneDistributedIndex() {
  const distributed = await readJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: [] });
  const knownDistributedPaths = Array.isArray(distributed.knownDistributedPaths) ? distributed.knownDistributedPaths : [];
  const pruned = [];
  for (const folderPath of knownDistributedPaths) {
    try {
      const stats = await fs.stat(folderPath);
      if (stats.isDirectory()) pruned.push(folderPath);
    } catch {
      // Drop stale paths.
    }
  }
  if (pruned.length !== knownDistributedPaths.length) {
    await writeJsonFile(DISTRIBUTED_INDEX_FILE, { ...distributed, knownDistributedPaths: pruned });
  }
}

async function testWritableDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.videocull-write-test-${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.unlink(probe).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getDriveKeyForPath(targetPath) {
  return path.parse(path.resolve(targetPath)).root.replace(/[\\/]$/, '').toUpperCase();
}

async function movePathIfPresent(source, target) {
  try {
    await fs.access(source);
  } catch {
    return false;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.cp(source, target, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
  return true;
}

function isSqliteCorruptionError(err) {
  return (
    err?.code === 'SQLITE_CORRUPT' ||
    err?.code === 'SQLITE_CORRUPT_INDEX' ||
    err?.code === 'SQLITE_NOTADB' ||
    /database disk image is malformed|file is not a database/i.test(String(err?.message || err))
  );
}

async function quarantineCorruptCacheDb(folderPath, cacheOptions, reason) {
  const cachePaths = getCachePaths(folderPath, cacheOptions);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  log.warn(`[cache] Corrupt DB detected for ${folderPath}; quarantining cache. Reason: ${reason}`);

  cache.closeDb();

  for (const sourcePath of collectCacheSidecars(cachePaths.dbPath)) {
    try {
      await fs.access(sourcePath);
    } catch {
      continue;
    }

    const targetPath = `${sourcePath}.corrupt-${stamp}`;
    try {
      await fs.rename(sourcePath, targetPath);
      log.warn(`[cache] Moved corrupt cache file: ${sourcePath} -> ${targetPath}`);
    } catch (err) {
      log.warn(`[cache] Failed to quarantine corrupt cache file ${sourcePath}:`, err);
    }
  }

  sendToRenderer('app-notification', {
    title: `Cache rebuilt: ${folderDisplayName(folderPath)}`,
    detail: 'Damaged DB was quarantined; cached decisions there may be missing.',
    kind: 'warning',
    dedupeKey: `corrupt-cache:${folderPath}`,
    durationMs: 8000,
  });
}

function collectCacheSidecars(dbPath) {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
}

async function migrateOneCache(folderPath, fromOptions, toOptions) {
  const fromPaths = cache.resolveCachePaths(folderPath, fromOptions);
  const toPaths = cache.resolveCachePaths(folderPath, toOptions);
  const result = { folderPath, movedDb: false, movedThumbs: false, skipped: false, error: null };

  if (path.resolve(fromPaths.dbPath) === path.resolve(toPaths.dbPath)) {
    result.skipped = true;
    return result;
  }

  try {
    cache.closeDb();
    for (const sourceDbPath of collectCacheSidecars(fromPaths.dbPath)) {
      const suffix = sourceDbPath.slice(fromPaths.dbPath.length);
      const moved = await movePathIfPresent(sourceDbPath, `${toPaths.dbPath}${suffix}`);
      result.movedDb = result.movedDb || moved;
    }
    result.movedThumbs = await movePathIfPresent(fromPaths.thumbRootDir, toPaths.thumbRootDir);
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

async function getKnownCacheFolders(loadedDirs = []) {
  const index = await readJsonFile(CACHE_INDEX_FILE, { knownFolders: [] });
  const distributed = await readJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: [] });
  const knownFolders = Array.isArray(index.knownFolders) ? index.knownFolders : [];
  const knownDistributedPaths = Array.isArray(distributed.knownDistributedPaths) ? distributed.knownDistributedPaths : [];
  return Array.from(new Set([...knownFolders, ...knownDistributedPaths, ...loadedDirs].filter(Boolean)));
}

function cacheRelevantSettingsChanged(oldSettings = {}, newSettings = {}) {
  return (
    oldSettings.cacheLocation !== newSettings.cacheLocation ||
    (oldSettings.centralCachePath || null) !== (newSettings.centralCachePath || null) ||
    JSON.stringify(oldSettings.perDriveCachePaths || {}) !== JSON.stringify(newSettings.perDriveCachePaths || {})
  );
}

function isFolderInsideSync(childFolder, parentFolder) {
  const child = path.resolve(childFolder).toLowerCase();
  const parent = path.resolve(parentFolder).toLowerCase();
  return child !== parent && child.startsWith(parent + path.sep);
}

function isSameFolderSync(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function loadCacheMapWithAbsoluteThumbs(db, cacheRootDir) {
  const map = cache.loadCacheMap(db);
  for (const cached of map.values()) {
    cached.thumbnails = cached.thumbnails.map((thumb) => thumbAbsolute(thumb, cacheRootDir));
  }
  return map;
}

async function openCacheDbWithRecovery(folderPath, cacheOptions) {
  try {
    return cache.openDb(folderPath, cacheOptions);
  } catch (err) {
    if (!isSqliteCorruptionError(err)) throw err;
    await quarantineCorruptCacheDb(folderPath, cacheOptions, err.code || err.message);
    return cache.openDb(folderPath, cacheOptions);
  }
}

async function loadCacheMapWithRecovery(folderPath, cacheOptions, cacheRootDir) {
  let db = await openCacheDbWithRecovery(folderPath, cacheOptions);
  try {
    return loadCacheMapWithAbsoluteThumbs(db, cacheRootDir);
  } catch (err) {
    if (!isSqliteCorruptionError(err)) throw err;
    await quarantineCorruptCacheDb(folderPath, cacheOptions, err.code || err.message);
    db = cache.openDb(folderPath, cacheOptions);
    return loadCacheMapWithAbsoluteThumbs(db, cacheRootDir);
  }
}

function getVideoFolderPath(video) {
  return path.dirname(video.path);
}

function groupVideosByFolder(videos) {
  const groups = new Map();
  for (const video of videos) {
    if (!video?.path) continue;
    const folderPath = getVideoFolderPath(video);
    const group = groups.get(folderPath) ?? [];
    group.push(video);
    groups.set(folderPath, group);
  }
  return groups;
}

function mergeCacheMap(targetMap, sourceMap, scannedIds = null, { overwrite = false } = {}) {
  for (const [videoId, cached] of sourceMap) {
    if (scannedIds && !scannedIds.has(videoId)) continue;
    if (overwrite || !targetMap.has(videoId)) targetMap.set(videoId, cached);
  }
}

async function prepareCacheFolder(folderPath, cacheOptions) {
  const cachePaths = getCachePaths(folderPath, cacheOptions);
  activeCacheRoots.add(cachePaths.cacheRootDir);
  await registerCacheFolder(folderPath, cachePaths);
  await fs.mkdir(cachePaths.thumbRootDir, { recursive: true });
  return cachePaths;
}

async function saveVideosByParentFolder(videos, cacheOptions, { atomic = false } = {}) {
  const groups = groupVideosByFolder(videos);
  for (const [folderPath, folderVideos] of groups) {
    const cachePaths = await prepareCacheFolder(folderPath, cacheOptions);
    const payload = folderVideos.map((video) => videoForDb(video, cachePaths.cacheRootDir));

    const writePayload = async () => {
      const db = await openCacheDbWithRecovery(folderPath, cacheOptions);
      if (atomic && payload.length <= ATOMIC_SAVE_SYNC_LIMIT) {
        cache.saveCache(db, payload);
      } else {
        await cache.saveCacheChunked(db, payload);
      }
    };

    try {
      await writePayload();
    } catch (err) {
      if (!isSqliteCorruptionError(err)) throw err;
      await quarantineCorruptCacheDb(folderPath, cacheOptions, err.code || err.message);
      await writePayload();
    }
  }
}

async function loadOwnerFolderCachesIntoMap(videos, rootDirPath, cacheOptions, cachedMap) {
  const scannedIds = new Set(videos.map((video) => video.id));
  const ownerFolders = Array.from(new Set(
    videos
      .map((video) => getVideoFolderPath(video))
      .filter((folderPath) => !isSameFolderSync(folderPath, rootDirPath))
  ));

  for (const ownerFolder of ownerFolders) {
    try {
      const ownerPaths = await prepareCacheFolder(ownerFolder, cacheOptions);
      const ownerMap = await loadCacheMapWithRecovery(ownerFolder, cacheOptions, ownerPaths.cacheRootDir);
      // Owner-folder caches are the canonical location after P3. Let them win
      // over stale parent rows if both exist.
      mergeCacheMap(cachedMap, ownerMap, scannedIds, { overwrite: true });
    } catch (err) {
      log.warn(`[scan-directory] Failed to load owner cache for ${ownerFolder}:`, err);
    }
  }
}

async function splitDescendantRowsFromParentDb(parentFolder, parentDb, cacheOptions, parentCacheRootDir) {
  const cachedVideos = cache.loadCacheVideos(parentDb);
  const byTargetFolder = new Map();

  for (const cached of cachedVideos) {
    if (!cached.path) continue;
    const targetFolder = getVideoFolderPath(cached);
    if (isSameFolderSync(targetFolder, parentFolder)) continue;
    try {
      const stats = await fs.stat(targetFolder);
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }

    const absoluteThumbs = cached.thumbnails.map((thumb) => thumbAbsolute(thumb, parentCacheRootDir));
    const video = { ...cached, thumbnails: absoluteThumbs };
    const group = byTargetFolder.get(targetFolder) ?? [];
    group.push(video);
    byTargetFolder.set(targetFolder, group);
  }

  if (byTargetFolder.size === 0) return;

  let movedCount = 0;
  for (const [targetFolder, videos] of byTargetFolder) {
    const targetPaths = await prepareCacheFolder(targetFolder, cacheOptions);
    const targetDb = await openCacheDbWithRecovery(targetFolder, cacheOptions);
    cache.saveCache(targetDb, videos.map((video) => videoForDb(video, targetPaths.cacheRootDir)));
    cache.deleteVideosByIds(parentDb, videos.map((video) => video.id));
    movedCount += videos.length;
  }

  log.info(`[cache] Split ${movedCount} descendant cached video rows out of ${parentFolder}`);
}

// â”€â”€ Thumbnail path helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The DB always stores paths relative to cacheRootDir (e.g. 'thumbs/id/thumb_01.jpg').
// The renderer always receives absolute paths. main.js converts at the boundary.

function thumbAbsolute(relPath, cacheRootDir) {
  if (!relPath || path.isAbsolute(relPath)) return relPath; // already absolute (legacy)
  return path.join(cacheRootDir, relPath);
}

function thumbRelative(absPath, cacheRootDir) {
  if (!absPath || !path.isAbsolute(absPath)) return absPath; // already relative
  const rel = path.relative(cacheRootDir, absPath);
  return rel.startsWith('..') ? absPath : rel; // keep absolute if outside cacheRootDir
}

function videoForDb(v, cacheRootDir) {
  return { ...v, thumbnails: v.thumbnails?.map((thumb) => thumbRelative(thumb, cacheRootDir)) ?? [] };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatDate(timestampMs) {
  if (!timestampMs) return '--';
  return new Date(timestampMs).toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function isPathWithinAnyDir(filePath, dirs) {
  for (const dir of dirs) {
    if (await isPathWithinDir(filePath, dir)) return true;
  }
  return false;
}

async function isValidLoadedPath(filePath) {
  if (currentScanDirs.size === 0 || !knownVideoPaths.has(filePath)) return false;
  return isPathWithinAnyDir(filePath, currentScanDirs);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function buildReportHtml(videos, dirPath) {
  const sortedVideos = [...videos].sort((a, b) => a.filename.localeCompare(b.filename));

  const getRelativeFolder = (videoPath) => {
    const folder = path.dirname(videoPath);
    const rel = path.relative(dirPath, folder).replace(/\\/g, '/');
    if (!rel || rel === '.') return 'Root';
    return rel;
  };

  const groupByFolder = (items) => {
    const map = new Map();
    for (const video of items) {
      const folder = getRelativeFolder(video.path);
      const group = map.get(folder);
      if (group) {
        group.push(video);
      } else {
        map.set(folder, [video]);
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, folderVideos]) => ({ folder, videos: folderVideos }));
  };

  const groups = {
    keep: sortedVideos.filter((video) => video.status === 'keep'),
    delete: sortedVideos.filter((video) => video.status === 'delete'),
    skipped: sortedVideos.filter((video) => video.status === 'skipped'),
    pending: sortedVideos.filter((video) => video.status === 'pending'),
  };

  const totalSize = sortedVideos.reduce((sum, video) => sum + (video.sizeBytes || 0), 0);
  const keptSize = groups.keep.reduce((sum, video) => sum + (video.sizeBytes || 0), 0);
  const deletedSize = groups.delete.reduce((sum, video) => sum + (video.sizeBytes || 0), 0);
  const skippedSize = groups.skipped.reduce((sum, video) => sum + (video.sizeBytes || 0), 0);
  const pendingSize = groups.pending.reduce((sum, video) => sum + (video.sizeBytes || 0), 0);

  const rowHtml = (video) => `
    <tr>
      <td class="filename" title="${escapeHtml(video.path)}">${escapeHtml(video.filename)}</td>
      <td>${escapeHtml(formatBytes(video.sizeBytes || 0))}</td>
      <td>${escapeHtml(formatDuration(video.durationSecs))}</td>
      <td>${escapeHtml(formatDate(video.metadataDate || video.date))}</td>
      <td><span class="status status-${escapeHtml(video.status)}">${escapeHtml(video.status)}</span></td>
    </tr>`;

  const folderSectionHtml = (folder, items) => `
    <div class="folder-group">
      <h3>${escapeHtml(folder)} <span>(${items.length})</span></h3>
      <table>
        <thead>
          <tr>
            <th>Filename</th>
            <th>Size</th>
            <th>Duration</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${items.length > 0 ? items.map(rowHtml).join('') : '<tr><td colspan="5" class="empty">No videos</td></tr>'}
        </tbody>
      </table>
    </div>`;

  const sectionHtml = (title, items) => {
    const folders = groupByFolder(items);
    return `
    <section class="group">
      <h2>${escapeHtml(title)} <span>(${items.length})</span></h2>
      ${items.length > 0 ? folders.map((folderGroup) => folderSectionHtml(folderGroup.folder, folderGroup.videos)).join('') : '<p class="empty">No videos</p>'}
    </section>`;
  };

  return `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Video Cull Report</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: Arial, sans-serif; background: #0b0b12; color: #f3f4f6; }
      .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; }
      .hero { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
      .hero h1 { margin: 0; font-size: 28px; }
      .hero p { margin: 0; color: #a1a1aa; }
      .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 20px 0 28px; }
      .card { background: #141420; border: 1px solid #2a2a3a; border-radius: 14px; padding: 16px; }
      .card .label { color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
      .card .value { margin-top: 8px; font-size: 20px; font-weight: 700; }
      .group { margin: 24px 0; }
      .group h2 { margin: 0 0 12px; font-size: 18px; }
      .folder-group { margin: 14px 0 20px; }
      .folder-group h3 { margin: 0 0 8px; font-size: 14px; color: #d1d5db; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 14px; }
      thead th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; background: #141420; padding: 12px 14px; border-bottom: 1px solid #2a2a3a; }
      tbody td { padding: 12px 14px; border-bottom: 1px solid #232333; background: #101018; }
      tbody tr:nth-child(even) td { background: #0f0f16; }
      .filename { max-width: 540px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .status { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
      .status-keep { background: rgba(0, 250, 154, 0.16); color: #34d399; }
      .status-delete { background: rgba(255, 71, 87, 0.16); color: #fb7185; }
      .status-skipped { background: rgba(245, 158, 11, 0.16); color: #f59e0b; }
      .status-pending { background: rgba(148, 163, 184, 0.16); color: #cbd5e1; }
      .empty { color: #9ca3af; text-align: center; padding: 18px; }
      @media (max-width: 900px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 640px) { .summary { grid-template-columns: 1fr; } tbody td, thead th { padding: 10px 12px; } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header class="hero">
        <h1>Video Cull Report</h1>
        <p>${escapeHtml(dirPath)}</p>
        <p>Exported ${escapeHtml(new Date().toLocaleString())}</p>
      </header>

      <section class="summary">
        <div class="card"><div class="label">Total videos</div><div class="value">${sortedVideos.length}</div></div>
        <div class="card"><div class="label">Total size</div><div class="value">${escapeHtml(formatBytes(totalSize))}</div></div>
        <div class="card"><div class="label">Kept size</div><div class="value">${escapeHtml(formatBytes(keptSize))}</div></div>
        <div class="card"><div class="label">Delete size</div><div class="value">${escapeHtml(formatBytes(deletedSize))}</div></div>
        <div class="card"><div class="label">Skipped size</div><div class="value">${escapeHtml(formatBytes(skippedSize))}</div></div>
        <div class="card"><div class="label">Pending size</div><div class="value">${escapeHtml(formatBytes(pendingSize))}</div></div>
      </section>

      ${sectionHtml('Keep', groups.keep)}
      ${sectionHtml('Delete', groups.delete)}
      ${sectionHtml('Skipped', groups.skipped)}
      ${sectionHtml('Pending', groups.pending)}
    </div>
  </body>
  </html>`;
}

// â”€â”€ IPC Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// 1. Select directory via OS dialog
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// 1b. Validate a drag-dropped path â€” confirms it exists and is a directory
ipcMain.handle('validate-dropped-path', async (_event, droppedPath) => {
  try {
    const stats = await fs.stat(droppedPath);
    return { valid: true, isDirectory: stats.isDirectory() };
  } catch {
    return { valid: false, isDirectory: false };
  }
});

ipcMain.handle('reset-loaded-directories', async () => {
  cancelProcessing();
  currentScanDir = null;
  currentScanDirs = new Set();
  activeCacheRoots = new Set();
  knownVideoPaths.clear();
  cache.closeDb();
  return true;
});

// 2. Scan directory for video files
ipcMain.handle('scan-directory', async (_event, dirPath, includeSubfolders) => {
  log.info(`[scan-directory] called for: ${dirPath}`);
  // Security: Validate dirPath
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) throw new Error('Not a directory');
  } catch (err) {
    throw new Error('Invalid directory path');
  }

  currentScanDir = currentScanDir || dirPath;
  currentScanDirs.add(dirPath);

  const cacheOptions = await getCacheOptions();
  const cachePaths = await prepareCacheFolder(dirPath, cacheOptions);

  // Open SQLite DB for this directory (creates schema if first time)
  let db = await openCacheDbWithRecovery(dirPath, cacheOptions);

  // Import old JSON cache if present (first launch after update)
  await cache.migrateJsonIfNeeded(dirPath, db);
  try {
    await splitDescendantRowsFromParentDb(dirPath, db, cacheOptions, cachePaths.cacheRootDir);
  } catch (err) {
    if (!isSqliteCorruptionError(err)) throw err;
    await quarantineCorruptCacheDb(dirPath, cacheOptions, err.code || err.message);
    db = await openCacheDbWithRecovery(dirPath, cacheOptions);
  }

  let knownCacheFolders = await getKnownCacheFolders();
  const parentCacheFolders = knownCacheFolders.filter((folderPath) => isFolderInsideSync(dirPath, folderPath));
  for (const parentFolder of parentCacheFolders) {
    try {
      const parentPaths = getCachePaths(parentFolder, cacheOptions);
      activeCacheRoots.add(parentPaths.cacheRootDir);
      const parentDb = await openCacheDbWithRecovery(parentFolder, cacheOptions);
      await splitDescendantRowsFromParentDb(parentFolder, parentDb, cacheOptions, parentPaths.cacheRootDir);
    } catch (err) {
      log.warn(`[scan-directory] Failed to split parent cache for ${parentFolder}:`, err);
    }
  }

  // Load existing cache entries for merging. Known subfolder caches are folded in
  // so opening a parent preserves decisions made when a child folder was opened alone.
  const cachedMap = await loadCacheMapWithRecovery(dirPath, cacheOptions, cachePaths.cacheRootDir);
  knownCacheFolders = await getKnownCacheFolders();
  const childCacheFolders = knownCacheFolders.filter((folderPath) => isFolderInsideSync(folderPath, dirPath));
  for (const childFolder of childCacheFolders) {
    try {
      const childPaths = getCachePaths(childFolder, cacheOptions);
      activeCacheRoots.add(childPaths.cacheRootDir);
      const childMap = await loadCacheMapWithRecovery(childFolder, cacheOptions, childPaths.cacheRootDir);
      mergeCacheMap(cachedMap, childMap);
    } catch (err) {
      log.warn(`[scan-directory] Failed to reuse subfolder cache for ${childFolder}:`, err);
    }
  }

  // Migrate any old .video-cull-thumbs thumbnails into the cache directory.
  // Filesystem-based: checks disk directly, not the DB, so it works even when
  // the DB has no thumbnail records (e.g. first launch after JSONâ†’SQLite migration).
  // Runs once per folder; subsequent scans find nothing to move and are instant.
  const oldThumbBase = path.join(dirPath, THUMB_DIR);
  const oldVideoIds = await fs.readdir(oldThumbBase).catch(() => []);
  if (oldVideoIds.length > 0) {
    const newThumbRoot = cachePaths.thumbRootDir;
    log.info(`[scan-directory] Migrating ${oldVideoIds.length} thumb dirs from ${oldThumbBase} â†’ ${newThumbRoot}`);
    const BATCH = 10;
    for (let i = 0; i < oldVideoIds.length; i += BATCH) {
      await Promise.all(oldVideoIds.slice(i, i + BATCH).map(async (videoId) => {
        const oldDir = path.join(oldThumbBase, videoId);
        const newDir = path.join(newThumbRoot, videoId);
        try {
          await fs.rename(oldDir, newDir);
        } catch (err) {
          if (err.code === 'EXDEV') {
            // Cross-device move: copy then delete
            try {
              await fs.cp(oldDir, newDir, { recursive: true, force: true });
              await fs.rm(oldDir, { recursive: true, force: true });
            } catch { /* leave in place if copy fails */ }
          }
          // ENOENT = already gone, ignore
        }
      }));
    }
    // Remove old base dir if now empty
    const remaining = await fs.readdir(oldThumbBase).catch(() => ['x']);
    if (remaining.length === 0) await fs.rmdir(oldThumbBase).catch(() => {});
    log.info('[scan-directory] Thumbnail migration complete');
  }

  const videos = await scanDirectory(dirPath, includeSubfolders, (progress) => {
    sendToRenderer('scan-progress', progress);
  });
  await loadOwnerFolderCachesIntoMap(videos, dirPath, cacheOptions, cachedMap);

  // Merge with cache: preserve status, thumbnails, bookmarks from SQLite.
  // Thumbnail paths are resolved to absolute here so the renderer can use them directly.
  const merged = videos.map((v) => {
    const cached = cachedMap.get(v.id);
    if (cached) {
      return {
        ...v,
        status: cached.status,
        durationSecs: cached.durationSecs ?? v.durationSecs,
        thumbnails: cached.thumbnails,
        duplicateHash: cached.duplicateHash || v.duplicateHash,
        metadataDate: cached.metadataDate ?? null,
        bookmarks: cached.bookmarks,
        rating: cached.rating ?? 0,
        favorite: Boolean(cached.favorite),
        compatible: cached.compatible !== false,
        videoCodec: cached.videoCodec ?? null,
        audioCodec: cached.audioCodec ?? null,
        width: cached.width ?? null,
        height: cached.height ?? null,
        fps: cached.fps ?? null,
      };
    }
    return {
      ...v,
      status: 'pending',
      thumbnails: [],
      metadataDate: null,
      bookmarks: [],
      rating: 0,
      favorite: false,
      compatible: true,
      videoCodec: null,
      audioCodec: null,
      width: null,
      height: null,
      fps: null,
    };
  });

  // Persist each video to the cache owned by its immediate parent folder.
  await saveVideosByParentFolder(merged, cacheOptions);

  // Populate the known-paths whitelist for this loaded session
  merged.forEach((v) => knownVideoPaths.add(v.path));

  return merged;
});

// Valid video ID format: 16 hex characters (MD5-derived from path+size in scanner.js)
const VALID_VIDEO_ID = /^[0-9a-f]{16}$/;

// 3. Generate thumbnails for videos that don't have them
ipcMain.handle('generate-thumbnails', async (_event, videos, dirPath, options = {}) => {
  // Cancel any in-progress generation before starting a new one
  cancelProcessing();

  // Security: validate that dirPath is one of the loaded scan directories
  if (!currentScanDirs.has(dirPath)) {
    log.warn('[generate-thumbnails] dirPath is not loaded, rejecting');
    return false;
  }

  // Security: filter out any video with an invalid id or a path not in the known set
  const safeVideos = videos.filter((v) => {
    if (!VALID_VIDEO_ID.test(v.id)) {
      log.warn(`[generate-thumbnails] Rejected video with invalid id: ${v.id}`);
      return false;
    }
    if (!knownVideoPaths.has(v.path)) {
      log.warn(`[generate-thumbnails] Rejected unknown path: ${v.path}`);
      return false;
    }
    return true;
  });

  // Thumbnails are written to each video's owning cache directory, not the scan root.
  const cacheOptions = await getCacheOptions();
  const thumbRootByFolder = new Map();
  for (const video of safeVideos) {
    const videoFolder = getVideoFolderPath(video);
    if (thumbRootByFolder.has(videoFolder)) continue;
    const videoCachePaths = await prepareCacheFolder(videoFolder, cacheOptions);
    thumbRootByFolder.set(videoFolder, videoCachePaths.thumbRootDir);
  }

  let config = {};
  try {
    const data = await fs.readFile(path.join(app.getPath('userData'), CONFIG_FILE), 'utf8');
    config = JSON.parse(data);
  } catch (e) {
    // Defaults are fine
  }
  const targetThumbCount = Math.max(1, Number(config.thumbsPerVideo) || 6);
  const skipIntroDelaySecs = config.skipIntroDelaySecs !== undefined ? Number(config.skipIntroDelaySecs) : 3;
  const expectedThumbCount = (video) => {
    if (video.durationSecs != null && video.durationSecs > 0) {
      const end = video.durationSecs * 0.97;
      if (video.durationSecs < skipIntroDelaySecs || end <= skipIntroDelaySecs) return 1;
    }
    return targetThumbCount;
  };

  const forceRegenerate = Boolean(options?.force);
  const needThumbs = forceRegenerate
    ? safeVideos
    : safeVideos.filter((v) => (
      !v.thumbnails ||
      v.thumbnails.length < expectedThumbCount(v) ||
      !v.videoCodec ||
      !v.width ||
      !v.height ||
      v.fps === null ||
      v.fps === undefined
    ));

  let readyBatch = [];
  let lastProgress = null;
  
  const flushBatch = () => {
    if (readyBatch.length > 0) {
      const batch = readyBatch;
      readyBatch = [];
      sendToRenderer('thumb-ready-batch', batch);
    }
    if (lastProgress) {
      const progress = lastProgress;
      lastProgress = null;
      sendToRenderer('thumb-progress', progress);
    }
  };

  const batchInterval = setInterval(flushBatch, 1000);
  activeBatchIntervals.add(batchInterval);

  try {
    await processVideos(needThumbs, (video) => thumbRootByFolder.get(getVideoFolderPath(video)), config, (progress) => {
      lastProgress = progress;
    }, (videoId, thumbnails, durationSecs, creationTime, videoCodec, audioCodec, width, height, fps) => {
      readyBatch.push({
        videoId,
        thumbnails,
        durationSecs,
        metadataDate: creationTime,
        videoCodec,
        audioCodec,
        width,
        height,
        fps,
      });
    }, { forceRegenerate });
  } finally {
    clearInterval(batchInterval);
    activeBatchIntervals.delete(batchInterval);
    if (!isQuitting) flushBatch();
  }

  return true;
});

// 4. Cancel running thumbnail generation
ipcMain.handle('cancel-generation', async () => {
  cancelProcessing();
  return true;
});

// 5. Save cache
ipcMain.handle('save-cache', async (event, dirPath, videos) => {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    const cacheOptions = await getCacheOptions();
    await saveVideosByParentFolder(videos, cacheOptions);
    return true;
  } catch (err) {
    log.error('[save-cache] Error saving cache:', err);
    return false;
  }
});

ipcMain.handle('save-cache-atomic', async (_event, dirPath, videos) => {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    const cacheOptions = await getCacheOptions();
    if (videos.length > ATOMIC_SAVE_SYNC_LIMIT) {
      log.warn(`[save-cache-atomic] ${videos.length} videos exceeds sync transaction limit; using chunked save to keep UI responsive.`);
    }
    await saveVideosByParentFolder(videos, cacheOptions, { atomic: true });
    return true;
  } catch (err) {
    log.error('[save-cache-atomic] Error saving cache:', err);
    return false;
  }
});

ipcMain.handle('clear-cache', async (event, dirPath) => {
  log.warn(`[clear-cache] called for: ${dirPath}`);
  log.warn(`[clear-cache] stack:\n${new Error().stack}`);
  if (!dirPath || typeof dirPath !== 'string') return false;

  // Security: only allow clearing the cache of the currently scanned directory
  if (!currentScanDirs.has(dirPath)) {
    log.warn('[clear-cache] dirPath is not loaded, rejecting');
    return false;
  }

  cancelProcessing();

  const cacheOptions = await getCacheOptions();
  const knownCacheFolders = await getKnownCacheFolders();
  const cacheFoldersToClear = Array.from(new Set([
    dirPath,
    ...knownCacheFolders.filter((folderPath) => isFolderInsideSync(folderPath, dirPath)),
  ]));
  try {
    for (const folderPath of cacheFoldersToClear) {
      const cachePaths = getCachePaths(folderPath, cacheOptions);
      cache.deleteDb(folderPath, cacheOptions);
      await fs.rm(cachePaths.thumbRootDir, { recursive: true, force: true }).catch(() => {});
    }

    // Also clean up any legacy .video-cull-thumbs in the video folder
    const legacyThumbDir = path.join(dirPath, THUMB_DIR);
    fs.rm(legacyThumbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});

    return true;
  } catch (err) {
    log.error('[clear-cache] Error clearing thumbs:', err);
    return false;
  }
});

// 6. Batch delete â†’ OS Trash first, then explicit permanent-delete fallback for failures
ipcMain.handle('batch-delete', async (_event, filePaths) => {
  const results = [];

  const validPaths = [];
  for (const filePath of filePaths) {
    if (await isValidLoadedPath(filePath)) {
      validPaths.push(filePath);
    } else {
      log.warn(`[batch-delete] Rejected path outside loaded directory: ${filePath}`);
      results.push({ path: filePath, success: false, error: 'Path is outside the loaded directory scope.' });
    }
  }

  if (validPaths.length === 0) return results;

  const trashResults = await mapWithConcurrency(validPaths, 5, async (filePath) => {
    try {
      await shell.trashItem(filePath);
      return { path: filePath, success: true, method: 'trash' };
    } catch (err) {
      return { path: filePath, success: false, error: err.message };
    }
  });
  results.push(...trashResults);

  const failedTrash = trashResults.filter((result) => !result.success).map((result) => result.path);
  if (failedTrash.length === 0) return results;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Recycle Bin not available',
    message: `Recycle Bin failed for ${failedTrash.length} file(s). Do you want to permanently delete them instead?`,
    detail: 'This action cannot be undone.',
    buttons: ['Cancel', 'Delete Permanently'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (response === 0) return results;

  const permanentResults = await mapWithConcurrency(failedTrash, 5, async (filePath) => {
    try {
      await fs.unlink(filePath);
      return { path: filePath, success: true, method: 'permanent' };
    } catch (err) {
      return { path: filePath, success: false, error: err.message, method: 'permanent' };
    }
  });

  const merged = new Map(results.map((result) => [result.path, result]));
  for (const result of permanentResults) {
    merged.set(result.path, result);
  }
  return Array.from(merged.values());
});

ipcMain.handle('export-report', async (_event, videos, dirPath) => {
  if (!dirPath || !Array.isArray(videos) || videos.length === 0) return 'error';

  const defaultFileName = `videocull-report-${new Date().toISOString().slice(0, 10)}.html`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Video Cull Report',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'HTML', extensions: ['html'] }],
    properties: ['createDirectory'],
  });

  if (result.canceled || !result.filePath) return 'cancelled';

  try {
    const html = buildReportHtml(videos, dirPath);
    await fs.writeFile(result.filePath, html, 'utf8');
    return 'saved';
  } catch (err) {
    log.error('[export-report] Error writing report:', err);
    return 'error';
  }
});

ipcMain.handle('choose-report-scope', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Export Report',
    message: 'What do you want to export?',
    detail: 'Choose whether to export all loaded videos or only the current filtered selection.',
    buttons: ['All videos', 'Filtered selection', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (result.response === 0) return 'all';
  if (result.response === 1) return 'filtered';
  return null;
});

ipcMain.handle('validate-cache-location', async (_event, dirPath, expectedDriveKey = null) => {
  if (!dirPath || typeof dirPath !== 'string') {
    return { ok: false, error: 'No folder selected.' };
  }
  if (expectedDriveKey && getDriveKeyForPath(dirPath) !== String(expectedDriveKey).toUpperCase()) {
    return { ok: false, error: `Pick a folder on ${expectedDriveKey}.` };
  }
  return testWritableDirectory(dirPath);
});

ipcMain.handle('get-auto-concurrency', async (_event, settingsOverride) => {
  const config = settingsOverride && typeof settingsOverride === 'object'
    ? settingsOverride
    : await readJsonFile(CONFIG_FILE, {});
  return getConcurrentLimit({ ...config, maxConcurrent: 'auto' });
});


ipcMain.handle('confirm-distributed-mode', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Distributed mode is not recommended',
    message: 'Are you sure you want to use Distributed cache mode?',
    detail: 'Cache is stored in a hidden .videocull folder inside each video folder. Switching back to Centralised or Per-drive later may be impossible without losing cache data if the tracking index is missing or a drive is disconnected.',
    buttons: ['I understand, use Distributed', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
});
ipcMain.handle('migrate-cache-settings', async (_event, oldSettings, newSettings, loadedDirs = []) => {
  if (!cacheRelevantSettingsChanged(oldSettings, newSettings)) {
    return { status: 'unchanged', migrated: 0, errors: [] };
  }

  const knownFolders = await getKnownCacheFolders(Array.isArray(loadedDirs) ? loadedDirs : []);
  if (knownFolders.length === 0) {
    return { status: 'no-cache', migrated: 0, errors: [] };
  }

  const fromOptions = normalizeCacheSettings(oldSettings);
  const toOptions = normalizeCacheSettings(newSettings);
  const targetRoots = new Set(knownFolders.map((folderPath) => cache.resolveCachePaths(folderPath, toOptions).cacheRootDir));
  for (const targetRoot of targetRoots) {
    const writable = await testWritableDirectory(targetRoot);
    if (!writable.ok) {
      return { status: 'error', migrated: 0, errors: [`Cannot write to ${targetRoot}: ${writable.error}`] };
    }
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Cache storage changed',
    message: 'How should Video Cull handle existing cache data?',
    detail: `${knownFolders.length} known folder cache${knownFolders.length === 1 ? '' : 's'} can be moved to the new location. Choose Start fresh to discard cache and regenerate thumbnails/metadata next scan.`,
    buttons: ['Migrate existing cache', 'Start fresh', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (response === 2) {
    return { status: 'cancelled', migrated: 0, errors: [] };
  }

  cache.closeDb();

  if (response === 1) {
    for (const folderPath of knownFolders) {
      const fromPaths = cache.resolveCachePaths(folderPath, fromOptions);
      cache.deleteDb(folderPath, fromOptions);
      await fs.rm(fromPaths.thumbRootDir, { recursive: true, force: true }).catch(() => {});
    }
    if (toOptions.mode === 'distributed') {
      await writeJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: knownFolders });
    } else {
      await writeJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: [] });
    }
    await writeJsonFile(CACHE_INDEX_FILE, { knownFolders });
    return { status: 'fresh', migrated: 0, errors: [] };
  }

  const results = [];
  for (const folderPath of knownFolders) {
    results.push(await migrateOneCache(folderPath, fromOptions, toOptions));
  }
  const errors = results.filter((result) => result.error).map((result) => `${result.folderPath}: ${result.error}`);

  if (toOptions.mode === 'distributed') {
    await writeJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: knownFolders });
  } else {
    await writeJsonFile(DISTRIBUTED_INDEX_FILE, { knownDistributedPaths: [] });
  }
  await writeJsonFile(CACHE_INDEX_FILE, { knownFolders });

  return {
    status: errors.length > 0 ? 'partial' : 'migrated',
    migrated: results.filter((result) => result.movedDb || result.movedThumbs).length,
    errors,
  };
});


// 7. Get OS native thumbnail
ipcMain.handle('get-os-thumbnail', async (_event, filePath) => {
  if (!knownVideoPaths.has(filePath)) return null;
  try {
    const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: 300, height: 200 });
    return thumb.toDataURL();
  } catch (err) {
    return null;
  }
});

// 8. Open video in default system player
ipcMain.handle('open-video', async (_event, filePath) => {
  if (!knownVideoPaths.has(filePath)) return;
  await shell.openPath(filePath);
});

// 9. Config management
ipcMain.handle('get-config', async () => {
  try {
    const configPath = path.join(app.getPath('userData'), CONFIG_FILE);
    const data = await fs.readFile(configPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

ipcMain.handle('save-config', async (_event, config) => {
  try {
    const configPath = path.join(app.getPath('userData'), CONFIG_FILE);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    log.error('[save-config] Error saving config:', e);
    return false;
  }
});

// 10. Open a directory in explorer
ipcMain.handle('open-in-explorer', async (_event, filePath) => {
  if (!knownVideoPaths.has(filePath) && !await isPathWithinAnyDir(filePath, currentScanDirs)) return;
  shell.showItemInFolder(filePath);
});

// 11. App version
ipcMain.handle('get-app-version', () => app.getVersion());

// 12. Auto-updater IPC
ipcMain.handle('check-for-updates', () => {
  if (!isDev) autoUpdater.checkForUpdates();
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// â”€â”€ Auto-updater setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupAutoUpdater() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update-status', { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('update-status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update-status', { status: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log.error('[auto-updater] error:', err);
    sendToRenderer('update-status', { status: 'error', message: err.message });
  });

  // Check shortly after launch (if auto-updates are enabled in settings)
  setTimeout(async () => {
    try {
      const configPath = path.join(app.getPath('userData'), CONFIG_FILE);
      const data = await require('fs').promises.readFile(configPath, 'utf8');
      const config = JSON.parse(data);
      if (config.autoUpdates === false) return;
    } catch {
      // No config yet â€” default is enabled
    }
    autoUpdater.checkForUpdates();
  }, 5000);
}
