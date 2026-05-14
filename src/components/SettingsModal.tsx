import React, { useState, useEffect } from 'react';
import useStore from '../store';
import { ArrowDown, ArrowUp, X, RotateCcw, RefreshCw, FileDown, Database, Code2, ExternalLink, HeartHandshake } from 'lucide-react';
import type { AppSettings, ToastInput, UpdateInfo } from '../types';
import { ALL_SHORTCUTS, findConflict, type KeybindSettingKey, type ShortcutGroup } from '../keybinds';
import { DEFAULT_DUPLICATE_SETTINGS, DEFAULT_KEYBINDS } from '../keybind-defaults';
import type { Keybind } from '../keybinds';
import KeybindInput from './KeybindInput';
import './SettingsModal.css';

const KEYBIND_GROUPS: ShortcutGroup[] = ['Review mode', 'Preview', 'Global'];

type SettingsTab = 'interface' | 'features' | 'duplicates' | 'keybindings' | 'cache' | 'processing' | 'updates' | 'about';

const ABOUT_LINKS = {
  repo: 'https://github.com/stippie-dot/VideoCull',
  releases: 'https://github.com/stippie-dot/VideoCull/releases',
  sponsors: 'https://github.com/sponsors/stippie-dot',
  paypal: 'https://paypal.me/stippiedot',
} as const;

const FEATURE_TOGGLES = [
  { key: 'ratings', label: '5-star rating', description: 'Show rating controls on video cards and in review mode.' },
  { key: 'favorites', label: 'Favorites', description: 'Show the heart toggle and favorites filter.' },
  { key: 'analytics', label: 'Analytics screen', description: 'Show storage analytics entry points.' },
  { key: 'codecBadges', label: 'Codec / resolution badges', description: 'Show resolution, codec, and FPS metadata.' },
  { key: 'compatibilityCheck', label: 'Incompatible codec indicator', description: 'Flag videos that need the external player.' },
  { key: 'globalMute', label: 'Global mute toggle', description: 'Persist a single mute switch for all in-app video playback.' },
  { key: 'nextUndecided', label: 'Next Undecided jump', description: 'Enable the review-mode shortcut that jumps to pending videos.' },
] as const;

const KEEPER_RULE_LABELS: Record<string, { title: string; description: string }> = {
  resolution: { title: 'Resolution', description: 'Prefer the highest pixel count.' },
  videoBitrate: { title: 'Video bitrate', description: 'Prefer the cleaner encode.' },
  duration: { title: 'Duration', description: 'Prefer the longest version.' },
  fps: { title: 'FPS', description: 'Prefer smoother playback.' },
  size: { title: 'File size', description: 'Prefer the largest file.' },
  metadataDate: { title: 'Metadata date', description: 'Prefer the newest date.' },
  filename: { title: 'Filename', description: 'Use name as a final tie-breaker.' },
};

interface SettingsModalProps {
  initialTab?: SettingsTab;
  tabRequestId?: number;
}

