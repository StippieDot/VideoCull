const fs = require('node:fs');
const path = require('node:path');
const product = require('../product.json');

function expectedChildPath(appDataPath, childName, pathImpl = path) {
  const base = pathImpl.resolve(appDataPath);
  const candidate = pathImpl.resolve(base, childName);
  if (pathImpl.dirname(candidate) !== base) {
    throw new Error(`Profile path must be a direct child of appData: ${candidate}`);
  }
  return candidate;
}

function lstatOrNull(candidatePath, fsImpl = fs) {
  try {
    return fsImpl.lstatSync(candidatePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertDirectory(profilePath, stats = null, fsImpl = fs) {
  const resolvedStats = stats ?? fsImpl.lstatSync(profilePath);
  if (!resolvedStats.isDirectory() || resolvedStats.isSymbolicLink()) {
    throw new Error(`Profile path is not a regular directory: ${profilePath}`);
  }
}

function ensureDirectory(profilePath, fsImpl = fs) {
  fsImpl.mkdirSync(profilePath, { recursive: true });
  assertDirectory(profilePath, null, fsImpl);
}

function warning(title, detail) {
  return { title, detail, kind: 'warning' };
}

function dualProfileResult(legacyPath, canonicalPath) {
  return {
    selectedPath: canonicalPath,
    status: 'both-canonical',
    warning: warning(
      'Two VideoCull profile folders were found',
      `VideoCull is using ${canonicalPath}. No files were merged, copied, or removed. The other profile remains at ${legacyPath}.`,
    ),
    legacyPath,
    canonicalPath,
  };
}

function selectProfile({ appDataPath, legacyName, canonicalName, fsImpl = fs, pathImpl = path }) {
  const legacyPath = expectedChildPath(appDataPath, legacyName, pathImpl);
  const canonicalPath = expectedChildPath(appDataPath, canonicalName, pathImpl);
  const legacyStats = lstatOrNull(legacyPath, fsImpl);
  const canonicalStats = lstatOrNull(canonicalPath, fsImpl);

  if (canonicalStats) {
    assertDirectory(canonicalPath, canonicalStats, fsImpl);
    return legacyStats
      ? dualProfileResult(legacyPath, canonicalPath)
      : { selectedPath: canonicalPath, status: 'canonical', warning: null, legacyPath, canonicalPath };
  }

  if (!legacyStats) {
    ensureDirectory(canonicalPath, fsImpl);
    return { selectedPath: canonicalPath, status: 'fresh', warning: null, legacyPath, canonicalPath };
  }

  assertDirectory(legacyPath, legacyStats, fsImpl);
  try {
    fsImpl.renameSync(legacyPath, canonicalPath);
  } catch (error) {
    const remainingLegacy = lstatOrNull(legacyPath, fsImpl);
    const movedCanonical = lstatOrNull(canonicalPath, fsImpl);

    if (movedCanonical) {
      assertDirectory(canonicalPath, movedCanonical, fsImpl);
      return remainingLegacy
        ? dualProfileResult(legacyPath, canonicalPath)
        : { selectedPath: canonicalPath, status: 'renamed', warning: null, legacyPath, canonicalPath };
    }
    if (!remainingLegacy) throw error;

    assertDirectory(legacyPath, remainingLegacy, fsImpl);
    return {
      selectedPath: legacyPath,
      status: 'rename-fallback',
      warning: warning(
        'VideoCull kept the existing profile location',
        `Windows could not rename ${legacyPath} to ${canonicalPath}. Your data is unchanged and this session will continue using the existing folder. VideoCull will try again next time.`,
      ),
      legacyPath,
      canonicalPath,
    };
  }

  assertDirectory(canonicalPath, null, fsImpl);
  return { selectedPath: canonicalPath, status: 'renamed', warning: null, legacyPath, canonicalPath };
}

function configureAppProfile(app, options = {}) {
  const env = options.env ?? process.env;
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const isE2E = env.VC_E2E_USE_DIST === '1';
  const isDev = !app.isPackaged && !isE2E;
  let result;

  if (isE2E) {
    if (!env.VC_E2E_USER_DATA_DIR) {
      throw new Error('VC_E2E_USER_DATA_DIR is required when VC_E2E_USE_DIST=1.');
    }
    const selectedPath = pathImpl.resolve(env.VC_E2E_USER_DATA_DIR);
    ensureDirectory(selectedPath, fsImpl);
    result = { selectedPath, status: 'e2e', warning: null, legacyPath: null, canonicalPath: selectedPath };
  } else {
    result = selectProfile({
      appDataPath: app.getPath('appData'),
      legacyName: isDev ? `${product.legacyTechnicalName}-dev` : product.legacyTechnicalName,
      canonicalName: isDev ? `${product.displayName}-dev` : product.displayName,
      fsImpl,
      pathImpl,
    });
  }

  ensureDirectory(result.selectedPath, fsImpl);
  app.setName(product.displayName);
  app.setPath('userData', result.selectedPath);
  app.setPath('sessionData', result.selectedPath);
  app.setAppUserModelId(product.appId);

  return { ...result, isDev, isE2E };
}

module.exports = {
  assertDirectory,
  configureAppProfile,
  ensureDirectory,
  expectedChildPath,
  selectProfile,
};
