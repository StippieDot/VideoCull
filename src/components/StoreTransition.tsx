import { useCallback, useEffect, useState } from 'react';
import type { LegacyInstallStatus } from '../types';
import './StoreTransition.css';

export default function StoreTransition() {
  const [legacy, setLegacy] = useState<LegacyInstallStatus | null>(null);

  const refreshLegacy = useCallback(() => {
    void window.electronAPI?.getLegacyInstallStatus?.().then(setLegacy).catch(() => setLegacy(null));
  }, []);

  useEffect(() => {
    refreshLegacy();
    const unsubscribeReady = window.electronAPI?.onStoreTransitionReady?.(refreshLegacy);
    return () => unsubscribeReady?.();
  }, [refreshLegacy]);

  const dismissLegacy = async () => {
    await window.electronAPI?.dismissLegacyInstallPrompt?.();
    setLegacy((current) => current ? { ...current, promptDismissed: true } : current);
  };

  if (!legacy?.eligible || legacy.promptDismissed) return null;

  return (
    <aside className="legacy-install-banner" role="status">
      <span>
        <strong>{legacy.olderThanCurrent ? 'An older direct VideoCull installation was detected.' : 'Both VideoCull editions are installed.'}</strong>{' '}
        {legacy.olderThanCurrent
          ? 'Update your direct VideoCull installation before switching between editions.'
          : `After confirming the Store edition works, we recommend removing ${legacy.displayName || 'the direct installation'}.`}
      </span>
      <div>
        <button onClick={() => void window.electronAPI?.uninstallLegacyInstall?.()}>Open uninstaller</button>
        <button onClick={() => void dismissLegacy()}>Not now</button>
      </div>
    </aside>
  );
}