export default function SettingsModal({ initialTab = 'interface', tabRequestId = 0 }: SettingsModalProps) {
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

  const [activeTab, setActiveTab] = useState<SettingsTab>('interface');
  const [localSettings, setLocalSettings] = useState<AppSettings>(globalSettings);
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ status: 'idle' });
  const [exportMessage, setExportMessage] = useState<string>('');
  const [cacheMessage, setCacheMessage] = useState<string>('');
  const [autoConcurrency, setAutoConcurrency] = useState<number | null>(null);
  const appVersionLabel = __APP_VERSION__ || appVersion || '...';

  const openExternal = (url: string) => {
    void window.electronAPI?.openExternalUrl(url).catch((err) => {
      console.warn('[settings] Failed to open external URL:', err);
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
  }, [isOpen, globalSettings]);

  useEffect(() => {
    if (!isOpen || !window.electronAPI?.getAutoConcurrency) return;
    window.electronAPI.getAutoConcurrency(localSettings).then(setAutoConcurrency).catch(() => setAutoConcurrency(null));
  }, [isOpen, localSettings]);

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab, tabRequestId]);

  useEffect(() => {
    if (activeTab !== 'interface') {
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

  const moveKeeperRule = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    const currentOrder = localSettings.duplicates.keeperOrder;
    if (nextIndex < 0 || nextIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    handleDuplicateChange('keeperOrder', nextOrder);
  };

  const resetKeeperOrder = () => {
    handleDuplicateChange('keeperOrder', [...DEFAULT_DUPLICATE_SETTINGS.keeperOrder]);
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

  const cacheSettingsChanged = (a: AppSettings, b: AppSettings) => (
    a.cacheLocation !== b.cacheLocation ||
    (a.centralCachePath || null) !== (b.centralCachePath || null) ||
    JSON.stringify(a.perDriveCachePaths || {}) !== JSON.stringify(b.perDriveCachePaths || {})
  );

  const handleSave = async () => {
    let cacheToast: ToastInput | null = null;
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
        cacheToast = {
          title: 'Cache migration partial',
          detail: `${result.migrated} moved, ${result.errors.length} ${result.errors.length === 1 ? 'issue' : 'issues'} left.`,
          kind: 'warning',
        };
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
      pushToast(cacheToast ?? {
        title: 'Preferences saved',
        detail: 'Settings applied immediately.',
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
    ALL_SHORTCUTS.map((s) => [s.id, localSettings[s.id] as Keybind])
  ) as Record<KeybindSettingKey, Keybind>;

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
      setCacheMessage('');
      return;
    }
    if (!currentDriveKey) {
      setCacheMessage('Open a folder first so Video Cull knows which drive to configure.');
      return;
    }
    handleChange('perDriveCachePaths', {
      ...localSettings.perDriveCachePaths,
      [currentDriveKey]: dir,
    });
    setCacheMessage('');
  };

  return (
    <div className="settings-overlay">
      <div className="settings-window">
        <div className="settings-header">
          <h2>Preferences</h2>
          <button className="settings-close-btn" onClick={close} title="Close without saving">
            <X size={20} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-sidebar">
            <button className={`tab-btn ${activeTab === 'interface' ? 'active' : ''}`} onClick={() => setActiveTab('interface')}>Interface</button>
            <button className={`tab-btn ${activeTab === 'features' ? 'active' : ''}`} onClick={() => setActiveTab('features')}>Features</button>
            <button className={`tab-btn ${activeTab === 'duplicates' ? 'active' : ''}`} onClick={() => setActiveTab('duplicates')}>Duplicates</button>
            <button className={`tab-btn ${activeTab === 'cache' ? 'active' : ''}`} onClick={() => setActiveTab('cache')}>Cache</button>
            <button className={`tab-btn ${activeTab === 'processing' ? 'active' : ''}`} onClick={() => setActiveTab('processing')}>Processing</button>
            <button className={`tab-btn ${activeTab === 'keybindings' ? 'active' : ''}`} onClick={() => setActiveTab('keybindings')}>Keybindings</button>
            <button className={`tab-btn ${activeTab === 'updates' ? 'active' : ''}`} onClick={() => setActiveTab('updates')}>
              Updates
              {updateInfo.status === 'ready' && <span className="update-dot" />}
            </button>
            <button className={`tab-btn ${activeTab === 'about' ? 'active' : ''}`} onClick={() => setActiveTab('about')}>About</button>
          </div>

          <div className="settings-content">

            {activeTab === 'interface' && (
              <div className="settings-form">
                <div className="form-group">
                  <label>Default Card Scale</label>
                  <div className="flex-row">
                    <input type="range" min="0.5" max="2.0" step="0.1" value={localSettings.defaultCardScale} onChange={(e) => handleChange('defaultCardScale', Number(e.target.value))} />
                    <span>{localSettings.defaultCardScale.toFixed(1)}x</span>
                  </div>
                </div>

                <div className="form-group">
                  <label>Default Sorting</label>
                  <div className="flex-row">
                    <select value={localSettings.defaultSortBy} onChange={(e) => handleChange('defaultSortBy', e.target.value)}>
                      <option value="name">Name</option>
                      <option value="size">Size</option>
                      <option value="date">Date</option>
                      <option value="duration">Duration</option>
                      {localSettings.features.ratings && <option value="rating">Rating</option>}
                      {localSettings.features.codecBadges && <option value="resolution">Resolution</option>}
                      {localSettings.features.codecBadges && <option value="fps">FPS</option>}
                    </select>
                    <select value={localSettings.defaultSortOrder} onChange={(e) => handleChange('defaultSortOrder', e.target.value)}>
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </div>
                </div>

                <div className="form-group checkbox-group">
                  <label>
                    <input type="checkbox" checked={localSettings.defaultGroupByFolder} onChange={(e) => handleChange('defaultGroupByFolder', e.target.checked)} />
                    Group videos by folder natively
                  </label>
                </div>

                <div className="form-group settings-section-divider">
                  <label>Export Report</label>
                  <button
                    className="btn-check-updates"
                    onClick={handleExportReport}
                    disabled={!directory || videos.length === 0 || isScanning}
                  >
                    <FileDown size={14} />
                    Export Report...
                  </button>
                  <span className="help-text">Choose filtered or all videos when exporting.</span>
                  {exportMessage && <span className="help-text">{exportMessage}</span>}
                </div>
              </div>
            )}

            {activeTab === 'features' && (
              <div className="settings-form">
                <div className="feature-toggle-list">
                  {FEATURE_TOGGLES.map((feature) => (
                    <label key={feature.key} className="feature-toggle-row">
                      <input
                        type="checkbox"
                        checked={localSettings.features[feature.key]}
                        onChange={(e) => handleFeatureChange(feature.key, e.target.checked)}
                      />
                      <span className="feature-toggle-copy">
                        <span className="feature-toggle-label">{feature.label}</span>
                        <span className="help-text">{feature.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'duplicates' && (
              <div className="settings-form duplicates-settings">
                <label className={`duplicates-enable-row ${localSettings.duplicates.enabled ? 'active' : ''}`}>
                  <span className="duplicates-enable-main">
                    <input type="checkbox" checked={localSettings.duplicates.enabled} onChange={(e) => handleDuplicateChange('enabled', e.target.checked)} />
                    <span className="duplicates-enable-copy">
                      <span className="duplicates-enable-title">Enable duplicate detection</span>
                      <span className="help-text">Enables duplicate finding and stores its cache data.</span>
                    </span>
                  </span>
                </label>

                {localSettings.duplicates.enabled && (
                  <>
                    <div className="duplicates-section settings-section-divider">
                      <div className="duplicates-section-heading">
                        <h3 className="settings-subsection-title">Matching</h3>
                        <span className="help-text">Main duplicate matching options.</span>
                      </div>
                      <div className="duplicates-toggle-list">
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.runAfterScan} onChange={(e) => handleDuplicateChange('runAfterScan', e.target.checked)} />
                            Run after each scan
                          </label>
                          <span className="help-text">Starts duplicate detection after each scan.</span>
                        </div>
                      </div>
                      <div className="duplicates-control-grid">
                        <div className="form-group">
                          <label>Similarity</label>
                          <div className="flex-row duplicates-inline-value">
                            <input type="number" min="80" max="100" value={localSettings.duplicates.finalSimilarityThreshold} onChange={(e) => handleDuplicateChange('finalSimilarityThreshold', Number(e.target.value))} className="number-input" />
                            <span>%</span>
                          </div>
                          <span className="help-text">Minimum score needed to group videos as duplicates.</span>
                        </div>
                        <div className="form-group">
                          <label>Sample Count</label>
                          <select value={localSettings.duplicates.sampleCount} onChange={(e) => handleDuplicateChange('sampleCount', Number(e.target.value))}>
                            <option value={1}>1 sample</option>
                            <option value={2}>2 samples</option>
                            <option value={3}>3 samples</option>
                            <option value={4}>4 samples</option>
                            <option value={5}>5 samples</option>
                            <option value={7}>7 samples</option>
                            <option value={9}>9 samples</option>
                          </select>
                          <span className="help-text">More samples reduce false positives, but take longer.</span>
                        </div>
                        <div className="form-group duplicates-span-full">
                          <label>Comparison Method</label>
                          <select value={localSettings.duplicates.comparisonMode} onChange={(e) => handleDuplicateChange('comparisonMode', e.target.value)}>
                            <option value="phash">pHash</option>
                            <option value="visual">Visual similarity</option>
                          </select>
                          <span className="help-text">pHash is more flexible. Visual similarity compares sampled frames more directly.</span>
                        </div>
                        <div className="form-group duplicates-span-full">
                          <label>Default Scope</label>
                          <select value={localSettings.duplicates.defaultScope} onChange={(e) => handleDuplicateChange('defaultScope', e.target.value)}>
                            <option value="all">All loaded videos</option>
                            <option value="filtered">Current filtered view</option>
                          </select>
                          <span className="help-text">Choose all loaded videos or only the current filtered view.</span>
                        </div>
                      </div>
                      <div className="duplicates-toggle-list">
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.protectKeep} onChange={(e) => handleDuplicateChange('protectKeep', e.target.checked)} />
                            Protect marked keep videos
                          </label>
                          <span className="help-text">Keeps already approved videos out of delete suggestions.</span>
                        </div>
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.protectSkipped} onChange={(e) => handleDuplicateChange('protectSkipped', e.target.checked)} />
                            Protect skipped videos
                          </label>
                          <span className="help-text">Leaves skipped videos out of delete suggestions.</span>
                        </div>
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
                              <div className="duplicates-keeper-row" key={rule}>
                                <span className="duplicates-keeper-rank">{index + 1}</span>
                                <span className="duplicates-keeper-copy">
                                  <strong>{label.title}</strong>
                                  <span>{label.description}</span>
                                </span>
                                <span className="duplicates-keeper-actions">
                                  <button type="button" onClick={() => moveKeeperRule(index, -1)} disabled={index === 0} aria-label={`Move ${label.title} up`}>
                                    <ArrowUp size={14} />
                                  </button>
                                  <button type="button" onClick={() => moveKeeperRule(index, 1)} disabled={index === localSettings.duplicates.keeperOrder.length - 1} aria-label={`Move ${label.title} down`}>
                                    <ArrowDown size={14} />
                                  </button>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="duplicates-section settings-section-divider">
                      <div className="duplicates-section-heading">
                        <h3 className="settings-subsection-title">Ignored Matches</h3>
                        <span className="help-text">Pairs marked Not a match stay hidden in future duplicate runs.</span>
                      </div>
                      <div className="duplicates-maintenance-row">
                        <div>
                          <strong>{ignoredDuplicatePairCount}</strong>
                          <span className="help-text">
                            {ignoredDuplicatePairCount === 1 ? ' ignored pair' : ' ignored pairs'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="duplicates-clear-btn"
                          disabled={ignoredDuplicatePairCount === 0}
                          onClick={() => handleDuplicateChange('ignoredDuplicatePairs', [])}
                        >
                          Clear ignored matches
                        </button>
                      </div>
                    </div>

                    <div className="duplicates-section settings-section-divider">
                      <div className="duplicates-section-heading">
                        <h3 className="settings-subsection-title">Advanced</h3>
                        <span className="help-text">Extra control for harder matching cases.</span>
                      </div>
                      <div className="duplicates-control-grid">
                        <div className="form-group">
                          <label>Sampling Window</label>
                          <select value={localSettings.duplicates.samplingWindow} onChange={(e) => handleDuplicateChange('samplingWindow', e.target.value)}>
                            <option value="even">Evenly spaced</option>
                            <option value="25-75">25-75% center</option>
                            <option value="20-80">20-80% center</option>
                            <option value="15-85">15-85% center</option>
                            <option value="custom">Custom window</option>
                          </select>
                          <span className="help-text">Choose which part of each video gets sampled.</span>
                        </div>
                        <div className="form-group">
                          <label>Duration Tolerance</label>
                          <div className="flex-row duplicates-inline-value">
                            <input type="number" min="0" max="100" value={localSettings.duplicates.durationTolerancePercent} onChange={(e) => handleDuplicateChange('durationTolerancePercent', Number(e.target.value))} className="number-input" />
                            <span>%</span>
                          </div>
                          <span className="help-text">How much video lengths may differ and still be compared.</span>
                        </div>
                        <div className="form-group">
                          <label>Max Sampling Duration</label>
                          <div className="flex-row duplicates-inline-value">
                            <input type="number" min="0" max="86400" value={localSettings.duplicates.maxSamplingDuration} onChange={(e) => handleDuplicateChange('maxSamplingDuration', Number(e.target.value))} className="number-input" />
                            <span>seconds</span>
                          </div>
                          <span className="help-text">0 uses the full video length.</span>
                        </div>
                        <div className="form-group">
                          <label>Checkpoint Interval</label>
                          <div className="flex-row duplicates-inline-value">
                            <input type="number" min="0" max="60" value={localSettings.duplicates.checkpointIntervalMinutes} onChange={(e) => handleDuplicateChange('checkpointIntervalMinutes', Number(e.target.value))} className="number-input" />
                            <span>minutes</span>
                          </div>
                          <span className="help-text">How often long runs save progress.</span>
                        </div>
                      </div>
                      {localSettings.duplicates.samplingWindow === 'custom' && (
                        <div className="form-group duplicates-custom-window">
                          <label>Custom Sampling Window</label>
                          <div className="flex-row duplicates-inline-value">
                            <input type="number" min="0" max="95" value={localSettings.duplicates.customStartPercent} onChange={(e) => handleDuplicateChange('customStartPercent', Number(e.target.value))} className="number-input" />
                            <span>% start</span>
                            <input type="number" min="5" max="100" value={localSettings.duplicates.customEndPercent} onChange={(e) => handleDuplicateChange('customEndPercent', Number(e.target.value))} className="number-input" />
                            <span>% end</span>
                          </div>
                          <span className="help-text">Useful for repeated intros, outros, or watermarks.</span>
                        </div>
                      )}
                      <div className="duplicates-toggle-list advanced">
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.requireEverySample} onChange={(e) => handleDuplicateChange('requireEverySample', e.target.checked)} />
                            Require every sample to meet similarity
                          </label>
                          <span className="help-text">Every sample must pass, not just the average.</span>
                        </div>
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.ignoreBlackPixels} onChange={(e) => handleDuplicateChange('ignoreBlackPixels', e.target.checked)} />
                            Ignore black pixels
                          </label>
                          <span className="help-text">Can help with fades, black frames, and letterboxing.</span>
                        </div>
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.ignoreWhitePixels} onChange={(e) => handleDuplicateChange('ignoreWhitePixels', e.target.checked)} />
                            Ignore white pixels
                          </label>
                          <span className="help-text">Can help with bright flashes and white frames.</span>
                        </div>
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.compareFlipped} onChange={(e) => handleDuplicateChange('compareFlipped', e.target.checked)} />
                            Compare flipped videos
                          </label>
                          <span className="help-text">Also checks horizontally mirrored copies.</span>
                        </div>
                        <div className="form-group checkbox-group duplicates-toggle-row">
                          <label>
                            <input type="checkbox" checked={localSettings.duplicates.retryFailedFingerprintExtraction} onChange={(e) => handleDuplicateChange('retryFailedFingerprintExtraction', e.target.checked)} />
                            Retry failed fingerprints
                          </label>
                          <span className="help-text">Retries videos that failed to process before.</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'cache' && (
              <div className="settings-form">
                <div className="form-group">
                  <label>Cache Storage</label>
                  <select
                    value={localSettings.cacheLocation}
                    onChange={(e) => void handleCacheLocationChange(e.target.value)}
                  >
                    <option value="centralised">Centralised</option>
                    <option value="per-drive">Per-drive</option>
                    <option value="distributed">Distributed</option>
                  </select>
                  <span className="help-text">Centralised stores cache in app data. Per-drive keeps cache on the same drive. Distributed creates a hidden .videocull folder inside each loaded folder.</span>
                </div>

                <div className="form-group">
                  <label>Central Cache Location</label>
                  <button
                    className="btn-check-updates"
                    onClick={() => void handleChooseCacheFolder('centralCachePath')}
                    disabled={localSettings.cacheLocation !== 'centralised'}
                  >
                    <Database size={14} />
                    Choose Folder
                  </button>
                  <span className="help-text">{localSettings.centralCachePath || 'Default app cache folder'}</span>
                </div>

                <div className="form-group">
                  <label>Per-drive Cache Location</label>
                  <button
                    className="btn-check-updates"
                    onClick={() => void handleChooseCacheFolder('perDriveCachePaths')}
                    disabled={localSettings.cacheLocation !== 'per-drive' || !currentDriveKey}
                  >
                    <Database size={14} />
                    Choose Folder
                  </button>
                  <span className="help-text">
                    {currentDriveKey
                      ? (localSettings.perDriveCachePaths[currentDriveKey] || `Default location for ${currentDriveKey}`)
                      : 'Open a folder to configure its drive.'}
                  </span>
                  {cacheMessage && <span className="help-text">{cacheMessage}</span>}
                </div>
              </div>
            )}

            {activeTab === 'processing' && (
              <div className="settings-form">
                <div className="form-group">
                  <label>Thumbnails per Video</label>
                  <select value={localSettings.thumbsPerVideo} onChange={(e) => handleChange('thumbsPerVideo', Number(e.target.value))}>
                    <option value={1}>1 Frame</option>
                    <option value={2}>2 Frames</option>
                    <option value={4}>4 Frames</option>
                    <option value={6}>6 Frames</option>
                    <option value={9}>9 Frames</option>
                  </select>
                  <span className="help-text">Number of preview shots extracted evenly per video. Videos with fewer cached shots are rebuilt on the next scan.</span>
                </div>

                <div className="form-group">
                  <label>Skip Intro Blackframes (Delay)</label>
                  <div className="flex-row">
                    <input type="number" min="0" max="60" value={localSettings.skipIntroDelaySecs} onChange={(e) => handleChange('skipIntroDelaySecs', Number(e.target.value))} className="number-input" />
                    <span>Seconds</span>
                  </div>
                  <span className="help-text">Forces the first thumbnail to extract X seconds later to avoid black fade-in screens.</span>
                </div>

                <div className="form-group">
                  <label>Parallel FFmpeg Processes</label>
                  <select
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
                  <span className="help-text">
                    {localSettings.maxConcurrent === 'auto' && autoConcurrency
                      ? `Auto will run up to ${autoConcurrency} FFmpeg process${autoConcurrency === 1 ? '' : 'es'} at once with the current thread setting.`
                      : 'Caps how many thumbnail extraction processes run at the same time.'}
                  </span>
                </div>

                <div className="form-group checkbox-group">
                  <label>
                    <input type="checkbox" checked={localSettings.cpuThreadsLimited} onChange={(e) => handleChange('cpuThreadsLimited', e.target.checked)} />
                    Limit each FFmpeg process to 1 CPU thread (Recommended)
                  </label>
                  <span className="help-text">Uses more small FFmpeg processes instead of fewer multi-threaded processes. Usually faster and smoother for thumbnail generation.</span>
                </div>

                <div className="form-group checkbox-group">
                  <label>
                    <input type="checkbox" checked={localSettings.hardwareAccel} onChange={(e) => handleChange('hardwareAccel', e.target.checked)} />
                    Enable Hardware Acceleration (Beta)
                  </label>
                  <span className="help-text">Attempts to route decoding through the GPU instead of CPU. May crash on legacy formats.</span>
                </div>
              </div>
            )}

            {activeTab === 'keybindings' && (
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
                  return (
                    <div key={group} className="keybind-group">
                      <h4 className="keybind-group-title">{group}</h4>
                      {shortcuts.map((shortcut) => {
                        const bind = localSettings[shortcut.id] as Keybind;
                        const conflict = findConflict(shortcut.id, bind, currentBinds);
                        return (
                          <div key={shortcut.id} className="form-group row keybind-row">
                            <label className="keybind-label">
                              {shortcut.description}
                              {shortcut.context && (
                                <span className="keybind-context-tag">
                                  {shortcut.context === 'playing' ? 'while playing' : 'not playing'}
                                </span>
                              )}
                            </label>
                            <KeybindInput
                              value={bind}
                              onChange={(newBind) => handleKeybind(shortcut.id, newBind)}
                              conflict={conflict}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <p className="help-text" style={{ marginTop: 12 }}>
                  <strong>Note:</strong> Esc always closes/stops. System shortcuts (Ctrl+O, F5, etc.) cannot be rebound here.
                </p>
              </div>
            )}

            {activeTab === 'updates' && (() => {
              const statusLabel: Record<string, string> = {
                idle: 'Not checked yet',
                checking: 'Checking for updates…',
                available: `Update available: v${updateInfo.version}`,
                downloading: `Downloading… ${updateInfo.percent ?? 0}%`,
                ready: `v${updateInfo.version} ready to install`,
                'up-to-date': "You're up to date",
                error: `Error: ${updateInfo.message ?? 'unknown'}`,
              };
              const isReady = updateInfo.status === 'ready';
              const isBusy = updateInfo.status === 'checking' || updateInfo.status === 'downloading' || updateInfo.status === 'available';
              return (
                <div className="settings-form">
                  <div className="form-group">
                    <label>Current Version</label>
                    <span className="version-display">v{appVersionLabel}</span>
                  </div>

                  <div className="form-group">
                    <label>Status</label>
                    <span className={`update-status-label update-status-${updateInfo.status}`}>
                      {statusLabel[updateInfo.status] ?? updateInfo.status}
                    </span>
                    {updateInfo.status === 'downloading' && (
                      <div className="update-progress-bar">
                        <div className="update-progress-fill" style={{ width: `${updateInfo.percent ?? 0}%` }} />
                      </div>
                    )}
                  </div>

                  <div className="form-group update-actions">
                    {!isReady && (
                      <button
                        className="btn-check-updates"
                        onClick={() => window.electronAPI?.checkForUpdates()}
                        disabled={isBusy}
                      >
                        <RefreshCw size={14} />
                        {updateInfo.status === 'checking' ? 'Checking…' : 'Check for updates'}
                      </button>
                    )}
                    {isReady && (
                      <button
                        className="btn-install-update"
                        onClick={() => window.electronAPI?.installUpdate()}
                      >
                        Restart to Install v{updateInfo.version}
                      </button>
                    )}
                  </div>

                  <div className="form-group checkbox-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={localSettings.autoUpdates}
                        onChange={(e) => handleChange('autoUpdates', e.target.checked)}
                      />
                      Automatically check for updates on startup
                    </label>
                    <span className="help-text">When enabled, updates download silently in the background. You are always notified before anything installs.</span>
                  </div>
                </div>
              );
            })()}

            {activeTab === 'about' && (
              <div className="settings-form about-panel">
                <div className="about-header">
                  <div className="about-mark">VC</div>
                  <div>
                    <h3>Video Cull</h3>
                    <span className="version-display">v{appVersionLabel}</span>
                  </div>
                </div>

                <div className="about-link-grid">
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
              </div>
            )}

          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-cancel" onClick={close}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save Preferences</button>
        </div>
      </div>
    </div>
  );
}
