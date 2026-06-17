import { useEffect, useCallback, useRef, useState } from 'react';
import useStore from './store';
import { Profiler } from 'react';
import { formatKeybind, matchesKeybind } from './keybinds';
import Sidebar from './components/Sidebar';
import GridMode from './components/GridMode';
import ReviewMode from './components/ReviewMode';
import EmptyState from './components/EmptyState';
import SettingsModal from './components/SettingsModal';
import DuplicateGroupsView from './components/DuplicateGroupsView';
import ShortcutsHelp from './components/ShortcutsHelp';
import privacyScreenDashboardCover from './assets/privacy-screen-dashboard-cover.png';
import type { MediaProbeVideoInput, UpdateInfo, Video } from './types';
import { detectVideoCompatibility, formatRecentPath } from './utils';
import { completeDevInteractionOnNextPaint, recordDevPerf, recordReactCommit } from './perf-dev';
import { Volume2, VolumeX } from 'lucide-react';
import './App.css';

const CURRENT_METADATA_VERSION = 2;
const SINGLE_THUMBNAIL_VIDEO_DURATION_SECS = 10;

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const file = normalizeFsPath(filePath);
  const root = normalizeFsPath(rootPath);
  return file === root || file.startsWith(`${root}/`);
}

function groupVideosByLoadedRoot(videos: Video[], roots: string[], fallbackRoot: string | null): Map<string, Video[]> {
  const groups = new Map<string, Video[]>();
  for (const video of videos) {
    const root = roots.find((candidate) => isPathInsideRoot(video.path, candidate)) ?? fallbackRoot;
    if (!root) continue;
    const group = groups.get(root) ?? [];
    group.push(video);
    groups.set(root, group);
  }
  return groups;
}

function expectedThumbnailCountForDuration(durationSecs: number | null | undefined, thumbsPerVideo: number, skipIntroDelaySecs: number): number {
  if (durationSecs !== null && durationSecs !== undefined && durationSecs > 0) {
    const end = durationSecs * 0.97;
    if (
      durationSecs < SINGLE_THUMBNAIL_VIDEO_DURATION_SECS ||
      durationSecs < skipIntroDelaySecs ||
      end <= skipIntroDelaySecs
    ) return 1;
  }
  return thumbsPerVideo;
}

function needsMetadataRefresh(video: Video): boolean {
  return video.metadataVersion !== CURRENT_METADATA_VERSION;
}

function toMediaProbeInput(video: Video): MediaProbeVideoInput {
  return {
    id: video.id,
    filename: video.filename,
    path: video.path,
    sizeBytes: video.sizeBytes,
    date: video.date,
  };
}

function isMetadataRunning(isGenerating: boolean, phase: string | undefined): boolean {
  return isGenerating && phase === 'metadata';
}

function blurPointerActivatedButton(event: MouseEvent) {
  if (event.detail === 0) return;
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('button');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return;
  queueMicrotask(() => {
    if (document.activeElement === button) button.blur();
  });
}

