// ── Video Status ────────────────────────────────────────────────────
export type VideoStatus = 'pending' | 'keep' | 'delete' | 'skipped';

export interface Video {
  id: string;
  filename: string;
  path: string;
  sizeBytes: number;
  date: number;
  metadataDate?: number | null;
  durationSecs: number | null;
  duplicateHash: string | null;
  status: VideoStatus;
  thumbnails: string[];
  osThumbnail?: string | null;
  bookmarks?: number[]; // seconds into the video
  rating: 0 | 1 | 2 | 3 | 4 | 5;
  favorite: boolean;
  compatible: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  videoBitrate?: number | null;
  audioBitrate?: number | null;
  totalBitrate?: number | null;
  metadataCheckedAt?: number | null;
  metadataVersion?: number | null;
  metadataFailedAt?: number | null;
  metadataFailureReason?: string | null;
  containerFormat: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  duplicateGroupId?: string | null;
  duplicateSimilarity?: number | null;
  duplicateMatchType?: DuplicateMatchType;
  duplicateSuggestedKeeper?: boolean;
  duplicateExact?: boolean;
  duplicateGroupSize?: number;
  duplicateMatchReason?: string | null;
}

export type MediaProbeVideoInput = Pick<Video, 'id' | 'filename' | 'path' | 'sizeBytes' | 'date'>;

// ── Progress Events ────────────────────────────────────────────────
export interface ScanProgress {
  found: number;
  currentFile: string;
}

export interface ScanSummary {
  skippedDirectoryCount: number;
  skippedDirectorySamples: Array<{ path: string; reason: string }>;
}

export type ScanDirectoryResult = Video[] | {
  videos: Video[];
  summary?: ScanSummary;
};

export interface ThumbProgress {
  current: number;
  total: number;
  phase?: 'thumbnails' | 'metadata' | 'media';
}

export interface ThumbReadyEvent {
  videoId: string;
  thumbnails?: string[];
  durationSecs?: number;
  metadataDate?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  videoBitrate?: number | null;
  audioBitrate?: number | null;
  totalBitrate?: number | null;
  metadataCheckedAt?: number | null;
  metadataVersion?: number | null;
  metadataFailedAt?: number | null;
  metadataFailureReason?: string | null;
  containerFormat?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  compatible?: boolean;
}

// ── Delete Result ──────────────────────────────────────────────────
export interface DeleteResult {
  path: string;
  success: boolean;
  error?: string;
  method?: 'trash' | 'permanent';
  removedFolder?: string;
}

// ── Statistics ─────────────────────────────────────────────────────
export interface VideoStats {
  total: number;
  pending: number;
  skipped: number;
  keep: number;
  delete: number;
  totalSize: number;
  deleteSize: number;
}

