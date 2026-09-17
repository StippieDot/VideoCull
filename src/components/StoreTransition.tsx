import { useCallback, useEffect, useState } from 'react';
import useStore from '../store';
import type { LegacyInstallStatus, ProfileMigrationStatus } from '../types';
import './StoreTransition.css';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatByteProgress(bytesCopied: number, totalBytes: number): string {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return `${formatBytes(bytesCopied)} copied`;

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(totalBytes) / Math.log(1024)), units.length - 1);
  const divisor = 1024 ** exponent;
  const formatInTotalUnit = (bytes: number) => {
    const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0) / divisor;
    const decimals = exponent === 0 ? 0 : value > 0 && value < 1 ? 3 : value < 10 ? 2 : 1;
    return `${value.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')} ${units[exponent]}`;
  };

  return `${formatInTotalUnit(bytesCopied)} of ${formatInTotalUnit(totalBytes)} copied`;
}

export default function StoreTransition() {
  const [migration, setMigration] = useState<ProfileMigrationStatus | null>(null);
  const [legacy, setLegacy] = useState<LegacyInstallStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshLegacy = useCallback(() => {
    void window.electronAPI?.getLegacyInstallStatus?.().then(setLegacy).catch(() => setLegacy(null));
  }, []);

  useEffect(() => {
    void window.electronAPI?.getProfileMigrationStatus?.().then((status) => {
      setMigration(status);
      if (status.stage === 'complete') refreshLegacy();
    });
    const unsubscribeMigration = window.electronAPI?.onProfileMigrationStatus?.((status) => {
      setMigration(status);
      if (status.stage === 'complete') refreshLegacy();
    });
    const unsubscribeReady = window.electronAPI?.onStoreTransitionReady?.(refreshLegacy);
    return () => {
      unsubscribeMigration?.();
      unsubscribeReady?.();
    };
  }, [refreshLegacy]);

  const chooseCache = async (action: 'inspect' | 'retain' | 'copy' | 'rebuild') => {
    setBusy(true);
    try {
      const status = await window.electronAPI?.chooseProfileCacheMigration?.(action);
      if (status) {
        setMigration(status);
        if (status.cacheOutcome === 'retained' && status.sourceCachePath) {
          useStore.getState().updateSettings({
            cacheLocation: 'centralised',
            centralCachePath: status.sourceCachePath,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const dismissLegacy = async () => {
    await window.electronAPI?.dismissLegacyInstallPrompt?.();
    setLegacy((current) => current ? { ...current, promptDismissed: true } : current);
  };

  const showMigration = migration && ['awaiting-cache-strategy', 'cache-preflight', 'awaiting-cache-choice', 'cache-copy'].includes(migration.stage);
  const progressPercent = migration?.progress?.totalBytes
    ? Math.min(100, Math.round((migration.progress.bytesCopied / migration.progress.totalBytes) * 100))
    : 0;

  return (
    <>
      {showMigration && (
        <div className="store-transition-overlay">
          <section className="store-transition-dialog" role="dialog" aria-modal="true" aria-labelledby="store-migration-title">
            <h2 id="store-migration-title">Bring your VideoCull cache with you?</h2>
            {migration.stage === 'awaiting-cache-strategy' && (
              <>
                <p>Your settings and library state are already migrated into the Microsoft Store profile. Choose what to do with the existing cache.</p>
                {migration.sourceCachePath && (
                  <div className="store-cache-source">
                    <span>Existing cache</span>
                    <code>{migration.sourceCachePath}</code>
                  </div>
                )}
                <div className="store-migration-options">
                  <button className="store-migration-option store-migration-option-primary" disabled={busy} onClick={() => void chooseCache('inspect')}>
                    <strong>Check size and copy <small>Recommended</small></strong>
                    <span>Inspect the cache and available space before copying it into Store storage.</span>
                  </button>
                  <button className="store-migration-option" disabled={busy} onClick={() => void chooseCache('retain')}>
                    <strong>Keep using existing cache</strong>
                    <span>No copying or extra disk space. The cache stays outside the Store package.</span>
                  </button>
                  <button className="store-migration-option" disabled={busy} onClick={() => void chooseCache('rebuild')}>
                    <strong>Rebuild cache</strong>
                    <span>Leave the old cache untouched and regenerate thumbnails and metadata as needed.</span>
                  </button>
                </div>
                <p className="store-transition-warning">Do not run the previous direct edition at the same time when both editions use this cache.</p>
              </>
            )}
            {migration.stage === 'cache-preflight' && (
              <>
                <p>Checking the existing cache and available disk space…</p>
                {migration.preflightProgress && (
                  <p className="store-preflight-progress" role="status" aria-live="polite">
                    {migration.preflightProgress.filesScanned.toLocaleString()} files in{' '}
                    {migration.preflightProgress.directoriesScanned.toLocaleString()} folders checked
                    {migration.preflightProgress.bytesScanned > 0
                      ? ` · ${formatBytes(migration.preflightProgress.bytesScanned)}`
                      : ''}
                  </p>
                )}
              </>
            )}
            {migration.stage === 'awaiting-cache-choice' && migration.preflight && (
              <>
                <p>Your settings and library state are already migrated. Copying thumbnails is optional and can be retried by rebuilding them later.</p>
                <dl className="store-migration-summary">
                  <div><dt>Existing cache</dt><dd>{formatBytes(migration.preflight.sourceBytes)} in {migration.preflight.fileCount} files</dd></div>
                  <div><dt>Free space</dt><dd>{formatBytes(migration.preflight.freeBytes)}</dd></div>
                  <div><dt>Required with headroom</dt><dd>{formatBytes(migration.preflight.requiredBytes)}</dd></div>
                </dl>
                {!migration.preflight.canCopy && <p className="store-transition-warning">There is not enough free space for a safe copy. Rebuild the cache instead.</p>}
                <div className="store-transition-actions">
                  <button
                    className="btn btn-primary"
                    disabled={busy || !migration.preflight.canCopy}
                    onClick={() => void chooseCache('copy')}
                  >
                    Copy existing cache (recommended)
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void chooseCache('retain')}>
                    Keep using existing cache
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void chooseCache('rebuild')}>
                    Skip and rebuild
                  </button>
                </div>
              </>
            )}
            {migration.stage === 'cache-copy' && migration.progress && (
              <>
                <p>Copying {migration.progress.filesCopied} of {migration.progress.totalFiles} files…</p>
                <div className="store-migration-progress" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
                <p>{formatByteProgress(migration.progress.bytesCopied, migration.progress.totalBytes)}</p>
              </>
            )}
          </section>
        </div>
      )}

      {legacy?.eligible && !legacy.promptDismissed && (
        <aside className="legacy-install-banner" role="status">
          <span>
            <strong>Store migration complete.</strong> You can now remove {legacy.displayName || 'the previous direct installation'}.
          </span>
          <div>
            <button onClick={() => void window.electronAPI?.uninstallLegacyInstall?.()}>Open uninstaller</button>
            <button onClick={() => void dismissLegacy()}>Not now</button>
          </div>
        </aside>
      )}
    </>
  );
}