export default function App() {
  const directory = useStore((s) => s.directory);
  const directories = useStore((s) => s.directories);
  const videoCount = useStore((s) => s.videos.length);
  const reviewMode = useStore((s) => s.reviewMode);
  const isScanning = useStore((s) => s.isScanning);
  const globalMute = useStore((s) => s.settings.globalMute);
  const globalMuteEnabled = useStore((s) => s.settings.features.globalMute);
  const globalMuteKeybind = useStore((s) => s.settings.keyGlobalMute);
  const duplicateSettings = useStore((s) => s.settings.duplicates);
  const duplicateGroupsMode = useStore((s) => s.duplicateGroupsMode);
  const isFindingDuplicates = useStore((s) => s.isFindingDuplicates);
  const isGenerating = useStore((s) => s.isGenerating);
  const genProgress = useStore((s) => s.genProgress);
  const setVideos = useStore((s) => s.setVideos);
  const setIsScanning = useStore((s) => s.setIsScanning);
  const setScanProgress = useStore((s) => s.setScanProgress);
  const setIsGenerating = useStore((s) => s.setIsGenerating);
  const setGenProgress = useStore((s) => s.setGenProgress);
  const updateVideoThumbnailsBatch = useStore((s) => s.updateVideoThumbnailsBatch);
  const applyDuplicateResult = useStore((s) => s.applyDuplicateResult);
  const setDuplicateProgress = useStore((s) => s.setDuplicateProgress);
  const setIsFindingDuplicates = useStore((s) => s.setIsFindingDuplicates);
  const setDuplicateGroupsMode = useStore((s) => s.setDuplicateGroupsMode);
  const setFolderFilterPath = useStore((s) => s.setFolderFilterPath);
  const includeSubfolders = useStore((s) => s.includeSubfolders);
  const thumbsPerVideo = useStore((s) => s.settings.thumbsPerVideo);
  const skipIntroDelaySecs = useStore((s) => s.settings.skipIntroDelaySecs);
  const toasts = useStore((s) => s.toasts);
  const pushToast = useStore((s) => s.pushToast);
  const dismissToast = useStore((s) => s.dismissToast);
  const scanIdRef = useRef(0);
  const duplicateRunIdRef = useRef(0);
  const genProgressBaseRef = useRef(0);
  const genProgressTotalRef = useRef(0);
  const genProgressPhaseRef = useRef<'thumbnails' | 'metadata' | 'media'>('thumbnails');
  const isPrivateRef = useRef(false);
  const dragDepthRef = useRef(0);
  const folderReviewPathRef = useRef<string | null>(null);
  const settingsSaveQueueRef = useRef(Promise.resolve());
  const previousReviewModeRef = useRef(reviewMode);
  const autoScannedDirectoriesKeyRef = useRef('');

  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropModalPath, setDropModalPath] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'interface' | 'features' | 'duplicates' | 'keybindings' | 'cache' | 'processing' | 'updates' | 'about'>('interface');
  const [settingsTabRequestId, setSettingsTabRequestId] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ status: 'idle' });
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  const handleSidebarProfiler = useCallback((
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    recordReactCommit(id, phase, actualDuration, baseDuration, startTime, commitTime, isScanning ? 'scan' : 'idle');
  }, [isScanning]);

  const handleMainProfiler = useCallback((
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    const context = reviewMode
      ? 'review'
      : isScanning
        ? 'scan'
        : duplicateGroupsMode
          ? 'duplicates'
          : 'grid';
    recordReactCommit(id, phase, actualDuration, baseDuration, startTime, commitTime, context);
  }, [duplicateGroupsMode, isScanning, reviewMode]);

  useEffect(() => {
    isPrivateRef.current = isPrivate;
  }, [isPrivate]);

  useEffect(() => {
    if (previousReviewModeRef.current && !reviewMode) {
      completeDevInteractionOnNextPaint('review.exit');
    }
    previousReviewModeRef.current = reviewMode;
  }, [reviewMode]);

  const handleDirectoryPicked = useCallback((pickedPath: string) => {
    const currentDirs = useStore.getState().directories;
    if (currentDirs.length === 0 || currentDirs.includes(pickedPath)) {
      useStore.getState().setDirectory(pickedPath);
      return;
    }
    setDropModalPath(pickedPath);
  }, []);

  const openSettings = useCallback((tab: 'interface' | 'features' | 'duplicates' | 'keybindings' | 'cache' | 'processing' | 'updates' | 'about' = 'interface') => {
    setSettingsTab(tab);
    setSettingsTabRequestId((prev) => prev + 1);
    useStore.getState().setIsSettingsModalOpen(true);
  }, []);

  const toggleGlobalMute = useCallback(() => {
    const state = useStore.getState();
    if (!state.settings.features.globalMute) return;
    const nextGlobalMute = !state.settings.globalMute;
    state.updateSettings({ globalMute: nextGlobalMute });
    if (window.electronAPI) {
      settingsSaveQueueRef.current = settingsSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await window.electronAPI?.saveConfig(useStore.getState().settings);
        })
        .catch((err) => {
          console.warn('[app] Failed to save global mute setting:', err);
        });
    }
    pushToast({
      title: nextGlobalMute ? 'Muted' : 'Audio on',
      detail: nextGlobalMute ? 'In-app video playback is muted.' : 'In-app video playback can use audio.',
      kind: 'info',
      dedupeKey: 'global-mute-toggle',
    });
  }, [pushToast]);

  const handleExportReport = useCallback(async () => {
    if (!window.electronAPI) return;
    const state = useStore.getState();
    if (!state.directory || state.videos.length === 0 || state.isScanning) return;

    const scope = await window.electronAPI.chooseReportScope();
    if (!scope) return;

    const payload = scope === 'filtered' ? state.filteredVideos : state.videos;
    if (payload.length === 0) {
      pushToast({
        title: 'Nothing to export',
        detail: scope === 'filtered' ? 'No videos match the current filters.' : 'No videos are loaded.',
        kind: 'warning',
        dedupeKey: `export-empty:${scope}`,
      });
      return;
    }

    const roots = state.directories.length > 0 ? state.directories : [state.directory];
    const result = await window.electronAPI.exportReport(payload, roots);
    if (result === 'saved') {
      pushToast({
        title: 'Report exported',
        detail: `${payload.length} ${payload.length === 1 ? 'video' : 'videos'} included.`,
        kind: 'success',
        dedupeKey: `export-saved:${scope}:${payload.length}`,
      });
    } else if (result === 'error') {
      pushToast({
        title: 'Export failed',
        detail: 'The report could not be written.',
        kind: 'error',
      });
    }
  }, [pushToast]);

  const handleFindDuplicates = useCallback(async () => {
    const state = useStore.getState();
    if (!window.electronAPI || state.videos.length < 2 || isFindingDuplicates || !duplicateSettings.enabled) return;
    if (isMetadataRunning(isGenerating, genProgress.phase)) {
      pushToast({
        title: 'Metadata still updating',
        detail: 'Duplicate detection becomes available when metadata is done.',
        kind: 'info',
        dedupeKey: 'duplicates-wait-metadata',
      });
      return;
    }
    const scopeVideos = duplicateSettings.defaultScope === 'filtered' ? state.filteredVideos : state.videos;
    if (scopeVideos.length < 2) {
      pushToast({
        title: 'Not enough videos',
        detail: 'Duplicate detection needs at least two videos in scope.',
        kind: 'warning',
      });
      return;
    }
    const duplicateRunId = ++duplicateRunIdRef.current;
    setIsFindingDuplicates(true);
    setDuplicateProgress({ stage: 'Preparing', current: 0, total: scopeVideos.length });
    try {
      const result = await window.electronAPI.findDuplicates(scopeVideos, { settings: duplicateSettings });
      if (duplicateRunId !== duplicateRunIdRef.current) return;
      if (result.status === 'ok') {
        const activeIds = new Set(useStore.getState().videos.map((video) => video.id));
        const resultIds = result.videos?.map((video) => video.id) ?? [];
        if (resultIds.some((id) => !activeIds.has(id))) return;
        applyDuplicateResult(result);
        const count = result.stats?.duplicateVideoCount ?? 0;
        pushToast({
          title: count > 0 ? 'Duplicates found' : 'No duplicates found',
          detail: count > 0 ? `${result.stats?.groupCount ?? 0} duplicate groups detected.` : 'No mostly identical videos matched.',
          kind: count > 0 ? 'success' : 'info',
        });
      } else if (result.status === 'cancelled') {
        pushToast({ title: 'Duplicate detection cancelled', kind: 'info' });
      } else {
        pushToast({ title: 'Duplicate detection failed', detail: result.error ?? 'Unexpected error.', kind: 'error' });
      }
    } finally {
      if (duplicateRunId === duplicateRunIdRef.current) {
        setIsFindingDuplicates(false);
      }
    }
  }, [applyDuplicateResult, duplicateSettings, genProgress.phase, isFindingDuplicates, isGenerating, pushToast, setDuplicateProgress, setIsFindingDuplicates]);

  // Scan directory when selected
  const handleScan = useCallback(async (dirPaths: string[]) => {
    if (!window.electronAPI || dirPaths.length === 0) return;
    await window.electronAPI.cancelGeneration();
    duplicateRunIdRef.current += 1;
    await window.electronAPI.cancelDuplicateDetection();
    await window.electronAPI.resetLoadedDirectories();
    const scanId = ++scanIdRef.current;
    useStore.getState().setDuplicateGroups([]);
    setIsScanning(true);
    setIsGenerating(false);
    setScanProgress({ found: 0, currentFile: '' });
    try {
      const scannedGroups = [];
      for (const dirPath of dirPaths) {
        const scannedVideos = await window.electronAPI.scanDirectory(dirPath, includeSubfolders);
        scannedGroups.push({ dirPath, videos: scannedVideos });
      }
      if (scanId !== scanIdRef.current) return;
      const allVideos = scannedGroups.flatMap((group) => group.videos);
      const expectedThumbCount = (v: typeof allVideos[number]) => expectedThumbnailCountForDuration(v.durationSecs, thumbsPerVideo, skipIntroDelaySecs);
      const normalizeVideoThumbs = (video: typeof allVideos[number]) => ({
        ...video,
        thumbnails: video.thumbnails?.slice(0, expectedThumbCount(video)) ?? [],
        compatible: detectVideoCompatibility(video.containerFormat, video.videoCodec, video.path),
      });
      const normalizedGroups = scannedGroups.map((group) => {
        const videos = group.videos.map(normalizeVideoThumbs);
        const compatibilityChanged = videos.filter((video, index) => video.compatible !== group.videos[index].compatible);
        return { ...group, videos, compatibilityChanged };
      });
      const normalizedVideos = normalizedGroups.flatMap((group) => group.videos);
      setVideos(normalizedVideos);
      await Promise.all(normalizedGroups
        .filter((group) => group.compatibilityChanged.length > 0)
        .map((group) => window.electronAPI.saveCacheAtomic(group.dirPath, group.compatibilityChanged)
          .then((ok) => {
            if (!ok) console.warn('[app] Compatibility update save was rejected:', group.dirPath);
          })
          .catch((err) => {
            console.warn('[app] Failed to persist compatibility updates:', err);
          })));
      setIsScanning(false);
      const folderLabel = dirPaths.length === 1 ? formatRecentPath(dirPaths[0]) : `${dirPaths.length} folders`;
      pushToast({
        title: dirPaths.length === 1 ? 'Folder loaded' : 'Folders loaded',
        detail: `${normalizedVideos.length} ${normalizedVideos.length === 1 ? 'video' : 'videos'} found in ${folderLabel}.`,
        kind: 'success',
        dedupeKey: `scan-loaded:${dirPaths.join('|')}`,
      });
      const needsThumbnails = (v: typeof allVideos[number]) => (
        !v.thumbnails ||
        v.thumbnails.length < expectedThumbCount(v)
      );
      const metadataTasks = normalizedVideos.filter(needsMetadataRefresh);
      if (metadataTasks.length > 0) {
        let completedTasks = 0;
        genProgressBaseRef.current = 0;
        genProgressTotalRef.current = metadataTasks.length;
        genProgressPhaseRef.current = 'metadata';
        setIsGenerating(true);
        setGenProgress({ current: 0, total: metadataTasks.length, phase: 'metadata' });
        for (const group of normalizedGroups) {
          const needMetadata = group.videos.filter(needsMetadataRefresh);
          if (needMetadata.length === 0) continue;
          genProgressBaseRef.current = completedTasks;
          await window.electronAPI.processMetadata(needMetadata.map(toMediaProbeInput), group.dirPath);
          completedTasks += needMetadata.length;
          if (scanId === scanIdRef.current) {
            setGenProgress({ current: completedTasks, total: metadataTasks.length, phase: 'metadata' });
          }
        }
        if (scanId === scanIdRef.current) {
          setIsGenerating(false);
        }
      }
      const videosAfterMetadata = useStore.getState().videos;
      const thumbnailTasks = videosAfterMetadata.filter(needsThumbnails);
      if (thumbnailTasks.length > 0) {
        const thumbnailTaskIds = new Set(thumbnailTasks.map((v) => v.id));
        let completedTasks = 0;
        genProgressBaseRef.current = 0;
        genProgressTotalRef.current = thumbnailTasks.length;
        genProgressPhaseRef.current = 'thumbnails';
        setIsGenerating(true);
        setGenProgress({ current: 0, total: thumbnailTasks.length, phase: 'thumbnails' });
        const groupsAfterMetadata = groupVideosByLoadedRoot(thumbnailTasks, dirPaths, dirPaths[0] ?? null);
        for (const [root, videosForRoot] of groupsAfterMetadata) {
          genProgressBaseRef.current = completedTasks;
          await window.electronAPI.generateThumbnails(videosForRoot, root);
          completedTasks += videosForRoot.length;
          if (scanId === scanIdRef.current) {
            setGenProgress({ current: completedTasks, total: thumbnailTasks.length, phase: 'thumbnails' });
          }
        }
        if (scanId === scanIdRef.current) {
          setIsGenerating(false);
          const currentVideos = useStore.getState().videos;
          const stillIncomplete = currentVideos.filter((v) => (
            thumbnailTaskIds.has(v.id) &&
            (!v.thumbnails || v.thumbnails.length < expectedThumbCount(v))
          )).length;
          pushToast(stillIncomplete > 0
            ? {
              title: 'Some thumbnails failed',
              detail: `${stillIncomplete} ${stillIncomplete === 1 ? 'video still has' : 'videos still have'} fewer than ${thumbsPerVideo} frames.`,
              kind: 'warning',
              dedupeKey: `thumbs-incomplete:${dirPaths.join('|')}`,
            }
            : {
              title: 'Thumbnails updated',
              detail: `${thumbnailTasks.length} ${thumbnailTasks.length === 1 ? 'video was' : 'videos were'} rebuilt to ${thumbsPerVideo} frames.`,
              kind: 'success',
              dedupeKey: `thumbs-updated:${dirPaths.join('|')}`,
            });
        }
      }
      if (scanId === scanIdRef.current) {
        const duplicateConfig = useStore.getState().settings.duplicates;
        if (duplicateConfig.enabled && duplicateConfig.runAfterScan && window.electronAPI) {
          const currentVideos = useStore.getState().videos;
          if (currentVideos.length >= 2) {
            const duplicateRunId = ++duplicateRunIdRef.current;
            setIsFindingDuplicates(true);
            setDuplicateProgress({ stage: 'Preparing', current: 0, total: currentVideos.length });
            const result = await window.electronAPI.findDuplicates(currentVideos, { settings: duplicateConfig });
            if (scanId === scanIdRef.current && duplicateRunId === duplicateRunIdRef.current && result.status === 'ok') {
              applyDuplicateResult(result);
            }
            if (duplicateRunId === duplicateRunIdRef.current) {
              setIsFindingDuplicates(false);
            }
          }
        }
      }
    } catch (err) {
      if (scanId !== scanIdRef.current) return;
      console.error('Scan failed:', err);
      setIsScanning(false);
      setIsGenerating(false);
      setIsFindingDuplicates(false);
      pushToast({
        title: 'Scan failed',
        detail: dirPaths.length === 1 ? formatRecentPath(dirPaths[0]) : `${dirPaths.length} folders`,
        kind: 'error',
      });
    }
  }, [applyDuplicateResult, includeSubfolders, thumbsPerVideo, skipIntroDelaySecs, setVideos, setIsScanning, setScanProgress, setIsGenerating, setGenProgress, setDuplicateProgress, setIsFindingDuplicates, pushToast]);

  const handleRegenerateThumbnails = useCallback(async (selectedVideos: Video[]) => {
    if (!window.electronAPI || !directory || selectedVideos.length === 0) return;

    const uniqueSelected = Array.from(new Map(selectedVideos.map((video) => [video.id, video])).values());
    const selectedIds = new Set(uniqueSelected.map((video) => video.id));
    const previousVideos = useStore.getState().videos;
    const clearedVideos = previousVideos.map((video) => (
      selectedIds.has(video.id) ? { ...video, thumbnails: [] } : video
    ));
    const clearedSelectedVideos = clearedVideos.filter((video) => selectedIds.has(video.id));

    setVideos(clearedVideos);
    const clearedGroups = groupVideosByLoadedRoot(clearedSelectedVideos, directories, directory);
    const clearResults = await Promise.all(
      Array.from(clearedGroups.entries()).map(([root, videosForRoot]) => (
        window.electronAPI!.saveCacheAtomic(root, videosForRoot)
      ))
    );
    if (clearResults.some((ok) => !ok)) {
      setVideos(previousVideos);
      pushToast({
        title: 'Regeneration cancelled',
        detail: 'Could not safely clear the selected thumbnail cache.',
        kind: 'error',
        dedupeKey: `thumbs-regenerate-clear:${Array.from(selectedIds).join('|')}`,
      });
      return;
    }

    const expectedThumbCount = (video: Video) => expectedThumbnailCountForDuration(video.durationSecs, thumbsPerVideo, skipIntroDelaySecs);

    const countIncompleteSelected = () => useStore.getState().videos.filter((video) => (
      selectedIds.has(video.id) &&
      (!video.thumbnails || video.thumbnails.length < expectedThumbCount(video))
    )).length;

    const waitForStoreThumbnailUpdate = () => new Promise<number>((resolve) => {
      const currentIncomplete = countIncompleteSelected();
      if (currentIncomplete === 0) {
        resolve(0);
        return;
      }

      let unsubscribe: (() => void) | null = null;
      const timeout = window.setTimeout(() => {
        unsubscribe?.();
        resolve(countIncompleteSelected());
      }, 2000);

      unsubscribe = useStore.subscribe(() => {
        const incomplete = countIncompleteSelected();
        if (incomplete === 0) {
          window.clearTimeout(timeout);
          unsubscribe?.();
          resolve(0);
        }
      });
    });

    genProgressBaseRef.current = 0;
    genProgressTotalRef.current = uniqueSelected.length;
    genProgressPhaseRef.current = 'thumbnails';
    setIsGenerating(true);
    setGenProgress({ current: 0, total: uniqueSelected.length, phase: 'thumbnails' });

    try {
      let completedGroups = 0;
      for (const [root, videosForRoot] of clearedGroups) {
        genProgressBaseRef.current = completedGroups;
        const ok = await window.electronAPI.generateThumbnails(videosForRoot, root, { force: true });
        if (!ok) {
          pushToast({
            title: 'Regeneration failed',
            detail: `${videosForRoot.length} selected ${videosForRoot.length === 1 ? 'video was' : 'videos were'} not processed in ${formatRecentPath(root)}.`,
            kind: 'error',
            dedupeKey: `thumbs-regenerate-failed:${Array.from(selectedIds).join('|')}`,
          });
          return;
        }
        completedGroups += videosForRoot.length;
        setGenProgress({ current: completedGroups, total: uniqueSelected.length, phase: 'thumbnails' });
      }

      const incomplete = await waitForStoreThumbnailUpdate();

      pushToast(incomplete > 0
        ? {
          title: 'Some thumbnails failed',
          detail: `${incomplete} selected ${incomplete === 1 ? 'video still has' : 'videos still have'} fewer frames than expected.`,
          kind: 'warning',
          dedupeKey: `thumbs-regenerate-incomplete:${Array.from(selectedIds).join('|')}`,
        }
        : {
          title: 'Thumbnails regenerated',
          detail: `${uniqueSelected.length} selected ${uniqueSelected.length === 1 ? 'video was' : 'videos were'} rebuilt.`,
          kind: 'success',
          dedupeKey: `thumbs-regenerated:${Array.from(selectedIds).join('|')}`,
        });
    } catch (err) {
      console.error('Thumbnail regeneration failed:', err);
      pushToast({
        title: 'Regeneration failed',
        detail: `${uniqueSelected.length} selected ${uniqueSelected.length === 1 ? 'video was' : 'videos were'} not processed.`,
        kind: 'error',
      });
    } finally {
      setIsGenerating(false);
      genProgressBaseRef.current = 0;
      genProgressTotalRef.current = 0;
    }
  }, [directory, directories, setVideos, setIsGenerating, setGenProgress, pushToast, skipIntroDelaySecs, thumbsPerVideo]);

  useEffect(() => {
    void useStore.getState().loadSettings();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const unsub = window.electronAPI.onUpdateStatus((info) => {
      setUpdateInfo(info);
      if (info.status === 'ready') setUpdateBannerDismissed(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    const unsub1 = window.electronAPI.onScanProgress((progress) => setScanProgress(progress));
    const unsub2 = window.electronAPI.onThumbProgress((progress) => {
      const total = genProgressTotalRef.current || progress.total;
      setGenProgress({
        current: Math.min(total, genProgressBaseRef.current + progress.current),
        total,
        phase: genProgressPhaseRef.current,
      });
    });
    const unsubMetadataProgress = window.electronAPI.onMetadataProgress((progress) => {
      const total = genProgressTotalRef.current || progress.total;
      setGenProgress({
        current: Math.min(total, genProgressBaseRef.current + progress.current),
        total,
        phase: genProgressPhaseRef.current,
      });
    });
    const applyMediaBatch = (batch: Parameters<typeof updateVideoThumbnailsBatch>[0]) => {
      const startedAt = import.meta.env.DEV ? performance.now() : 0;
      const preparedAt = import.meta.env.DEV ? performance.now() : 0;
      updateVideoThumbnailsBatch(batch);
      const finishedAt = import.meta.env.DEV ? performance.now() : 0;
      recordDevPerf('applyMediaBatch.prepare', preparedAt - startedAt, { items: batch.length });
      recordDevPerf('applyMediaBatch.storeUpdate', finishedAt - preparedAt, { items: batch.length });
      recordDevPerf('applyMediaBatch.total', finishedAt - startedAt, { items: batch.length });
    };
    const unsubMetadataReady = window.electronAPI.onMetadataReadyBatch(applyMediaBatch);
    const unsub3 = window.electronAPI.onThumbReadyBatch((batch) => {
      applyMediaBatch(batch);
    });
    const unsubNotifications = window.electronAPI.onAppNotification
      ? window.electronAPI.onAppNotification((notification) => pushToast(notification))
      : () => {};
    const unsubDuplicates = window.electronAPI.onDuplicateProgress
      ? window.electronAPI.onDuplicateProgress((progress) => setDuplicateProgress(progress))
      : () => {};

    const unsub4 = window.electronAPI.onMenuAction(async (action) => {
      if (isPrivateRef.current) return;
      const state = useStore.getState();
      switch (action) {
        case 'open-settings': { openSettings('interface'); break; }
        case 'open-directory': {
          const dir = await window.electronAPI.selectDirectory();
          if (dir) handleDirectoryPicked(dir);
          break;
        }
        case 'rescan-directory': { if (state.directories.length > 0) handleScan(state.directories); break; }
        case 'clear-cache': {
          if (state.directories.length > 0) {
            const confirmed = window.confirm('Are you sure you want to clear the cache for all loaded folders? All manual review decisions will be lost.');
            if (confirmed) {
              let clearedCount = 0;
              let failedCount = 0;
              for (const dir of state.directories) {
                const ok = await window.electronAPI.clearCache(dir);
                if (ok) {
                  clearedCount += 1;
                } else {
                  failedCount += 1;
                  pushToast({
                    title: 'Cache clear failed',
                    detail: formatRecentPath(dir),
                    kind: 'error',
                    dedupeKey: `cache-clear-failed:${dir}`,
                  });
                }
              }
              pushToast({
                title: failedCount > 0 ? 'Cache clear incomplete' : 'Cache cleared',
                detail: failedCount > 0
                  ? `${clearedCount} cleared, ${failedCount} failed.`
                  : `${clearedCount} ${clearedCount === 1 ? 'folder' : 'folders'} will be rebuilt.`,
                kind: failedCount > 0 ? 'warning' : 'success',
                dedupeKey: `cache-cleared:${state.directories.join('|')}`,
              });
              state.setVideos([]);
              void handleScan(state.directories);
            }
          }
          break;
        }
        case 'undo': { state.undo(); break; }
        case 'delete-all': {
          const toDelete = state.videos.filter((v) => v.status === 'delete');
          if (toDelete.length === 0) break;
          const confirmed = window.confirm(`Move ${toDelete.length} marked videos to Recycle Bin?`);
          if (confirmed) {
            const results = await window.electronAPI.batchDelete(toDelete.map((v) => v.path));
            const deletedPaths = results.filter((r) => r.success).map((r) => r.path);
            state.removeDeletedVideos(deletedPaths);
            const permanentSuccessCount = results.filter((r) => r.method === 'permanent' && r.success).length;
            const permanentFailureCount = results.filter((r) => r.method === 'permanent' && !r.success).length;
            const failedCount = results.filter((r) => !r.success).length;
            const removedFolderCount = new Set(results.map((r) => r.removedFolder).filter(Boolean)).size;
            const folderDetail = removedFolderCount > 0
              ? ` ${removedFolderCount} empty ${removedFolderCount === 1 ? 'folder was' : 'folders were'} cleaned up.`
              : '';
            if (permanentSuccessCount > 0 && failedCount > 0) {
              pushToast({
                title: 'Delete partly failed',
                detail: `${deletedPaths.length} removed, ${failedCount} failed. ${permanentSuccessCount} skipped Recycle Bin.${folderDetail}`,
                kind: 'error',
              });
            } else if (permanentSuccessCount > 0) {
              pushToast({
                title: 'Permanently deleted',
                detail: `${permanentSuccessCount} ${permanentSuccessCount === 1 ? 'file' : 'files'} skipped Recycle Bin.${folderDetail}`,
                kind: 'warning',
              });
            } else if (permanentFailureCount > 0 || failedCount > 0) {
              pushToast({
                title: 'Delete failed',
                detail: `${failedCount} ${failedCount === 1 ? 'file could' : 'files could'} not be removed.`,
                kind: 'error',
              });
            } else {
              pushToast({
                title: 'Moved to Recycle Bin',
                detail: `${deletedPaths.length} ${deletedPaths.length === 1 ? 'video' : 'videos'} removed from the session.${folderDetail}`,
                kind: 'success',
              });
            }
          }
          break;
        }
        case 'zoom-in': { state.setCardScale(Math.min(state.cardScale + 0.1, 1.5)); break; }
        case 'zoom-out': { state.setCardScale(Math.max(state.cardScale - 0.1, 0.5)); break; }
        case 'reveal-video': {
          if (state.reviewMode && state.activeReviewVideoPath)
            window.electronAPI.openInExplorer(state.activeReviewVideoPath);
          break;
        }
        case 'play-external': {
          if (state.reviewMode && state.activeReviewVideoPath)
            window.electronAPI.openVideo(state.activeReviewVideoPath);
          break;
        }
        case 'export-report': {
          await handleExportReport();
          break;
        }
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      // Privacy screen: Shift+Escape toggles regardless of any other state
      if (e.shiftKey && e.key === 'Escape') {
        e.preventDefault();
        setIsPrivate((v) => !v);
        return;
      }
      if (isPrivateRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;
      if (document.body.hasAttribute('data-capturing-keybind')) return;
      const s = useStore.getState().settings;
      const modalOpen = useStore.getState().isSettingsModalOpen || showShortcutsHelp;
      if (!modalOpen && s.features.globalMute && matchesKeybind(e, s.keyGlobalMute)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleGlobalMute();
      } else if (matchesKeybind(e, s.keyShowHelp)) {
        e.preventDefault();
        setShowShortcutsHelp((v) => !v);
      } else if (e.key === 'Escape') {
        setShowShortcutsHelp(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', blurPointerActivatedButton, true);

    return () => {
      unsub1();
      unsub2();
      unsubMetadataProgress();
      unsubMetadataReady();
      unsub3();
      unsubNotifications();
      unsubDuplicates();
      unsub4();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', blurPointerActivatedButton, true);
    };
  }, [setScanProgress, setGenProgress, setDuplicateProgress, updateVideoThumbnailsBatch, handleScan, handleDirectoryPicked, openSettings, pushToast, toggleGlobalMute, handleExportReport, showShortcutsHelp]);

  useEffect(() => {
    window.electronAPI?.setExportReportAvailable(Boolean(directory && videoCount > 0 && !isScanning));
  }, [directory, videoCount, isScanning]);

  useEffect(() => {
    if (!reviewMode && folderReviewPathRef.current) {
      folderReviewPathRef.current = null;
      setFolderFilterPath(null);
    }
  }, [reviewMode, setFolderFilterPath]);

  useEffect(() => {
    const key = `${directories.join('\0')}|subfolders:${includeSubfolders}`;
    if (key === autoScannedDirectoriesKeyRef.current) return;
    autoScannedDirectoriesKeyRef.current = key;
    if (directories.length > 0) handleScan(directories);
  }, [directories, handleScan]);

  // â”€â”€ Drag & Drop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (!window.electronAPI) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const droppedPath = window.electronAPI.getPathForFile(file);
    if (!droppedPath) return;
    const result = await window.electronAPI.validateDroppedPath(droppedPath);
    if (!result.valid || !result.isDirectory) {
      const isShortcut = droppedPath.toLowerCase().endsWith('.lnk');
      pushToast(isShortcut
        ? 'Shortcuts are not supported. Please drop the actual folder.'
        : 'Please drop a valid folder path. Files are not supported.', 'error');
      return;
    }
    handleDirectoryPicked(droppedPath);
  }, [handleDirectoryPicked, pushToast]);

  const handleDropModalOpenNew = useCallback(() => {
    if (!dropModalPath) return;
    useStore.getState().setDirectory(dropModalPath);
    setDropModalPath(null);
  }, [dropModalPath]);

  const handleDropModalAddSession = useCallback(() => {
    if (!dropModalPath) return;
    useStore.getState().addDirectory(dropModalPath);
    setDropModalPath(null);
    setTimeout(() => {
      pushToast({
        title: 'Folder added',
        detail: formatRecentPath(dropModalPath),
        kind: 'success',
        dedupeKey: `folder-added:${dropModalPath}`,
      });
    }, 50);
  }, [dropModalPath, pushToast]);

  const handleDropModalKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setDropModalPath(null);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLButtonElement>('button');
      if (buttons.length === 0) return;
      const focused = document.activeElement;
      const focusedIndex = focused instanceof HTMLButtonElement ? Array.from(buttons).indexOf(focused) : -1;
      const nextIndex = e.shiftKey ? focusedIndex - 1 : focusedIndex + 1;
      const wrappedIndex = (nextIndex + buttons.length) % buttons.length;
      (buttons[wrappedIndex] as HTMLButtonElement).focus();
    }
  }, []);

  const handleReviewFolder = useCallback((folderPath: string) => {
    folderReviewPathRef.current = folderPath;
    setFolderFilterPath(folderPath);
    useStore.getState().setReviewIndex(0);
    useStore.getState().setReviewMode(true);
  }, [setFolderFilterPath]);

  const handleCloseSession = useCallback(async () => {
    scanIdRef.current += 1;
    duplicateRunIdRef.current += 1;
    await window.electronAPI?.cancelGeneration();
    await window.electronAPI?.cancelDuplicateDetection();
    await window.electronAPI?.resetLoadedDirectories();
    setIsScanning(false);
    setIsGenerating(false);
    setScanProgress({ found: 0, currentFile: '' });
    setGenProgress({ current: 0, total: 0 });
    useStore.getState().setDirectory(null);
    pushToast({
      title: 'Session closed',
      detail: 'Loaded folders and generated work were cancelled.',
      kind: 'info',
    });
  }, [pushToast, setGenProgress, setIsGenerating, setIsScanning, setScanProgress]);

  return (
    <div
      className={`app-layout${isDragOver ? ' drag-over' : ''}${reviewMode ? ' review-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <SettingsModal initialTab={settingsTab} tabRequestId={settingsTabRequestId} />
      {showShortcutsHelp && <ShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />}
      {reviewMode && globalMuteEnabled && !isPrivate && (
        <button
          className={`app-global-mute ${globalMute ? 'active' : ''}`}
          onClick={toggleGlobalMute}
          title={`${globalMute ? 'Unmute' : 'Mute'} in-app playback (${formatKeybind(globalMuteKeybind)})`}
          aria-label={globalMute ? 'Unmute in-app playback' : 'Mute in-app playback'}
        >
          {globalMute ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      )}
      {directory && (
        <Profiler id="Sidebar" onRender={handleSidebarProfiler}>
          <Sidebar
            onRescan={() => directories.length > 0 && handleScan(directories)}
            onDirectoryPicked={handleDirectoryPicked}
            onNotify={pushToast}
            onOpenSettings={() => openSettings('interface')}
            onCloseSession={() => void handleCloseSession()}
            onFindDuplicates={() => void handleFindDuplicates()}
            onOpenDuplicateSettings={() => openSettings('duplicates')}
            globalMute={globalMute}
            globalMuteEnabled={globalMuteEnabled && !isPrivate}
            globalMuteLabel={formatKeybind(globalMuteKeybind)}
            onToggleGlobalMute={toggleGlobalMute}
          />
        </Profiler>
      )}

      <Profiler id="AppMain" onRender={handleMainProfiler}>
        <main className="app-main">
          {!directory && !isScanning && videoCount === 0 && <EmptyState onNotify={pushToast} />}
          {directory && videoCount > 0 && duplicateGroupsMode && (
            <Profiler id="DuplicateGroupsView" onRender={handleMainProfiler}>
              <div
                style={{
                  display: reviewMode ? 'none' : 'flex',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <DuplicateGroupsView />
              </div>
            </Profiler>
          )}
          {directory && videoCount > 0 && !duplicateGroupsMode && (
            <div
              style={{
                display: 'flex',
                flex: 1,
                minHeight: 0,
                visibility: reviewMode ? 'hidden' : 'visible',
                pointerEvents: reviewMode ? 'none' : 'auto',
              }}
              aria-hidden={reviewMode}
            >
              <GridMode
                onReviewFolder={handleReviewFolder}
                onRegenerateThumbnails={handleRegenerateThumbnails}
              />
            </div>
          )}
          {reviewMode && (
            <Profiler id="ReviewMode" onRender={handleMainProfiler}>
              <ReviewMode />
            </Profiler>
          )}
          {isScanning && videoCount === 0 && (
            <div className="scanning-overlay">
              <div className="scanning-spinner" />
              <p>Scanning for videos...</p>
            </div>
          )}
        </main>
      </Profiler>

      {/* Drag-over hint overlay */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <span className="drag-overlay-icon">Folder</span>
            <span>Drop folder to open</span>
          </div>
        </div>
      )}

      {/* Modal shown when a folder is dropped while another is already open */}
      {dropModalPath && (
        <div className="drop-modal-backdrop" onClick={() => setDropModalPath(null)}>
          <div
            className="drop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drop-modal-title"
            aria-describedby="drop-modal-path"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleDropModalKeyDown}
          >
            <p className="drop-modal-title" id="drop-modal-title">Open folder</p>
            <p className="drop-modal-path" id="drop-modal-path" title={dropModalPath}>
              {dropModalPath.split(/[/\\]/).slice(-2).join(' / ')}
            </p>
            <div className="drop-modal-actions">
              <button className="btn btn-primary" autoFocus onClick={handleDropModalOpenNew}>Open as new</button>
              <button className="btn btn-ghost" onClick={handleDropModalAddSession}>Add to session</button>
              <button className="btn btn-ghost" onClick={() => setDropModalPath(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Update-ready banner */}
      {updateInfo.status === 'ready' && !updateBannerDismissed && !isPrivate && (
        <div className="update-banner">
          <span>Video Cull v{updateInfo.version} is ready to install.</span>
          <div className="update-banner-actions">
            <button className="update-banner-btn primary" onClick={() => window.electronAPI?.installUpdate()}>
              Restart Now
            </button>
            <button className="update-banner-btn" onClick={() => setUpdateBannerDismissed(true)}>
              Later
            </button>
          </div>
        </div>
      )}

      {/* Privacy screen overlay image, full-bleed without stretching */}
      {isPrivate && <div className="privacy-screen" style={{ backgroundImage: `url(${privacyScreenDashboardCover})` }} />}

      {!isPrivate && (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast-${toast.kind}`}
              role={toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status'}
            >
              <span className="toast-copy">
                <span className="toast-title">{toast.title}</span>
                {toast.detail && <span className="toast-detail">{toast.detail}</span>}
              </span>
              {toast.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    toast.action?.();
                    dismissToast(toast.id);
                  }}
                >
                  {toast.actionLabel ?? 'Undo'}
                </button>
              )}
              <button className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">x</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
