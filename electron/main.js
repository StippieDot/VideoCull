const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { performance: nodePerformance } = require('perf_hooks');
const { scanDirectory } = require('./scanner');
const { processVideos, processMetadata, cancelProcessing, cancelThumbnails, cancelMetadata, getConcurrentLimit } = require('./processor');
const cache = require('./cache');
const { collectUnloadedOwnerFolders, createFolderKey, rememberFolder } = require('./cache-folder-tracker');
const { createDuplicateRun, findDuplicates, DuplicateCancelledError } = require('./duplicates');
const perfMetrics = require('./perf-metrics');
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
let scanGeneration = 0;
let updateReadyToInstall = false;
let activeDuplicateRun = null;
let lastEventLoopUtilization = typeof nodePerformance.eventLoopUtilization === 'function'
  ? nodePerformance.eventLoopUtilization()
  : null;
const RESPONSIVE_SCAN_YIELD_MS = 16;
const ALLOWED_EXTERNAL_URLS = new Set([
  'https://github.com/stippie-dot/VideoCull',
  'https://github.com/stippie-dot/VideoCull/releases',
  'https://github.com/sponsors/stippie-dot',
  'https://paypal.me/stippiedot',
]);

// Set of known valid video paths, populated on every scan-directory call.
// All IPC handlers that accept file paths validate against this set.
const knownVideoPaths = new Set();
const knownVideoIdsByPath = new Map();
const SERVABLE_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.m4v', '.ts', '.mts',
]);
// Valid video ID format: 16 hex characters (MD5-derived from path+size in scanner.js)
const VALID_VIDEO_ID = /^[0-9a-f]{16}$/;

// Mirrors detectVideoCompatibility in src/utils.ts — kept in sync manually.
// Used in scan-directory to re-evaluate compatibility from cached codec/format data,
// so that stale `compatible = false` values from old buggy logic are fixed on rescan.
const COMPAT_UNSUPPORTED_EXTS = new Set([
  '.wmv', '.asf', '.avi', '.flv', '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.vob', '.divx',
]);
const COMPAT_UNSUPPORTED_CODECS = new Set([
  'wmv1', 'wmv2', 'wmv3', 'vc1', 'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'mpeg2video',
  'prores', 'h263', 'dvvideo', 'theora',
]);
const COMPAT_SUPPORTED_CODECS = new Set([
  'h264', 'avc', 'avc1', 'hevc', 'h265', 'hvc1', 'av1', 'av01', 'vp8', 'vp9', 'mpeg4', 'mp4v',
]);
const COMPAT_SUPPORTED_FORMATS = ['mp4', 'mov', 'matroska', 'webm', 'ogg', '3gp', '3g2', 'm4a', 'mj2'];
const COMPAT_WEB_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.mkv', '.m4v'];

function hasAnyCompatFormat(containerFormat, tokens) {
  const parts = (containerFormat || '').toLowerCase().split(',').map((p) => p.trim());
  return tokens.some((t) => parts.includes(t));
}

function detectCompatibility(containerFormat, videoCodec, filePath) {
  const extMatch = (filePath || '').match(/\.[^.\\/]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const codec = (videoCodec || '').toLowerCase();

  if (COMPAT_UNSUPPORTED_EXTS.has(ext) || COMPAT_UNSUPPORTED_CODECS.has(codec)) return false;
  if (codec) {
    if (!COMPAT_SUPPORTED_CODECS.has(codec)) return false;
    if (hasAnyCompatFormat(containerFormat, COMPAT_SUPPORTED_FORMATS)) return true;
    if (hasAnyCompatFormat(containerFormat, ['asf', 'avi', 'flv', 'mpegts', 'mpeg', 'vob'])) return false;
    return COMPAT_WEB_EXTS.includes(ext);
  }
  if (hasAnyCompatFormat(containerFormat, COMPAT_SUPPORTED_FORMATS)) return true;
  if (COMPAT_WEB_EXTS.includes(ext) && !containerFormat) return true;
  if (hasAnyCompatFormat(containerFormat, ['asf', 'avi', 'flv', 'mpegts', 'mpeg', 'vob'])) return false;
  return false;
}

class ScanSupersededError extends Error {
  constructor() {
    super('Scan superseded');
    this.name = 'ScanSupersededError';
  }
}

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
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const webContents = mainWindow.webContents;
    if (!webContents || webContents.isDestroyed() || webContents.isCrashed?.()) return false;
    if (webContents.isLoadingMainFrame?.()) return false;
    const mainFrame = webContents.mainFrame;
    if (!mainFrame || mainFrame.isDestroyed?.()) return false;
    return true;
  } catch {
    return false;
  }
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

