import { useEffect, useRef } from 'react';
import useStore from '../store';
import type { AppMenuState } from '../types';

/** Tells the main process what the menu can act on, so unusable items are disabled. */
export default function useAppMenuState(isPrivate: boolean) {
  const hasSession = useStore((s) => s.directories.length > 0);
  const directory = useStore((s) => s.directory);
  const videoCount = useStore((s) => s.videos.length);
  const markedCount = useStore((s) => s.stats.delete);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const isScanning = useStore((s) => s.isScanning);
  const metadataRunning = useStore((s) => s.isGenerating && s.genProgress.phase === 'metadata');
  const isFindingDuplicates = useStore((s) => s.isFindingDuplicates);
  const duplicatesEnabled = useStore((s) => s.settings.duplicates.enabled);
  const hasActiveVideo = useStore((s) => (
    s.reviewMode ? Boolean(s.activeReviewVideoPath) : s.gridSelectionIds.size === 1
  ));
  const recentFolders = useStore((s) => s.settings.recentDirectories);
  const lastSent = useRef('');

  useEffect(() => {
    const state: AppMenuState = {
      hasSession,
      videoCount,
      markedCount,
      canUndo,
      canExport: Boolean(directory && videoCount > 0 && !isScanning),
      canFindDuplicates: duplicatesEnabled && videoCount >= 2 && !isFindingDuplicates && !metadataRunning,
      hasActiveVideo,
      isPrivate,
      recentFolders,
    };
    const serialized = JSON.stringify(state);
    if (serialized === lastSent.current) return;
    lastSent.current = serialized;
    window.electronAPI?.setMenuState(state);
  }, [
    hasSession, directory, videoCount, markedCount, canUndo, isScanning, metadataRunning,
    isFindingDuplicates, duplicatesEnabled, hasActiveVideo,
    isPrivate, recentFolders,
  ]);
}
