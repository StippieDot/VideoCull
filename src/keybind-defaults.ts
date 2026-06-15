import { kb } from './keybinds';
import type { Keybind, KeybindSettingKey } from './keybinds';
import type { AppSettings, FeatureSettings } from './types';
import type { DuplicateSettings } from './types';

export const DEFAULT_FEATURES: FeatureSettings = {
  ratings: true,
  favorites: true,
  codecBadges: true,
  compatibilityCheck: true,
  globalMute: true,
  nextUndecided: true,
};

export const OPTIONAL_FEATURE_KEYS = ['ratings', 'favorites'] as const;

export function normalizeFeatureSettings(raw: unknown): FeatureSettings {
  const rawFeatures = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  return {
    ratings: typeof rawFeatures.ratings === 'boolean' ? rawFeatures.ratings : DEFAULT_FEATURES.ratings,
    favorites: typeof rawFeatures.favorites === 'boolean' ? rawFeatures.favorites : DEFAULT_FEATURES.favorites,
    codecBadges: DEFAULT_FEATURES.codecBadges,
    compatibilityCheck: DEFAULT_FEATURES.compatibilityCheck,
    globalMute: DEFAULT_FEATURES.globalMute,
    nextUndecided: DEFAULT_FEATURES.nextUndecided,
  };
}

export const DEFAULT_KEYBINDS: Record<KeybindSettingKey, Keybind> = {
  keyKeep:               kb('k'),
  keyDelete:             kb('d'),
  keySkip:               kb('s'),
  keyReset:              kb('r'),
  keyUndo:               kb('z'),
  keyPlay:               kb(' '),
  keyPrevVideo:          kb('arrowleft'),
  keyNextVideo:          kb('arrowright'),
  keyEnterPlay:          kb('enter'),
  keyExternalPlayer:     kb('enter', { ctrl: true }),
  keyNextUndecided:      kb('tab'),
  keySeekBack:           kb('arrowleft'),
  keySeekForward:        kb('arrowright'),
  keySpeedDown:          kb('['),
  keySpeedUp:            kb(']'),
  keyBookmark:           kb('b'),
  keyShowHelp:           kb('?', { shift: true }),
  keyGlobalMute:         kb('m'),
  keyPreviewSeekBack:    kb('arrowleft'),
  keyPreviewSeekForward: kb('arrowright'),
};

// SYNC NOTE: These defaults are duplicated in electron/duplicate-utils.js (DEFAULT_DUPLICATE_SETTINGS).
// The backend copy is used during duplicate detection. Keep both in sync when changing defaults.
// The compareKeeperCandidates / chooseSuggestedKeeperId functions in src/store.ts mirror the backend versions.
export const DEFAULT_DUPLICATE_SETTINGS: DuplicateSettings = {
  enabled: true,
  runAfterScan: false,
  comparisonMode: 'visual',
  sampleCount: 3,
  defaultScope: 'all',
  protectKeep: true,
  protectSkipped: false,
  keeperOrder: ['resolution', 'videoBitrate', 'duration', 'fps', 'size'],
  samplingWindow: 'even',
  customStartPercent: 0,
  customEndPercent: 100,
  finalSimilarityThreshold: 95,
  durationTolerancePercent: 20,
  requireEverySample: true,
  ignoreBlackPixels: false,
  ignoreWhitePixels: false,
  compareFlipped: false,
  maxSamplingDuration: 0,
  retryFailedFingerprintExtraction: false,
  checkpointIntervalMinutes: 5,
  ignoredDuplicatePairs: [],
};

const KEEPER_RULES = new Set(DEFAULT_DUPLICATE_SETTINGS.keeperOrder);

function normalizeKeeperOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_DUPLICATE_SETTINGS.keeperOrder;
  const normalized = value.filter((rule): rule is string => typeof rule === 'string' && KEEPER_RULES.has(rule));
  for (const rule of DEFAULT_DUPLICATE_SETTINGS.keeperOrder) {
    if (!normalized.includes(rule)) normalized.push(rule);
  }
  return normalized.length > 0 ? normalized : DEFAULT_DUPLICATE_SETTINGS.keeperOrder;
}

// Keys that existed in the old single-char string format
const LEGACY_STRING_KEYS = ['keyKeep', 'keyDelete', 'keySkip', 'keyUndo', 'keyPlay'] as const;

/**
 * Migrate a raw config object from disk into valid AppSettings.
 * Handles:
 *  - Old string-based keybinds ("k" → { key: "k", ctrl: false, ... })
 *  - Missing new keybind fields (filled with defaults)
 *  - Already-migrated Keybind objects (passed through unchanged)
 */
