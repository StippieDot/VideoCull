import { useEffect, useRef } from 'react';
import useStore, { hasActiveFilters } from '../store';
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
  const activeVideoCount = useStore((s) => (
    s.reviewMode ? (s.activeReviewVideoPath ? 1 : 0)
      : s.duplicateGroupsMode || s.gridSelectionIds.size === 0 ? 0
        : s.filteredVideos.reduce((count, video) => count + (s.gridSelectionIds.has(video.id) ? 1 : 0), 0)
  ));
  const isGenerating = useStore((s) => s.isGenerating);
  const sortBy = useStore((s) => s.sortBy);
  const sortOrder = useStore((s) => s.sortOrder);
  const ratingsEnabled = useStore((s) => s.settings.features.ratings);
  const codecBadgesEnabled = useStore((s) => s.settings.features.codecBadges);
  const groupByFolder = useStore((s) => s.groupByFolder);
  const filtersActive = useStore(hasActiveFilters);
  const muteAvailable = useStore((s) => s.settings.features.globalMute);
  const muted = useStore((s) => s.settings.globalMute);
  const recentFolders = useStore((s) => s.settings.recentDirectories);
  const folders = useStore((s) => s.directories);
  const lastSent = useRef('');

  useEffect(() => {
    const state: AppMenuState = {
      hasSession,
      videoCount,
      markedCount,
      canUndo,
      canExport: Boolean(directory && videoCount > 0 && !isScanning),
      canFindDuplicates: duplicatesEnabled && videoCount >= 2 && !isFindingDuplicates && !metadataRunning,
      canPauseProcessing: isGenerating || isFindingDuplicates,
      activeVideoCount,
      canRegenerateThumbnails: !isScanning && !isGenerating,
      sortBy,
      sortOrder,
      // Same choices as the sidebar's sort list.
      sortOptions: [
        'name', 'size', 'duration', 'date',
        ...(ratingsEnabled ? ['rating' as const] : []),
        ...(codecBadgesEnabled ? ['resolution' as const, 'fps' as const] : []),
      ],
      groupByFolder,
      filtersActive,
      muteAvailable,
      muted,
      isPrivate,
      recentFolders,
      folders,
    };
    const serialized = JSON.stringify(state);
    if (serialized === lastSent.current) return;
    lastSent.current = serialized;
    window.electronAPI?.setMenuState(state);
  }, [
    hasSession, directory, videoCount, markedCount, canUndo, isScanning, metadataRunning,
    isFindingDuplicates, duplicatesEnabled, activeVideoCount, isGenerating, sortBy, sortOrder,
    ratingsEnabled, codecBadgesEnabled, groupByFolder, filtersActive, muteAvailable, muted,
    isPrivate, recentFolders, folders,
  ]);
}
