import { useEffect, useCallback, useRef, useState } from 'react';
import useStore from './store';
import { formatKeybind, matchesKeybind } from './keybinds';
import Sidebar from './components/Sidebar';
import GridMode from './components/GridMode';
import ReviewMode from './components/ReviewMode';
import EmptyState from './components/EmptyState';
import SettingsModal from './components/SettingsModal';
import ShortcutsHelp from './components/ShortcutsHelp';
import privacyScreenDashboardCover from './assets/privacy-screen-dashboard-cover.png';
import type { UpdateInfo, Video } from './types';
import { detectVideoCompatibility, formatRecentPath } from './utils';
import { Volume2, VolumeX } from 'lucide-react';
import './App.css';

export default function App() {
  const directory = useStore((s) => s.directory);
  const directories = useStore((s) => s.directories);
  const videos = useStore((s) => s.videos);
  const filteredVideos = useStore((s) => s.filteredVideos);
  const reviewMode = useStore((s) => s.reviewMode);
  const isScanning = useStore((s) => s.isScanning);
  const globalMute = useStore((s) => s.settings.globalMute);
  const globalMuteEnabled = useStore((s) => s.settings.features.globalMute);
  const globalMuteKeybind = useStore((s) => s.settings.keyGlobalMute);
  const setVideos = useStore((s) => s.setVideos);
  const setIsScanning = useStore((s) => s.setIsScanning);
  const setScanProgress = useStore((s) => s.setScanProgress);
  const setIsGenerating = useStore((s) => s.setIsGenerating);
  const setGenProgress = useStore((s) => s.setGenProgress);
  const updateVideoThumbnailsBatch = useStore((s) => s.updateVideoThumbnailsBatch);
  const setFolderFilterPath = useStore((s) => s.setFolderFilterPath);
  const includeSubfolders = useStore((s) => s.includeSubfolders);
  const thumbsPerVideo = useStore((s) => s.settings.thumbsPerVideo);
  const skipIntroDelaySecs = useStore((s) => s.settings.skipIntroDelaySecs);
  const toasts = useStore((s) => s.toasts);
  const pushToast = useStore((s) => s.pushToast);
  const dismissToast = useStore((s) => s.dismissToast);
  const scanIdRef = useRef(0);
  const genProgressBaseRef = useRef(0);
  const genProgressTotalRef = useRef(0);
  const genProgressPhaseRef = useRef<'thumbnails' | 'metadata' | 'media'>('thumbnails');
  const isPrivateRef = useRef(false);
  const dragDepthRef = useRef(0);
  const folderReviewPathRef = useRef<string | null>(null);
  const settingsSaveQueueRef = useRef(Promise.resolve());

  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropModalPath, setDropModalPath] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'interface' | 'features' | 'keybindings' | 'cache' | 'processing' | 'updates' | 'about'>('interface');
  const [settingsTabRequestId, setSettingsTabRequestId] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ status: 'idle' });
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  useEffect(() => {
    isPrivateRef.current = isPrivate;
  }, [isPrivate]);

  const handleDirectoryPicked = useCallback((pickedPath: string) => {
    const currentDirs = useStore.getState().directories;
    if (currentDirs.length === 0 || currentDirs.includes(pickedPath)) {
      useStore.getState().setDirectory(pickedPath);
      return;
    }
    setDropModalPath(pickedPath);
  }, []);

  const openSettings = useCallback((tab: 'interface' | 'features' | 'keybindings' | 'cache' | 'processing' | 'updates' | 'about' = 'interface') => {
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
        .then(() => window.electronAPI?.saveConfig(useStore.getState().settings))
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

  // Scan directory when selected
  const handleScan = useCallback(async (dirPaths: string[]) => {
    if (!window.electronAPI || dirPaths.length === 0) return;
    await window.electronAPI.cancelGeneration();
    await window.electronAPI.resetLoadedDirectories();
    const scanId = ++scanIdRef.current;
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
      const expectedThumbCount = (v: typeof allVideos[number]) => {
        if (v.durationSecs !== null && v.durationSecs !== undefined && v.durationSecs > 0) {
          const end = v.durationSecs * 0.97;
          if (v.durationSecs < skipIntroDelaySecs || end <= skipIntroDelaySecs) return 1;
        }
        return thumbsPerVideo;
      };
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
      for (const group of normalizedGroups) {
        if (group.compatibilityChanged.length > 0) {
          void window.electronAPI.saveCacheAtomic(group.dirPath, group.compatibilityChanged).catch((err) => {
            console.warn('[app] Failed to persist compatibility updates:', err);
          });
        }
      }
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
      const needsMetadata = (v: typeof allVideos[number]) => (
        !v.videoCodec ||
        !v.containerFormat ||
        !v.width ||
        !v.height ||
        v.fps === null ||
        v.fps === undefined
      );
      const needsThumbnailOrMetadata = (v: typeof allVideos[number]) => needsThumbnails(v) || needsMetadata(v);
      const needThumbsTotal = normalizedVideos.filter(needsThumbnailOrMetadata).length;
      if (needThumbsTotal > 0) {
        const thumbnailTaskCount = normalizedVideos.filter(needsThumbnails).length;
        const thumbnailTaskIds = new Set(normalizedVideos.filter(needsThumbnails).map((v) => v.id));
        const phase = thumbnailTaskCount === 0
          ? 'metadata'
          : thumbnailTaskCount === needThumbsTotal
            ? 'thumbnails'
            : 'media';
        let completedTasks = 0;
        genProgressBaseRef.current = 0;
        genProgressTotalRef.current = needThumbsTotal;
        genProgressPhaseRef.current = phase;
        setIsGenerating(true);
        setGenProgress({ current: 0, total: needThumbsTotal, phase });
        for (const group of normalizedGroups) {
          const needThumbs = group.videos.filter(needsThumbnailOrMetadata);
          if (needThumbs.length === 0) continue;
          genProgressBaseRef.current = completedTasks;
          await window.electronAPI.generateThumbnails(needThumbs, group.dirPath);
          completedTasks += needThumbs.length;
          if (scanId === scanIdRef.current) {
            setGenProgress({ current: completedTasks, total: needThumbsTotal, phase });
          }
        }
        if (scanId === scanIdRef.current) {
          setIsGenerating(false);
          if (thumbnailTaskCount > 0) {
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
                detail: `${thumbnailTaskCount} ${thumbnailTaskCount === 1 ? 'video was' : 'videos were'} rebuilt to ${thumbsPerVideo} frames.`,
                kind: 'success',
                dedupeKey: `thumbs-updated:${dirPaths.join('|')}`,
              });
          }
        }
      }
    } catch (err) {
      console.error('Scan failed:', err);
      setIsScanning(false);
      setIsGenerating(false);
      pushToast({
        title: 'Scan failed',
        detail: dirPaths.length === 1 ? formatRecentPath(dirPaths[0]) : `${dirPaths.length} folders`,
        kind: 'error',
      });
    }
  }, [includeSubfolders, thumbsPerVideo, skipIntroDelaySecs, setVideos, setIsScanning, setScanProgress, setIsGenerating, setGenProgress, pushToast]);

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
    const clearedSaved = await window.electronAPI.saveCacheAtomic(directory, clearedSelectedVideos);
    if (!clearedSaved) {
      setVideos(previousVideos);
      pushToast({
        title: 'Regeneration cancelled',
        detail: 'Could not safely clear the selected thumbnail cache.',
        kind: 'error',
        dedupeKey: `thumbs-regenerate-clear:${Array.from(selectedIds).join('|')}`,
      });
      return;
    }

    const expectedThumbCount = (video: Video) => {
      if (video.durationSecs !== null && video.durationSecs !== undefined && video.durationSecs > 0) {
        const end = video.durationSecs * 0.97;
        if (video.durationSecs < skipIntroDelaySecs || end <= skipIntroDelaySecs) return 1;
      }
      return thumbsPerVideo;
    };

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
      const ok = await window.electronAPI.generateThumbnails(clearedSelectedVideos, directory, { force: true });
      if (!ok) {
        pushToast({
          title: 'Regeneration failed',
          detail: `${uniqueSelected.length} selected ${uniqueSelected.length === 1 ? 'video was' : 'videos were'} not processed.`,
          kind: 'error',
          dedupeKey: `thumbs-regenerate-failed:${Array.from(selectedIds).join('|')}`,
        });
        return;
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
  }, [directory, setVideos, setIsGenerating, setGenProgress, pushToast, skipIntroDelaySecs, thumbsPerVideo]);

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
    const unsub3 = window.electronAPI.onThumbReadyBatch((batch) => {
      const videosById = new Map(useStore.getState().videos.map((item) => [item.id, item]));
      updateVideoThumbnailsBatch(batch.map((item) => {
        const existing = videosById.get(item.videoId);
        const containerFormat = item.containerFormat ?? existing?.containerFormat ?? null;
        const videoCodec = item.videoCodec ?? existing?.videoCodec ?? null;
        return {
          ...item,
          compatible: detectVideoCompatibility(containerFormat, videoCodec, existing?.path),
        };
      }));
    });
    const unsubNotifications = window.electronAPI.onAppNotification
      ? window.electronAPI.onAppNotification((notification) => pushToast(notification))
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
              ? ` ${removedFolderCount} empty ${removedFolderCount === 1 ? 'folder was' : 'folders were'} removed.`
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
                detail: `${deletedPaths.length} ${deletedPaths.length === 1 ? 'video' : 'videos'} removed from the library.${folderDetail}`,
                kind: 'success',
              });
            }
          }
          break;
        }
        case 'zoom-in': { state.setCardScale(Math.min(state.cardScale + 0.1, 1.5)); break; }
        case 'zoom-out': { state.setCardScale(Math.max(state.cardScale - 0.1, 0.5)); break; }
        case 'reveal-video': {
          if (state.reviewMode && state.filteredVideos[state.reviewIndex])
            window.electronAPI.openInExplorer(state.filteredVideos[state.reviewIndex].path);
          break;
        }
        case 'play-external': {
          if (state.reviewMode && state.filteredVideos[state.reviewIndex])
            window.electronAPI.openVideo(state.filteredVideos[state.reviewIndex].path);
          break;
        }
        case 'export-report': {
          openSettings('interface');
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

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
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

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsubNotifications();
      unsub4();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setScanProgress, setGenProgress, updateVideoThumbnailsBatch, handleScan, handleDirectoryPicked, openSettings, pushToast, toggleGlobalMute, showShortcutsHelp]);

  useEffect(() => {
    window.electronAPI?.setExportReportAvailable(Boolean(directory && videos.length > 0 && !isScanning));
  }, [directory, videos.length, isScanning]);

  useEffect(() => {
    if (!reviewMode && folderReviewPathRef.current) {
      folderReviewPathRef.current = null;
      setFolderFilterPath(null);
    }
  }, [reviewMode, setFolderFilterPath]);

  useEffect(() => {
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
    await window.electronAPI?.cancelGeneration();
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
        <Sidebar
          onRescan={() => directories.length > 0 && handleScan(directories)}
          onDirectoryPicked={handleDirectoryPicked}
          onNotify={pushToast}
          onOpenSettings={() => openSettings('interface')}
          onCloseSession={() => void handleCloseSession()}
          globalMute={globalMute}
          globalMuteEnabled={globalMuteEnabled && !isPrivate}
          globalMuteLabel={formatKeybind(globalMuteKeybind)}
          onToggleGlobalMute={toggleGlobalMute}
        />
      )}

      <main className="app-main">
        {!directory && !isScanning && videos.length === 0 && <EmptyState onNotify={pushToast} />}
        {directory && videos.length > 0 && !reviewMode && (
          <GridMode
            onReviewFolder={handleReviewFolder}
            onRegenerateThumbnails={handleRegenerateThumbnails}
          />
        )}
        {reviewMode && <ReviewMode />}
        {isScanning && videos.length === 0 && (
          <div className="scanning-overlay">
            <div className="scanning-spinner" />
            <p>Scanning for videos...</p>
          </div>
        )}
      </main>

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
              <button className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">x</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