export function migrateSettings(raw: Record<string, unknown>): Partial<AppSettings> {
  const result: Record<string, unknown> = { ...raw };

  // Convert legacy single-char strings to Keybind objects
  for (const field of LEGACY_STRING_KEYS) {
    const val = result[field];
    if (typeof val === 'string') {
      result[field] = kb(val || field[0]); // fallback to first char if empty
    }
  }

  // Fill in any missing keybind fields with defaults
  for (const [key, defaultBind] of Object.entries(DEFAULT_KEYBINDS)) {
    if (result[key] === undefined || result[key] === null) {
      result[key] = defaultBind;
    }
  }
  const helpBind = result.keyShowHelp as Keybind | undefined;
  if (helpBind?.key === '?' && helpBind.shift === false && helpBind.ctrl === false && helpBind.alt === false) {
    result.keyShowHelp = DEFAULT_KEYBINDS.keyShowHelp;
  }

  // Ensure recentDirectories is an array (handle old config)
  if (!Array.isArray(result.recentDirectories)) {
    result.recentDirectories = [];
  }

  if (!result.recentDirectoryTimestamps || typeof result.recentDirectoryTimestamps !== 'object' || Array.isArray(result.recentDirectoryTimestamps)) {
    result.recentDirectoryTimestamps = {};
  }

  if (result.autoUpdates === undefined || result.autoUpdates === null) {
    result.autoUpdates = true;
  }

  if (typeof result.globalMute !== 'boolean') {
    result.globalMute = false;
  }

  if (typeof result.hardwareAccel !== 'boolean') {
    result.hardwareAccel = false;
  }

  result.features = normalizeFeatureSettings(result.features);

  if (!result.duplicates || typeof result.duplicates !== 'object' || Array.isArray(result.duplicates)) {
    result.duplicates = { ...DEFAULT_DUPLICATE_SETTINGS };
  } else {
    const migratedDuplicates: Record<string, unknown> = {
      ...DEFAULT_DUPLICATE_SETTINGS,
      ...(result.duplicates as Record<string, unknown>),
    };
    if (!['phash', 'visual'].includes(String(migratedDuplicates.comparisonMode))) {
      migratedDuplicates.comparisonMode = DEFAULT_DUPLICATE_SETTINGS.comparisonMode;
    }
    if (![1, 2, 3, 4, 5, 7, 9].includes(Number(migratedDuplicates.sampleCount))) {
      migratedDuplicates.sampleCount = DEFAULT_DUPLICATE_SETTINGS.sampleCount;
    }
    migratedDuplicates.ignoredDuplicatePairs = Array.isArray(migratedDuplicates.ignoredDuplicatePairs)
      ? Array.from(new Set(
        migratedDuplicates.ignoredDuplicatePairs
          .filter((pairKey) => typeof pairKey === 'string' && /^[0-9a-f]{16}\|[0-9a-f]{16}$/i.test(pairKey))
          .map((pairKey) => pairKey.toLowerCase())
      ))
      : [];
    migratedDuplicates.keeperOrder = normalizeKeeperOrder(migratedDuplicates.keeperOrder);
    delete migratedDuplicates.phashCandidateThreshold;
    delete migratedDuplicates.rawGrayThreshold;
    delete migratedDuplicates.profile;
    delete migratedDuplicates.durationToleranceMinSecs;
    delete migratedDuplicates.durationToleranceMaxSecs;
    result.duplicates = migratedDuplicates;
  }

  delete result.appMode;
  delete result.hasSeenAppModeIntro;
  delete result.keyToggleAppMode;

  if (typeof result.defaultGroupByFolder !== 'boolean') {
    result.defaultGroupByFolder = true;
  }

  if (!['centralised', 'per-drive', 'distributed'].includes(result.cacheLocation as string)) {
    result.cacheLocation = 'centralised';
  }

  if (result.centralCachePath !== null && typeof result.centralCachePath !== 'string') {
    result.centralCachePath = null;
  }

  if (!result.perDriveCachePaths || typeof result.perDriveCachePaths !== 'object' || Array.isArray(result.perDriveCachePaths)) {
    result.perDriveCachePaths = {};
  }

  if (typeof result.autoPruneMissingSubfolderCache !== 'boolean') {
    result.autoPruneMissingSubfolderCache = true;
  }

  return result as Partial<AppSettings>;
}

/**
 * Asynchronously prune stale recent directories by validating each path exists.
 * Called during app startup to keep the recents list fresh and trustworthy.
 */
export async function pruneRecentDirectories(
  recentDirectories: string[],
  validator: (path: string) => Promise<{ valid: boolean; isDirectory: boolean }>
): Promise<string[]> {
  if (recentDirectories.length === 0) return [];

  const validatedPaths: string[] = [];
  for (const path of recentDirectories) {
    try {
      const result = await validator(path);
      if (result.valid && result.isDirectory) {
        validatedPaths.push(path);
      }
    } catch {
      // Silently skip paths that fail validation
    }
  }
  return validatedPaths;
}