export interface SidebarAggregates {
  maxSizeBytes: number;
  maxDurationSeconds: number;
  duplicateCount: number;
  incompatibleCount: number;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastNotification {
  id: number;
  title: string;
  detail?: string;
  kind: ToastKind;
  createdAt: number;
  actionLabel?: string;
  action?: () => void;
}

export interface ToastInput {
  title: string;
  detail?: string;
  kind?: ToastKind;
  dedupeKey?: string;
  durationMs?: number;
  actionLabel?: string;
  action?: () => void;
}

// ── Sort & Filter ──────────────────────────────────────────────────
export type SortField = 'name' | 'size' | 'duration' | 'date' | 'rating' | 'resolution' | 'fps';
export type FolderSortField = 'name' | 'size';
export type SortOrder = 'asc' | 'desc';
export type StatusFilter = 'all' | VideoStatus;
export type RatingFilter = 0 | 1 | 2 | 3 | 4 | 5;
export type CacheLocationMode = 'centralised' | 'per-drive' | 'distributed';
export type DuplicateMatchType = 'exact' | 'phash' | 'visual' | 'mixed' | null;
export type DuplicateComparisonMode = 'phash' | 'visual';
export type DuplicateViewMode = 'rows' | 'gallery';
export type DuplicateSortField = 'similarity' | 'groupSize' | 'totalSize';
export type DuplicateScope = 'all' | 'filtered';
export type DuplicateSamplingWindow = 'even' | '25-75' | '20-80' | '15-85' | 'custom';

export interface FeatureSettings {
  ratings: boolean;
  favorites: boolean;
  codecBadges: boolean;
  compatibilityCheck: boolean;
  globalMute: boolean;
  nextUndecided: boolean;
}

export interface DuplicateSettings {
  enabled: boolean;
  runAfterScan: boolean;
  comparisonMode: DuplicateComparisonMode;
  sampleCount: 1 | 2 | 3 | 4 | 5 | 7 | 9;
  defaultScope: DuplicateScope;
  protectKeep: boolean;
  protectSkipped: boolean;
  keeperOrder: string[];
  samplingWindow: DuplicateSamplingWindow;
  customStartPercent: number;
  customEndPercent: number;
  similarityThreshold?: number;
  finalSimilarityThreshold: number;
  durationTolerancePercent: number;
  requireEverySample: boolean;
  ignoreBlackPixels: boolean;
  ignoreWhitePixels: boolean;
  compareFlipped: boolean;
  maxSamplingDuration: number;
  retryFailedFingerprintExtraction: boolean;
  checkpointIntervalMinutes: number;
  ignoredDuplicatePairs: string[];
}

export interface DuplicateGroup {
  id: string;
  videoIds: string[];
  similarity: number;
  matchType: Exclude<DuplicateMatchType, null>;
  suggestedKeeperId: string | null;
  manualSuggestedKeeperId?: string | null;
  reason: string;
  exactVideoIds?: string[];
}

export interface DuplicateProgress {
  stage: 'Preparing' | 'Building fingerprints' | 'Checking exact matches' | 'Comparing pHashes' | 'Finding candidates' | 'Confirming visual matches' | 'Building groups' | 'Done' | 'Cancelled' | 'Error';
  current: number;
  total: number;
  message?: string;
}

export interface DuplicateResult {
  status: 'ok' | 'cancelled' | 'error';
  groups?: DuplicateGroup[];
  videos?: Array<Pick<Video, 'id' | 'duplicateGroupId' | 'duplicateSimilarity' | 'duplicateMatchType' | 'duplicateSuggestedKeeper' | 'duplicateExact' | 'duplicateGroupSize' | 'duplicateMatchReason'>>;
  stats?: {
    groupCount: number;
    duplicateVideoCount: number;
    exactGroupCount: number;
    similarityGroupCount: number;
  };
  error?: string;
}

// ── Undo Entry ─────────────────────────────────────────────────────
export interface UndoEntry {
  videoId: string;
  previousStatus: VideoStatus;
  previousIndex: number;
  videoIds?: string[];
  previousStatuses?: Record<string, VideoStatus>;
}

// ── Settings ───────────────────────────────────────────────────────
import type { Keybind } from './keybinds';

export interface AppSettings {
  cacheLocation: CacheLocationMode;
  centralCachePath: string | null;
  perDriveCachePaths: Record<string, string>;
  autoPruneMissingSubfolderCache: boolean;
  removeEmptyFoldersAfterDelete: boolean;
  thumbsPerVideo: 1 | 2 | 4 | 6 | 9;
  defaultCardScale: number;
  defaultSortBy: SortField;
  defaultSortOrder: SortOrder;
  defaultGroupByFolder: boolean;
  maxConcurrent: number | 'auto';
  cpuThreadsLimited: boolean;
  skipIntroDelaySecs: number;
  hardwareAccel: boolean;
  recentDirectories: string[];
  recentDirectoryTimestamps: Record<string, number>;
  autoUpdates: boolean;
  globalMute: boolean;
  features: FeatureSettings;
  duplicates: DuplicateSettings;
  // Review mode — context-independent
  keyKeep: Keybind;
  keyDelete: Keybind;
  keySkip: Keybind;
  keyReset: Keybind;
  keyUndo: Keybind;
  keyPlay: Keybind;
  keyEnterPlay: Keybind;
  keyExternalPlayer: Keybind;
  keyNextUndecided: Keybind;
  // Review mode — not playing
  keyPrevVideo: Keybind;
  keyNextVideo: Keybind;
  // Review mode — playing
  keySeekBack: Keybind;
  keySeekForward: Keybind;
  keySpeedDown: Keybind;
  keySpeedUp: Keybind;
  keyBookmark: Keybind;
  // Preview modal
  keyPreviewSeekBack: Keybind;
  keyPreviewSeekForward: Keybind;
  // Global
  keyShowHelp: Keybind;
  keyGlobalMute: Keybind;
}

// ── Store State ────────────────────────────────────────────────────
export interface VideoStore {
  // Directory
  directory: string | null;
  directories: string[];
  includeSubfolders: boolean;

