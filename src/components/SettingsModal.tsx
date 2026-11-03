import React, { useState, useEffect } from 'react';
import useStore from '../store';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X, RotateCcw, RefreshCw, FileDown, Database, Code2, ExternalLink, HeartHandshake, FolderOpen, Copy, Trash2, FileText } from 'lucide-react';
import type { AppSettings, CacheLocationInfo, DistributionInfo, LegacyInstallStatus, LegalFileName, ToastInput, UpdateInfo } from '../types';
import { ALL_SHORTCUTS, findConflict, type KeybindSettingKey, type ShortcutGroup } from '../keybinds';
import { DEFAULT_DUPLICATE_SETTINGS, DEFAULT_KEYBINDS, OPTIONAL_FEATURE_KEYS } from '../keybind-defaults';
import type { Keybind } from '../keybinds';
import { isWindows as isWindowsPlatform, modKeyName } from '../utils';
import KeybindInput from './KeybindInput';
import { PRODUCT } from '../product';
import { SettingRow, SwitchRow } from './SettingRow';
import './Dialog.css';
import './SettingsModal.css';

const KEYBIND_GROUPS: ShortcutGroup[] = ['Review mode', 'Global'];

export type SettingsTab = 'general' | 'view' | 'library' | 'duplicates' | 'processing' | 'shortcuts' | 'updates' | 'about';

const SETTINGS_TABS: ReadonlyArray<{ id: Exclude<SettingsTab, 'updates' | 'about'>; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'view', label: 'Grid & review' },
  { id: 'library', label: 'Library & cache' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'processing', label: 'Processing' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
];

const ABOUT_LINKS = {
  repo: PRODUCT.repository.url,
  releases: `${PRODUCT.repository.url}/releases`,
  support: `${PRODUCT.website}/support/`,
  sponsors: `https://github.com/sponsors/${PRODUCT.publisher}`,
  paypal: 'https://paypal.me/stippiedot',
} as const;

// Must match the source-code URL main allows in open-external-url (legal-files.js).
const sourceCodeUrl = (version: string) => `${PRODUCT.repository.url}/tree/v${version}`;

const FEATURE_TOGGLES = [
  { key: 'ratings', label: '5-star rating', description: 'Rating controls on video cards and in Review.' },
  { key: 'favorites', label: 'Favorites', description: 'A heart toggle on each video and a favorites filter.' },
] as const satisfies ReadonlyArray<{
  key: typeof OPTIONAL_FEATURE_KEYS[number];
  label: string;
  description: string;
}>;

const KEEPER_RULE_LABELS: Record<string, { title: string; description: string }> = {
  resolution: { title: 'Resolution', description: 'Prefer the highest displayed resolution.' },
  videoBitrate: { title: 'Video bitrate', description: 'Prefer the cleaner encode.' },
  duration: { title: 'Duration', description: 'Prefer the longest version.' },
  fps: { title: 'FPS', description: 'Prefer smoother playback.' },
  size: { title: 'File size', description: 'Prefer the largest file.' },
  codec: { title: 'Codec', description: 'Prefer the codec ranked higher in the codec preference.' },
};

const CODEC_FAMILY_INFO: Record<string, { title: string; description: string }> = {
  av1: { title: 'AV1', description: 'Newest and most efficient' },
  hevc: { title: 'H.265 / HEVC', description: 'Efficient, widely used for 4K' },
  vp9: { title: 'VP9', description: 'Efficient, common for web video' },
  h264: { title: 'H.264 / AVC', description: 'Most compatible' },
  vp8: { title: 'VP8', description: 'Older web video' },
  mpeg4: { title: 'MPEG-4 (Xvid, DivX)', description: 'Common in older AVI files' },
  mpeg2video: { title: 'MPEG-2', description: 'DVDs and broadcast recordings' },
  vc1: { title: 'WMV / VC-1', description: 'Windows Media video' },
};

type SaveChangeSummary = {
  hasNextRunChanges: boolean;
  hasRestartRequiredChanges: boolean;
};

interface SettingsModalProps {
  initialTab?: SettingsTab;
  tabRequestId?: number;
}

