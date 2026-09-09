import { useCallback, useEffect, useState } from 'react';
import type { LegacyInstallStatus, ProfileMigrationStatus } from '../types';
import './StoreTransition.css';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
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

  const chooseCache = async (action: 'copy' | 'rebuild') => {
    setBusy(true);
    try {
      const status = await window.electronAPI?.chooseProfileCacheMigration?.(action);
      if (status) setMigration(status);
    } finally {
      setBusy(false);
    }
  };

  const dismissLegacy = async () => {
    await window.electronAPI?.dismissLegacyInstallPrompt?.();
    setLegacy((current) => current ? { ...current, promptDismissed: true } : current);
  };

  const showMigration = migration && ['cache-preflight', 'awaiting-cache-choice', 'cache-copy'].includes(migration.stage);
  const progressPercent = migration?.progress?.totalBytes
    ? Math.min(100, Math.round((migration.progress.bytesCopied / migration.progress.totalBytes) * 100))
    : 0;

  return (
    <>
      {showMigration && (
        <div className="store-transition-overlay">
          <section className="store-transition-dialog" role="dialog" aria-modal="true" aria-labelledby="store-migration-title">
            <h2 id="store-migration-title">Bring your VideoCull cache with you?</h2>
            {migration.stage === 'cache-preflight' && <p>Checking the existing cache and available disk space…</p>}
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
                <p>{formatBytes(migration.progress.bytesCopied)} of {formatBytes(migration.progress.totalBytes)} copied</p>
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
