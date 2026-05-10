const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const Database = require('better-sqlite3');

function usage() {
  console.log(`Usage:
  node scripts/cleanup-cache-clutter.js --cache-root <path> [--apply]
  node scripts/cleanup-cache-clutter.js --db <path> [--apply]
  node scripts/cleanup-cache-clutter.js --video-root <path> [--apply]

Dry-run is the default. With --apply, stale DB rows are deleted and orphan
thumbnail folders are moved to the Recycle Bin on Windows, or quarantined
inside the cache root on other platforms.`);
}

function parseArgs(argv) {
  const args = { cacheRoots: [], dbPaths: [], videoRoots: [], apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--cache-root') args.cacheRoots.push(path.resolve(argv[++i] || ''));
    else if (arg === '--db') args.dbPaths.push(path.resolve(argv[++i] || ''));
    else if (arg === '--video-root') args.videoRoots.push(path.resolve(argv[++i] || ''));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function findDbFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.db')) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

function findLegacyThumbDirs(root) {
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === '.video-cull-thumbs') {
        result.push(fullPath);
        continue;
      }
      stack.push(fullPath);
    }
  }
  return result;
}

function resolveThumbRoot(dbPath) {
  const dbDir = path.dirname(dbPath);
  const dbName = path.basename(dbPath, '.db');
  if (path.basename(dbDir).toLowerCase() === '.videocull' && path.basename(dbPath).toLowerCase() === 'cache.db') {
    return path.join(dbDir, 'thumbs');
  }
  return path.join(dbDir, 'thumbs', dbName);
}

function listDirectories(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

function moveToRecycleBin(targetPath) {
  if (process.platform !== 'win32') return false;
  const command = [
    '$p = [Console]::In.ReadLine();',
    'Add-Type -AssemblyName Microsoft.VisualBasic;',
    '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin");',
  ].join(' ');
  childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    input: targetPath,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  return true;
}

function quarantine(targetPath, cacheRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantineRoot = path.join(cacheRoot, '.videocull-cleanup-trash', stamp);
  fs.mkdirSync(quarantineRoot, { recursive: true });
  const destination = path.join(quarantineRoot, path.basename(targetPath));
  fs.renameSync(targetPath, destination);
  return destination;
}

function removeThumbDir(targetPath, cacheRoot) {
  try {
    if (moveToRecycleBin(targetPath)) return 'recycle-bin';
  } catch (err) {
    console.warn(`Recycle Bin failed for ${targetPath}: ${err.message}`);
  }
  return `quarantine:${quarantine(targetPath, cacheRoot)}`;
}

function cleanDb(dbPath, apply) {
  const thumbRoot = resolveThumbRoot(dbPath);
  const cacheRoot = path.dirname(dbPath);
  const db = new Database(dbPath);
  const videoRows = db.prepare('SELECT id, path FROM videos').all();
  const thumbnailRows = db.prepare('SELECT DISTINCT video_id FROM thumbnails').all();
  const videoIds = new Set(videoRows.map((row) => row.id));
  const missingVideoIds = videoRows
    .filter((row) => !row.path || !fs.existsSync(row.path))
    .map((row) => row.id);
  const orphanThumbnailIds = thumbnailRows
    .map((row) => row.video_id)
    .filter((id) => !videoIds.has(id));
  const orphanThumbDirs = listDirectories(thumbRoot)
    .filter((dirPath) => !videoIds.has(path.basename(dirPath)));
  const deletedThumbDirs = missingVideoIds
    .map((id) => path.join(thumbRoot, id))
    .filter((dirPath) => fs.existsSync(dirPath));
  const thumbDirsToRemove = Array.from(new Set([...orphanThumbDirs, ...deletedThumbDirs]));

  if (apply && (missingVideoIds.length > 0 || orphanThumbnailIds.length > 0)) {
    const deleteThumbRows = db.prepare('DELETE FROM thumbnails WHERE video_id = ?');
    const deleteVideo = db.prepare('DELETE FROM videos WHERE id = ?');
    db.transaction((ids) => {
      for (const id of ids) {
        deleteThumbRows.run(id);
        deleteVideo.run(id);
      }
    })(missingVideoIds);
    db.transaction((ids) => {
      for (const id of ids) deleteThumbRows.run(id);
    })(orphanThumbnailIds);
  }

  const removedThumbDirs = [];
  if (apply) {
    for (const dirPath of thumbDirsToRemove) {
      removedThumbDirs.push({ path: dirPath, method: removeThumbDir(dirPath, cacheRoot) });
    }
  }

  db.close();
  return {
    dbPath,
    missingVideoRows: missingVideoIds.length,
    orphanThumbnailRows: orphanThumbnailIds.length,
    orphanThumbDirs: orphanThumbDirs.length,
    deletedVideoThumbDirs: deletedThumbDirs.length,
    removedThumbDirs,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (args.cacheRoots.length === 0 && args.dbPaths.length === 0 && args.videoRoots.length === 0)) {
    usage();
    return;
  }

  const dbPaths = new Set(args.dbPaths);
  for (const root of args.cacheRoots) {
    for (const dbPath of findDbFiles(root)) dbPaths.add(dbPath);
  }

  const results = [];
  for (const dbPath of dbPaths) {
    try {
      results.push(cleanDb(dbPath, args.apply));
    } catch (err) {
      results.push({ dbPath, error: err.message });
    }
  }

  const legacyThumbDirs = args.videoRoots.flatMap(findLegacyThumbDirs);
  const legacyResults = legacyThumbDirs.map((dirPath) => {
    if (!args.apply) return { path: dirPath, removed: false };
    return { path: dirPath, removed: true, method: removeThumbDir(dirPath, path.dirname(dirPath)) };
  });

  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', results, legacyThumbDirs: legacyResults }, null, 2));
}

main();
