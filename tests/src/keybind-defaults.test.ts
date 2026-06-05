import {
  DEFAULT_DUPLICATE_SETTINGS,
  DEFAULT_FEATURES,
  DEFAULT_KEYBINDS,
  migrateSettings,
  pruneRecentDirectories,
} from '../../src/keybind-defaults';

describe('migrateSettings', () => {
  test('keeps legacy string shortcuts usable by converting them to keybind objects', () => {
    const migrated = migrateSettings({
      keyKeep: 'K',
      keyDelete: '',
    });

    expect(migrated.keyKeep).toEqual({ key: 'k', ctrl: false, shift: false, alt: false });
    expect(migrated.keyDelete).toEqual({ key: 'k', ctrl: false, shift: false, alt: false });
  });

  test('restores the default help shortcut when legacy modifiers would make it unreachable', () => {
    const migrated = migrateSettings({
      keyShowHelp: { key: '?', ctrl: false, shift: false, alt: false },
    });

    expect(migrated.keyShowHelp).toEqual(DEFAULT_KEYBINDS.keyShowHelp);
  });

  test('falls back to safe defaults for malformed feature and cache settings', () => {
    const migrated = migrateSettings({
      features: { ratings: false, analytics: 'yes' },
      cacheLocation: 'unknown',
      centralCachePath: 123,
      perDriveCachePaths: [],
      recentDirectoryTimestamps: [],
      autoUpdates: null,
      globalMute: 'no',
      hardwareAccel: undefined,
    });

    expect(migrated.features).toEqual({
      ...DEFAULT_FEATURES,
      ratings: false,
    });
    expect(migrated.cacheLocation).toBe('centralised');
    expect(migrated.centralCachePath).toBeNull();
    expect(migrated.perDriveCachePaths).toEqual({});
    expect(migrated.recentDirectoryTimestamps).toEqual({});
    expect(migrated.autoUpdates).toBe(true);
    expect(migrated.globalMute).toBe(false);
    expect(migrated.hardwareAccel).toBe(false);
  });

  test('normalizes invalid duplicate-detection settings back to supported values', () => {
    const migrated = migrateSettings({
      duplicates: {
        comparisonMode: 'broken',
        sampleCount: 6,
        keeperOrder: ['fps', 'invalid-rule'],
        ignoredDuplicatePairs: ['ABCDEFABCDEFABCD|0011223344556677', 'bad', 'abcdefabcdefabcd|0011223344556677'],
      },
    });

    expect(migrated.duplicates).toMatchObject({
      ...DEFAULT_DUPLICATE_SETTINGS,
      comparisonMode: DEFAULT_DUPLICATE_SETTINGS.comparisonMode,
      sampleCount: DEFAULT_DUPLICATE_SETTINGS.sampleCount,
      keeperOrder: ['fps', 'resolution', 'videoBitrate', 'duration', 'size'],
      ignoredDuplicatePairs: ['abcdefabcdefabcd|0011223344556677'],
    });
  });

  test('drops legacy duplicate and app-mode fields that no longer belong in settings', () => {
    const migrated = migrateSettings({
      duplicates: {
        phashCandidateThreshold: 80,
        rawGrayThreshold: 90,
        profile: 'legacy',
        durationToleranceMinSecs: 2,
        durationToleranceMaxSecs: 10,
      },
      appMode: 'legacy',
      hasSeenAppModeIntro: true,
      keyToggleAppMode: { key: 'm', ctrl: false, shift: false, alt: false },
    });

    expect('phashCandidateThreshold' in (migrated.duplicates ?? {})).toBe(false);
    expect('rawGrayThreshold' in (migrated.duplicates ?? {})).toBe(false);
    expect('profile' in (migrated.duplicates ?? {})).toBe(false);
    expect('durationToleranceMinSecs' in (migrated.duplicates ?? {})).toBe(false);
    expect('durationToleranceMaxSecs' in (migrated.duplicates ?? {})).toBe(false);
    expect('appMode' in migrated).toBe(false);
    expect('hasSeenAppModeIntro' in migrated).toBe(false);
    expect('keyToggleAppMode' in migrated).toBe(false);
  });
});

describe('pruneRecentDirectories', () => {
  const validator = vi.fn(async (path: string) => {
    if (path === 'throw') throw new Error('boom');
    return {
      valid: path !== 'missing',
      isDirectory: path === 'folder-a' || path === 'folder-b',
    };
  });

  test('returns an empty list when there are no recent directories to validate', async () => {
    await expect(pruneRecentDirectories([], validator)).resolves.toEqual([]);
  });

  test('keeps only directories that still validate successfully', async () => {
    await expect(pruneRecentDirectories(['folder-a', 'missing', 'folder-b'], validator)).resolves.toEqual([
      'folder-a',
      'folder-b',
    ]);
  });

  test('ignores validator failures instead of aborting the entire cleanup', async () => {
    await expect(pruneRecentDirectories(['folder-a', 'throw', 'folder-b'], validator)).resolves.toEqual([
      'folder-a',
      'folder-b',
    ]);
  });
});
