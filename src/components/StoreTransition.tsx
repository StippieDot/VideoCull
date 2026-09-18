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

  const messages = {
    older: {
      title: 'An older direct VideoCull installation was detected.',
      detail: 'Update your direct VideoCull installation before switching between editions.',
    },
    same: {
      title: 'Both VideoCull editions are installed.',
      detail: `After confirming the Store edition works, we recommend removing ${legacy.displayName || 'the direct installation'}.`,
    },
    newer: {
      title: 'A newer direct VideoCull installation was detected.',
      detail: 'Update the Microsoft Store edition before switching between editions.',
    },
    unknown: {
      title: 'The direct VideoCull installation version could not be verified.',
      detail: 'Update both VideoCull editions before switching between them.',
    },
  } as const;
  const message = messages[legacy.versionRelation || 'unknown'];

  return (
    <aside className="legacy-install-banner" role="status">
      <span>
        <strong>{message.title}</strong>{' '}
        {message.detail}
      </span>
      <div>
        <button onClick={() => void window.electronAPI?.uninstallLegacyInstall?.()}>Open uninstaller</button>
        <button onClick={() => void dismissLegacy()}>Not now</button>
      </div>
    </aside>
  );
}