async function collectIdleDiagnostics() {
  const memory = process.memoryUsage();
  let rendererMemory = null;
  let rendererProcessId = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      rendererProcessId = mainWindow.webContents.getOSProcessId?.() ?? null;
    } catch {
      rendererProcessId = null;
    }
    try {
      rendererMemory = await mainWindow.webContents.getProcessMemoryInfo();
    } catch {
      rendererMemory = null;
    }
  }

  let eventLoopUtilization = null;
  if (typeof nodePerformance.eventLoopUtilization === 'function') {
    const currentEventLoopUtilization = nodePerformance.eventLoopUtilization();
    const delta = lastEventLoopUtilization
      ? nodePerformance.eventLoopUtilization(lastEventLoopUtilization, currentEventLoopUtilization)
      : currentEventLoopUtilization;
    lastEventLoopUtilization = currentEventLoopUtilization;
    eventLoopUtilization = Number(delta.utilization ?? 0);
  }

  const appMetrics = app.getAppMetrics().map((metric) => ({
    cpuPercent: metric.cpu.percentCPUUsage,
    creationTime: metric.creationTime,
    memory: {
      privateKb: metric.memory.private,
      residentSetKb: metric.memory.residentSet,
      sharedKb: metric.memory.shared,
    },
    pid: metric.pid,
    serviceName: metric.serviceName,
    type: metric.type,
  }));

  return {
    timestamp: Date.now(),
    pid: process.pid,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    eventLoopUtilization,
    loadedRootCount: currentScanDirs.size,
    knownVideoCount: knownVideoPaths.size,
    activeCacheRootCount: activeCacheRoots.size,
    activeBatchIntervalCount: activeBatchIntervals.size,
    activeDuplicateRun: Boolean(activeDuplicateRun),
    windowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    windowMinimized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()),
    rendererProcessId,
    rendererMemory: rendererMemory
      ? {
        privateKb: rendererMemory.private,
        residentSetKb: rendererMemory.residentSet,
        sharedKb: rendererMemory.shared,
      }
      : null,
    appMetrics,
  };
}

function measurePayloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch {
    return 0;
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
  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    log.error('[renderer-crash] Render process gone', details);
    try {
      log.error('[renderer-crash] idle diagnostics', await collectIdleDiagnostics());
    } catch (err) {
      log.error('[renderer-crash] failed to collect idle diagnostics', err);
    }
  });
  mainWindow.webContents.on('unresponsive', async () => {
    log.warn('[renderer-crash] Renderer became unresponsive');
    try {
      log.warn('[renderer-crash] idle diagnostics', await collectIdleDiagnostics());
    } catch (err) {
      log.error('[renderer-crash] failed to collect idle diagnostics', err);
    }
  });
  mainWindow.on('closed', () => {
    menuBarHiddenForVideoFullscreen = false;
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${process.env.VITE_DEV_SERVER_PORT || 5173}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// â”€â”€ Custom Protocol for serving thumbnail images and videos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const customProtocolSchemes = [
  { scheme: 'thumb', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'video', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
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

    // Security: only stream videos discovered by the scanner for this session.
    if (!knownVideoPaths.has(filePath) || !isServableVideoPath(filePath)) {
      return new Response('Access Denied', { status: 403 });
    }

    try {
      const { createReadStream, statSync } = require('fs');
      // For video streaming we need to manually handle range requests to support seeking.
      // We use a large highWaterMark (5MB) to drastically reduce IPC overhead and prevent buffering.
      const { Readable } = require('stream');
      const stats = statSync(filePath);
      if (!stats.isFile()) {
        return new Response('Access Denied', { status: 403 });
      }
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
  if (activeDuplicateRun) {
    activeDuplicateRun.cancel();
    activeDuplicateRun = null;
  }
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

function createEventLoopYieldController(maxBlockMs = RESPONSIVE_SCAN_YIELD_MS) {
  let lastYieldAt = Date.now();
  return async () => {
    if (Date.now() - lastYieldAt < maxBlockMs) return;
    lastYieldAt = Date.now();
    await new Promise((resolve) => setImmediate(resolve));
  };
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

function publishScanCacheRoots(cacheRoots) {
  for (const cacheRoot of cacheRoots) activeCacheRoots.add(cacheRoot);
}

async function prepareCacheFolder(folderPath, cacheOptions, { publish = true, cacheRoots = null } = {}) {
  const cachePaths = getCachePaths(folderPath, cacheOptions);
  if (publish) activeCacheRoots.add(cachePaths.cacheRootDir);
  else cacheRoots?.add(cachePaths.cacheRootDir);
  await registerCacheFolder(folderPath, cachePaths);
  await fs.mkdir(cachePaths.thumbRootDir, { recursive: true });
  return cachePaths;
}

async function saveVideosByParentFolder(videos, cacheOptions, { atomic = false, publish = true, cacheRoots = null } = {}) {
  const groups = groupVideosByFolder(videos);
  for (const [folderPath, folderVideos] of groups) {
    const cachePaths = await prepareCacheFolder(folderPath, cacheOptions, { publish, cacheRoots });
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

async function loadOwnerFolderCachesIntoMap(videos, rootDirPath, cacheOptions, cachedMap, scanToken, scanCacheRoots, loadedCacheFolderKeys = new Set()) {
  const scannedIds = new Set(videos.map((video) => video.id));
  const ownerFolders = collectUnloadedOwnerFolders(videos, rootDirPath, loadedCacheFolderKeys);
  const yieldToEventLoop = createEventLoopYieldController();

  for (const ownerFolder of ownerFolders) {
    try {
      assertScanCurrent(scanToken);
      const ownerPaths = await prepareCacheFolder(ownerFolder, cacheOptions, { publish: false, cacheRoots: scanCacheRoots });
      assertScanCurrent(scanToken);
      const ownerMap = await loadCacheMapWithRecovery(ownerFolder, cacheOptions, ownerPaths.cacheRootDir);
      assertScanCurrent(scanToken);
      // Owner-folder caches are the canonical location after P3. Let them win
      // over stale parent rows if both exist.
      mergeCacheMap(cachedMap, ownerMap, scannedIds, { overwrite: true });
      await yieldToEventLoop();
    } catch (err) {
      if (err instanceof ScanSupersededError) throw err;
      log.warn(`[scan-directory] Failed to load owner cache for ${ownerFolder}:`, err);
    }
  }
}

async function splitDescendantRowsFromParentDb(parentFolder, parentDb, cacheOptions, parentCacheRootDir, scanToken = null, scanCacheRoots = null) {
  const cachedVideos = cache.loadCacheVideos(parentDb);
  const byTargetFolder = new Map();
  const yieldToEventLoop = createEventLoopYieldController();

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
    await yieldToEventLoop();
  }

  if (byTargetFolder.size === 0) return;

  let movedCount = 0;
  for (const [targetFolder, videos] of byTargetFolder) {
    if (scanToken !== null) assertScanCurrent(scanToken);
    const targetPaths = await prepareCacheFolder(
      targetFolder,
      cacheOptions,
      scanToken !== null ? { publish: false, cacheRoots: scanCacheRoots } : {}
    );
    if (scanToken !== null) assertScanCurrent(scanToken);
    const targetDb = await openCacheDbWithRecovery(targetFolder, cacheOptions);
    if (scanToken !== null) assertScanCurrent(scanToken);
    cache.saveCache(targetDb, videos.map((video) => videoForDb(video, targetPaths.cacheRootDir)));
    cache.deleteVideosByIds(parentDb, videos.map((video) => video.id));
    movedCount += videos.length;
    await yieldToEventLoop();
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

function assertScanCurrent(token) {
  if (token !== scanGeneration) {
    throw new ScanSupersededError();
  }
}

function isServableVideoPath(filePath) {
  return SERVABLE_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isKnownVideoRecord(video) {
  return Boolean(video?.path && knownVideoIdsByPath.get(video.path) === video.id);
}

async function validateCacheSavePayload(dirPath, videos) {
  if (!dirPath || typeof dirPath !== 'string' || !currentScanDirs.has(dirPath)) {
    log.warn('[save-cache] Rejected save for unloaded directory:', dirPath);
    return [];
  }
  if (!Array.isArray(videos)) return [];

  const safeVideos = [];
  for (const video of videos) {
    if (!video || !VALID_VIDEO_ID.test(String(video.id || ''))) {
      log.warn(`[save-cache] Rejected video with invalid id: ${video?.id}`);
      continue;
    }
    if (!isKnownVideoRecord(video)) {
      log.warn(`[save-cache] Rejected mismatched or unknown video record: ${video.path}`);
      continue;
    }
    if (!await isPathWithinDir(video.path, dirPath)) {
      log.warn(`[save-cache] Rejected path outside save root: ${video.path}`);
      continue;
    }
    safeVideos.push(video);
  }

  return safeVideos;
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

async function collectDeletionCacheTargets(filePaths) {
  const targets = [];
  for (const filePath of filePaths) {
    const knownId = knownVideoIdsByPath.get(filePath);
    if (!knownId) continue;
    targets.push({
      id: knownId,
      filePath,
      folderPath: path.dirname(filePath),
    });
  }
  return targets;
}

async function removeDeletedVideoCacheArtifacts(targets) {
  if (targets.length === 0) return;
  const cacheOptions = await getCacheOptions();
  const byFolder = new Map();
  for (const target of targets) {
    const group = byFolder.get(target.folderPath) ?? [];
    group.push(target.id);
    byFolder.set(target.folderPath, group);
  }

  for (const [folderPath, ids] of byFolder) {
    try {
      const uniqueIds = Array.from(new Set(ids));
      const cachePaths = getCachePaths(folderPath, cacheOptions);
      const dbExists = await fs.access(cachePaths.dbPath).then(() => true).catch(() => false);
      if (dbExists) {
        const db = await openCacheDbWithRecovery(folderPath, cacheOptions);
        cache.deleteVideosByIds(db, uniqueIds);
      }
      for (const id of uniqueIds) {
        const thumbDir = path.join(cachePaths.thumbRootDir, id);
        try {
          await fs.access(thumbDir);
          await shell.trashItem(thumbDir);
        } catch (err) {
          if (err?.code !== 'ENOENT') {
            try {
              const quarantinedPath = await quarantineCacheDirectory(cachePaths.cacheRootDir, thumbDir, id);
              log.warn(`[batch-delete] Recycle Bin unavailable for thumbnail cache; moved to ${quarantinedPath}`);
            } catch (quarantineErr) {
              log.warn(`[batch-delete] Failed to move thumbnail cache to Recycle Bin or quarantine: ${thumbDir}`, quarantineErr);
            }
          }
        }
      }
    } catch (err) {
      log.warn(`[batch-delete] Failed to remove deleted-video cache for ${folderPath}:`, err);
    }
  }
}

async function quarantineCacheDirectory(cacheRootDir, sourcePath, label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantineRoot = path.join(cacheRootDir, '.deleted-thumbs');
  const targetPath = path.join(quarantineRoot, `${label}-${stamp}`);
  await fs.mkdir(quarantineRoot, { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
    await fs.rm(sourcePath, { recursive: true, force: true });
  }
  return targetPath;
}

async function trashEmptyDeletedVideoFolders(deletedFilePaths) {
  const folders = Array.from(new Set(deletedFilePaths.map((filePath) => path.dirname(filePath))))
    .sort((a, b) => b.length - a.length);
  const trashed = new Set();
  for (const folderPath of folders) {
    const resolved = path.resolve(folderPath);
    if (resolved === path.parse(resolved).root) continue;
    if (!await isPathWithinAnyDir(resolved, currentScanDirs)) continue;
    try {
      const entries = await fs.readdir(resolved);
      if (entries.length > 0) continue;
      await shell.trashItem(resolved);
      trashed.add(resolved);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTEMPTY') continue;
      try {
        const entries = await fs.readdir(resolved);
        if (entries.length > 0) continue;
        await fs.rmdir(resolved);
        trashed.add(resolved);
        log.warn(`[batch-delete] Recycle Bin unavailable for empty folder; permanently removed ${resolved}`);
      } catch (fallbackErr) {
        if (fallbackErr.code !== 'ENOENT' && fallbackErr.code !== 'ENOTEMPTY') {
          log.warn(`[batch-delete] Failed to trash or remove empty folder ${resolved}: ${fallbackErr.message}`);
        }
      }
    }
  }
  return trashed;
}

function summarizeMediaProbeError(err) {
  const raw = err?.message || String(err);
  const stripExtendedWindowsPrefix = (value) => String(value)
    .replace(/\\\\\?\\UNC\\/g, '\\\\')
    .replace(/\\\\\?\\/g, '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const finalLine = stripExtendedWindowsPrefix(lines[lines.length - 1] || raw);
  if (/no such file or directory/i.test(finalLine)) return `File not available to ffprobe: ${finalLine}`;
  if (/permission denied/i.test(finalLine)) return `Permission denied: ${finalLine}`;
  if (/invalid data found/i.test(finalLine)) return `Invalid media data: ${finalLine}`;
  return finalLine.slice(0, 500);
}

function normalizeReportRoots(dirPaths) {
  return (Array.isArray(dirPaths) ? dirPaths : [dirPaths])
    .filter((dirPath) => typeof dirPath === 'string' && dirPath.length > 0)
    .map((dirPath) => path.resolve(dirPath));
}

function buildReportHtml(videos, dirPaths) {
  const roots = normalizeReportRoots(dirPaths);
  const sortedVideos = [...videos].sort((a, b) => a.filename.localeCompare(b.filename));

  const getRelativeFolder = (videoPath) => {
    const folder = path.dirname(videoPath);
    const root = roots.find((candidate) => {
      const relative = path.relative(candidate, folder);
      return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    });
    if (!root) return folder;
    const rel = path.relative(root, folder).replace(/\\/g, '/');
    const rootName = roots.length > 1 ? (path.basename(root) || root) : '';
    if (!rel || rel === '.') return rootName ? `${rootName} / Root` : 'Root';
    return rootName ? `${rootName} / ${rel}` : rel;
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
        <p>${escapeHtml(roots.length === 1 ? roots[0] : `${roots.length} folders`)}</p>
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
  scanGeneration += 1;
  cancelProcessing();
  currentScanDir = null;
  currentScanDirs = new Set();
  activeCacheRoots = new Set();
  knownVideoPaths.clear();
  knownVideoIdsByPath.clear();
  cache.closeDb();
  return true;
});

// 2. Scan directory for video files
ipcMain.handle('scan-directory', async (_event, dirPath, includeSubfolders) => {
  const scanToken = ++scanGeneration;
  const scanCacheRoots = new Set();
  log.info(`[scan-directory] called for: ${dirPath}`);
  // Security: Validate dirPath
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) throw new Error('Not a directory');
  } catch (err) {
    throw new Error('Invalid directory path');
  }

  const perfRun = perfMetrics.beginRun('scan', {
    dirPath,
    includeSubfolders: Boolean(includeSubfolders),
  });

  try {
  const cacheOptions = await getCacheOptions();
  assertScanCurrent(scanToken);
  const cachePaths = await prepareCacheFolder(dirPath, cacheOptions, { publish: false, cacheRoots: scanCacheRoots });
  assertScanCurrent(scanToken);
  const loadedCacheFolderKeys = new Set([createFolderKey(dirPath)]);

  // Open SQLite DB for this directory (creates schema if first time)
  let db = await openCacheDbWithRecovery(dirPath, cacheOptions);
  assertScanCurrent(scanToken);

  // Import old JSON cache if present (first launch after update)
  await cache.migrateJsonIfNeeded(dirPath, db);
  assertScanCurrent(scanToken);
  try {
    await splitDescendantRowsFromParentDb(dirPath, db, cacheOptions, cachePaths.cacheRootDir, scanToken, scanCacheRoots);
    assertScanCurrent(scanToken);
  } catch (err) {
    if (!isSqliteCorruptionError(err)) throw err;
    await quarantineCorruptCacheDb(dirPath, cacheOptions, err.code || err.message);
    db = await openCacheDbWithRecovery(dirPath, cacheOptions);
    assertScanCurrent(scanToken);
  }

  let knownCacheFolders = await getKnownCacheFolders();
  assertScanCurrent(scanToken);
  const parentCacheFolders = knownCacheFolders.filter((folderPath) => isFolderInsideSync(dirPath, folderPath));
  const yieldToEventLoop = createEventLoopYieldController();
  for (const parentFolder of parentCacheFolders) {
    try {
      assertScanCurrent(scanToken);
      const parentPaths = getCachePaths(parentFolder, cacheOptions);
      scanCacheRoots.add(parentPaths.cacheRootDir);
      const parentDb = await openCacheDbWithRecovery(parentFolder, cacheOptions);
      await splitDescendantRowsFromParentDb(parentFolder, parentDb, cacheOptions, parentPaths.cacheRootDir, scanToken, scanCacheRoots);
      assertScanCurrent(scanToken);
      await yieldToEventLoop();
    } catch (err) {
      if (err instanceof ScanSupersededError) throw err;
      log.warn(`[scan-directory] Failed to split parent cache for ${parentFolder}:`, err);
    }
  }

  // Load existing cache entries for merging. Known subfolder caches are folded in
  // so opening a parent preserves decisions made when a child folder was opened alone.
  const cachedMap = await loadCacheMapWithRecovery(dirPath, cacheOptions, cachePaths.cacheRootDir);
  assertScanCurrent(scanToken);
  knownCacheFolders = await getKnownCacheFolders();
  assertScanCurrent(scanToken);
  const childCacheFolders = knownCacheFolders.filter((folderPath) => isFolderInsideSync(folderPath, dirPath));
  for (const childFolder of childCacheFolders) {
    try {
      assertScanCurrent(scanToken);
      const childPaths = getCachePaths(childFolder, cacheOptions);
      scanCacheRoots.add(childPaths.cacheRootDir);
      const childMap = await loadCacheMapWithRecovery(childFolder, cacheOptions, childPaths.cacheRootDir);
      mergeCacheMap(cachedMap, childMap);
      rememberFolder(loadedCacheFolderKeys, childFolder);
      assertScanCurrent(scanToken);
      await yieldToEventLoop();
    } catch (err) {
      if (err instanceof ScanSupersededError) throw err;
      log.warn(`[scan-directory] Failed to reuse subfolder cache for ${childFolder}:`, err);
    }
  }

  // Migrate any old .video-cull-thumbs thumbnails into the cache directory.
  // Filesystem-based: checks disk directly, not the DB, so it works even when
  // the DB has no thumbnail records (e.g. first launch after JSONâ†’SQLite migration).
  // Runs once per folder; subsequent scans find nothing to move and are instant.
  const oldThumbBase = path.join(dirPath, THUMB_DIR);
  const oldVideoIds = await fs.readdir(oldThumbBase).catch(() => []);
  assertScanCurrent(scanToken);
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
      assertScanCurrent(scanToken);
    }
    // Remove old base dir if now empty
    const remaining = await fs.readdir(oldThumbBase).catch(() => ['x']);
    if (remaining.length === 0) await fs.rmdir(oldThumbBase).catch(() => {});
    log.info('[scan-directory] Thumbnail migration complete');
  }

  const videos = await scanDirectory(dirPath, includeSubfolders, (progress) => {
    if (scanToken !== scanGeneration) return;
    perfMetrics.recordRunCounter(perfRun, 'scanProgressEventCount');
    perfMetrics.recordRunCounter(perfRun, 'scanProgressPayloadBytes', measurePayloadBytes(progress));
    sendToRenderer('scan-progress', progress);
  });
  assertScanCurrent(scanToken);
  await loadOwnerFolderCachesIntoMap(videos, dirPath, cacheOptions, cachedMap, scanToken, scanCacheRoots, loadedCacheFolderKeys);
  assertScanCurrent(scanToken);

  // Merge with cache: preserve status, thumbnails, bookmarks from SQLite.
  // Thumbnail paths are resolved to absolute here so the renderer can use them directly.
  const merged = [];
  for (const v of videos) {
    const cached = cachedMap.get(v.id);
    if (cached) {
      merged.push({
        ...v,
        status: cached.status,
        durationSecs: cached.durationSecs ?? v.durationSecs,
        thumbnails: cached.thumbnails,
        duplicateHash: cached.duplicateHash || v.duplicateHash,
        metadataDate: cached.metadataDate ?? null,
        bookmarks: cached.bookmarks,
        rating: cached.rating ?? 0,
        favorite: Boolean(cached.favorite),
        videoCodec: cached.videoCodec ?? null,
        audioCodec: cached.audioCodec ?? null,
        videoBitrate: cached.videoBitrate ?? null,
        audioBitrate: cached.audioBitrate ?? null,
        totalBitrate: cached.totalBitrate ?? null,
        metadataCheckedAt: cached.metadataCheckedAt ?? null,
        metadataVersion: cached.metadataVersion ?? null,
        metadataFailedAt: cached.metadataFailedAt ?? null,
        metadataFailureReason: cached.metadataFailureReason ?? null,
        containerFormat: cached.containerFormat ?? null,
        width: cached.width ?? null,
        height: cached.height ?? null,
        fps: cached.fps ?? null,
        compatible: detectCompatibility(cached.containerFormat ?? null, cached.videoCodec ?? null, v.path),
      });
    } else {
      merged.push({
        ...v,
        status: 'pending',
        thumbnails: [],
        metadataDate: null,
        bookmarks: [],
        rating: 0,
        favorite: false,
        compatible: detectCompatibility(null, null, v.path),
        videoCodec: null,
        audioCodec: null,
        videoBitrate: null,
        audioBitrate: null,
        totalBitrate: null,
        metadataCheckedAt: null,
        metadataVersion: null,
        metadataFailedAt: null,
        metadataFailureReason: null,
        containerFormat: null,
        width: null,
        height: null,
        fps: null,
      });
    }
    await yieldToEventLoop();
  }

  // Persist each video to the cache owned by its immediate parent folder.
  await saveVideosByParentFolder(merged, cacheOptions, { publish: false, cacheRoots: scanCacheRoots });
  assertScanCurrent(scanToken);

  // Commit loaded-directory globals only after the scan is still current.
  currentScanDir = currentScanDir || dirPath;
  currentScanDirs.add(dirPath);
  publishScanCacheRoots(scanCacheRoots);

  // Populate the known-paths whitelist for this loaded session.
  merged.forEach((v) => {
    knownVideoPaths.add(v.path);
    knownVideoIdsByPath.set(v.path, v.id);
  });

  perfMetrics.finishRun(perfRun, {
    status: 'ok',
    videoCount: merged.length,
  });
  return merged;
  } catch (err) {
    perfMetrics.finishRun(perfRun, {
      status: err instanceof ScanSupersededError ? 'superseded' : 'error',
      error: err?.message || String(err),
    });
    throw err;
  }
});

// 3. Probe metadata for videos that are missing or stale.
ipcMain.handle('process-metadata', async (_event, videos, dirPath, options = {}) => {
  cancelMetadata();

  if (!currentScanDirs.has(dirPath)) {
    log.warn('[process-metadata] dirPath is not loaded, rejecting');
    return false;
  }

  const safeVideos = videos.filter((v) => {
    if (!VALID_VIDEO_ID.test(v.id)) {
      log.warn(`[process-metadata] Rejected video with invalid id: ${v.id}`);
      return false;
    }
    if (!isKnownVideoRecord(v)) {
      log.warn(`[process-metadata] Rejected mismatched or unknown video record: ${v.path}`);
      return false;
    }
    return true;
  });

  const cacheOptions = await getCacheOptions();
  const retryAfterMs = 24 * 60 * 60 * 1000;
  const recentFailures = new Set();
  if (!options?.force) {
    for (const [folderPath, folderVideos] of groupVideosByFolder(safeVideos)) {
      const db = await openCacheDbWithRecovery(folderPath, cacheOptions);
      const ids = folderVideos.map((video) => video.id);
      for (const id of cache.loadRecentMetadataFailureIds(db, ids, retryAfterMs)) {
        recentFailures.add(id);
      }
    }
  }

  const videosToProcess = safeVideos.filter((video) => !recentFailures.has(video.id));
  const videoById = new Map(videosToProcess.map((video) => [video.id, video]));
  log.info('[process-metadata] prepared', {
    requested: Array.isArray(videos) ? videos.length : 0,
    safe: safeVideos.length,
    queued: videosToProcess.length,
    skippedRecentFailures: recentFailures.size,
    force: Boolean(options?.force),
  });
  let config = {};
  try {
    const data = await fs.readFile(path.join(app.getPath('userData'), CONFIG_FILE), 'utf8');
    config = JSON.parse(data);
  } catch (e) {
    // Defaults are fine
  }

  let readyBatch = [];
  let lastProgress = null;

  const flushBatch = () => {
    if (!canSendToRenderer()) return;
    if (readyBatch.length > 0) {
      const batch = readyBatch;
      readyBatch = [];
      sendToRenderer('metadata-ready-batch', batch);
    }
    if (lastProgress) {
      const progress = lastProgress;
      lastProgress = null;
      sendToRenderer('metadata-progress', progress);
    }
  };

  const batchInterval = setInterval(flushBatch, 1000);
  activeBatchIntervals.add(batchInterval);
  let saved = 0;
  let failed = 0;
  const failureExamples = [];

  try {
    await processMetadata(videosToProcess, config, (progress) => {
      lastProgress = progress;
    }, async (videoId, result) => {
      const video = videoById.get(videoId);
      if (!video) return;
      const metadataUpdate = {
        videoId,
        durationSecs: result.durationSecs,
        metadataDate: result.creationTime,
        videoCodec: result.videoCodec,
        audioCodec: result.audioCodec,
        videoBitrate: result.videoBitrate,
        audioBitrate: result.audioBitrate,
        totalBitrate: result.totalBitrate,
        containerFormat: result.containerFormat,
        width: result.width,
        height: result.height,
        fps: result.fps,
        metadataVersion: result.metadataVersion,
        metadataCheckedAt: result.metadataCheckedAt,
        metadataFailedAt: null,
        metadataFailureReason: null,
      };
      const videoFolder = getVideoFolderPath(video);
      const db = await openCacheDbWithRecovery(videoFolder, cacheOptions);
      cache.updateVideoMetadata(db, videoId, metadataUpdate);
      saved++;
      readyBatch.push(metadataUpdate);
    }, async (videoId, err) => {
      const video = videoById.get(videoId);
      if (!video) return;
      const reason = summarizeMediaProbeError(err);
      const db = await openCacheDbWithRecovery(getVideoFolderPath(video), cacheOptions);
      cache.markMetadataFailure(db, videoId, reason);
      failed++;
      if (failureExamples.length < 8) {
        failureExamples.push({
          filename: video.filename,
          path: video.path,
          error: reason,
        });
      }
    });
  } finally {
    clearInterval(batchInterval);
    activeBatchIntervals.delete(batchInterval);
    if (!isQuitting) flushBatch();
  }
  log.info('[process-metadata] complete', {
    queued: videosToProcess.length,
    saved,
    failed,
    failureExamples,
  });

  return true;
});

// 4. Generate thumbnails for videos that don't have them
ipcMain.handle('generate-thumbnails', async (_event, videos, dirPath, options = {}) => {
  // Cancel any in-progress generation before starting a new one
  cancelThumbnails();

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
    if (!isKnownVideoRecord(v)) {
      log.warn(`[generate-thumbnails] Rejected mismatched or unknown video record: ${v.path}`);
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
      v.thumbnails.length < expectedThumbCount(v)
    ));

  let readyBatch = [];
  let lastProgress = null;
  
  const flushBatch = () => {
    if (!canSendToRenderer()) return;
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
    }, (videoId, thumbnails, durationSecs, creationTime, videoCodec, audioCodec, videoBitrate, audioBitrate, totalBitrate, containerFormat, width, height, fps) => {
      readyBatch.push({
        videoId,
        thumbnails,
        durationSecs,
        metadataDate: creationTime,
        videoCodec,
        audioCodec,
        videoBitrate,
        audioBitrate,
        totalBitrate,
        containerFormat,
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

ipcMain.handle('find-duplicates', async (_event, videos, options = {}) => {
  if (activeDuplicateRun) {
    activeDuplicateRun.cancel();
    activeDuplicateRun = null;
  }
  if (!Array.isArray(videos) || currentScanDirs.size === 0) {
    return { status: 'error', error: 'No loaded videos to compare.' };
  }

  const safeVideos = [];
  for (const video of videos) {
    if (!video || !VALID_VIDEO_ID.test(String(video.id || ''))) continue;
    if (!isKnownVideoRecord(video)) continue;
    if (!await isPathWithinAnyDir(video.path, currentScanDirs)) continue;
    safeVideos.push(video);
  }
  if (safeVideos.length < 2) {
    return { status: 'ok', groups: [], videos: [], stats: { groupCount: 0, duplicateVideoCount: 0, exactGroupCount: 0, similarityGroupCount: 0 } };
  }

  const cacheOptions = await getCacheOptions();
  const appConfig = await readJsonFile(CONFIG_FILE, {});
  const settings = {
    ...appConfig.duplicates,
    ...(options?.settings ?? options ?? {}),
  };
  const duplicateConcurrency = getConcurrentLimit(appConfig);
  const duplicateExecutionOptions = {
    cpuThreadsLimited: appConfig.cpuThreadsLimited,
  };
  const perfRun = perfMetrics.beginRun('duplicate', {
    videoCount: safeVideos.length,
    sampleCount: settings.sampleCount,
    comparisonMode: settings.comparisonMode,
    maxConcurrency: duplicateConcurrency,
  });
  const run = createDuplicateRun();
  activeDuplicateRun = run;

  try {
    const result = await findDuplicates({
      videos: safeVideos,
      settings,
      cacheOptions,
      maxConcurrency: duplicateConcurrency,
      executionOptions: duplicateExecutionOptions,
      run,
      openDb: openCacheDbWithRecovery,
      sendProgress: (payload) => sendToRenderer('duplicate-progress', payload),
    });
    if (activeDuplicateRun === run) activeDuplicateRun = null;
    sendToRenderer('duplicate-progress', { stage: 'Done', current: result.stats.duplicateVideoCount, total: result.stats.duplicateVideoCount });
    perfMetrics.finishRun(perfRun, {
      status: 'ok',
      groupCount: result.stats.groupCount,
      duplicateVideoCount: result.stats.duplicateVideoCount,
    });
    return { status: 'ok', ...result };
  } catch (err) {
    if (activeDuplicateRun === run) activeDuplicateRun = null;
    if (err instanceof DuplicateCancelledError || run.cancelled) {
      sendToRenderer('duplicate-progress', { stage: 'Cancelled', current: 0, total: 0 });
      perfMetrics.finishRun(perfRun, { status: 'cancelled' });
      return { status: 'cancelled' };
    }
    log.warn('[find-duplicates] Failed:', err);
    sendToRenderer('duplicate-progress', { stage: 'Error', current: 0, total: 0, message: err.message });
    perfMetrics.finishRun(perfRun, {
      status: 'error',
      error: err?.message || String(err),
    });
    return { status: 'error', error: err.message || String(err) };
  }
});

ipcMain.handle('cancel-duplicate-detection', async () => {
  if (!activeDuplicateRun) return false;
  activeDuplicateRun.cancel();
  activeDuplicateRun = null;
  sendToRenderer('duplicate-progress', { stage: 'Cancelled', current: 0, total: 0 });
  return true;
});

ipcMain.handle('get-performance-stats', async () => {
  return perfMetrics.getSnapshot();
});

ipcMain.handle('get-idle-diagnostics', async () => {
  return collectIdleDiagnostics();
});

ipcMain.handle('reset-performance-stats', async () => {
  perfMetrics.reset();
  return true;
});

ipcMain.on('renderer-error', (_event, payload = {}) => {
  const safePayload = {
    kind: String(payload.kind || 'error').slice(0, 80),
    message: String(payload.message || '').slice(0, 1000),
    stack: payload.stack ? String(payload.stack).slice(0, 4000) : null,
    componentStack: payload.componentStack ? String(payload.componentStack).slice(0, 4000) : null,
    source: payload.source ? String(payload.source).slice(0, 500) : null,
    lineno: Number.isFinite(payload.lineno) ? payload.lineno : null,
    colno: Number.isFinite(payload.colno) ? payload.colno : null,
  };
  log.error('[renderer-error]', safePayload);
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
    const safeVideos = await validateCacheSavePayload(dirPath, videos);
    if (safeVideos.length === 0) return false;
    const cacheOptions = await getCacheOptions();
    await saveVideosByParentFolder(safeVideos, cacheOptions);
    return true;
  } catch (err) {
    log.error('[save-cache] Error saving cache:', err);
    return false;
  }
});

ipcMain.handle('save-cache-atomic', async (_event, dirPath, videos) => {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    const safeVideos = await validateCacheSavePayload(dirPath, videos);
    if (safeVideos.length === 0) return false;
    const cacheOptions = await getCacheOptions();
    if (safeVideos.length > ATOMIC_SAVE_SYNC_LIMIT) {
      log.warn(`[save-cache-atomic] ${safeVideos.length} videos exceeds sync transaction limit; using chunked save to keep UI responsive.`);
    }
    await saveVideosByParentFolder(safeVideos, cacheOptions, { atomic: true });
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
  const cacheTargets = await collectDeletionCacheTargets(validPaths);

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
  if (failedTrash.length === 0) {
    const successful = new Set(trashResults.filter((result) => result.success).map((result) => result.path));
    await removeDeletedVideoCacheArtifacts(cacheTargets.filter((target) => successful.has(target.filePath)));
    for (const filePath of successful) {
      knownVideoPaths.delete(filePath);
      knownVideoIdsByPath.delete(filePath);
    }
    const trashedFolders1 = await trashEmptyDeletedVideoFolders(Array.from(successful));
    if (trashedFolders1.size === 0) return results;
    return results.map((r) => {
      if (!r.success) return r;
      const folder = path.resolve(path.dirname(r.path));
      return trashedFolders1.has(folder) ? { ...r, removedFolder: folder } : r;
    });
  }

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

  if (response === 0) {
    const successfulPaths = new Set(results.filter((result) => result.success).map((result) => result.path));
    await removeDeletedVideoCacheArtifacts(cacheTargets.filter((target) => successfulPaths.has(target.filePath)));
    for (const filePath of successfulPaths) {
      knownVideoPaths.delete(filePath);
      knownVideoIdsByPath.delete(filePath);
    }
    const trashedFolders2 = await trashEmptyDeletedVideoFolders(Array.from(successfulPaths));
    if (trashedFolders2.size === 0) return results;
    return results.map((r) => {
      if (!r.success) return r;
      const folder = path.resolve(path.dirname(r.path));
      return trashedFolders2.has(folder) ? { ...r, removedFolder: folder } : r;
    });
  }

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
  const mergedResults = Array.from(merged.values());
  const successfulPaths = new Set(mergedResults.filter((result) => result.success).map((result) => result.path));
  await removeDeletedVideoCacheArtifacts(cacheTargets.filter((target) => successfulPaths.has(target.filePath)));
  for (const filePath of successfulPaths) {
    knownVideoPaths.delete(filePath);
    knownVideoIdsByPath.delete(filePath);
  }
  const trashedFolders3 = await trashEmptyDeletedVideoFolders(Array.from(successfulPaths));
  if (trashedFolders3.size === 0) return mergedResults;
  return mergedResults.map((r) => {
    if (!r.success) return r;
    const folder = path.resolve(path.dirname(r.path));
    return trashedFolders3.has(folder) ? { ...r, removedFolder: folder } : r;
  });
});

ipcMain.handle('export-report', async (_event, videos, dirPaths) => {
  const roots = normalizeReportRoots(dirPaths);
  if (roots.length === 0 || !Array.isArray(videos) || videos.length === 0) return 'error';

  const defaultFileName = `videocull-report-${new Date().toISOString().slice(0, 10)}.html`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Video Cull Report',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'HTML', extensions: ['html'] }],
    properties: ['createDirectory'],
  });

  if (result.canceled || !result.filePath) return 'cancelled';

  try {
    const html = buildReportHtml(videos, roots);
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
ipcMain.handle('migrate-cache-settings', async (_event, _oldSettings, newSettings) => {
  const persistedSettings = await readJsonFile(CONFIG_FILE, {});
  if (!cacheRelevantSettingsChanged(persistedSettings, newSettings)) {
    return { status: 'unchanged', migrated: 0, errors: [] };
  }

  const knownFolders = await getKnownCacheFolders(Array.from(currentScanDirs));
  if (knownFolders.length === 0) {
    return { status: 'no-cache', migrated: 0, errors: [] };
  }

  const fromOptions = normalizeCacheSettings(persistedSettings);
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
  let allowed = knownVideoPaths.has(filePath) || await isPathWithinAnyDir(filePath, currentScanDirs);
  if (!allowed) {
    try {
      const stats = await fs.stat(filePath);
      allowed = stats.isFile() || stats.isDirectory();
    } catch {
      allowed = false;
    }
  }
  if (!allowed) return;
  shell.showItemInFolder(filePath);
});

// 11. App version
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('open-external-url', async (_event, url) => {
  if (!ALLOWED_EXTERNAL_URLS.has(url)) return false;
  await shell.openExternal(url);
  return true;
});

// 12. Auto-updater IPC
ipcMain.handle('check-for-updates', async () => {
  if (isDev) {
    return { ok: false, status: 'disabled-dev' };
  }

  try {
    updateReadyToInstall = false;
    await autoUpdater.checkForUpdates();
    return { ok: true, status: 'checking' };
  } catch (err) {
    log.error('[auto-updater] manual check failed:', err);
    sendToRenderer('update-status', { status: 'error', message: err.message });
    return { ok: false, status: 'error', error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  if (!updateReadyToInstall) {
    log.warn('[auto-updater] install-update rejected because no downloaded update is ready');
    return false;
  }
  autoUpdater.quitAndInstall(false, true);
  return true;
});

// â”€â”€ Auto-updater setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupAutoUpdater() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    updateReadyToInstall = false;
    sendToRenderer('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    updateReadyToInstall = false;
    sendToRenderer('update-status', { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    updateReadyToInstall = false;
    sendToRenderer('update-status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateReadyToInstall = true;
    sendToRenderer('update-status', { status: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    updateReadyToInstall = false;
    log.error('[auto-updater] error:', err);
    sendToRenderer('update-status', { status: 'error', message: err.message });
  });

  // Check shortly after launch (if auto-updates are enabled in settings)
  setTimeout(async () => {
    try {
      try {
        const configPath = path.join(app.getPath('userData'), CONFIG_FILE);
        const data = await require('fs').promises.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        if (config.autoUpdates === false) return;
      } catch {
        // No config yet â€” default is enabled
      }
      await autoUpdater.checkForUpdates();
    } catch (err) {
      log.error('[auto-updater] startup check failed:', err);
      sendToRenderer('update-status', { status: 'error', message: err.message });
    }
  }, 5000);
}
