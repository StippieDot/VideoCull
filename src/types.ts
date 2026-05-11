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
  containerFormat: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

// ── Progress Events ────────────────────────────────────────────────
export interface ScanProgress {
  found: number;
  currentFile: string;
}

export interface ThumbProgress {
  current: number;
  total: number;
  phase?: 'thumbnails' | 'metadata' | 'media';
}

export interface ThumbReadyEvent {
  videoId: string;
  thumbnails: string[];
  durationSecs?: number;
  metadataDate?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
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

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastNotification {
  id: number;
  title: string;
  detail?: string;
  kind: ToastKind;
  createdAt: number;
}

export interface ToastInput {
  title: string;
  detail?: string;
  kind?: ToastKind;
  dedupeKey?: string;
  durationMs?: number;
}

// ── Sort & Filter ──────────────────────────────────────────────────
export type SortField = 'name' | 'size' | 'duration' | 'date' | 'rating' | 'resolution' | 'fps';
export type FolderSortField = 'name' | 'size';
export type SortOrder = 'asc' | 'desc';
export type StatusFilter = 'all' | VideoStatus;
export type RatingFilter = 0 | 1 | 2 | 3 | 4 | 5;
export type CacheLocationMode = 'centralised' | 'per-drive' | 'distributed';

export interface FeatureSettings {
  ratings: boolean;
  favorites: boolean;
  analytics: boolean;
  codecBadges: boolean;
  compatibilityCheck: boolean;
  globalMute: boolean;
  nextUndecided: boolean;
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
  groupByFolder: boolean;
  folderSortBy: FolderSortField;
  folderSortOrder: SortOrder;

  // Settings
  settings: AppSettings;
  isSettingsModalOpen: boolean;

  // View Mode
  reviewMode: boolean;
  reviewIndex: number;
  reviewAutoPlay: boolean;
  activeReviewVideoPath: string | null;
  gridSelectionIds: Set<string>;
  gridSelectionAnchorId: string | null;
  // Card sizing
  cardScale: number;

  // Undo
  undoStack: UndoEntry[];

  // Statistics
  stats: VideoStats;

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
  setGroupByFolder: (val: boolean) => void;
  setFolderSortBy: (sortBy: FolderSortField) => void;
  setFolderSortOrder: (order: SortOrder) => void;
  setIsScanning: (val: boolean) => void;
  setScanProgress: (progress: ScanProgress) => void;
  setIsGenerating: (val: boolean) => void;
  setGenProgress: (progress: ThumbProgress) => void;
  setReviewMode: (val: boolean) => void;
  setReviewIndex: (idx: number) => void;
  setReviewAutoPlay: (val: boolean) => void;
  setActiveReviewVideoPath: (path: string | null) => void;
  setGridSelectionIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setGridSelectionAnchorId: (videoId: string | null) => void;
  clearGridSelection: () => void;
  enterReviewAndPlay: (videoId: string) => void;
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

// ── Electron API (exposed via preload) ─────────────────────────────
export interface ElectronAPI {
  selectDirectory: () => Promise<string | null>;
  getPathForFile: (file: File) => string;
  validateDroppedPath: (droppedPath: string) => Promise<{ valid: boolean; isDirectory: boolean }>;
  openInExplorer: (filePath: string) => Promise<void>;
  scanDirectory: (dirPath: string, includeSubfolders: boolean) => Promise<Video[]>;
  resetLoadedDirectories: () => Promise<boolean>;
  onScanProgress: (callback: (data: ScanProgress) => void) => () => void;
  generateThumbnails: (videos: Video[], dirPath: string, options?: { force?: boolean }) => Promise<boolean>;
  cancelGeneration: () => Promise<boolean>;
  onThumbProgress: (callback: (data: ThumbProgress) => void) => () => void;
  onThumbReadyBatch: (callback: (batch: ThumbReadyEvent[]) => void) => () => void;
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
  validateCacheLocation: (dirPath: string, expectedDriveKey?: string | null) => Promise<{ ok: boolean; error?: string }>;
  confirmDistributedMode: () => Promise<boolean>;
  migrateCacheSettings: (
    oldSettings: AppSettings,
    newSettings: AppSettings,
    loadedDirs: string[]
  ) => Promise<{ status: 'unchanged' | 'no-cache' | 'cancelled' | 'fresh' | 'migrated' | 'partial' | 'error'; migrated: number; errors: string[] }>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; status: string; error?: string }>;
  installUpdate: () => Promise<boolean>;
  onUpdateStatus: (callback: (data: UpdateInfo) => void) => () => void;
  onAppNotification: (callback: (data: ToastInput) => void) => () => void;
}

// ── Global augmentation ────────────────────────────────────────────
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