  // Videos
  videos: Video[];
  filteredVideos: Video[];

  // Scanning
  isScanning: boolean;
  scanProgress: ScanProgress;

  // Thumbnail generation
  isGenerating: boolean;
  genProgress: ThumbProgress;

  // Filters & Sort
  searchQuery: string;
  statusFilter: StatusFilter;
  sortBy: SortField;
  sortOrder: SortOrder;
  minSizeFilter: number;
  maxSizeFilter: number | null;
  minDurationFilter: number;
  maxDurationFilter: number | null;
  folderFilterPath: string | null;
  minRatingFilter: RatingFilter;
  favoritesFilter: boolean;
  incompatibleFilter: boolean;
  duplicateFilter: boolean;
  groupByFolder: boolean;
  folderSortBy: FolderSortField;
  folderSortOrder: SortOrder;

  // Settings
  settings: AppSettings;
  isSettingsModalOpen: boolean;

  // View Mode
  reviewMode: boolean;
  reviewIndex: number;
  reviewScopeIds: string[] | null;
  reviewAutoPlay: boolean;
  activeReviewVideoPath: string | null;
  duplicateGroupsMode: boolean;
  duplicateGroups: DuplicateGroup[];
  duplicateProgress: DuplicateProgress | null;
  isFindingDuplicates: boolean;
  duplicateViewMode: DuplicateViewMode;
  duplicatePathFilter: string;
  duplicateMinSimilarity: number;
  duplicateSortBy: DuplicateSortField;
  duplicateSortOrder: SortOrder;
  duplicateScrollTop: number;
  gridSelectionIds: Set<string>;
  gridSelectionAnchorId: string | null;
  // Card sizing
  cardScale: number;

  // Undo
  undoStack: UndoEntry[];

  // Statistics
  stats: VideoStats;
  sidebarAggregates: SidebarAggregates;

  // Notifications
  toasts: ToastNotification[];

