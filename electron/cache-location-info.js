const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cache = require('./cache');

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function location(pathValue, roots, label, fsImpl = fs) {
  let available = false;
  try {
    const stats = await fsImpl.lstat(pathValue);
    available = stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    available = false;
  }
  const packageOwned = Boolean(roots.packageRoot) && isPathInside(roots.packageRoot, pathValue);
  const profileOwned = !packageOwned && Boolean(roots.profileRoot) && isPathInside(roots.profileRoot, pathValue);
  return {
    label,
    path: path.resolve(pathValue),
    ownership: packageOwned ? 'package' : (profileOwned ? 'profile' : 'external'),
    available,
    disposableOnReset: packageOwned,
  };
}

async function getCacheLocationInfo(options) {
  const settings = options.settings ?? {};
  const mode = settings.cacheLocation || 'centralised';
  const roots = { packageRoot: options.packageRoot ?? null, profileRoot: options.profileRoot };
  const locations = [];

  if (mode === 'centralised') {
    locations.push(await location(settings.centralCachePath || options.defaultCentralRoot, roots, 'Central cache', options.fsImpl));
  } else if (mode === 'per-drive') {
    const seen = new Set();
    for (const [drive, configuredPath] of Object.entries(settings.perDriveCachePaths || {})) {
      if (!configuredPath) continue;
      const item = await location(configuredPath, roots, `${drive} cache`, options.fsImpl);
      seen.add(item.path.toLowerCase());
      locations.push(item);
    }
    for (const folderPath of options.knownFolders || []) {
      const resolved = cache.resolveCachePaths(folderPath, {
        mode,
        defaultCentralRoot: options.defaultCentralRoot,
        centralCachePath: null,
        perDriveCachePaths: settings.perDriveCachePaths || {},
        username: options.username ?? os.userInfo().username,
      }).cacheRootDir;
      if (seen.has(path.resolve(resolved).toLowerCase())) continue;
      const drive = path.parse(folderPath).root.replace(/[\\/]+$/, '') || folderPath;
      const item = await location(resolved, roots, `${drive} cache`, options.fsImpl);
      seen.add(item.path.toLowerCase());
      locations.push(item);
    }
  } else {
    for (const folderPath of options.knownFolders || []) {
      locations.push(await location(path.join(folderPath, '.videocull'), roots, path.basename(folderPath) || folderPath, options.fsImpl));
    }
  }

  return { mode, locations };
}

module.exports = { getCacheLocationInfo, isPathInside };