export default function SettingsModal({ initialTab = 'general', tabRequestId = 0 }: SettingsModalProps) {
  const isWindows = isWindowsPlatform();
  const isOpen = useStore((s) => s.isSettingsModalOpen);
  const close = () => useStore.getState().setIsSettingsModalOpen(false);
  const globalSettings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const saveSettings = useStore((s) => s.saveSettings);
  const pushToast = useStore((s) => s.pushToast);
  const directory = useStore((s) => s.directory);
  const directories = useStore((s) => s.directories);
  const videos = useStore((s) => s.videos);
  const filteredVideos = useStore((s) => s.filteredVideos);
  const isScanning = useStore((s) => s.isScanning);

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [localSettings, setLocalSettings] = useState<AppSettings>(globalSettings);
  const [appVersion, setAppVersion] = useState<string>('');
  // Collapsed by default: most people never change the codec preference.
  const [codecListOpen, setCodecListOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ status: 'idle' });
  const [exportMessage, setExportMessage] = useState<string>('');
  const [cacheMessage, setCacheMessage] = useState<string>('');
  const [autoConcurrency, setAutoConcurrency] = useState<number | null>(null);
  const [distributionInfo, setDistributionInfo] = useState<DistributionInfo | null>(null);
  const [cacheLocationInfo, setCacheLocationInfo] = useState<CacheLocationInfo | null>(null);
  const [legacyInstall, setLegacyInstall] = useState<LegacyInstallStatus | null>(null);
  const appVersionLabel = __APP_VERSION__ || appVersion || '...';

  const openExternal = (url: string) => {
    void window.electronAPI?.openExternalUrl(url).catch((err) => {
      console.warn('[settings] Failed to open external URL:', err);
    });
  };

  const openLegalFile = (name: LegalFileName) => {
    void window.electronAPI?.openLegalFile(name).then((opened) => {
      if (!opened) console.warn(`[settings] Bundled ${name} file is not available.`);
    }).catch((err) => {
      console.warn('[settings] Failed to open bundled legal file:', err);
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    setLocalSettings(useStore.getState().settings);
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(setAppVersion);
    }
    setExportMessage('');
    setCacheMessage('');
    void window.electronAPI?.getDistributionInfo?.().then(setDistributionInfo).catch(() => setDistributionInfo(null));
    void window.electronAPI?.getCacheLocationInfo?.().then(setCacheLocationInfo).catch(() => setCacheLocationInfo(null));
    void window.electronAPI?.getLegacyInstallStatus?.().then(setLegacyInstall).catch(() => setLegacyInstall(null));
  }, [isOpen, globalSettings]);

  useEffect(() => {
    if (!isOpen || !window.electronAPI?.getAutoConcurrency) return;
    window.electronAPI.getAutoConcurrency(localSettings).then(setAutoConcurrency).catch(() => setAutoConcurrency(null));
  }, [isOpen, localSettings]);

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab, tabRequestId]);

  useEffect(() => {
    if (activeTab !== 'general') {
      setExportMessage('');
    }
  }, [activeTab]);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const unsub = window.electronAPI.onUpdateStatus((info) => setUpdateInfo(info));
    return unsub;
  }, []);

  if (!isOpen) return null;

  const ignoredDuplicatePairCount = localSettings.duplicates.ignoredDuplicatePairs?.length ?? 0;

  const handleChange = (key: keyof AppSettings, val: unknown) => {
    setLocalSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleFeatureChange = (key: keyof AppSettings['features'], val: boolean) => {
    setLocalSettings((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        [key]: val,
      },
    }));
  };

  const handleDuplicateChange = (key: keyof AppSettings['duplicates'], val: unknown) => {
    setLocalSettings((prev) => ({
      ...prev,
      duplicates: {
        ...prev.duplicates,
        [key]: val,
      },
    }));
  };

  // Visual scores run higher for unrelated footage than pHash scores, so it needs the earlier warning.
  const isLowSimilarity = (mode: AppSettings['duplicates']['comparisonMode'], value: number) => (
    mode === 'visual' ? value <= 90 : value < 80
  );

  const renderSimilarityInput = (
    key: 'finalSimilarityThreshold' | 'phashSimilarityThreshold' | 'visualSimilarityThreshold',
    mode: AppSettings['duplicates']['comparisonMode'],
    label?: string,
  ) => {
    const value = localSettings.duplicates[key];
    const low = isLowSimilarity(mode, value);
    return (
      <input
        type="number"
        min="0"
        max="100"
        value={value}
        aria-label={label}
        aria-describedby={low ? 'duplicate-similarity-warning' : undefined}
        onChange={(e) => handleDuplicateChange(key, Number(e.target.value))}
        className={low ? 'number-input is-low' : 'number-input'}
      />
    );
  };

  const similarityWarning = (() => {
    const d = localSettings.duplicates;
    const checks: Array<[AppSettings['duplicates']['comparisonMode'], number]> = d.separateSimilarityThresholds
      ? [['phash', d.phashSimilarityThreshold], ['visual', d.visualSimilarityThreshold]]
      : [[d.comparisonMode, d.finalSimilarityThreshold]];
    const parts = checks
      .filter(([mode, value]) => isLowSimilarity(mode, value))
      .map(([mode]) => (mode === 'visual' ? 'visual at 90% or lower' : 'pHash below 80%'));
    return parts.length > 0 ? `Unrelated videos start to match with ${parts.join(' and ')}.` : null;
  })();

  // One select over two stored flags: first-sample-only (pHash) wins over every-sample.
  const sampleScoring = localSettings.duplicates.phashFirstSampleOnly
    ? 'first'
    : localSettings.duplicates.requireEverySample ? 'weakest' : 'average';

  const handleSampleScoringChange = (value: string) => {
    setLocalSettings((prev) => ({
      ...prev,
      duplicates: {
        ...prev.duplicates,
        requireEverySample: value === 'weakest',
        phashFirstSampleOnly: value === 'first',
      },
    }));
  };

  const moveInOrder = (field: 'keeperOrder' | 'codecOrder', index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    const currentOrder = localSettings.duplicates[field];
    if (nextIndex < 0 || nextIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    handleDuplicateChange(field, nextOrder);
  };

  // Bitrate and file size nearly always differ between copies, so a Codec rule below them almost never decides.
  const rulesAboveCodec = localSettings.duplicates.keeperOrder.slice(0, localSettings.duplicates.keeperOrder.indexOf('codec'));
  const codecOutranked = rulesAboveCodec.some((rule) => rule === 'videoBitrate' || rule === 'size');

  const moveCodecAboveBitrateAndSize = () => {
    const rest = localSettings.duplicates.keeperOrder.filter((rule) => rule !== 'codec');
    const target = rest.findIndex((rule) => rule === 'videoBitrate' || rule === 'size');
    handleDuplicateChange('keeperOrder', [...rest.slice(0, target), 'codec', ...rest.slice(target)]);
  };

  const resetKeeperOrder = () => {
    handleDuplicateChange('keeperOrder', [...DEFAULT_DUPLICATE_SETTINGS.keeperOrder]);
    handleDuplicateChange('codecOrder', [...DEFAULT_DUPLICATE_SETTINGS.codecOrder]);
  };

  const handleCacheLocationChange = async (val: string) => {
    if (val === 'distributed') {
      const confirmed = await window.electronAPI.confirmDistributedMode();
      if (!confirmed) return;
    }
    handleChange('cacheLocation', val);
  };

  const handleKeybind = (id: KeybindSettingKey, bind: Keybind) => {
    setLocalSettings((prev) => ({ ...prev, [id]: bind }));
  };

  const resetKeybinds = () => {
    setLocalSettings((prev) => ({ ...prev, ...DEFAULT_KEYBINDS }));
  };

  const countKeybindConflicts = (settings: AppSettings) => {
    const binds = Object.fromEntries(
      ALL_SHORTCUTS.map((s) => [s.id, (settings[s.id] ?? DEFAULT_KEYBINDS[s.id]) as Keybind])
    ) as Record<KeybindSettingKey, Keybind>;
    return ALL_SHORTCUTS.filter((shortcut) => (
      Boolean(findConflict(shortcut.id, binds[shortcut.id], binds))
    )).length;
  };

  const cacheSettingsChanged = (a: AppSettings, b: AppSettings) => (
    a.cacheLocation !== b.cacheLocation ||
    (a.centralCachePath || null) !== (b.centralCachePath || null) ||
    JSON.stringify(a.perDriveCachePaths || {}) !== JSON.stringify(b.perDriveCachePaths || {})
  );

  const summarizeSaveChanges = (before: AppSettings, after: AppSettings): SaveChangeSummary => {
    const hasProcessingChanges =
      before.thumbsPerVideo !== after.thumbsPerVideo ||
      before.skipIntroDelaySecs !== after.skipIntroDelaySecs ||
      before.maxConcurrent !== after.maxConcurrent ||
      before.cpuThreadsLimited !== after.cpuThreadsLimited ||
      before.hardwareAccel !== after.hardwareAccel;

    const hasDuplicateRunChanges =
      JSON.stringify(before.duplicates) !== JSON.stringify(after.duplicates);

    const hasCacheChanges = cacheSettingsChanged(before, after);
    const hasCacheMaintenanceChanges =
      before.autoPruneMissingSubfolderCache !== after.autoPruneMissingSubfolderCache ||
      before.removeEmptyFoldersAfterDelete !== after.removeEmptyFoldersAfterDelete ||
      before.followLinks !== after.followLinks;
    const hasRestartRequiredChanges = before.autoUpdates !== after.autoUpdates;

    return {
      hasNextRunChanges: hasProcessingChanges || hasDuplicateRunChanges || hasCacheChanges || hasCacheMaintenanceChanges,
      hasRestartRequiredChanges,
    };
  };

  const handleSave = async () => {
    if (countKeybindConflicts(localSettings) > 0) {
      pushToast({
        title: 'Shortcut conflict',
        detail: 'Fix shortcut conflicts before saving preferences.',
        kind: 'warning',
      });
      return;
    }
    let cacheToast: ToastInput | null = null;
    const changeSummary = summarizeSaveChanges(globalSettings, localSettings);
    const thumbnailVideoCount = videos.filter((video) => (video.thumbnails?.length ?? 0) > 0).length;
    if (
      localSettings.thumbsPerVideo > globalSettings.thumbsPerVideo &&
      thumbnailVideoCount > 0 &&
      window.electronAPI?.confirmThumbnailRebuild
    ) {
      const confirmed = await window.electronAPI.confirmThumbnailRebuild(
        globalSettings.thumbsPerVideo,
        localSettings.thumbsPerVideo,
        thumbnailVideoCount
      );
      if (!confirmed) return;
    }
    if (window.electronAPI?.migrateCacheSettings && cacheSettingsChanged(globalSettings, localSettings)) {
      setCacheMessage('Preparing cache migration...');
      const result = await window.electronAPI.migrateCacheSettings(globalSettings, localSettings, directories);
      if (result.status === 'cancelled') {
        setCacheMessage('Cache storage change cancelled.');
        pushToast({
          title: 'Cache migration cancelled',
          detail: 'Preferences were not saved.',
          kind: 'info',
        });
        return;
      }
      if (result.status === 'error') {
        setCacheMessage(result.errors[0] || 'Cache migration failed.');
        pushToast({
          title: 'Cache migration failed',
          detail: (result.errors[0] || 'No cache files were moved.').slice(0, 120),
          kind: 'error',
        });
        return;
      }
      if (result.status === 'partial') {
        setCacheMessage(`Cache migration partially completed. ${result.errors.length} item(s) need attention.`);
        pushToast({
          title: 'Cache migration partial',
          detail: `${result.migrated} moved, ${result.errors.length} ${result.errors.length === 1 ? 'issue' : 'issues'} left.`,
          kind: 'warning',
        });
        return;
      } else if (result.status === 'migrated') {
        cacheToast = {
          title: 'Cache migrated',
          detail: `${result.migrated} ${result.migrated === 1 ? 'cache folder' : 'cache folders'} moved.`,
          kind: 'success',
        };
      } else if (result.status === 'fresh') {
        cacheToast = {
          title: 'Cache reset',
          detail: 'New cache location will start fresh.',
          kind: 'warning',
        };
      } else if (result.status === 'no-cache') {
        cacheToast = {
          title: 'Cache location saved',
          detail: 'No existing cache needed migration.',
          kind: 'success',
        };
      }
    }
    try {
      updateSettings(localSettings);
      await saveSettings();
      close();
      if (cacheToast) pushToast(cacheToast);
      const detail = changeSummary.hasRestartRequiredChanges
        ? (changeSummary.hasNextRunChanges
          ? 'Visible changes are active now. Scan, processing, and duplicate changes apply on their next run. Restart the app for automatic update checks.'
          : 'Changed settings are active now. Restart the app for automatic update checks.')
        : (changeSummary.hasNextRunChanges
          ? 'Visible changes are active now. Scan, processing, and duplicate changes apply on their next run.'
          : 'Changed settings are active now.');
      pushToast({
        title: 'Preferences saved',
        detail,
        kind: 'success',
        dedupeKey: 'preferences-saved',
      });
    } catch (err) {
      console.error('Failed to save preferences:', err);
      pushToast({
        title: 'Preferences not saved',
        detail: 'Settings could not be written to disk.',
        kind: 'error',
      });
    }
  };

  const handleExportReport = async () => {
    if (!window.electronAPI || !directory || videos.length === 0 || isScanning) return;

    const scope = await window.electronAPI.chooseReportScope();
    if (!scope) {
      setExportMessage('Export cancelled.');
      return;
    }

    const payload = scope === 'filtered' ? filteredVideos : videos;
    if (payload.length === 0) {
      setExportMessage(scope === 'filtered' ? 'No videos match the current filters.' : 'No videos available to export.');
      return;
    }

    const result = await window.electronAPI.exportReport(payload, directories.length > 0 ? directories : [directory]);
    if (result === 'saved') {
      setExportMessage(`Exported ${scope} report (${payload.length} videos).`);
    } else if (result === 'cancelled') {
      setExportMessage('Export cancelled.');
    } else {
      setExportMessage('Export failed.');
    }
  };

  const currentBinds = Object.fromEntries(
    ALL_SHORTCUTS.map((s) => [s.id, (localSettings[s.id] ?? DEFAULT_KEYBINDS[s.id]) as Keybind])
  ) as Record<KeybindSettingKey, Keybind>;
  const keybindConflictCount = countKeybindConflicts(localSettings);

  const currentDriveKey = directory
    ? directory.match(/^[a-zA-Z]:/)?.[0].toUpperCase()
    : null;

  const handleChooseCacheFolder = async (setting: 'centralCachePath' | 'perDriveCachePaths') => {
    const dir = await window.electronAPI?.selectDirectory();
    if (!dir) return;
    const result = await window.electronAPI?.validateCacheLocation(
      dir,
      setting === 'perDriveCachePaths' ? currentDriveKey : null
    );
    if (!result?.ok) {
      setCacheMessage(result?.error ? `Cannot use that folder: ${result.error}` : 'Cannot write to that folder.');
      return;
    }
    if (setting === 'centralCachePath') {
      handleChange('centralCachePath', dir);
      setCacheMessage(`Selected ${dir}. Save Preferences to apply it.`);
      return;
    }
    if (!currentDriveKey) {
      setCacheMessage('Open a folder first so VideoCull knows which drive to configure.');
      return;
    }
    handleChange('perDriveCachePaths', {
      ...localSettings.perDriveCachePaths,
      [currentDriveKey]: dir,
    });
    setCacheMessage('');
  };

  const handleOpenCache = async (cachePath: string) => {
    const opened = await window.electronAPI?.openCacheFolder?.(cachePath);
    setCacheMessage(opened ? 'Opened cache folder.' : 'That cache folder is currently unavailable.');
  };

  const handleCopyCachePath = async (cachePath: string) => {
    const copied = await window.electronAPI?.copyCachePath?.(cachePath);
    setCacheMessage(copied ? 'Cache path copied.' : 'Cache path could not be copied.');
  };

  const handleUseDefaultCentralCache = () => {
    handleChange('centralCachePath', null);
    setCacheMessage('Default cache location selected. Save Preferences to apply it.');
  };

  const activeCacheLocations = cacheLocationInfo?.mode === localSettings.cacheLocation
    ? cacheLocationInfo.locations
    : [];

  const cacheLocationDescription = (item: CacheLocationInfo['locations'][number]) => {
    const description = item.ownership === 'package'
      ? 'Managed by Microsoft Store and removed when the app is reset or uninstalled'
      : item.ownership === 'external'
        ? 'User-selected folder; kept when VideoCull is uninstalled'
        : 'Managed in the VideoCull application profile';
    return item.available ? description : `${description} · Currently unavailable`;
  };

  return (
    <div className="dialog-overlay settings-overlay">
      <div className="dialog-window settings-window">
        <div className="dialog-header">
          <h2>Preferences</h2>
          <button className="dialog-close-btn" onClick={close} title="Close without saving">
            <X size={20} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-sidebar">
            {SETTINGS_TABS.map((tab) => (
              <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
            ))}
            <button className={`tab-btn ${activeTab === 'updates' ? 'active' : ''}`} onClick={() => setActiveTab('updates')}>
              Updates
              {(updateInfo.status === 'ready' || updateInfo.status === 'scheduled' || updateInfo.status === 'deferred') && <span className="update-dot" />}
            </button>
            <button className={`tab-btn ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>About</button>
          </div>

          <div className="settings-content">

            {activeTab === 'general' && (
              <div className="settings-form">
                <section className="settings-subsection">
                  <h3 className="settings-subsection-title">Appearance</h3>
                  <div className="settings-card">
                    <SettingRow label="Theme">
                      {(id) => (
                        <select id={id} value={localSettings.theme} onChange={(e) => handleChange('theme', e.target.value)}>
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                        </select>
                      )}
                    </SettingRow>
                    {window.electronAPI?.micaSupported && (
                      <SwitchRow
                        label="Tint the title bar with the desktop background"
                        help="Lets the desktop background show through the title bar, as in Windows 11's own apps."
                        checked={localSettings.micaTitleBar}
                        onChange={(checked) => handleChange('micaTitleBar', checked)}
                      />
                    )}
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">Startup</h3>
                  <div className="settings-card">
                    <SwitchRow
                      label="Reopen the last session at startup"
                      help="Opens the folders that were loaded when VideoCull closed, unless you ended the session with Close Session."
                      checked={localSettings.reopenLastSession}
                      onChange={(checked) => handleChange('reopenLastSession', checked)}
                    />
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">Export</h3>
                  <div className="settings-card">
                    <SettingRow
                      label="Export report"
                      help="Saves an HTML report of all loaded videos or only the filtered ones."
                      details={exportMessage && <span className="help-text">{exportMessage}</span>}
                    >
                      {(id) => (
                        <button
                          id={id}
                          className="btn-check-updates"
                          onClick={handleExportReport}
                          disabled={!directory || videos.length === 0 || isScanning}
                        >
                          <FileDown size={14} />
                          Export Report...
                        </button>
                      )}
                    </SettingRow>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'view' && (
              <div className="settings-form">
                <section className="settings-subsection">
                  <h3 className="settings-subsection-title">Grid defaults</h3>
                  <div className="settings-card settings-card-grid">
                    <SettingRow label="Default card scale">
                      {(id) => (
                        <div className="flex-row">
                          <input id={id} type="range" min="0.5" max="2.0" step="0.1" value={localSettings.defaultCardScale} onChange={(e) => handleChange('defaultCardScale', Number(e.target.value))} />
                          <span className="settings-range-value">{localSettings.defaultCardScale.toFixed(1)}x</span>
                        </div>
                      )}
                    </SettingRow>
                    <SettingRow label="Default sorting">
                      {(id) => (
                        <div className="flex-row">
                          <select id={id} value={localSettings.defaultSortBy} onChange={(e) => handleChange('defaultSortBy', e.target.value)}>
                            <option value="name">Name</option>
                            <option value="size">Size</option>
                            <option value="date">Date</option>
                            <option value="duration">Duration</option>
                            {localSettings.features.ratings && <option value="rating">Rating</option>}
                            {localSettings.features.codecBadges && <option value="resolution">Resolution</option>}
                            {localSettings.features.codecBadges && <option value="fps">FPS</option>}
                          </select>
                          <select aria-label="Sort order" value={localSettings.defaultSortOrder} onChange={(e) => handleChange('defaultSortOrder', e.target.value)}>
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                          </select>
                        </div>
                      )}
                    </SettingRow>
                    <SwitchRow
                      wide
                      label="Group videos by folder"
                      checked={localSettings.defaultGroupByFolder}
                      onChange={(checked) => handleChange('defaultGroupByFolder', checked)}
                    />
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">Review mode</h3>
                  <div className="settings-card">
                    <SwitchRow
                      label="Keep playback controls visible in Review"
                      help="Stops the timeline and playback controls from hiding while a video plays."
                      checked={localSettings.keepReviewControlsVisible}
                      onChange={(checked) => handleChange('keepReviewControlsVisible', checked)}
                    />
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">Optional features</h3>
                  <div className="settings-card">
                    {FEATURE_TOGGLES.map((feature) => (
                      <SwitchRow
                        key={feature.key}
                        label={feature.label}
                        help={feature.description}
                        checked={localSettings.features[feature.key]}
                        onChange={(checked) => handleFeatureChange(feature.key, checked)}
                      />
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'duplicates' && (
              <div className="settings-form duplicates-settings">
                <div className="form-group">
                  <span className="help-text">Matching changes apply to the next duplicate run. Protection and keeper priority update the current results right away.</span>
                </div>
                <div className="settings-card">
                  <SwitchRow
                    label="Enable duplicate detection"
                    checked={localSettings.duplicates.enabled}
                    onChange={(checked) => handleDuplicateChange('enabled', checked)}
                  />
                </div>

                {localSettings.duplicates.enabled && (
                  <>
                    <div className="duplicates-section settings-section-divider">
                      <h3 className="settings-subsection-title">Matching</h3>
                      <div className="settings-card settings-card-grid">
                        <SwitchRow
                          label="Run after each scan"
                          checked={localSettings.duplicates.runAfterScan}
                          onChange={(checked) => handleDuplicateChange('runAfterScan', checked)}
                        />
                        <SettingRow label="Default scope">
                          {(id) => (
                            <select id={id} value={localSettings.duplicates.defaultScope} onChange={(e) => handleDuplicateChange('defaultScope', e.target.value)}>
                              <option value="all">All loaded videos</option>
                              <option value="filtered">Current filtered view</option>
                            </select>
                          )}
                        </SettingRow>
                        <SettingRow
                          wide
                          label="Comparison method"
                          help="pHash is strict and rarely matches the wrong videos. Visual similarity is broader and also finds copies pHash misses."
                        >
                          {(id) => (
                            <select id={id} value={localSettings.duplicates.comparisonMode} onChange={(e) => handleDuplicateChange('comparisonMode', e.target.value)}>
                              <option value="phash">pHash</option>
                              <option value="visual">Visual similarity</option>
                            </select>
                          )}
                        </SettingRow>
                        <SettingRow
                          label="Similarity"
                          help="The lowest score two videos need to count as a match."
                          details={similarityWarning && (
                            <span className="help-text duplicates-similarity-warning" id="duplicate-similarity-warning">{similarityWarning}</span>
                          )}
                        >
                          {() => (
                            <>
                              {localSettings.duplicates.separateSimilarityThresholds ? (
                                <div className="duplicates-similarity-pair">
                                  <span>pHash</span>
                                  {renderSimilarityInput('phashSimilarityThreshold', 'phash', 'pHash similarity')}
                                  <span>%</span>
                                  <span>Visual</span>
                                  {renderSimilarityInput('visualSimilarityThreshold', 'visual', 'Visual similarity')}
                                  <span>%</span>
                                </div>
                              ) : (
                                <div className="flex-row duplicates-inline-value">
                                  {renderSimilarityInput('finalSimilarityThreshold', localSettings.duplicates.comparisonMode, 'Similarity')}
                                  <span>%</span>
                                </div>
                              )}
                              <label className="settings-inline-check">
                                <input type="checkbox" checked={localSettings.duplicates.separateSimilarityThresholds} onChange={(e) => handleDuplicateChange('separateSimilarityThresholds', e.target.checked)} />
                                Separate value per method
                              </label>
                            </>
                          )}
                        </SettingRow>
                        <SettingRow
                          label="Samples"
                          help={<>
                            {sampleScoring === 'weakest' && 'Strictest: a match is scored by its weakest sample.'}
                            {sampleScoring === 'average' && 'One differing frame, such as a trimmed intro, does not hide a match.'}
                            {sampleScoring === 'first' && 'Finds the most pHash matches, with more false positives. Visual similarity uses the average.'}
                          </>}
                        >
                          {(id) => (
                            <>
                              <select id={id} value={localSettings.duplicates.sampleCount} onChange={(e) => handleDuplicateChange('sampleCount', Number(e.target.value))}>
                                <option value={1}>1 sample</option>
                                <option value={2}>2 samples</option>
                                <option value={3}>3 samples</option>
                                <option value={4}>4 samples</option>
                                <option value={5}>5 samples</option>
                                <option value={7}>7 samples</option>
                                <option value={9}>9 samples</option>
                              </select>
                              <select
                                aria-label="Sample scoring"
                                value={sampleScoring}
                                disabled={localSettings.duplicates.sampleCount === 1}
                                onChange={(e) => handleSampleScoringChange(e.target.value)}
                              >
                                <option value="average">Average score</option>
                                <option value="weakest">Weakest sample</option>
                                <option value="first">First sample (pHash)</option>
                              </select>
                            </>
                          )}
                        </SettingRow>
                        <SwitchRow
                          label="Protect marked keep videos"
                          help="Videos marked Keep are never suggested for deletion."
                          checked={localSettings.duplicates.protectKeep}
                          onChange={(checked) => handleDuplicateChange('protectKeep', checked)}
                        />
                        <SwitchRow
                          label="Protect skipped videos"
                          help="Skipped videos are never suggested for deletion."
                          checked={localSettings.duplicates.protectSkipped}
                          onChange={(checked) => handleDuplicateChange('protectSkipped', checked)}
                        />
                      </div>
                      <div className="duplicates-keeper-order">
                        <div className="duplicates-keeper-heading">
                          <div>
                            <h4>Suggested keeper priority</h4>
                            <span className="help-text">Higher items decide first when choosing which duplicate to keep.</span>
                          </div>
                          <button type="button" className="duplicates-clear-btn" onClick={resetKeeperOrder}>
                            Reset
                          </button>
                        </div>
                        <div className="duplicates-keeper-list">
                          {localSettings.duplicates.keeperOrder.map((rule, index) => {
                            const label = KEEPER_RULE_LABELS[rule] ?? { title: rule, description: 'Custom rule.' };
                            return (
                              <div className="duplicates-keeper-item" key={rule}>
                                <div className="duplicates-keeper-row">
                                  <span className="duplicates-keeper-rank">{index + 1}</span>
                                  <span className="duplicates-keeper-copy">
                                    <strong>{label.title}</strong>
                                    <span>{label.description}</span>
                                  </span>
                                  <span className="duplicates-keeper-actions">
                                    <button type="button" onClick={() => moveInOrder('keeperOrder', index, -1)} disabled={index === 0} aria-label={`Move ${label.title} up`}>
                                      <ArrowUp size={14} />
                                    </button>
                                    <button type="button" onClick={() => moveInOrder('keeperOrder', index, 1)} disabled={index === localSettings.duplicates.keeperOrder.length - 1} aria-label={`Move ${label.title} down`}>
                                      <ArrowDown size={14} />
                                    </button>
                                  </span>
                                </div>
                                {rule === 'codec' && (
                                  <div className="duplicates-codec-panel">
                                    <button
                                      type="button"
                                      className="duplicates-codec-toggle"
                                      aria-expanded={codecListOpen}
                                      onClick={() => setCodecListOpen((open) => !open)}
                                    >
                                      {codecListOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                      Codec preference
                                    </button>
                                    {codecListOpen && (
                                      <>
                                        {codecOutranked && (
                                          <div className="duplicates-keeper-hint" role="note">
                                            <span>Video bitrate or File size is ranked above Codec and nearly always differs between copies, so Codec rarely decides.</span>
                                            <button type="button" className="duplicates-clear-btn" onClick={moveCodecAboveBitrateAndSize}>
                                              Move Codec above them
                                            </button>
                                          </div>
                                        )}
                                        <span className="help-text">
                                          Higher decides first. Videos with the same codec, or one not listed here, tie and the next rule decides.
                                        </span>
                                        <div className="duplicates-keeper-list">
                                          {localSettings.duplicates.codecOrder.map((family, codecIndex) => {
                                            const info = CODEC_FAMILY_INFO[family] ?? { title: family, description: '' };
                                            return (
                                              <div className="duplicates-keeper-row" key={family}>
                                                <span className="duplicates-keeper-rank">{codecIndex + 1}</span>
                                                <span className="duplicates-keeper-copy">
                                                  <strong>{info.title}</strong>
                                                  <span>{info.description}</span>
                                                </span>
                                                <span className="duplicates-keeper-actions">
                                                  <button type="button" onClick={() => moveInOrder('codecOrder', codecIndex, -1)} disabled={codecIndex === 0} aria-label={`Move ${info.title} up`}>
                                                    <ArrowUp size={14} />
                                                  </button>
                                                  <button type="button" onClick={() => moveInOrder('codecOrder', codecIndex, 1)} disabled={codecIndex === localSettings.duplicates.codecOrder.length - 1} aria-label={`Move ${info.title} down`}>
                                                    <ArrowDown size={14} />
                                                  </button>
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="duplicates-section settings-section-divider">
                      <h3 className="settings-subsection-title">Ignored matches</h3>
                      <div className="settings-card">
                        <SettingRow
                          label={`${ignoredDuplicatePairCount} ${ignoredDuplicatePairCount === 1 ? 'ignored pair' : 'ignored pairs'}`}
                          help="Pairs marked Not a match stay hidden in future duplicate runs."
                        >
                          {(id) => (
                            <button
                              id={id}
                              type="button"
                              className="duplicates-clear-btn"
                              disabled={ignoredDuplicatePairCount === 0}
                              onClick={() => handleDuplicateChange('ignoredDuplicatePairs', [])}
                            >
                              Clear ignored matches
                            </button>
                          )}
                        </SettingRow>
                      </div>
                    </div>

                    <div className="duplicates-section settings-section-divider">
                      <h3 className="settings-subsection-title">Advanced</h3>
                      <div className="settings-card settings-card-grid">
                        <SettingRow label="Sampling window" help="Which part of each video is sampled.">
                          {(id) => (
                            <select id={id} value={localSettings.duplicates.samplingWindow} onChange={(e) => handleDuplicateChange('samplingWindow', e.target.value)}>
                              <option value="even">Evenly spaced</option>
                              <option value="25-75">25-75% center</option>
                              <option value="20-80">20-80% center</option>
                              <option value="15-85">15-85% center</option>
                              <option value="custom">Custom window</option>
                            </select>
                          )}
                        </SettingRow>
                        <SettingRow label="Duration tolerance" help="How much two videos may differ in length and still be compared.">
                          {(id) => (
                            <div className="flex-row duplicates-inline-value">
                              <input id={id} type="number" min="0" max="100" value={localSettings.duplicates.durationTolerancePercent} onChange={(e) => handleDuplicateChange('durationTolerancePercent', Number(e.target.value))} className="number-input" />
                              <span>%</span>
                            </div>
                          )}
                        </SettingRow>
                        <SettingRow label="Max sampling duration" help="0 samples the whole video.">
                          {(id) => (
                            <div className="flex-row duplicates-inline-value">
                              <input id={id} type="number" min="0" max="86400" value={localSettings.duplicates.maxSamplingDuration} onChange={(e) => handleDuplicateChange('maxSamplingDuration', Number(e.target.value))} className="number-input" />
                              <span>seconds</span>
                            </div>
                          )}
                        </SettingRow>
                        <SettingRow label="Checkpoint interval" help="How often long runs save their progress.">
                          {(id) => (
                            <div className="flex-row duplicates-inline-value">
                              <input id={id} type="number" min="0" max="60" value={localSettings.duplicates.checkpointIntervalMinutes} onChange={(e) => handleDuplicateChange('checkpointIntervalMinutes', Number(e.target.value))} className="number-input" />
                              <span>minutes</span>
                            </div>
                          )}
                        </SettingRow>
                        {localSettings.duplicates.samplingWindow === 'custom' && (
                          <SettingRow wide label="Custom sampling window" help="Skips repeated intros, outros or watermarks.">
                            {(id) => (
                              <div className="flex-row duplicates-inline-value">
                                <input id={id} type="number" min="0" max="95" value={localSettings.duplicates.customStartPercent} onChange={(e) => handleDuplicateChange('customStartPercent', Number(e.target.value))} className="number-input" />
                                <span>% start</span>
                                <input aria-label="Custom sampling window end" type="number" min="5" max="100" value={localSettings.duplicates.customEndPercent} onChange={(e) => handleDuplicateChange('customEndPercent', Number(e.target.value))} className="number-input" />
                                <span>% end</span>
                              </div>
                            )}
                          </SettingRow>
                        )}
                        <SwitchRow
                          label="Ignore black pixels"
                          help="Helps with fades, black frames and letterboxing."
                          checked={localSettings.duplicates.ignoreBlackPixels}
                          onChange={(checked) => handleDuplicateChange('ignoreBlackPixels', checked)}
                        />
                        <SwitchRow
                          label="Ignore white pixels"
                          help="Helps with bright flashes and white frames."
                          checked={localSettings.duplicates.ignoreWhitePixels}
                          onChange={(checked) => handleDuplicateChange('ignoreWhitePixels', checked)}
                        />
                        <SwitchRow
                          label="Compare flipped videos"
                          help="Also matches mirrored copies."
                          checked={localSettings.duplicates.compareFlipped}
                          onChange={(checked) => handleDuplicateChange('compareFlipped', checked)}
                        />
                        <SwitchRow
                          label="Retry failed fingerprints"
                          help="Tries videos that failed before again."
                          checked={localSettings.duplicates.retryFailedFingerprintExtraction}
                          onChange={(checked) => handleDuplicateChange('retryFailedFingerprintExtraction', checked)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'library' && (
              <div className="settings-form">
                <section className="settings-subsection">
                  <h3 className="settings-subsection-title">Scanning</h3>
                  <div className="settings-card">
                    <SwitchRow
                      label={`Follow symbolic links${isWindows ? ' and junctions' : ''} (Experimental)`}
                      help={`Also scans folders and videos that ${isWindows ? 'links and junctions' : 'symbolic links'} point to, even outside the opened folder. Each video is listed once. Applies from the next scan.`}
                      checked={localSettings.followLinks}
                      onChange={(checked) => handleChange('followLinks', checked)}
                    />
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">Cache</h3>
                  <div className="settings-card">
                    <SettingRow
                      label="Cache storage"
                      help="Centralised keeps it in the app's data folder, Per-drive on the same drive as the videos, and Distributed in a hidden .videocull folder inside each loaded folder."
                    >
                      {(id) => (
                        <select id={id} value={localSettings.cacheLocation} onChange={(e) => void handleCacheLocationChange(e.target.value)}>
                          <option value="centralised">Centralised</option>
                          <option value="per-drive">Per-drive</option>
                          <option value="distributed">Distributed</option>
                        </select>
                      )}
                    </SettingRow>
                    {localSettings.cacheLocation === 'centralised' && (
                        <div className="form-group">
                          <label>Central Cache Location</label>
                          <div className="cache-location-panel">
                            {activeCacheLocations[0] ? (
                              <>
                                <div className="cache-location-details">
                                  <span className="cache-location-label">
                                    {globalSettings.centralCachePath ? 'Active custom folder' : 'Active default folder'}
                                  </span>
                                  <span className="cache-location-path" title={activeCacheLocations[0].path}>{activeCacheLocations[0].path}</span>
                                </div>
                                <div className="cache-location-actions">
                                  <button type="button" onClick={() => void handleOpenCache(activeCacheLocations[0].path)} disabled={!activeCacheLocations[0].available} title="Open cache folder"><FolderOpen size={14} /> Open</button>
                                  <button type="button" onClick={() => void handleCopyCachePath(activeCacheLocations[0].path)} title="Copy cache path"><Copy size={14} /> Copy path</button>
                                </div>
                              </>
                            ) : (
                              <span className="help-text">Save this cache mode to resolve its active folder.</span>
                            )}
                          </div>
                          {activeCacheLocations[0] && (
                            <span className="help-text">{cacheLocationDescription(activeCacheLocations[0])}</span>
                          )}
                          <div className="cache-location-controls">
                            <button className="btn-check-updates" type="button" onClick={() => void handleChooseCacheFolder('centralCachePath')}>
                              <Database size={14} />
                              Choose Folder
                            </button>
                            {localSettings.centralCachePath && (
                              <button className="btn-check-updates" type="button" onClick={handleUseDefaultCentralCache}>
                                <RotateCcw size={14} />
                                Use Default
                              </button>
                            )}
                          </div>
                        </div>
                      )}
  
                      {localSettings.cacheLocation === 'per-drive' && (
                        <div className="form-group">
                          <label>Per-drive Cache Locations</label>
                          {activeCacheLocations.length ? activeCacheLocations.map((item) => (
                            <div className="cache-location-panel" key={item.path}>
                              <div className="cache-location-details">
                                <span className="cache-location-label">{item.label}</span>
                                <span className="cache-location-path" title={item.path}>{item.path}</span>
                                <span className="help-text">{cacheLocationDescription(item)}</span>
                              </div>
                              <div className="cache-location-actions">
                                <button type="button" onClick={() => void handleOpenCache(item.path)} disabled={!item.available} title="Open cache folder"><FolderOpen size={14} /> Open</button>
                                <button type="button" onClick={() => void handleCopyCachePath(item.path)} title="Copy cache path"><Copy size={14} /> Copy path</button>
                              </div>
                            </div>
                          )) : (
                            <span className="help-text">Open a folder to resolve its drive cache.</span>
                          )}
                          <div className="cache-location-controls">
                            <button
                              className="btn-check-updates"
                              type="button"
                              onClick={() => void handleChooseCacheFolder('perDriveCachePaths')}
                              disabled={!currentDriveKey}
                            >
                              <Database size={14} />
                              Choose Folder
                            </button>
                          </div>
                          <span className="help-text">
                            {currentDriveKey
                              ? (localSettings.perDriveCachePaths[currentDriveKey] || `Using the default location for ${currentDriveKey}`)
                              : 'Open a folder to configure its drive.'}
                          </span>
                        </div>
                      )}
  
                      {localSettings.cacheLocation === 'distributed' && (
                        <div className="form-group">
                          <label>Distributed Cache Locations</label>
                          {activeCacheLocations.length ? activeCacheLocations.map((item) => (
                            <div className="cache-location-panel" key={item.path}>
                              <div className="cache-location-details">
                                <span className="cache-location-label">{item.label}</span>
                                <span className="cache-location-path" title={item.path}>{item.path}</span>
                                <span className="help-text">{cacheLocationDescription(item)}</span>
                              </div>
                              <div className="cache-location-actions">
                                <button type="button" onClick={() => void handleOpenCache(item.path)} disabled={!item.available} title="Open cache folder"><FolderOpen size={14} /> Open</button>
                                <button type="button" onClick={() => void handleCopyCachePath(item.path)} title="Copy cache path"><Copy size={14} /> Copy path</button>
                              </div>
                            </div>
                          )) : (
                            <span className="help-text">Open a folder to resolve its distributed cache.</span>
                          )}
                        </div>
                      )}
  
                      {cacheMessage && <span className="help-text cache-location-message">{cacheMessage}</span>}
                    <SwitchRow
                      label="Auto-clean stale cache after scans"
                      help="After each scan, removes cached data and thumbnails for files and folders that no longer exist."
                      checked={localSettings.autoPruneMissingSubfolderCache}
                      onChange={(checked) => handleChange('autoPruneMissingSubfolderCache', checked)}
                    />
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">After deleting</h3>
                  <div className="settings-card">
                    <SwitchRow
                      label="Remove empty source folders after delete"
                      help={`Removes folders a delete leaves empty. Folders outside the loaded folders, unavailable ones and ${isWindows ? 'links and junctions' : 'symbolic links'} are never removed.`}
                      checked={localSettings.removeEmptyFoldersAfterDelete}
                      onChange={(checked) => handleChange('removeEmptyFoldersAfterDelete', checked)}
                    />
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'processing' && (
              <div className="settings-form">
                <span className="help-text">Changes apply to the next run. Existing thumbnails stay until you rescan or regenerate them.</span>

                <section className="settings-subsection">
                  <h3 className="settings-subsection-title">Thumbnails</h3>
                  <div className="settings-card settings-card-grid">
                    <SettingRow
                      label="Thumbnails per video"
                      help="Raising this rebuilds the thumbnails of videos that need more frames. Lowering it keeps the extra frames, so raising it again reuses them."
                    >
                      {(id) => (
                        <select id={id} value={localSettings.thumbsPerVideo} onChange={(e) => handleChange('thumbsPerVideo', Number(e.target.value))}>
                          <option value={1}>1 Frame</option>
                          <option value={2}>2 Frames</option>
                          <option value={4}>4 Frames</option>
                          <option value={6}>6 Frames</option>
                          <option value={9}>9 Frames</option>
                        </select>
                      )}
                    </SettingRow>
                    <SettingRow
                      label="Skip intro blackframes (delay)"
                      help="Takes the first thumbnail later, to skip black fade-ins."
                    >
                      {(id) => (
                        <div className="flex-row">
                          <input id={id} type="number" min="0" max="60" value={localSettings.skipIntroDelaySecs} onChange={(e) => handleChange('skipIntroDelaySecs', Number(e.target.value))} className="number-input" />
                          <span>seconds</span>
                        </div>
                      )}
                    </SettingRow>
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">FFmpeg</h3>
                  <div className="settings-card">
                    <SettingRow
                      label="Parallel FFmpeg processes"
                      help={localSettings.maxConcurrent === 'auto' && autoConcurrency
                        ? `Auto runs up to ${autoConcurrency} at once on this PC.`
                        : 'How many FFmpeg processes run at once.'}
                    >
                      {(id) => (
                        <select
                          id={id}
                          value={localSettings.maxConcurrent === 'auto' ? 'auto' : localSettings.maxConcurrent}
                          onChange={(e) => handleChange('maxConcurrent', e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                        >
                          <option value="auto">
                            {autoConcurrency
                              ? `Auto (${autoConcurrency} process${autoConcurrency === 1 ? '' : 'es'}, CPU + RAM aware)`
                              : 'Auto (CPU + RAM aware)'}
                          </option>
                          <option value={1}>1 Process (Slower, stable)</option>
                          <option value={2}>2 Processes</option>
                          <option value={3}>3 Processes</option>
                          <option value={4}>4 Processes</option>
                          <option value={6}>6 Processes</option>
                          <option value={8}>8 Processes</option>
                          <option value={12}>12 Processes</option>
                          <option value={16}>16 Processes</option>
                          <option value={24}>24 Processes</option>
                          <option value={32}>32 Processes</option>
                        </select>
                      )}
                    </SettingRow>
                  </div>
                  <div className="settings-card settings-card-grid">
                    <SwitchRow
                      label="Limit each FFmpeg process to 1 CPU thread (Recommended)"
                      help="Runs more single-threaded processes instead of fewer multi-threaded ones, which is usually faster for thumbnails."
                      checked={localSettings.cpuThreadsLimited}
                      onChange={(checked) => handleChange('cpuThreadsLimited', checked)}
                    />
                    <SwitchRow
                      label="Enable Hardware Acceleration (Beta)"
                      help="Decodes with the GPU instead of the CPU. Can fail on older formats."
                      checked={localSettings.hardwareAccel}
                      onChange={(checked) => handleChange('hardwareAccel', checked)}
                    />
                  </div>
                </section>

                <section className="settings-subsection settings-section-divider">
                  <h3 className="settings-subsection-title">Power</h3>
                  <div className="settings-card">
                    <SwitchRow
                      label="Keep the PC awake while processing"
                      help="Stops the PC from going to sleep on its own while processing runs, so long runs finish unattended. The screen can still turn off, and choosing Sleep yourself still works."
                      checked={localSettings.keepAwakeWhileProcessing}
                      onChange={(checked) => handleChange('keepAwakeWhileProcessing', checked)}
                    />
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">When processing finishes</span>
                        <span className="help-text">To sleep or shut down after a long run, choose Actions &gt; When Processing Finishes or select the processing status in the title bar while processing runs. It applies to that run only.</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="settings-form">
                <div className="keybind-header-row">
                  <span className="help-text">Click a key to record a new shortcut. Escape cancels recording.</span>
                  <button className="btn-reset-keybinds" onClick={resetKeybinds} title="Reset all keybinds to defaults">
                    <RotateCcw size={13} />
                    Reset defaults
                  </button>
                </div>

                {KEYBIND_GROUPS.map((group) => {
                  const shortcuts = ALL_SHORTCUTS.filter((s) => s.group === group);
                  if (shortcuts.length === 0) return null;
                  const sections = [...new Set(shortcuts.map((s) => s.section))];
                  return (
                    <section key={group} className="settings-subsection">
                      <h3 className="settings-subsection-title">{group}</h3>
                      {sections.map((section) => (
                        <div key={section} className="keybind-group">
                          <h4 className="keybind-group-title">{section}</h4>
                          {shortcuts.filter((s) => s.section === section).map((shortcut) => {
                            const bind = (localSettings[shortcut.id] ?? DEFAULT_KEYBINDS[shortcut.id]) as Keybind;
                            const conflict = findConflict(shortcut.id, bind, currentBinds);
                            return (
                              <div key={shortcut.id} className="form-group row keybind-row">
                                <label className="keybind-label">
                                  {shortcut.description}
                                  {shortcut.context === 'not-playing' && (
                                    <span className="keybind-context-tag">not playing</span>
                                  )}
                                </label>
                                <KeybindInput
                                  value={bind}
                                  onChange={(newBind) => handleKeybind(shortcut.id, newBind)}
                                  conflict={conflict}
                                />
                                {conflict && (
                                  <span className="help-text keybind-conflict-text">
                                    Conflicts with {conflict}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </section>
                  );
                })}

                <p className="help-text" style={{ marginTop: 12 }}>
                  <strong>Note:</strong> Esc always closes/stops. System shortcuts ({modKeyName()}+O, F5, etc.) cannot be rebound here.
                </p>
              </div>
            )}

            {activeTab === 'updates' && (() => {
              const isStore = distributionInfo?.channel === 'microsoft-store';
              // macOS builds are not signed yet, which self-updating requires (see updatesEnabled in electron/main.js).
              if (isStore || window.electronAPI?.platform === 'darwin') {
                return (
                  <div className="settings-form">
                    <div className="form-group">
                      <label>Current Version</label>
                      <span className="version-display">v{appVersionLabel}</span>
                    </div>
                    <div className="form-group">
                      <label>{isStore ? 'Microsoft Store edition' : 'Updates'}</label>
                      <span className="help-text">{isStore ? 'Updates are managed and installed by Microsoft Store.' : 'This version does not update itself yet. Download new versions from GitHub Releases.'}</span>
                    </div>
                  </div>
                );
              }
              const statusLabel: Record<string, string> = {
                idle: 'Not checked yet',
                checking: 'Checking for updates…',
                available: `Update available: v${updateInfo.version}`,
                downloading: `Downloading… ${updateInfo.percent ?? 0}%`,
                ready: `v${updateInfo.version} ready to install`,
                scheduled: `v${updateInfo.version} will install when VideoCull exits`,
                deferred: `v${updateInfo.version} postponed until the next launch`,
                'up-to-date': "You're up to date",
                error: `Error: ${updateInfo.message ?? 'unknown'}`,
              };
              const hasDownloadedUpdate = updateInfo.status === 'ready' || updateInfo.status === 'scheduled' || updateInfo.status === 'deferred';
              const isBusy = updateInfo.status === 'checking' || updateInfo.status === 'downloading' || updateInfo.status === 'available';
              return (
                <div className="settings-form">
                  <div className="settings-card">
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">Version <span className="version-display">v{appVersionLabel}</span></span>
                        <span className={`update-status-label update-status-${updateInfo.status}`}>
                          {statusLabel[updateInfo.status] ?? updateInfo.status}
                        </span>
                        {updateInfo.status === 'downloading' && (
                          <div className="update-progress-bar">
                            <div className="update-progress-fill" style={{ width: `${updateInfo.percent ?? 0}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="settings-row-control update-actions">
                        {!hasDownloadedUpdate && (
                          <button
                            className="btn-check-updates"
                            onClick={() => window.electronAPI?.checkForUpdates()}
                            disabled={isBusy}
                          >
                            <RefreshCw size={14} />
                            {updateInfo.status === 'checking' ? 'Checking…' : 'Check for updates'}
                          </button>
                        )}
                        {hasDownloadedUpdate && (
                          <>
                            <button
                              className="btn-install-update"
                              onClick={() => void window.electronAPI?.installUpdate()}
                            >
                              Update now to v{updateInfo.version}
                            </button>
                            {updateInfo.status !== 'scheduled' && (
                              <button
                                className="btn-check-updates"
                                onClick={() => void window.electronAPI?.scheduleUpdateOnExit()}
                              >
                                Install on exit
                              </button>
                            )}
                            {updateInfo.status !== 'deferred' && (
                              <button
                                className="btn-check-updates"
                                onClick={() => void window.electronAPI?.deferUpdate()}
                              >
                                Ask me later
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <SwitchRow
                      label="Automatically check for updates on startup"
                      help="Downloads updates in the background. Nothing installs until you choose Update now or Install on exit. Takes effect after a restart."
                      checked={localSettings.autoUpdates}
                      onChange={(checked) => handleChange('autoUpdates', checked)}
                    />
                  </div>
                </div>
              );
            })()}

            {activeTab === 'about' && (
              <div className="settings-form about-panel">
                <div className="about-header">
                  <div className="about-mark">VC</div>
                  <div>
                    <h3>{PRODUCT.displayName}</h3>
                    <span className="version-display">v{appVersionLabel}</span>
                  </div>
                </div>

                <div className="about-link-grid">
                  <button className="about-link-btn" onClick={() => openExternal(ABOUT_LINKS.support)}>
                    <HeartHandshake size={16} />
                    <span>VideoCull Support</span>
                    <ExternalLink size={13} />
                  </button>
                  <button className="about-link-btn" onClick={() => openExternal(ABOUT_LINKS.repo)}>
                    <Code2 size={16} />
                    <span>GitHub Repository</span>
                    <ExternalLink size={13} />
                  </button>
                  <button className="about-link-btn" onClick={() => openExternal(ABOUT_LINKS.releases)}>
                    <RefreshCw size={16} />
                    <span>Releases / Changelog</span>
                    <ExternalLink size={13} />
                  </button>
                </div>

                <div className="about-support-row">
                  <button className="about-support-btn" onClick={() => openExternal(ABOUT_LINKS.sponsors)}>
                    <HeartHandshake size={15} />
                    GitHub Sponsors
                  </button>
                  <button className="about-support-btn" onClick={() => openExternal(ABOUT_LINKS.paypal)}>
                    <HeartHandshake size={15} />
                    PayPal
                  </button>
                </div>

                <div className="form-group settings-section-divider about-license">
                  <label>License</label>
                  <span className="help-text">
                    © 2026 {PRODUCT.publisher}. {PRODUCT.displayName} is free software under the GNU Affero General
                    Public License v3.0, provided without any warranty. It includes third-party components, such as
                    FFmpeg, under their own licenses.
                  </span>
                  <div className="about-link-grid">
                    <button className="about-link-btn" onClick={() => openLegalFile('license')}>
                      <FileText size={16} />
                      <span>View license</span>
                    </button>
                    <button className="about-link-btn" onClick={() => openLegalFile('notices')}>
                      <FileText size={16} />
                      <span>Third-party notices</span>
                    </button>
                    <button className="about-link-btn" onClick={() => openExternal(sourceCodeUrl(appVersionLabel))}>
                      <Code2 size={16} />
                      <span>Source code for this version</span>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
                {legacyInstall?.eligible && (
                  <div className="form-group settings-section-divider">
                    <label>Previous direct installation</label>
                    <span className="help-text">
                      {legacyInstall.versionRelation === 'older'
                        ? 'An older direct VideoCull installation was detected. Update it before switching between editions.'
                        : legacyInstall.versionRelation === 'newer'
                          ? 'A newer direct VideoCull installation was detected. Update the Microsoft Store edition before switching between editions.'
                          : legacyInstall.versionRelation === 'same'
                            ? 'Both editions use the same VideoCull profile. Close both editions before removing the direct installation; shared and external cache folders are not deleted automatically.'
                            : 'The direct installation version could not be verified. Update both VideoCull editions before switching between them.'}
                    </span>
                    <button className="about-link-btn" onClick={() => void window.electronAPI?.uninstallLegacyInstall?.()}>
                      <Trash2 size={16} />
                      <span>Remove {legacyInstall.displayName || 'previous VideoCull installation'}</span>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        <div className="settings-footer">
          <span className="help-text settings-footer-note">Changes take effect when you choose Save Preferences.</span>
          <button className="btn-cancel" onClick={close}>Cancel</button>
          <button className="btn-save" onClick={handleSave} disabled={keybindConflictCount > 0}>Save Preferences</button>
        </div>
      </div>
    </div>
  );
}