  // Actions
  setDirectory: (dir: string | null) => void;
  addDirectory: (dir: string) => void;
  setDirectories: (dirs: string[]) => void;
  setIncludeSubfolders: (val: boolean) => void;
  setVideos: (videos: Video[]) => void;
  updateVideoThumbnailsBatch: (batch: ThumbReadyEvent[]) => void;
  setVideoStatus: (videoId: string, status: VideoStatus) => void;
  undo: () => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setSortBy: (sortBy: SortField) => void;
  setSortOrder: (sortOrder: SortOrder) => void;
  setMinSizeFilter: (minSize: number) => void;
  setSizeFilterRange: (minSize: number, maxSize: number | null) => void;
  setMinDurationFilter: (seconds: number) => void;
  setDurationFilterRange: (minSeconds: number, maxSeconds: number | null) => void;
  setFolderFilterPath: (folderPath: string | null) => void;
  setMinRatingFilter: (rating: RatingFilter) => void;
  setFavoritesFilter: (val: boolean) => void;
  setIncompatibleFilter: (val: boolean) => void;
  setDuplicateFilter: (val: boolean) => void;
  setGroupByFolder: (val: boolean) => void;
  setFolderSortBy: (sortBy: FolderSortField) => void;
  setFolderSortOrder: (order: SortOrder) => void;
  setIsScanning: (val: boolean) => void;
  setScanProgress: (progress: ScanProgress) => void;
  setIsGenerating: (val: boolean) => void;
  setGenProgress: (progress: ThumbProgress) => void;
  setReviewMode: (val: boolean) => void;
  setReviewIndex: (idx: number) => void;
  setReviewScopeIds: (ids: string[] | null) => void;
  setReviewAutoPlay: (val: boolean) => void;
  setActiveReviewVideoPath: (path: string | null) => void;
  setDuplicateGroupsMode: (val: boolean) => void;
  setDuplicateGroups: (groups: DuplicateGroup[]) => void;
  setManualDuplicateKeeper: (groupId: string, videoId: string | null) => void;
  applyDuplicateResult: (result: DuplicateResult) => void;
  addIgnoredDuplicatePairs: (pairKeys: string[]) => void;
  removeIgnoredDuplicatePairs: (pairKeys: string[]) => void;
  clearIgnoredDuplicatePairs: () => void;
  setDuplicateProgress: (progress: DuplicateProgress | null) => void;
  setIsFindingDuplicates: (val: boolean) => void;
  setDuplicateViewMode: (mode: DuplicateViewMode) => void;
  setDuplicatePathFilter: (pathFilter: string) => void;
  setDuplicateMinSimilarity: (similarity: number) => void;
  setDuplicateSortBy: (sortBy: DuplicateSortField) => void;
  setDuplicateSortOrder: (order: SortOrder) => void;
  setDuplicateScrollTop: (scrollTop: number) => void;
  clearDuplicateListFilters: () => void;
  setGridSelectionIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setGridSelectionAnchorId: (videoId: string | null) => void;
  clearGridSelection: () => void;
  enterReviewAndPlay: (videoId: string, scopeIds?: string[]) => void;
  setCardScale: (scale: number) => void;
  advanceReview: () => void;
  removeDeletedVideos: (deletedPaths: string[]) => void;
  addBookmark: (videoId: string, time: number) => void;
  removeBookmark: (videoId: string, time: number) => void;
  clearRecentDirectories: () => void;
  removeRecentDirectory: (dir: string) => void;
  setVideoStatusesBatch: (videoIds: string[], status: VideoStatus) => void;
  setVideoRating: (videoId: string, rating: 0 | 1 | 2 | 3 | 4 | 5) => void;
  toggleFavorite: (videoId: string) => void;
  pushToast: (toast: ToastInput | string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  clearToasts: () => void;

  // Settings Actions
  setIsSettingsModalOpen: (val: boolean) => void;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  saveSettings: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

// ── Auto-update ────────────────────────────────────────────────────
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error';

export interface UpdateInfo {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  message?: string;
}

export interface PerfCounterSample {
  count: number;
  total: number;
  max: number;
}

export interface PerfTimingSample {
  count: number;
  totalMs: number;
  maxMs: number;
  totalItems: number;
}

export interface PerfRunSnapshot {
  id: number;
  name: string;
  meta: Record<string, unknown>;
  extra: Record<string, unknown>;
  durationMs: number;
  counters: Record<string, PerfCounterSample>;
  timings: Record<string, PerfTimingSample>;
  finishedAt: number;
}

export interface PerformanceStatsSnapshot {
  counters: Record<string, PerfCounterSample>;
  timings: Record<string, PerfTimingSample>;
  latestRuns: Record<string, PerfRunSnapshot>;
}

export interface RendererPerformanceSnapshot {
  counters: Record<string, PerfCounterSample>;
  timings: Record<string, PerfTimingSample>;
  latestRuns: Record<string, never>;
}

export interface RendererMemorySnapshot {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

export interface MainProcessMemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface ElectronProcessMemorySnapshot {
  privateKb: number | null;
  residentSetKb: number | null;
  sharedKb: number | null;
}

export interface AppProcessMetricSnapshot {
  cpuPercent: number;
  creationTime: number;
  memory: ElectronProcessMemorySnapshot;
  pid: number;
  serviceName: string;
  type: string;
}

export interface MainIdleDiagnosticsSnapshot {
  activeBatchIntervalCount: number;
  activeCacheRootCount: number;
  activeDuplicateRun: boolean;
  appMetrics: AppProcessMetricSnapshot[];
  eventLoopUtilization: number | null;
  knownVideoCount: number;
  loadedRootCount: number;
  memory: MainProcessMemorySnapshot;
  pid: number;
  rendererMemory: ElectronProcessMemorySnapshot | null;
  rendererProcessId: number | null;
  timestamp: number;
  windowMinimized: boolean;
  windowVisible: boolean;
}

export interface RendererIdleDiagnosticsSnapshot {
  hidden: boolean;
  memory: RendererMemorySnapshot | null;
  mountedVideoCardCount: number;
  perf: RendererPerformanceSnapshot;
  timestamp: number;
  videoElementCount: number;
  visibilityState: DocumentVisibilityState | 'unknown';
}

export interface IdleDiagnosticsSnapshot {
  main: MainIdleDiagnosticsSnapshot | undefined;
  renderer: RendererIdleDiagnosticsSnapshot;
}

// ── Electron API (exposed via preload) ─────────────────────────────
export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  getPathForFile: (file: File) => string;
  validateDroppedPath: (droppedPath: string) => Promise<{ valid: boolean; isDirectory: boolean }>;
  openInExplorer: (filePath: string) => Promise<void>;
  scanDirectory: (dirPath: string, includeSubfolders: boolean) => Promise<ScanDirectoryResult>;
  resetLoadedDirectories: () => Promise<boolean>;
  onScanProgress: (callback: (data: ScanProgress) => void) => () => void;
  processMetadata: (videos: MediaProbeVideoInput[], dirPath: string, options?: { force?: boolean }) => Promise<boolean>;
  onMetadataProgress: (callback: (data: ThumbProgress) => void) => () => void;
  onMetadataReadyBatch: (callback: (batch: ThumbReadyEvent[]) => void) => () => void;
  generateThumbnails: (videos: Video[], dirPath: string, options?: { force?: boolean }) => Promise<boolean>;
  cancelGeneration: () => Promise<boolean>;
  onThumbProgress: (callback: (data: ThumbProgress) => void) => () => void;
  onThumbReadyBatch: (callback: (batch: ThumbReadyEvent[]) => void) => () => void;
  findDuplicates: (videos: Video[], options?: { settings?: Partial<DuplicateSettings> }) => Promise<DuplicateResult>;
  cancelDuplicateDetection: () => Promise<boolean>;
  onDuplicateProgress: (callback: (data: DuplicateProgress) => void) => () => void;
  onMenuAction: (callback: (action: string) => void) => () => void;
  saveCache: (dirPath: string, videos: Video[]) => Promise<boolean>;
  saveCacheAtomic: (dirPath: string, videos: Video[]) => Promise<boolean>;
  clearCache: (dirPath: string) => Promise<boolean>;
  batchDelete: (filePaths: string[]) => Promise<DeleteResult[]>;
  exportReport: (videos: Video[], dirPaths: string[]) => Promise<'saved' | 'cancelled' | 'error'>;
  chooseReportScope: () => Promise<'all' | 'filtered' | null>;
  setExportReportAvailable: (enabled: boolean) => void;
  openVideo: (filePath: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<boolean>;
  setVideoFullscreen: (fullscreen: boolean) => Promise<boolean>;
  getConfig: () => Promise<AppSettings | null>;
  saveConfig: (config: AppSettings) => Promise<boolean>;
  getAutoConcurrency: (config?: AppSettings) => Promise<number>;
  getPerformanceStats: () => Promise<PerformanceStatsSnapshot>;
  getIdleDiagnostics: () => Promise<MainIdleDiagnosticsSnapshot>;
  resetPerformanceStats: () => Promise<boolean>;
  validateCacheLocation: (dirPath: string, expectedDriveKey?: string | null) => Promise<{ ok: boolean; error?: string }>;
  confirmDistributedMode: () => Promise<boolean>;
  confirmThumbnailRebuild: (fromCount: number, toCount: number, videoCount: number) => Promise<boolean>;
  migrateCacheSettings: (
    oldSettings: AppSettings,
    newSettings: AppSettings,
    loadedDirs: string[]
  ) => Promise<{ status: 'unchanged' | 'no-cache' | 'cancelled' | 'fresh' | 'migrated' | 'partial' | 'error'; migrated: number; errors: string[] }>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; status: string; error?: string }>;
  installUpdate: () => Promise<boolean>;
  onUpdateStatus: (callback: (data: UpdateInfo) => void) => () => void;
  reportRendererError: (payload: {
    kind: string;
    message: string;
    stack?: string | null;
    componentStack?: string | null;
    source?: string | null;
    lineno?: number | null;
    colno?: number | null;
  }) => void;
  onAppNotification: (callback: (data: ToastInput) => void) => () => void;
}

// ── Global augmentation ────────────────────────────────────────────
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __VIDEO_CULL_DEV_PERF__?: {
      getSnapshot: () => RendererPerformanceSnapshot;
      getCombinedSnapshot: () => Promise<{
        renderer: RendererPerformanceSnapshot;
        main: PerformanceStatsSnapshot | undefined;
      }>;
      getIdleDiagnostics: () => Promise<IdleDiagnosticsSnapshot>;
      getIdleSamples: () => IdleDiagnosticsSnapshot[];
      clearIdleSamples: () => void;
      startIdleMonitor: (intervalMs?: number) => void;
      stopIdleMonitor: () => void;
      reset: () => void;
      resetAll: () => Promise<void>;
    };
  }
}
