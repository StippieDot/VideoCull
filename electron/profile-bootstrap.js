const fs = require('node:fs');
const path = require('node:path');
const product = require('../product.json');

const CONTROL_JSON_FILES = new Set([
  'settings.json',
  'cache-index.json',
  'distributed-index.json',
]);

const KNOWN_FILES = new Set([
  ...CONTROL_JSON_FILES,
  'library-state.json',
  '.updaterId',
  'Local State',
  'Preferences',
]);

const KNOWN_DIRECTORIES = new Set([
  'video-cache',
  'blob_storage',
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUCache',
  'Local Storage',
  'logs',
  'Network',
  'Session Storage',
  'Shared Dictionary',
  'shared_proto_db',
  'VideoDecodeStats',
]);

const MAX_CONTROL_JSON_BYTES = 8 * 1024 * 1024;
const MAX_PROFILE_ROOT_ENTRIES = 512;

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

function validateProfile(profilePath, fsImpl = fs, pathImpl = path) {
  const errors = [];
  let rootStats;
  try {
    rootStats = fsImpl.lstatSync(profilePath);
  } catch (error) {
    return { valid: false, errors: [`Profile is not readable: ${error.message}`] };
  }

  if (!rootStats.isDirectory()) errors.push('Profile path is not a directory.');
  if (rootStats.isSymbolicLink()) errors.push('Profile path cannot be a symbolic link or junction.');
  if (errors.length > 0) return { valid: false, errors };

  try {
    const rootEntries = fsImpl.readdirSync(profilePath, { withFileTypes: true });
    if (rootEntries.length > MAX_PROFILE_ROOT_ENTRIES) {
      errors.push(`Profile root exceeds the bounded validation limit of ${MAX_PROFILE_ROOT_ENTRIES} entries.`);
    } else {
      for (const entry of rootEntries) {
        if (entry.isSymbolicLink()) {
          errors.push(`${entry.name} cannot be a symbolic link or junction.`);
        }
      }
    }
  } catch (error) {
    errors.push(`Profile entries are not readable: ${error.message}`);
  }

  for (const entryName of KNOWN_FILES) {
    const entryPath = pathImpl.join(profilePath, entryName);
    let entryStats;
    try {
      entryStats = fsImpl.lstatSync(entryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      errors.push(`${entryName} is not readable: ${error.message}`);
      continue;
    }

    if (!entryStats.isFile() || entryStats.isSymbolicLink()) {
      errors.push(`${entryName} is not a regular file.`);
      continue;
    }

    if (!CONTROL_JSON_FILES.has(entryName)) continue;
    if (entryStats.size > MAX_CONTROL_JSON_BYTES) {
      errors.push(`${entryName} exceeds the bounded startup validation limit.`);
      continue;
    }

    try {
      JSON.parse(fsImpl.readFileSync(entryPath, 'utf8'));
    } catch (error) {
      errors.push(`${entryName} is not valid JSON: ${error.message}`);
    }
  }

  for (const entryName of KNOWN_DIRECTORIES) {
    const entryPath = pathImpl.join(profilePath, entryName);
    let entryStats;
    try {
      entryStats = fsImpl.lstatSync(entryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      errors.push(`${entryName} is not readable: ${error.message}`);
      continue;
    }

    if (!entryStats.isDirectory() || entryStats.isSymbolicLink()) {
      errors.push(`${entryName} is not a regular directory.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function ensureDirectory(profilePath, fsImpl = fs) {
  fsImpl.mkdirSync(profilePath, { recursive: true });
  const stats = fsImpl.lstatSync(profilePath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Profile path is not a safe directory: ${profilePath}`);
  }
}

function warning(title, detail) {
  return { title, detail, kind: 'warning' };
}

function selectProfile({ appDataPath, legacyName, canonicalName, fsImpl = fs, pathImpl = path }) {
  const legacyPath = expectedChildPath(appDataPath, legacyName, pathImpl);
  const canonicalPath = expectedChildPath(appDataPath, canonicalName, pathImpl);
  const legacyStats = lstatOrNull(legacyPath, fsImpl);
  const canonicalStats = lstatOrNull(canonicalPath, fsImpl);

  if (!legacyStats && !canonicalStats) {
    ensureDirectory(canonicalPath, fsImpl);
    return { selectedPath: canonicalPath, status: 'fresh', warning: null, legacyPath, canonicalPath };
  }

  if (!legacyStats && canonicalStats) {
    const validation = validateProfile(canonicalPath, fsImpl, pathImpl);
    return {
      selectedPath: canonicalPath,
      status: validation.valid ? 'canonical' : 'canonical-warning',
      warning: validation.valid
        ? null
        : warning(
          'VideoCull profile needs attention',
          `VideoCull is using ${canonicalPath}, but bounded startup validation found: ${validation.errors.join(' ')}`,
        ),
      legacyPath,
      canonicalPath,
    };
  }

  if (legacyStats && !canonicalStats) {
    const validation = validateProfile(legacyPath, fsImpl, pathImpl);
    if (!validation.valid) {
      return {
        selectedPath: legacyPath,
        status: 'legacy-validation-fallback',
        warning: warning(
          'VideoCull kept the existing profile location',
          `The profile at ${legacyPath} could not be safely renamed because validation found: ${validation.errors.join(' ')} No files were copied or removed.`,
        ),
        legacyPath,
        canonicalPath,
      };
    }

    try {
      fsImpl.renameSync(legacyPath, canonicalPath);
      ensureDirectory(canonicalPath, fsImpl);
      return { selectedPath: canonicalPath, status: 'renamed', warning: null, legacyPath, canonicalPath };
    } catch (error) {
      const remainingLegacy = lstatOrNull(legacyPath, fsImpl);
      const movedCanonical = lstatOrNull(canonicalPath, fsImpl);
      if (!remainingLegacy && movedCanonical) {
        ensureDirectory(canonicalPath, fsImpl);
        return { selectedPath: canonicalPath, status: 'renamed', warning: null, legacyPath, canonicalPath };
      }
      if (!remainingLegacy) throw error;
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
  }

  const canonicalValidation = validateProfile(canonicalPath, fsImpl, pathImpl);
  const legacyValidation = validateProfile(legacyPath, fsImpl, pathImpl);
  const useCanonical = canonicalValidation.valid || !legacyValidation.valid;
  const selectedPath = useCanonical ? canonicalPath : legacyPath;
  const validationDetail = useCanonical
    ? (canonicalValidation.valid ? '' : ` Canonical validation found: ${canonicalValidation.errors.join(' ')}`)
    : ` Canonical validation found: ${canonicalValidation.errors.join(' ')}`;

  return {
    selectedPath,
    status: useCanonical ? 'both-canonical' : 'both-legacy',
    warning: warning(
      'Two VideoCull profile folders were found',
      `VideoCull is using ${selectedPath}. No files were merged, copied, or removed. The other profile remains at ${useCanonical ? legacyPath : canonicalPath}.${validationDetail}`,
    ),
    legacyPath,
    canonicalPath,
  };
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
  MAX_CONTROL_JSON_BYTES,
  MAX_PROFILE_ROOT_ENTRIES,
  configureAppProfile,
  ensureDirectory,
  expectedChildPath,
  selectProfile,
  validateProfile,
};
