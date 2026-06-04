import { create } from 'zustand';
import type {
  AppSettings, DuplicateGroup,
  Video, VideoStatus, VideoStats, VideoStore,
  ScanProgress, ThumbProgress, UndoEntry,
  StatusFilter, SortField, SortOrder, FolderSortField, RatingFilter,
  ToastInput, ToastKind,
} from './types';
import { DEFAULT_DUPLICATE_SETTINGS, DEFAULT_FEATURES, DEFAULT_KEYBINDS, migrateSettings, pruneRecentDirectories } from './keybind-defaults';
import { recordDevPerf } from './perf-dev';
import { changeAffectsCurrentView, patchFilteredVideosPreservingOrder, type InvalidationField } from './store-invalidation';

function thumbnailIndex(filePath: string): number | null {
  const basename = filePath.split(/[\\/]/).pop() ?? filePath;
  const match = basename.match(/thumb[_-]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

function orderedThumbnails(thumbnails: string[] | undefined): string[] {
  if (!Array.isArray(thumbnails)) return [];
  return [...thumbnails].sort((a, b) => {
    const aIndex = thumbnailIndex(a);
    const bIndex = thumbnailIndex(b);
    if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    const aBase = a.split(/[\\/]/).pop() ?? a;
    const bBase = b.split(/[\\/]/).pop() ?? b;
    return aBase.localeCompare(bBase, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function getFolder(v: Video): string {
  const sep = v.path.includes('/') ? '/' : '\\';
  const parts = v.path.split(sep);
  // Return parent folder name (last directory component)
  return parts.length >= 2 ? parts.slice(0, -1).join(sep) : '';
}

function computeFiltered(state: Pick<VideoStore, 'videos' | 'statusFilter' | 'minSizeFilter' | 'maxSizeFilter' | 'minDurationFilter' | 'maxDurationFilter' | 'folderFilterPath' | 'minRatingFilter' | 'favoritesFilter' | 'incompatibleFilter' | 'duplicateFilter' | 'sortBy' | 'sortOrder' | 'groupByFolder' | 'folderSortBy' | 'folderSortOrder'>): Video[] {
  const startedAt = import.meta.env.DEV ? performance.now() : 0;
  let filtered = [...state.videos];
  const minSizeFilter = Math.max(0, Math.floor(state.minSizeFilter));
  const maxSizeFilter = state.maxSizeFilter === null
    ? null
    : Math.max(minSizeFilter, Math.floor(state.maxSizeFilter));
  const minDurationFilter = Math.max(0, Math.floor(state.minDurationFilter));
  const maxDurationFilter = state.maxDurationFilter === null
    ? null
    : Math.max(minDurationFilter, Math.floor(state.maxDurationFilter));

  if (state.statusFilter !== 'all') {
    filtered = filtered.filter((v) => v.status === state.statusFilter);
  }

  if (minSizeFilter > 0) {
    filtered = filtered.filter((v) => v.sizeBytes >= minSizeFilter);
  }
  if (maxSizeFilter !== null) {
    filtered = filtered.filter((v) => v.sizeBytes <= maxSizeFilter);
  }

  if (minDurationFilter > 0 || maxDurationFilter !== null) {
    filtered = filtered.filter((v) => {
      if (!Number.isFinite(v.durationSecs)) return false;
      const duration = v.durationSecs ?? 0;
      if (minDurationFilter > 0 && duration < minDurationFilter) return false;
      return maxDurationFilter === null || duration <= maxDurationFilter;
    });
  }

  if (state.folderFilterPath) {
    filtered = filtered.filter((v) => getFolder(v) === state.folderFilterPath);
  }

  if (state.minRatingFilter > 0) {
    filtered = filtered.filter((v) => (v.rating ?? 0) >= state.minRatingFilter);
  }

  if (state.favoritesFilter) {
    filtered = filtered.filter((v) => Boolean(v.favorite));
  }

  if (state.incompatibleFilter) {
    filtered = filtered.filter((v) => v.compatible === false);
  }

  if (state.duplicateFilter) {
    filtered = filtered.filter((v) => Boolean(v.duplicateGroupId));
  }

  const getSortCmp = (a: Video, b: Video): number => {
    switch (state.sortBy) {
      case 'name':
        return a.filename.localeCompare(b.filename);
      case 'size':
        return a.sizeBytes - b.sizeBytes;
      case 'duration':
        return (a.durationSecs || 0) - (b.durationSecs || 0);
      case 'date': {
        const dateA = a.metadataDate || a.date || 0;
        const dateB = b.metadataDate || b.date || 0;
        return dateA - dateB;
      }
      case 'rating':
        return (a.rating ?? 0) - (b.rating ?? 0);
      case 'resolution':
        return ((a.width ?? 0) * (a.height ?? 0)) - ((b.width ?? 0) * (b.height ?? 0));
      case 'fps':
        return (a.fps ?? 0) - (b.fps ?? 0);
    }
  };

  if (state.groupByFolder) {
    // Pre-compute folder sizes for size-based folder sorting
    let folderSizeMap: Map<string, number> | null = null;
    if (state.folderSortBy === 'size') {
      folderSizeMap = new Map();
      for (const v of state.videos) {
        const folder = getFolder(v);
        folderSizeMap.set(folder, (folderSizeMap.get(folder) || 0) + v.sizeBytes);
      }
    }

    filtered.sort((a, b) => {
      const folderA = getFolder(a);
      const folderB = getFolder(b);

      let folderCmp = 0;
      if (state.folderSortBy === 'size' && folderSizeMap) {
        folderCmp = (folderSizeMap.get(folderA) || 0) - (folderSizeMap.get(folderB) || 0);
      } else {
        folderCmp = folderA.localeCompare(folderB);
      }
      if (folderCmp !== 0) return state.folderSortOrder === 'asc' ? folderCmp : -folderCmp;

      // Within same folder, sort by selected field
      const cmp = getSortCmp(a, b);
      return state.sortOrder === 'asc' ? cmp : -cmp;
    });
  } else {
    filtered.sort((a, b) => {
      const cmp = getSortCmp(a, b);
      return state.sortOrder === 'asc' ? cmp : -cmp;
    });
  }
  recordDevPerf('computeFiltered', performance.now() - startedAt, { items: state.videos.length });
  return filtered;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function computeStats(videos: Video[]): VideoStats {
  const startedAt = import.meta.env.DEV ? performance.now() : 0;
  const stats = {
    total: videos.length,
    pending: videos.filter((v) => v.status === 'pending').length,
    skipped: videos.filter((v) => v.status === 'skipped').length,
    keep: videos.filter((v) => v.status === 'keep').length,
    delete: videos.filter((v) => v.status === 'delete').length,
    totalSize: videos.reduce((sum, v) => sum + v.sizeBytes, 0),
    deleteSize: videos.filter((v) => v.status === 'delete').reduce((sum, v) => sum + v.sizeBytes, 0),
  };
  recordDevPerf('computeStats', performance.now() - startedAt, { items: videos.length });
  return stats;
}

type VideoStateUpdateOptions = {
  duplicateFilter?: boolean;
  duplicateGroups?: DuplicateGroup[];
  duplicateGroupsMode?: boolean;
  recomputeStats?: boolean;
  reviewIndex?: number;
  undoStack?: UndoEntry[];
};

function buildVideoStateUpdate(
  currentState: VideoStore,
  videos: Video[],
  changedFields: Iterable<InvalidationField>,
  options: VideoStateUpdateOptions = {}
) {
  const nextState = {
    ...currentState,
    videos,
    duplicateFilter: options.duplicateFilter ?? currentState.duplicateFilter,
    duplicateGroups: options.duplicateGroups ?? currentState.duplicateGroups,
    duplicateGroupsMode: options.duplicateGroupsMode ?? currentState.duplicateGroupsMode,
  };

  const filteredVideos = changeAffectsCurrentView(changedFields, nextState)
    ? computeFiltered(nextState)
    : patchFilteredVideosPreservingOrder(currentState.filteredVideos, videos);

  return {
    videos,
    filteredVideos,
    ...(options.duplicateFilter !== undefined ? { duplicateFilter: options.duplicateFilter } : {}),
    ...(options.duplicateGroups !== undefined ? { duplicateGroups: options.duplicateGroups } : {}),
    ...(options.duplicateGroupsMode !== undefined ? { duplicateGroupsMode: options.duplicateGroupsMode } : {}),
    ...(options.undoStack !== undefined ? { undoStack: options.undoStack } : {}),
    ...(options.reviewIndex !== undefined ? { reviewIndex: options.reviewIndex } : {}),
    ...(options.recomputeStats ? { stats: computeStats(videos) } : {}),
  };
}

function duplicatePairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function normalizeDuplicatePairKey(pairKey: string): string | null {
  if (typeof pairKey !== 'string') return null;
  const parts = pairKey.toLowerCase().split('|');
  if (parts.length !== 2 || !parts.every((part) => /^[0-9a-f]{16}$/.test(part))) return null;
  if (parts[0] === parts[1]) return null;
  return duplicatePairKey(parts[0], parts[1]);
}

function applyDuplicateGroupsToVideos(videos: Video[], groups: DuplicateGroup[]): Video[] {
  const groupByVideo = new Map<string, DuplicateGroup>();
  for (const group of groups) {
    for (const videoId of group.videoIds) groupByVideo.set(videoId, group);
  }

  return videos.map((video) => {
    const group = groupByVideo.get(video.id);
    if (!group) {
      return {
        ...video,
        duplicateGroupId: null,
        duplicateSimilarity: null,
        duplicateMatchType: null,
        duplicateSuggestedKeeper: false,
        duplicateExact: false,
        duplicateGroupSize: 0,
        duplicateMatchReason: null,
      };
    }

    return {
      ...video,
      duplicateGroupId: group.id,
      duplicateSimilarity: group.similarity,
      duplicateMatchType: group.matchType,
      duplicateSuggestedKeeper: group.suggestedKeeperId === video.id,
      duplicateExact: group.matchType === 'exact' || Boolean(group.exactVideoIds?.includes(video.id)),
      duplicateGroupSize: group.videoIds.length,
      duplicateMatchReason: group.reason,
    };
  });
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolutionPixels(video: Video): number {
  return finiteNumber(video.width) * finiteNumber(video.height);
}

// SYNC NOTE: This function mirrors compareKeeperCandidates in electron/duplicate-utils.js.
// The renderer copy exists for instant keeper re-computation when settings change.
function compareKeeperCandidates(a: Video, b: Video, order: string[]): number {
  for (const rule of order) {
    let diff = 0;
    if (rule === 'resolution') diff = resolutionPixels(a) - resolutionPixels(b);
    else if (rule === 'videoBitrate') diff = finiteNumber(a.videoBitrate ?? a.totalBitrate) - finiteNumber(b.videoBitrate ?? b.totalBitrate);
    else if (rule === 'duration') diff = finiteNumber(a.durationSecs) - finiteNumber(b.durationSecs);
    else if (rule === 'fps') diff = finiteNumber(a.fps) - finiteNumber(b.fps);
    else if (rule === 'size') diff = finiteNumber(a.sizeBytes) - finiteNumber(b.sizeBytes);
    if (Number.isFinite(diff) && diff !== 0) return diff;
  }
  return String(b.path ?? '').localeCompare(String(a.path ?? ''));
}

function chooseSuggestedKeeperId(videos: Video[], order: string[]): string | null {
  return [...videos].sort((a, b) => -compareKeeperCandidates(a, b, order))[0]?.id ?? null;
}

function applyKeeperOrderToGroups(groups: DuplicateGroup[], videos: Video[], order: string[]): DuplicateGroup[] {
  if (groups.length === 0) return groups;
  const videosById = new Map(videos.map((video) => [video.id, video]));
  return groups.map((group) => {
    const groupVideos = group.videoIds
      .map((videoId) => videosById.get(videoId))
      .filter((video): video is Video => Boolean(video));
    const manualSuggestedKeeperId = group.manualSuggestedKeeperId && group.videoIds.includes(group.manualSuggestedKeeperId)
      ? group.manualSuggestedKeeperId
      : null;
    return {
      ...group,
      manualSuggestedKeeperId,
      suggestedKeeperId: manualSuggestedKeeperId ?? chooseSuggestedKeeperId(groupVideos, order),
    };
  });
}

function uniqueVideoIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function sameVideoIdentitySet(a: Video[], b: Video[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((video) => video.id));
  return b.every((video) => ids.has(video.id));
}

function getReviewScopeIdsForVideo(videoId: string, scopeIds: string[] | undefined, videos: Video[], filteredVideos: Video[]): string[] {
  const explicitScope = uniqueVideoIds(scopeIds ?? []);
  if (explicitScope.includes(videoId)) return explicitScope;

  const filteredScope = filteredVideos.map((video) => video.id);
  if (filteredScope.includes(videoId)) return filteredScope;

  const allScope = videos.map((video) => video.id);
  return allScope.includes(videoId) ? allScope : [];
}

function getVideoByReviewIndex(videos: Video[], scopeIds: string[] | null, fallbackVideos: Video[], reviewIndex: number): Video | null {
  if (scopeIds && scopeIds.length > 0) {
    const byId = new Map(videos.map((video) => [video.id, video]));
    const videoId = scopeIds[reviewIndex];
    return videoId ? byId.get(videoId) ?? null : null;
  }
  return fallbackVideos[reviewIndex] ?? null;
}

function saveSettingsQuietly(settings: AppSettings) {
  if (!window.electronAPI) return;
  void window.electronAPI.saveConfig(settings).catch((err) => {
    console.error('[store] Failed to save settings:', err);
  });
}

function normalizePathForCompare(value: string): string {
  return value.replace(/[/\\]+/g, '\\').replace(/\\+$/g, '').toLowerCase();
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const file = normalizePathForCompare(filePath);
  const root = normalizePathForCompare(rootPath);
  return file === root || file.startsWith(`${root}\\`);
}

function findRootForVideo(video: Video, directories: string[], fallback: string | null): string | null {
  const root = directories.find((dir) => isPathInsideRoot(video.path, dir));
  return root ?? fallback;
}

function uniqueDirectories(dirs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    const key = normalizePathForCompare(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(dir);
  }
  return result;
}

function folderLabel(pathValue: string | null | undefined): string {
  if (!pathValue) return 'folder';
  const parts = pathValue.split(/[/\\]/).filter(Boolean);
  return parts.slice(-1)[0] || pathValue;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

type NotifyFn = (toast: ToastInput | string, kind?: ToastKind) => void;
let notifyToast: NotifyFn | null = null;

function notify(toast: ToastInput | string, kind?: ToastKind) {
  notifyToast?.(toast, kind);
}

const DEFAULT_TOAST_DURATION_MS = 4200;
const IMPORTANT_TOAST_DURATION_MS = 7000;
const TOAST_DEDUPE_WINDOW_MS = 2500;
const MAX_VISIBLE_TOASTS = 5;
let toastIdCounter = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
const recentToastByKey = new Map<string, number>();

function pruneRecentToastKeys(now: number) {
  for (const [key, lastShownAt] of recentToastByKey) {
    if (now - lastShownAt >= TOAST_DEDUPE_WINDOW_MS) {
      recentToastByKey.delete(key);
    }
  }
}

const SAVE_RETRY_DELAY_MS = 750;
const MAX_SAVE_RETRY_ATTEMPTS = 3;

type RetryQueueEntry = {
  video: Video;
  token: number;
};

let retryDirectory: string | null = null;
let retryAttempts = 0;
let retryQueueByVideoId = new Map<string, RetryQueueEntry>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryFlushInFlight = false;
let retryTokenCounter = 0;

function nextRetryToken() {
  retryTokenCounter += 1;
  return retryTokenCounter;
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function resetRetryQueue() {
  clearRetryTimer();
  retryDirectory = null;
  retryAttempts = 0;
  retryQueueByVideoId = new Map<string, RetryQueueEntry>();
}

function acknowledgeSavedTokens(directory: string, savedTokenByVideoId: Map<string, number>) {
  if (retryDirectory !== directory || savedTokenByVideoId.size === 0 || retryQueueByVideoId.size === 0) return;

  const nextQueue = new Map(retryQueueByVideoId);
  for (const [videoId, savedToken] of savedTokenByVideoId) {
    const queued = nextQueue.get(videoId);
    if (!queued) continue;

    // Only clear the queue entry if the queued version is not newer.
    if (queued.token <= savedToken) {
      nextQueue.delete(videoId);
    }
  }
  retryQueueByVideoId = nextQueue;

  if (retryQueueByVideoId.size === 0 && !retryFlushInFlight) {
    clearRetryTimer();
    retryDirectory = null;
    retryAttempts = 0;
  }
}

function scheduleRetryFlush() {
  if (!retryDirectory || retryQueueByVideoId.size === 0 || retryTimer || retryFlushInFlight) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flushRetryQueue();
  }, SAVE_RETRY_DELAY_MS);
}

function enqueueRetryVideos(directory: string, videos: Video[], token: number) {
  if (videos.length === 0) return;

  if (retryDirectory && retryDirectory !== directory) {
    // Directory changed; drop stale retry payloads from previous directory.
    resetRetryQueue();
  }

  retryDirectory = directory;
  const nextQueue = new Map(retryQueueByVideoId);
  for (const video of videos) {
    const existing = nextQueue.get(video.id);
    if (!existing || existing.token <= token) {
      nextQueue.set(video.id, { video, token });
    }
  }
  retryQueueByVideoId = nextQueue;
  scheduleRetryFlush();
}

function flushRetryQueue() {
  if (!retryDirectory || retryQueueByVideoId.size === 0 || !window.electronAPI || retryFlushInFlight) return;

  const directory = retryDirectory;
  const retryEntries = Array.from(retryQueueByVideoId.values());
  const retryPayload = retryEntries.map((entry) => entry.video);
  const sentTokenByVideoId = new Map<string, number>();
  for (const entry of retryEntries) {
    sentTokenByVideoId.set(entry.video.id, entry.token);
  }
  retryFlushInFlight = true;

  void window.electronAPI.saveCache(directory, retryPayload)
    .then((ok) => {
      retryFlushInFlight = false;

      if (retryDirectory !== directory) {
        scheduleRetryFlush();
        return;
      }

      if (retryQueueByVideoId.size === 0) {
        retryDirectory = null;
        retryAttempts = 0;
        return;
      }

      if (ok) {
        retryAttempts = 0;
        // Remove only queue entries that match the successful payload version.
        acknowledgeSavedTokens(directory, sentTokenByVideoId);
        if (retryQueueByVideoId.size > 0) {
          scheduleRetryFlush();
        }
        return;
      }

      retryAttempts += 1;
      if (retryAttempts >= MAX_SAVE_RETRY_ATTEMPTS) {
        console.error('[store] saveCache retry exhausted', {
          attempts: retryAttempts,
          count: retryPayload.length,
        });
        notify({
          title: 'Decisions not saved',
          detail: `${plural(retryPayload.length, 'change')} could be lost for "${folderLabel(directory)}".`,
          kind: 'error',
          dedupeKey: `save-exhausted:${directory}`,
        });
        resetRetryQueue();
        return;
      }

      console.warn('[store] saveCache retry scheduled after false result', {
        attempt: retryAttempts,
        count: retryPayload.length,
      });
      if (retryAttempts === 1) {
        notify({
          title: 'Saving decisions delayed',
          detail: `Retrying ${plural(retryPayload.length, 'change')} for "${folderLabel(directory)}".`,
          kind: 'warning',
          dedupeKey: `save-delayed:${directory}`,
        });
      }
      scheduleRetryFlush();
    })
    .catch((err) => {
      retryFlushInFlight = false;

      if (retryDirectory !== directory) {
        scheduleRetryFlush();
        return;
      }

      if (retryQueueByVideoId.size === 0) {
        retryDirectory = null;
        retryAttempts = 0;
        return;
      }

      retryAttempts += 1;
      if (retryAttempts >= MAX_SAVE_RETRY_ATTEMPTS) {
        console.error('[store] saveCache retry failed permanently', err);
        notify({
          title: 'Decisions not saved',
          detail: `${plural(retryPayload.length, 'change')} could be lost for "${folderLabel(directory)}".`,
          kind: 'error',
          dedupeKey: `save-exhausted:${directory}`,
        });
        resetRetryQueue();
        return;
      }

      console.warn('[store] saveCache retry scheduled after error', {
        attempt: retryAttempts,
        count: retryPayload.length,
      });
      if (retryAttempts === 1) {
        notify({
          title: 'Saving decisions delayed',
          detail: `Retrying ${plural(retryPayload.length, 'change')} for "${folderLabel(directory)}".`,
          kind: 'warning',
          dedupeKey: `save-delayed:${directory}`,
        });
      }
      scheduleRetryFlush();
    });
}

function persistChangedVideos(directory: string | null, directories: string[], videos: Video[]) {
  if (!window.electronAPI || videos.length === 0) return;

  const videosByRoot = new Map<string, Video[]>();
  for (const video of videos) {
    const root = findRootForVideo(video, directories, directory);
    if (!root) continue;
    const list = videosByRoot.get(root) ?? [];
    list.push(video);
    videosByRoot.set(root, list);
  }

  for (const [root, rootVideos] of videosByRoot) {
    const requestToken = nextRetryToken();

    void window.electronAPI.saveCache(root, rootVideos)
      .then((ok) => {
        if (ok) {
          const queueSizeBeforeAck = retryQueueByVideoId.size;
          const savedTokenByVideoId = new Map<string, number>();
          for (const video of rootVideos) {
            savedTokenByVideoId.set(video.id, requestToken);
          }
          acknowledgeSavedTokens(root, savedTokenByVideoId);
          if (retryDirectory === root && retryQueueByVideoId.size < queueSizeBeforeAck) {
            retryAttempts = 0;
          }
          return;
        }

        console.warn('[store] saveCache returned false for partial save', { count: rootVideos.length });
        notify({
          title: 'Saving decisions delayed',
          detail: `Retrying ${plural(rootVideos.length, 'change')} for "${folderLabel(root)}".`,
          kind: 'warning',
          dedupeKey: `save-delayed:${root}`,
        });
        enqueueRetryVideos(root, rootVideos, requestToken);
      })
      .catch((err) => {
        console.error('[store] saveCache failed for partial save', err);
        notify({
          title: 'Saving decisions delayed',
          detail: `Retrying ${plural(rootVideos.length, 'change')} for "${folderLabel(root)}".`,
          kind: 'warning',
          dedupeKey: `save-delayed:${root}`,
        });
        enqueueRetryVideos(root, rootVideos, requestToken);
      });
  }
}

function persistChangedVideosAtomic(directory: string | null, directories: string[], videos: Video[]) {
  if (!window.electronAPI || videos.length === 0) return;

  const videosByRoot = new Map<string, Video[]>();
  for (const video of videos) {
    const root = findRootForVideo(video, directories, directory);
    if (!root) continue;
    const list = videosByRoot.get(root) ?? [];
    list.push(video);
    videosByRoot.set(root, list);
  }

  for (const [root, rootVideos] of videosByRoot) {
    const requestToken = nextRetryToken();
    void window.electronAPI.saveCacheAtomic(root, rootVideos)
      .then((ok) => {
        if (!ok) {
          console.warn('[store] saveCacheAtomic returned false; falling back to queued save', { count: rootVideos.length });
          notify({
            title: 'Saving decisions delayed',
            detail: `Retrying ${plural(rootVideos.length, 'change')} for "${folderLabel(root)}".`,
            kind: 'warning',
            dedupeKey: `save-delayed:${root}`,
          });
          persistChangedVideos(root, [root], rootVideos);
          return;
        }

        const savedTokenByVideoId = new Map<string, number>();
        for (const video of rootVideos) {
          savedTokenByVideoId.set(video.id, requestToken);
        }
        acknowledgeSavedTokens(root, savedTokenByVideoId);
      })
      .catch((err) => {
        console.error('[store] saveCacheAtomic failed', err);
        notify({
          title: 'Saving decisions delayed',
          detail: `Retrying ${plural(rootVideos.length, 'change')} for "${folderLabel(root)}".`,
          kind: 'warning',
          dedupeKey: `save-delayed:${root}`,
        });
        persistChangedVideos(root, [root], rootVideos);
    });
  }
}

const useStore = create<VideoStore>((set, get) => ({
  // ── Directory ──
  directory: null,
  directories: [],
  includeSubfolders: true,

  // ── Videos ──
  videos: [],
  filteredVideos: [],

  // ── Scanning ──
  isScanning: false,
  scanProgress: { found: 0, currentFile: '' },

  // ── Thumbnail generation ──
  isGenerating: false,
  genProgress: { current: 0, total: 0 },

  // ── Filters & Sort ──
  statusFilter: 'all',
  sortBy: 'name',
  sortOrder: 'asc',
  minSizeFilter: 0,
  maxSizeFilter: null,
  minDurationFilter: 0,
  maxDurationFilter: null,
  folderFilterPath: null,
  minRatingFilter: 0,
  favoritesFilter: false,
  incompatibleFilter: false,
  duplicateFilter: false,
  groupByFolder: true,
  folderSortBy: 'name',
  folderSortOrder: 'asc',

  // ── View Mode ──
  reviewMode: false,
  reviewIndex: 0,
  reviewScopeIds: null,
  reviewAutoPlay: false,
  activeReviewVideoPath: null,
  duplicateGroupsMode: false,
  duplicateGroups: [],
  duplicateProgress: null,
  isFindingDuplicates: false,
  duplicateViewMode: 'rows',
  duplicatePathFilter: '',
  duplicateMinSimilarity: 0,
  duplicateSortBy: 'similarity',
  duplicateSortOrder: 'desc',
  duplicateScrollTop: 0,
  gridSelectionIds: new Set(),
  gridSelectionAnchorId: null,
  // ── Card sizing ──
  cardScale: 1,

  // ── Undo stack ──
  undoStack: [],

  // ── Settings ──
  isSettingsModalOpen: false,
  settings: {
    cacheLocation: 'centralised',
    centralCachePath: null,
    perDriveCachePaths: {},
    thumbsPerVideo: 6,
    defaultCardScale: 1,
    defaultSortBy: 'name',
    defaultSortOrder: 'asc',
    defaultGroupByFolder: true,
    maxConcurrent: 'auto',
    cpuThreadsLimited: true,
    skipIntroDelaySecs: 3,
    hardwareAccel: false,
    recentDirectories: [],
    recentDirectoryTimestamps: {},
    autoUpdates: true,
    globalMute: false,
    features: { ...DEFAULT_FEATURES },
    duplicates: { ...DEFAULT_DUPLICATE_SETTINGS },
    ...DEFAULT_KEYBINDS,
  },

  // ── Statistics ──
  stats: { total: 0, pending: 0, skipped: 0, keep: 0, delete: 0, totalSize: 0, deleteSize: 0 },

  // ── Notifications ──
  toasts: [],

  // ── Actions ──
  setDirectory: (dir: string | null) => {
    if (dir !== null) {
      const { settings } = get();
      const existing = settings.recentDirectories.filter((d) => d !== dir);
      const updated = [dir, ...existing].slice(0, 8);
      const nextTimestamps = { ...settings.recentDirectoryTimestamps, [dir]: Date.now() };
      const prunedTimestamps: Record<string, number> = {};
      for (const p of updated) {
        if (nextTimestamps[p]) prunedTimestamps[p] = nextTimestamps[p];
      }
      const newSettings = {
        ...settings,
        recentDirectories: updated,
        recentDirectoryTimestamps: prunedTimestamps,
      };
      set({
        directory: dir,
        directories: [dir],
        settings: newSettings,
        folderFilterPath: null,
        reviewIndex: 0,
        duplicateGroupsMode: false,
        duplicateGroups: [],
        duplicateProgress: null,
        duplicateFilter: false,
        duplicatePathFilter: '',
        duplicateMinSimilarity: 0,
        duplicateSortBy: 'similarity',
        duplicateSortOrder: 'desc',
        undoStack: [],
        gridSelectionIds: new Set(),
        gridSelectionAnchorId: null,
      });
      if (window.electronAPI) {
        void window.electronAPI.saveConfig(newSettings).catch((err) => {
          console.warn('[store] Failed to save directory settings:', err);
        });
      }
    } else {
      set({
        directory: null,
        directories: [],
        videos: [],
        filteredVideos: [],
        stats: computeStats([]),
        folderFilterPath: null,
        reviewMode: false,
        reviewIndex: 0,
        duplicateGroupsMode: false,
        duplicateGroups: [],
        duplicateProgress: null,
        duplicateFilter: false,
        duplicatePathFilter: '',
        duplicateMinSimilarity: 0,
        duplicateSortBy: 'similarity',
        duplicateSortOrder: 'desc',
        undoStack: [],
        gridSelectionIds: new Set(),
        gridSelectionAnchorId: null,
      });
    }
  },

  addDirectory: (dir: string) => {
    const state = get();
    const nextDirs = uniqueDirectories([...state.directories, dir]);
    const existing = state.settings.recentDirectories.filter((d) => d !== dir);
    const updated = [dir, ...existing].slice(0, 8);
    const nextTimestamps = { ...state.settings.recentDirectoryTimestamps, [dir]: Date.now() };
    const prunedTimestamps: Record<string, number> = {};
    for (const p of updated) {
      if (nextTimestamps[p]) prunedTimestamps[p] = nextTimestamps[p];
    }
    const newSettings = {
      ...state.settings,
      recentDirectories: updated,
      recentDirectoryTimestamps: prunedTimestamps,
    };
    set({
      directory: nextDirs[0] ?? null,
      directories: nextDirs,
      settings: newSettings,
      folderFilterPath: null,
      reviewIndex: 0,
    });
    if (window.electronAPI) {
      void window.electronAPI.saveConfig(newSettings).catch((err) => {
        console.warn('[store] Failed to save directory settings:', err);
      });
    }
  },

  setDirectories: (dirs: string[]) => {
    const nextDirs = uniqueDirectories(dirs);
    set({
      directory: nextDirs[0] ?? null,
      directories: nextDirs,
      folderFilterPath: null,
      reviewIndex: 0,
      gridSelectionIds: new Set(),
      gridSelectionAnchorId: null,
    });
  },

  setIncludeSubfolders: (val: boolean) => set({ includeSubfolders: val }),

  setVideos: (videos: Video[]) => {
    const previousVideos = get().videos;
    const shouldClearDuplicates = !sameVideoIdentitySet(previousVideos, videos);
    const orderedVideos = videos.map((video) => ({
      ...video,
      thumbnails: orderedThumbnails(video.thumbnails),
    }));
    const nextVideos = shouldClearDuplicates
      ? applyDuplicateGroupsToVideos(orderedVideos, [])
      : orderedVideos;
    const state = {
      ...get(),
      videos: nextVideos,
      duplicateGroups: shouldClearDuplicates ? [] : get().duplicateGroups,
      duplicateGroupsMode: shouldClearDuplicates ? false : get().duplicateGroupsMode,
      duplicateFilter: shouldClearDuplicates ? false : get().duplicateFilter,
    };
    set({
      videos: nextVideos,
      filteredVideos: computeFiltered(state),
      stats: computeStats(nextVideos),
      ...(shouldClearDuplicates ? {
        duplicateGroups: [],
        duplicateGroupsMode: false,
        duplicateFilter: false,
      } : {}),
    });
  },

  updateVideoThumbnailsBatch: (batch) => {
    const startedAt = import.meta.env.DEV ? performance.now() : 0;
    const stateBefore = get();
    const videos = [...stateBefore.videos];
    const indexById = new Map(videos.map((video, index) => [video.id, index]));
    let changed = false;
    const changedFields = new Set<InvalidationField>();
    const videosToPersist = new Map<string, Video>();
    for (const item of batch) {
      const vIdx = indexById.get(item.videoId);
      if (vIdx === undefined) continue;

      const previousVideo = videos[vIdx];
      const nextVideo: Video = {
        ...previousVideo,
        thumbnails: item.thumbnails ? orderedThumbnails(item.thumbnails) : previousVideo.thumbnails,
        durationSecs: item.durationSecs ?? previousVideo.durationSecs,
        metadataDate: item.metadataDate ?? previousVideo.metadataDate,
        videoCodec: item.videoCodec ?? previousVideo.videoCodec,
        audioCodec: item.audioCodec ?? previousVideo.audioCodec,
        videoBitrate: item.videoBitrate ?? previousVideo.videoBitrate,
        audioBitrate: item.audioBitrate ?? previousVideo.audioBitrate,
        totalBitrate: item.totalBitrate ?? previousVideo.totalBitrate,
        metadataCheckedAt: item.metadataCheckedAt ?? previousVideo.metadataCheckedAt,
        metadataVersion: item.metadataVersion ?? previousVideo.metadataVersion,
        metadataFailedAt: item.metadataFailedAt ?? previousVideo.metadataFailedAt,
        metadataFailureReason: item.metadataFailureReason ?? previousVideo.metadataFailureReason,
        containerFormat: item.containerFormat ?? previousVideo.containerFormat,
        width: item.width ?? previousVideo.width,
        height: item.height ?? previousVideo.height,
        fps: item.fps ?? previousVideo.fps,
        compatible: item.compatible ?? previousVideo.compatible,
      };

      const changedThumbnails = !arraysEqual(previousVideo.thumbnails, nextVideo.thumbnails);
      const changedDuration = previousVideo.durationSecs !== nextVideo.durationSecs;
      const changedMetadataDate = previousVideo.metadataDate !== nextVideo.metadataDate;
      const changedResolution = previousVideo.width !== nextVideo.width || previousVideo.height !== nextVideo.height;
      const changedFps = previousVideo.fps !== nextVideo.fps;
      const changedCompatibility = previousVideo.compatible !== nextVideo.compatible;
      const changedMetadata =
        previousVideo.videoCodec !== nextVideo.videoCodec ||
        previousVideo.audioCodec !== nextVideo.audioCodec ||
        previousVideo.videoBitrate !== nextVideo.videoBitrate ||
        previousVideo.audioBitrate !== nextVideo.audioBitrate ||
        previousVideo.totalBitrate !== nextVideo.totalBitrate ||
        previousVideo.metadataCheckedAt !== nextVideo.metadataCheckedAt ||
        previousVideo.metadataVersion !== nextVideo.metadataVersion ||
        previousVideo.metadataFailedAt !== nextVideo.metadataFailedAt ||
        previousVideo.metadataFailureReason !== nextVideo.metadataFailureReason ||
        previousVideo.containerFormat !== nextVideo.containerFormat;

      if (!changedThumbnails && !changedDuration && !changedMetadataDate && !changedResolution && !changedFps && !changedCompatibility && !changedMetadata) {
        continue;
      }

      if (changedThumbnails) changedFields.add('thumbnails');
      if (changedDuration) changedFields.add('duration');
      if (changedMetadataDate) changedFields.add('metadataDate');
      if (changedResolution) changedFields.add('resolution');
      if (changedFps) changedFields.add('fps');
      if (changedCompatibility) changedFields.add('compatible');

      videos[vIdx] = nextVideo;
      if (item.thumbnails) videosToPersist.set(item.videoId, nextVideo);
      changed = true;
    }
    if (!changed) return;
    set(buildVideoStateUpdate(stateBefore, videos, changedFields));

    const stateNow = get();
    if (videosToPersist.size > 0) {
      persistChangedVideos(stateNow.directory, stateNow.directories, Array.from(videosToPersist.values()));
    }
    recordDevPerf('updateVideoThumbnailsBatch', performance.now() - startedAt, { items: batch.length });
  },

  setVideoStatus: (videoId: string, status: VideoStatus) => {
    const stateBefore = get();
    const prev = stateBefore.videos.find((v) => v.id === videoId);
    if (!prev) return;
    if (prev.status === status) return;

    const undoEntry: UndoEntry = {
      videoId,
      previousStatus: prev.status,
      previousIndex: stateBefore.reviewIndex,
    };
    const undoStack = [...stateBefore.undoStack, undoEntry];

    const videos = stateBefore.videos.map((v) =>
      v.id === videoId ? { ...v, status } : v
    );
    const updatedVideo = videos.find((v) => v.id === videoId);
    set(buildVideoStateUpdate(stateBefore, videos, ['status'], {
      recomputeStats: true,
      undoStack,
    }));

    const stateNow = get();
    persistChangedVideos(stateNow.directory, stateNow.directories, updatedVideo ? [updatedVideo] : []);
  },

  setVideoStatusesBatch: (videoIds: string[], status: VideoStatus) => {
    if (videoIds.length === 0) return;
    const stateBefore = get();
    const targetIds = new Set(videoIds);
    const previousStatuses: Record<string, VideoStatus> = {};
    let changed = false;

    const videos = stateBefore.videos.map((video) => {
      if (!targetIds.has(video.id) || video.status === status) return video;
      previousStatuses[video.id] = video.status;
      changed = true;
      return { ...video, status };
    });

    if (!changed) return;

    const changedIds = new Set(Object.keys(previousStatuses));
    const changedVideos = videos.filter((video) => changedIds.has(video.id));
    const undoEntry: UndoEntry = {
      videoId: videoIds[0],
      previousStatus: previousStatuses[videoIds[0]] ?? status,
      previousIndex: stateBefore.reviewIndex,
      videoIds: Object.keys(previousStatuses),
      previousStatuses,
    };

    const undoStack = [...stateBefore.undoStack, undoEntry];
    set(buildVideoStateUpdate(stateBefore, videos, ['status'], {
      recomputeStats: true,
      undoStack,
    }));

    const stateNow = get();
    persistChangedVideosAtomic(stateNow.directory, stateNow.directories, changedVideos);
  },

  setVideoRating: (videoId, rating) => {
    const stateBefore = get();
    let updatedVideo: Video | null = null;
    const videos = stateBefore.videos.map((video) => {
      if (video.id !== videoId || video.rating === rating) return video;
      updatedVideo = { ...video, rating };
      return updatedVideo;
    });
    if (!updatedVideo) return;
    set(buildVideoStateUpdate(stateBefore, videos, ['rating']));
    const stateNow = get();
    persistChangedVideos(stateNow.directory, stateNow.directories, [updatedVideo]);
  },

  toggleFavorite: (videoId) => {
    const stateBefore = get();
    let updatedVideo: Video | null = null;
    const videos = stateBefore.videos.map((video) => {
      if (video.id !== videoId) return video;
      updatedVideo = { ...video, favorite: !video.favorite };
      return updatedVideo;
    });
    if (!updatedVideo) return;
    set(buildVideoStateUpdate(stateBefore, videos, ['favorite']));
    const stateNow = get();
    persistChangedVideos(stateNow.directory, stateNow.directories, [updatedVideo]);
  },

  undo: () => {
    const stateBefore = get();
    const stack = [...stateBefore.undoStack];
    if (stack.length === 0) return;
    const action = stack.pop()!;

    const videos = stateBefore.videos.map((v) => {
      if (action.videoIds && action.previousStatuses && action.videoIds.includes(v.id)) {
        return { ...v, status: action.previousStatuses[v.id] ?? v.status };
      }
      if (v.id === action.videoId) {
        return { ...v, status: action.previousStatus };
      }
      return v;
    });
    const restoredVideos = action.videoIds ? videos.filter((v) => action.videoIds?.includes(v.id)) : videos.filter((v) => v.id === action.videoId);
    set(buildVideoStateUpdate(stateBefore, videos, ['status'], {
      recomputeStats: true,
      reviewIndex: action.previousIndex,
      undoStack: stack,
    }));

    const stateNow = get();
    persistChangedVideos(stateNow.directory, stateNow.directories, restoredVideos);
  },

  // ── Filter/Sort ──
  setStatusFilter: (filter: StatusFilter) => {
    const state = { ...get(), statusFilter: filter };
    set({ statusFilter: filter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setSortBy: (sortBy: SortField) => {
    const state = { ...get(), sortBy };
    set({ sortBy, filteredVideos: computeFiltered(state) });
  },

  setSortOrder: (sortOrder: SortOrder) => {
    const state = { ...get(), sortOrder };
    set({ sortOrder, filteredVideos: computeFiltered(state) });
  },

  setMinSizeFilter: (minSizeFilter: number) => {
    const state = { ...get(), minSizeFilter };
    set({ minSizeFilter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },
  setSizeFilterRange: (minSizeFilter: number, maxSizeFilter: number | null) => {
    const safeMin = Math.max(0, Math.floor(minSizeFilter));
    const safeMax = maxSizeFilter === null ? null : Math.max(safeMin, Math.floor(maxSizeFilter));
    const state = { ...get(), minSizeFilter: safeMin, maxSizeFilter: safeMax };
    set({ minSizeFilter: safeMin, maxSizeFilter: safeMax, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setMinDurationFilter: (minDurationFilter: number) => {
    const state = { ...get(), minDurationFilter };
    set({ minDurationFilter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },
  setDurationFilterRange: (minDurationFilter: number, maxDurationFilter: number | null) => {
    const safeMin = Math.max(0, Math.floor(minDurationFilter));
    const safeMax = maxDurationFilter === null ? null : Math.max(safeMin, Math.floor(maxDurationFilter));
    const state = { ...get(), minDurationFilter: safeMin, maxDurationFilter: safeMax };
    set({ minDurationFilter: safeMin, maxDurationFilter: safeMax, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setFolderFilterPath: (folderFilterPath: string | null) => {
    const state = { ...get(), folderFilterPath };
    set({ folderFilterPath, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setMinRatingFilter: (minRatingFilter: RatingFilter) => {
    const state = { ...get(), minRatingFilter };
    set({ minRatingFilter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setFavoritesFilter: (favoritesFilter: boolean) => {
    const state = { ...get(), favoritesFilter };
    set({ favoritesFilter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setIncompatibleFilter: (incompatibleFilter: boolean) => {
    const state = { ...get(), incompatibleFilter };
    set({ incompatibleFilter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setDuplicateFilter: (duplicateFilter: boolean) => {
    const state = { ...get(), duplicateFilter };
    set({ duplicateFilter, filteredVideos: computeFiltered(state), reviewIndex: 0 });
  },

  setGroupByFolder: (groupByFolder: boolean) => {
    const state = { ...get(), groupByFolder };
    set({ groupByFolder, filteredVideos: computeFiltered(state) });
  },

  setFolderSortBy: (folderSortBy: FolderSortField) => {
    const state = { ...get(), folderSortBy };
    set({ folderSortBy, filteredVideos: computeFiltered(state) });
  },

  setFolderSortOrder: (folderSortOrder: SortOrder) => {
    const state = { ...get(), folderSortOrder };
    set({ folderSortOrder, filteredVideos: computeFiltered(state) });
  },

  // ── Scanning state ──
  setIsScanning: (isScanning: boolean) => set({ isScanning }),
  setScanProgress: (scanProgress: ScanProgress) => set({ scanProgress }),
  setIsGenerating: (isGenerating: boolean) => set({ isGenerating }),
  setGenProgress: (genProgress: ThumbProgress) => set({ genProgress }),

  // ── View ──
  setReviewMode: (reviewMode: boolean) => {
    const state = get();
    const activeVideo = reviewMode
      ? getVideoByReviewIndex(state.videos, state.reviewScopeIds, state.filteredVideos, state.reviewIndex)
      : null;
    set({
      reviewMode,
      reviewScopeIds: reviewMode ? state.reviewScopeIds : null,
      activeReviewVideoPath: reviewMode ? activeVideo?.path ?? state.activeReviewVideoPath : null,
    });
  },
  setReviewIndex: (reviewIndex: number) => {
    const state = get();
    const activeVideo = getVideoByReviewIndex(state.videos, state.reviewScopeIds, state.filteredVideos, reviewIndex);
    set({
      reviewIndex,
      activeReviewVideoPath: state.reviewMode ? activeVideo?.path ?? null : state.activeReviewVideoPath,
    });
  },
  setReviewScopeIds: (reviewScopeIds: string[] | null) => set({ reviewScopeIds: reviewScopeIds ? uniqueVideoIds(reviewScopeIds) : null }),
  setReviewAutoPlay: (reviewAutoPlay: boolean) => set({ reviewAutoPlay }),
  setActiveReviewVideoPath: (activeReviewVideoPath: string | null) => set({ activeReviewVideoPath }),
  setDuplicateGroupsMode: (duplicateGroupsMode: boolean) => set({ duplicateGroupsMode }),
  setDuplicateGroups: (duplicateGroups) => {
    const stateBefore = get();
    const groupsWithKeepers = applyKeeperOrderToGroups(duplicateGroups, stateBefore.videos, stateBefore.settings.duplicates.keeperOrder);
    const videos = applyDuplicateGroupsToVideos(stateBefore.videos, groupsWithKeepers);
    set(buildVideoStateUpdate(stateBefore, videos, ['duplicate'], {
      duplicateGroups: groupsWithKeepers,
      duplicateGroupsMode: groupsWithKeepers.length > 0,
    }));
  },
  setManualDuplicateKeeper: (groupId, videoId) => {
    const stateBefore = get();
    const groupsWithOverride = stateBefore.duplicateGroups.map((group) => {
      if (group.id !== groupId) return group;
      return {
        ...group,
        manualSuggestedKeeperId: videoId && group.videoIds.includes(videoId) ? videoId : null,
      };
    });
    const groupsWithKeepers = applyKeeperOrderToGroups(
      groupsWithOverride,
      stateBefore.videos,
      stateBefore.settings.duplicates.keeperOrder
    );
    const videos = applyDuplicateGroupsToVideos(stateBefore.videos, groupsWithKeepers);
    set(buildVideoStateUpdate(stateBefore, videos, ['duplicate'], {
      duplicateGroups: groupsWithKeepers,
      duplicateGroupsMode: groupsWithKeepers.length > 0,
    }));
  },
  applyDuplicateResult: (result) => {
    const stateBefore = get();
    const groupsWithKeepers = result.groups
      ? applyKeeperOrderToGroups(result.groups, stateBefore.videos, stateBefore.settings.duplicates.keeperOrder)
      : [];
    const videos = result.groups
      ? applyDuplicateGroupsToVideos(stateBefore.videos, groupsWithKeepers)
      : applyDuplicateGroupsToVideos(stateBefore.videos, []);
    set(buildVideoStateUpdate(stateBefore, videos, ['duplicate'], {
      duplicateGroups: groupsWithKeepers,
      duplicateGroupsMode: groupsWithKeepers.length > 0,
    }));
  },
  addIgnoredDuplicatePairs: (pairKeys) => {
    const normalized = pairKeys
      .map(normalizeDuplicatePairKey)
      .filter((pairKey): pairKey is string => Boolean(pairKey));
    if (normalized.length === 0) return;

    const settings = get().settings;
    const existing = settings.duplicates.ignoredDuplicatePairs ?? [];
    const merged = Array.from(new Set([...existing, ...normalized]));
    if (merged.length === existing.length) return;

    const nextSettings = {
      ...settings,
      duplicates: {
        ...settings.duplicates,
        ignoredDuplicatePairs: merged,
      },
    };
    set({ settings: nextSettings });
    saveSettingsQuietly(nextSettings);
  },
  removeIgnoredDuplicatePairs: (pairKeys) => {
    const removeSet = new Set(
      pairKeys
        .map(normalizeDuplicatePairKey)
        .filter((pairKey): pairKey is string => Boolean(pairKey))
    );
    if (removeSet.size === 0) return;

    const settings = get().settings;
    const existing = settings.duplicates.ignoredDuplicatePairs ?? [];
    const remaining = existing.filter((pairKey) => !removeSet.has(pairKey));
    if (remaining.length === existing.length) return;

    const nextSettings = {
      ...settings,
      duplicates: {
        ...settings.duplicates,
        ignoredDuplicatePairs: remaining,
      },
    };
    set({ settings: nextSettings });
    saveSettingsQuietly(nextSettings);
  },
  clearIgnoredDuplicatePairs: () => {
    const settings = get().settings;
    if ((settings.duplicates.ignoredDuplicatePairs ?? []).length === 0) return;
    const nextSettings = {
      ...settings,
      duplicates: {
        ...settings.duplicates,
        ignoredDuplicatePairs: [],
      },
    };
    set({ settings: nextSettings });
    saveSettingsQuietly(nextSettings);
  },
  setDuplicateProgress: (duplicateProgress) => set({ duplicateProgress }),
  setIsFindingDuplicates: (isFindingDuplicates) => set({ isFindingDuplicates }),
  setDuplicateViewMode: (duplicateViewMode) => set({ duplicateViewMode }),
  setDuplicatePathFilter: (duplicatePathFilter) => set({ duplicatePathFilter }),
  setDuplicateMinSimilarity: (duplicateMinSimilarity) => set({ duplicateMinSimilarity: Math.max(0, Math.min(100, duplicateMinSimilarity)) }),
  setDuplicateSortBy: (duplicateSortBy) => set((state) => ({
    duplicateSortBy,
    duplicateSortOrder: state.duplicateSortBy === duplicateSortBy ? state.duplicateSortOrder : 'desc',
  })),
  setDuplicateSortOrder: (duplicateSortOrder) => set({ duplicateSortOrder }),
  setDuplicateScrollTop: (duplicateScrollTop) => set({ duplicateScrollTop: Math.max(0, duplicateScrollTop) }),
  clearDuplicateListFilters: () => set({
    duplicatePathFilter: '',
    duplicateMinSimilarity: 0,
    duplicateSortBy: 'similarity',
    duplicateSortOrder: 'desc',
  }),
  setGridSelectionIds: (gridSelectionIds) => set((state) => ({
    gridSelectionIds: typeof gridSelectionIds === 'function'
      ? gridSelectionIds(state.gridSelectionIds)
      : gridSelectionIds,
  })),
  setGridSelectionAnchorId: (gridSelectionAnchorId: string | null) => set({ gridSelectionAnchorId }),
  clearGridSelection: () => set({ gridSelectionIds: new Set(), gridSelectionAnchorId: null }),
  enterReviewAndPlay: (videoId: string, scopeIds?: string[]) => {
    const state = get();
    const reviewScopeIds = getReviewScopeIdsForVideo(videoId, scopeIds, state.videos, state.filteredVideos);
    const idx = reviewScopeIds.indexOf(videoId);
    if (idx < 0) return;
    const activeVideo = state.videos.find((video) => video.id === videoId) ?? null;
    set({
      reviewMode: true,
      reviewScopeIds,
      reviewIndex: idx,
      reviewAutoPlay: true,
      activeReviewVideoPath: activeVideo?.path ?? null,
    });
  },
  setCardScale: (cardScale: number) => set({ cardScale }),

  advanceReview: () => {
    const { reviewIndex, filteredVideos } = get();
    if (reviewIndex < filteredVideos.length - 1) {
      set({ reviewIndex: reviewIndex + 1 });
    }
  },

  // ── Batch delete ──
  removeDeletedVideos: (deletedPaths: string[]) => {
    const pathSet = new Set(deletedPaths);
    const videos = get().videos.filter((v) => !pathSet.has(v.path));

    // Prune deleted video IDs from duplicate groups and drop groups with < 2 members.
    const deletedVideoIds = new Set(
      get().videos.filter((v) => pathSet.has(v.path)).map((v) => v.id)
    );
    const prevGroups = get().duplicateGroups;
    const prunedGroups = deletedVideoIds.size > 0
      ? applyKeeperOrderToGroups(
        prevGroups
          .map((group) => ({
            ...group,
            videoIds: group.videoIds.filter((id) => !deletedVideoIds.has(id)),
            suggestedKeeperId: group.suggestedKeeperId && deletedVideoIds.has(group.suggestedKeeperId)
              ? null
              : group.suggestedKeeperId,
            manualSuggestedKeeperId: group.manualSuggestedKeeperId && deletedVideoIds.has(group.manualSuggestedKeeperId)
              ? null
              : group.manualSuggestedKeeperId,
          }))
          .filter((group) => group.videoIds.length >= 2),
        videos,
        get().settings.duplicates.keeperOrder
      )
      : prevGroups;
    const groupsChanged = prunedGroups !== prevGroups;

    const state = { ...get(), videos, duplicateGroups: prunedGroups };
    set({
      videos,
      filteredVideos: computeFiltered(state),
      stats: computeStats(videos),
      undoStack: [],
      ...(groupsChanged ? {
        duplicateGroups: prunedGroups,
        ...(prunedGroups.length === 0 ? { duplicateGroupsMode: false } : {}),
      } : {}),
    });
  },

  addBookmark: (videoId, time) => {
    const rounded = Math.round(time * 10) / 10;
    let updatedVideo: Video | null = null;
    const videos = get().videos.map((v) =>
      {
        if (v.id !== videoId) return v;
        const existing = v.bookmarks ?? [];
        if (existing.includes(rounded)) return v;
        updatedVideo = {
          ...v,
          bookmarks: [...existing, rounded].sort((a, b) => a - b),
        };
        return updatedVideo;
      }
    );
    if (!updatedVideo) return;
    set({ videos, filteredVideos: computeFiltered({ ...get(), videos }) });
    const stateNow = get();
    persistChangedVideos(stateNow.directory, stateNow.directories, [updatedVideo]);
  },

  removeBookmark: (videoId, time) => {
    let updatedVideo: Video | null = null;
    const videos = get().videos.map((v) =>
      {
        if (v.id !== videoId) return v;
        const existing = v.bookmarks ?? [];
        const nextBookmarks = existing.filter((t) => t !== time);
        if (nextBookmarks.length === existing.length) return v;
        updatedVideo = { ...v, bookmarks: nextBookmarks };
        return updatedVideo;
      }
    );
    if (!updatedVideo) return;
    set({ videos, filteredVideos: computeFiltered({ ...get(), videos }) });
    const stateNow = get();
    persistChangedVideos(stateNow.directory, stateNow.directories, [updatedVideo]);
  },

  clearRecentDirectories: () => {
    const { settings } = get();
    const nextSettings = {
      ...settings,
      recentDirectories: [],
      recentDirectoryTimestamps: {},
    };
    set({ settings: nextSettings });
    if (window.electronAPI) {
      void window.electronAPI.saveConfig(nextSettings);
    }
  },

  removeRecentDirectory: (dir: string) => {
    const { settings } = get();
    const nextRecentDirectories = settings.recentDirectories.filter((p) => p !== dir);
    const nextTimestamps = { ...settings.recentDirectoryTimestamps };
    delete nextTimestamps[dir];
    const nextSettings = {
      ...settings,
      recentDirectories: nextRecentDirectories,
      recentDirectoryTimestamps: nextTimestamps,
    };
    set({ settings: nextSettings });
    if (window.electronAPI) {
      void window.electronAPI.saveConfig(nextSettings);
    }
  },

  pushToast: (toast, kind = 'info') => {
    const input: ToastInput = typeof toast === 'string'
      ? { title: toast, kind }
      : { ...toast, kind: toast.kind ?? kind };
    const now = Date.now();
    pruneRecentToastKeys(now);

    if (input.dedupeKey) {
      const lastShown = recentToastByKey.get(input.dedupeKey) ?? 0;
      if (now - lastShown < TOAST_DEDUPE_WINDOW_MS) return;
      recentToastByKey.set(input.dedupeKey, now);
    }

    const toastKind = input.kind ?? 'info';
    const id = ++toastIdCounter;
    const duration = input.durationMs
      ?? (toastKind === 'error' || toastKind === 'warning' ? IMPORTANT_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS);

    set((state) => ({
      toasts: [
        ...state.toasts.slice(-(MAX_VISIBLE_TOASTS - 1)),
        {
          id,
          title: input.title,
          detail: input.detail,
          kind: toastKind,
          createdAt: now,
          actionLabel: input.actionLabel,
          action: input.action,
        },
      ],
    }));

    const timer = setTimeout(() => {
      toastTimers.delete(id);
      get().dismissToast(id);
    }, duration);
    toastTimers.set(id, timer);
  },

  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clearToasts: () => {
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
    recentToastByKey.clear();
    set({ toasts: [] });
  },

  // ── Settings ──
  setIsSettingsModalOpen: (val: boolean) => set({ isSettingsModalOpen: val }),
  updateSettings: (newSettings) => {
    const state = get();
    const mergedSettings = {
      ...state.settings,
      ...newSettings,
      features: {
        ...state.settings.features,
        ...(newSettings.features ?? {}),
      },
      duplicates: {
        ...state.settings.duplicates,
        ...(newSettings.duplicates ?? {}),
      },
    };
    const duplicateGroups = applyKeeperOrderToGroups(state.duplicateGroups, state.videos, mergedSettings.duplicates.keeperOrder);
    const videos = duplicateGroups.length > 0
      ? applyDuplicateGroupsToVideos(state.videos, duplicateGroups)
      : state.videos;
    const nextSortBy =
      (!mergedSettings.features.ratings && state.sortBy === 'rating') ||
      (!mergedSettings.features.codecBadges && (state.sortBy === 'resolution' || state.sortBy === 'fps'))
        ? 'name'
        : (newSettings.defaultSortBy ?? state.sortBy);
    const newState = {
      ...state,
      videos,
      duplicateGroups,
      settings: mergedSettings,
      cardScale: newSettings.defaultCardScale ?? state.cardScale,
      sortBy: nextSortBy,
      sortOrder: newSettings.defaultSortOrder ?? state.sortOrder,
      groupByFolder: newSettings.defaultGroupByFolder ?? state.groupByFolder,
      minRatingFilter: mergedSettings.features.ratings ? state.minRatingFilter : 0,
      favoritesFilter: mergedSettings.features.favorites ? state.favoritesFilter : false,
      incompatibleFilter: mergedSettings.features.compatibilityCheck ? state.incompatibleFilter : false,
    };
    set({
      ...newState,
      filteredVideos: computeFiltered(newState)
    });

    if (nextSortBy !== state.sortBy) {
      get().pushToast({
        title: 'Sort reset',
        detail: `${state.sortBy === 'rating' ? 'Rating' : 'Media'} sort was disabled, so sorting changed to Name.`,
        kind: 'warning',
        dedupeKey: 'settings-sort-reset',
      });
    }
    if (state.minRatingFilter > 0 && !mergedSettings.features.ratings) {
      get().pushToast({
        title: 'Filter cleared',
        detail: 'Rating filter was cleared because Ratings is disabled.',
        kind: 'warning',
        dedupeKey: 'settings-rated-filter-cleared',
      });
    }
    if (state.favoritesFilter && !mergedSettings.features.favorites) {
      get().pushToast({
        title: 'Filter cleared',
        detail: 'Favorites filter was cleared because Favorites is disabled.',
        kind: 'warning',
        dedupeKey: 'settings-favorites-filter-cleared',
      });
    }
    if (state.incompatibleFilter && !mergedSettings.features.compatibilityCheck) {
      get().pushToast({
        title: 'Filter cleared',
        detail: 'Incompatible filter was cleared because compatibility checks are disabled.',
        kind: 'warning',
        dedupeKey: 'settings-incompatible-filter-cleared',
      });
    }
  },
  saveSettings: async () => {
    const s = get().settings;
    if (window.electronAPI) {
      const ok = await window.electronAPI.saveConfig(s);
      if (!ok) throw new Error('saveConfig returned false');
    }
  },
  loadSettings: async () => {
    if (window.electronAPI) {
      const raw = await window.electronAPI.getConfig();
      if (raw) {
        let migrated = migrateSettings(raw as unknown as Record<string, unknown>);

        // Prune stale recent directories on app startup
        if (migrated.recentDirectories && migrated.recentDirectories.length > 0) {
          try {
            const pruned = await pruneRecentDirectories(
              migrated.recentDirectories,
              (path: string) => window.electronAPI!.validateDroppedPath(path)
            );
            const rawTimestamps = (migrated.recentDirectoryTimestamps ?? {}) as Record<string, number>;
            const prunedTimestamps: Record<string, number> = {};
            for (const p of pruned) {
              if (rawTimestamps[p]) prunedTimestamps[p] = rawTimestamps[p];
            }
            migrated = {
              ...migrated,
              recentDirectories: pruned,
              recentDirectoryTimestamps: prunedTimestamps,
            };
          } catch (err) {
            console.warn('[store] Failed to prune recent directories:', err);
          }
        }

        const fullSettings = { ...get().settings, ...migrated };
        set({
          settings: fullSettings,
          cardScale: fullSettings.defaultCardScale,
          sortBy: fullSettings.defaultSortBy,
          sortOrder: fullSettings.defaultSortOrder,
          groupByFolder: fullSettings.defaultGroupByFolder,
        });

        // Save pruned settings back to disk
        try {
          await window.electronAPI.saveConfig(fullSettings);
        } catch (err) {
          console.warn('[store] Failed to save pruned settings:', err);
        }
      }
    }
  },
}));

notifyToast = (toast, kind) => useStore.getState().pushToast(toast, kind);

export default useStore;
