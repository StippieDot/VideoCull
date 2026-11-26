// ── Video Status ────────────────────────────────────────────────────
import type { DuplicateRunInfo } from './duplicateResultsPersistence';

export type VideoStatus = 'pending' | 'keep' | 'delete' | 'skipped';

export type VideoReviewChanges = Partial<Pick<Video, 'status' | 'rating' | 'favorite' | 'bookmarks'>>;

export interface VideoReviewUpdate {
  id: string;
  path: string;
  changes: VideoReviewChanges;
}

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
  skippedFileCount?: number;
  skippedFileSamples?: Array<{ path: string }>;
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

export interface ProcessingPauseState {
  status: 'running' | 'pausing' | 'paused';
}

/** One app menu item, as listed in the command palette. */
export interface AppCommand {
  id: string;
  /** Menu path, such as ['View', 'Sort By', 'Size']. */
  path: string[];
  accelerator: string | null;
  enabled: boolean;
  /** For checkbox and radio items; null otherwise. */
  checked: boolean | null;
}

/** What the app menu can act on; items that cannot do anything are disabled. */
export interface AppMenuState {
  hasSession: boolean;
  videoCount: number;
  markedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  /** The edit Undo and Redo would act on, such as "Keep · beach.mp4"; empty when there is none. */
  undoLabel: string;
  redoLabel: string;
  canExport: boolean;
  /** Marked videos exist and no scan is running, which is when the delete handler acts. */
  canDeleteMarked: boolean;
  canFindDuplicates: boolean;
  canPauseProcessing: boolean;
  /** Videos the Video menu acts on: the one open in Review, or the videos selected in the grid. */
  activeVideoCount: number;
  canRegenerateThumbnails: boolean;
  sortBy: SortField;
  sortOrder: SortOrder;
  sortOptions: SortField[];
  groupByFolder: boolean;
  filtersActive: boolean;
  muteAvailable: boolean;
  muted: boolean;
  isPrivate: boolean;
  /** Each recent session, newest first: all of its folders, and its label with only the reachable ones. */
  recentSessions: Array<{ folders: string[]; label: string }>;
  /** The folders loaded in the session. */
  folders: string[];
}

/** What VideoCull does once the current processing has finished. Applies to one run only. */
export type FinishAction = 'none' | 'sleep' | 'shutdown';

/** Progress on the taskbar button; `fraction` is 0–1. */
export type TaskbarProgress =
  | { mode: 'none' | 'indeterminate' }
  | { mode: 'normal' | 'paused'; fraction: number };

export interface PowerState {
  processing: boolean;
  finishAction: FinishAction;
  /** Set while the finish action counts down; endsAt is a Date.now() timestamp. */
  countdown: { action: Exclude<FinishAction, 'none'>; endsAt: number } | null;
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
export type DeleteFailureReason =
  | 'changed'
  | 'unverifiable'
  | 'out-of-scope'
  | 'in-use'
  | 'permission'
  | 'not-found'
  | 'trash-unavailable'
  | 'unknown';

export interface DeleteResult {
  path: string;
  success: boolean;
  error?: string;
  /** Why a failed delete failed; absent on success. Only 'trash-unavailable' may lead to a permanent delete. */
  reason?: DeleteFailureReason;
  /** The raw error code (for example EPERM) when the failure had one. */
  code?: string;
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
  durationMs: number;
  replaceKey?: string;
  actionLabel?: string;
  action?: () => void;
}

export interface ToastInput {
  title: string;
  detail?: string;
  kind?: ToastKind;
  dedupeKey?: string;
  /** A new toast with the same key takes the place of the shown one instead of stacking. */
  replaceKey?: string;
  durationMs?: number;
  actionLabel?: string;
  action?: () => void;
}

// ── Sort & Filter ──────────────────────────────────────────────────
/** What the application menu asks the window to do; electron/app-menu.js sends these. */
export type MenuAction =
  | 'add-folder' | 'check-updates' | 'clear-cache' | 'clear-filters' | 'close-session' | 'copy-path'
  | 'delete-all' | 'export-report' | 'find-duplicates' | 'go-to-folder' | 'mark-short-videos' | 'open-about'
  | 'open-command-palette' | 'open-directory' | 'open-documentation' | 'open-settings' | 'play-external'
  | 'regenerate-thumbnails' | 'rescan-directory' | 'reveal-video' | 'show-shortcuts'
  | 'toggle-group-by-folder' | 'toggle-mute' | 'toggle-privacy' | 'toggle-theme' | 'undo' | 'redo' | 'zoom-in' | 'zoom-out'
  | `sort:${SortField}` | `sort-order:${SortOrder}` | `open-recent:${string}` | `reveal-folder:${string}` | `remove-folder:${string}`;

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
export type PartialClipSortField = 'sharedLength' | 'coverage' | 'totalSize';
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
  codecOrder: string[];
  samplingWindow: DuplicateSamplingWindow;
  customStartPercent: number;
  customEndPercent: number;
  similarityThreshold?: number;
  finalSimilarityThreshold: number;
  separateSimilarityThresholds: boolean;
  phashSimilarityThreshold: number;
  visualSimilarityThreshold: number;
  phashFirstSampleOnly: boolean;
  durationTolerancePercent: number;
  requireEverySample: boolean;
  compareFlipped: boolean;
  matchBlackBars: boolean;
  skipBlankFrames: boolean;
  matchPartlyUnreadable: boolean;
  minComparedSamples: 'auto' | 1 | 2 | 3;
  /** 'auto': pairs up to nearMissRange points below the similarity value are double-checked (pHash). */
  verifyNearMatches: 'auto' | 'off';
  nearMissRange: 5 | 10 | 15 | 20 | 25 | 30;
  /** Visual similarity: the pHash similarity each compared sample also needs, or 'off'. */
  visualOutlineCheck: 'off' | 70 | 75 | 80 | 85 | 90;
  /** 'sound': the sidebar offers Find partial clips, which reads the sound of every video once. */
  partialClips: 'off' | 'sound';
  /** Percent of the shorter video the shared sound must cover (or five minutes) to be checked. */
  partialClipMinShare: number;
  /** Sound found in more than this many other videos is common sound and is not searched. */
  partialClipCommonLimit: number;
  /**
   * Seconds at the start or end of a video (at most a tenth of it) that may be missing from the other
   * video without counting: intros and outros. Only labels results; the search does not use it.
   */
  partialClipEdgeSecs: number;
  maxSamplingDuration: number;
  retryFailedFingerprintExtraction: boolean;
  checkpointIntervalMinutes: number;
  ignoredDuplicatePairs: string[];
  phashDefaultApplied?: boolean;
  averageSamplesDefaultApplied?: boolean;
  visualCorrelationDefaultApplied?: boolean;
}

/** An accepted pair inside a duplicate group, with the score and evidence the group used. */
export interface DuplicateGroupPair {
  aId: string;
  bId: string;
  similarity: number;
  matchType: 'exact' | 'phash' | 'visual';
  comparedSamples?: number | null;
  confidence?: 'normal' | 'low';
  static?: boolean;
  borderAdjusted?: boolean;
  flipped?: boolean;
  partialFingerprint?: boolean;
  timingAdjusted?: boolean;
}

export interface DuplicateGroup {
  id: string;
  videoIds: string[];
  /** Weakest matched pair in the group; the value the similarity threshold tests. */
  similarity: number;
  averageSimilarity?: number;
  matchType: Exclude<DuplicateMatchType, null>;
  suggestedKeeperId: string | null;
  manualSuggestedKeeperId?: string | null;
  reason: string;
  exactVideoIds?: string[];
  /** A matched pair in the group shows (nearly) the same picture at every sample in both videos. */
  static?: boolean;
  /** Fewest samples compared in any similarity match of the group; null for exact-only groups. */
  comparedSamples?: number | null;
  /** 'low' when a match was decided by one sample or a static pair. */
  confidence?: 'normal' | 'low';
  /** 'exact' for byte-identical files only; 'sameSpan' when similarity matches are part of the group. */
  relation?: 'exact' | 'sameSpan';
  /** Samples per video in the run that found the group. */
  sampleCount?: number;
  /** A match only reached the threshold with a video cut to the picture inside its black bars. */
  borderAdjusted?: boolean;
  /** A match used the mirrored picture. */
  flipped?: boolean;
  /** A video was compared without the samples that could not be read. */
  partialFingerprint?: boolean;
  /** A match was only found after the sample times were corrected for a copy that starts a moment earlier or later. */
  timingAdjusted?: boolean;
  /** How far the members' lengths differ, when it is more than 1 second and 1 percent. */
  durationDifferenceSecs?: number | null;
  /** The keeper rule that decided, or 'path' when nothing else did. */
  keeperRule?: string | null;
  /** The deciding rule only separates copies whose picture does not differ (size, codec, path). */
  keeperTieBreak?: boolean;
  /** Per member other than the suggested keeper: why it was not suggested. */
  keeperReasons?: Record<string, string>;
  /** Per member with fingerprint data: sample positions it could not read (empty when all were read). */
  unreadableSamples?: Record<string, Array<{ index: number; percent: number | null }>>;
  /** Per member with black bars: the picture inside them, which the resolution rule compares. */
  pictureSizes?: Record<string, { width: number; height: number }>;
  /** The accepted pairs between members; a group is rebuilt from these when members or pairs go away. */
  pairs?: DuplicateGroupPair[];
}

/** The session stored duplicate results belong to: its folders, subfolder choice and run scope. */
export interface DuplicateResultsSession {
  folders: string[];
  includeSubfolders: boolean;
  scope: 'all' | 'filtered';
}

/** What is kept of a duplicate run between sessions: IDs, scores and choices, never paths. */
export interface StoredDuplicateResults {
  version: 1;
  createdAt: number;
  settingsKey: string;
  scope: 'all' | 'filtered';
  /** Every video that took part, with the size and modification time it had. */
  videos: Array<{ id: string; sizeBytes: number; date: number }>;
  groups: Array<Pick<DuplicateGroup, 'id' | 'videoIds' | 'manualSuggestedKeeperId' | 'sampleCount' | 'matchType' | 'unreadableSamples' | 'pictureSizes'> & {
    pairs: DuplicateGroupPair[];
  }>;
  /** The last Find partial clips of the session, when one ran. */
  partialClips?: PartialClip[];
}

export type LoadedDuplicateResults =
  | { status: 'ok'; results: StoredDuplicateResults }
  | { status: 'outdated' }
  | { status: 'none' };

export interface DuplicateProgress {
  stage: 'Preparing' | 'Building fingerprints' | 'Checking exact matches' | 'Comparing pHashes' | 'Verifying matches' | 'Finding candidates' | 'Confirming visual matches' | 'Building groups'
    | 'Reading sound' | 'Searching partial clips' | 'Checking pictures' | 'Done' | 'Cancelled' | 'Error';
  current: number;
  total: number;
  message?: string;
}

export interface DuplicateResult {
  status: 'ok' | 'cancelled' | 'error';
  /** Identity of the matching settings of the run; stored results with another key are discarded. */
  settingsKey?: string;
  groups?: DuplicateGroup[];
  videos?: Array<Pick<Video, 'id' | 'duplicateGroupId' | 'duplicateSimilarity' | 'duplicateMatchType' | 'duplicateSuggestedKeeper' | 'duplicateExact' | 'duplicateGroupSize' | 'duplicateMatchReason'>>;
  stats?: {
    groupCount: number;
    duplicateVideoCount: number;
    exactGroupCount: number;
    similarityGroupCount: number;
    /** Near misses double-checked with frames around the sample times; absent when that is off. */
    verification?: DuplicateVerificationStats;
  };
  error?: string;
}

/** One shared stretch of a partial clip: where it starts in each video, and what pictures showed. */
export interface PartialClipSegment {
  startA: number;
  startB: number;
  lengthSecs: number;
  soundSimilarity: number;
  pictureState: 'confirmed' | 'differentPicture' | 'unconfirmed';
  pictureSimilarity: number | null;
}

/**
 * Two videos that share stretches. 'partial': sound and pictures match, so one contains part of the
 * other. 'audioOnly': only the sound matches; the pictures differ or could not be checked.
 */
export interface PartialClip {
  aId: string;
  bId: string;
  relation: 'partial' | 'audioOnly';
  state: 'confirmed' | 'differentPicture' | 'unconfirmed';
  shorterId: string;
  segments: PartialClipSegment[];
  /** Share of the shorter video the stretches cover. */
  coverage: number | null;
  soundSimilarity: number;
  pictureSimilarity: number | null;
}

export interface PartialClipResult {
  status: 'ok' | 'cancelled' | 'error';
  clips?: PartialClip[];
  settingsKey?: string;
  stats?: {
    videos: number;
    soundRead: number;
    candidates: number;
    /** Videos with sound found in more than partialClipCommonLimit others, which was not searched. */
    commonSoundVideos: number;
    partial: number;
    audioOnly: number;
  } | null;
  error?: string;
}

export interface DuplicateVerificationStats {
  candidates: number;
  accepted: number;
  rejected: number;
  unverifiable: number;
  /** Not checked yet; a later run, or Check remaining near misses, checks them. */
  pending: number;
  /** Weaker near misses beyond the list a run keeps; no run checks them, a smaller near-miss range drops them. */
  unlisted: number;
  complete: boolean;
  /** More near misses than five per video: many videos in this library resemble each other. */
  manyNearMisses: boolean;
}

// ── Undo Entry ─────────────────────────────────────────────────────
export interface FolderFilter {
  path: string;
  includeSubfolders: boolean;
}

/** One edit in the undo history: undo applies each `before`, redo each `after`. */
export interface UndoEntry {
  /** What the edit did, for the menu and the toast, such as "Keep · beach.mp4". */
  label: string;
  changes: Array<{ videoId: string; before: VideoReviewChanges; after: VideoReviewChanges }>;
}

// ── Settings ───────────────────────────────────────────────────────
/** The loaded folders and whether their subfolders are scanned. */
export interface SavedSession {
  folders: string[];
  includeSubfolders: boolean;
}

export interface RecentSession extends SavedSession {
  openedAt: number;
}

import type { Keybind } from './keybinds';

export type ColorTheme = 'dark' | 'light';

export interface AppSettings {
  theme: ColorTheme;
  cacheLocation: CacheLocationMode;
  centralCachePath: string | null;
  perDriveCachePaths: Record<string, string>;
  autoPruneMissingSubfolderCache: boolean;
  removeEmptyFoldersAfterDelete: boolean;
  /** Experimental, off by default: scan through symbolic links and directory junctions; read by the main process at scan time. */
  followLinks: boolean;
  thumbsPerVideo: 1 | 2 | 4 | 6 | 9;
  defaultCardScale: number;
  defaultSortBy: SortField;
  defaultSortOrder: SortOrder;
  defaultGroupByFolder: boolean;
  keepReviewControlsVisible: boolean;
  seekStepSecs: number;
  maxConcurrent: number | 'auto';
  cpuThreadsLimited: boolean;
  skipIntroDelaySecs: number;
  hardwareAccel: boolean;
  keepAwakeWhileProcessing: boolean;
  /** Windows 11 only; temporary while the look is evaluated. */
  micaTitleBar: boolean;
  /** Reopened at startup when `reopenLastSession` is on; null after Close Session. */
  lastSession: SavedSession | null;
  /** Newest first. */
  recentSessions: RecentSession[];
  reopenLastSession: boolean;
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
  keyFavorite: Keybind;
  keyRatingUp: Keybind;
  keyRatingDown: Keybind;
  // Global
  keyShowHelp: Keybind;
  keyGlobalMute: Keybind;
  keyToggleTheme: Keybind;
  keySearch: Keybind;
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
  isDeleting: boolean;

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
  /** One folder of the grid, or also everything below it (the title bar path). */
  folderFilter: FolderFilter | null;
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
  /** Asks the grid to scroll to a folder; the id makes a repeated request for the same folder count. */
  /** Folder of the grid's topmost visible folder header, for the title bar; null without headers. */
  gridTopFolder: string | null;
  gridFolderJump: { folderPath: string; id: number } | null;
  gridVideoJump: { videoId: string; id: number } | null;
  duplicateGroupsMode: boolean;
  duplicateGroups: DuplicateGroup[];
  /** Where the groups on screen came from; null when there is no result to store. */
  duplicateRun: DuplicateRunInfo | null;
  /** Result of the last Find partial clips in this session; null before one ran. */
  partialClips: PartialClip[] | null;
  /** Videos whose common sound the last Find partial clips of this session skipped; 0 after a restore. */
  partialClipsCommonSound: number;
  /** The duplicate view shows the partial clips instead of the groups. */
  partialClipsMode: boolean;
  duplicateProgress: DuplicateProgress | null;
  isFindingDuplicates: boolean;
  duplicateViewMode: DuplicateViewMode;
  duplicatePathFilter: string;
  duplicateMinSimilarity: number;
  duplicateSortBy: DuplicateSortField;
  duplicateSortOrder: SortOrder;
  partialClipSortBy: PartialClipSortField;
  partialClipSortOrder: SortOrder;
  duplicateScrollTop: number;
  /** Review's place in its scope, for the title bar; null outside Review and on its finished screen. */
  reviewPosition: { index: number; total: number } | null;
  /** The duplicate group, or partial clip entry, at the top of the list and how many are shown, for the title bar. */
  duplicatePosition: { group: number; total: number } | null;
  duplicateGroupJump: { index: number; id: number } | null;
  /** The method the last duplicate run this session used; the setting may have changed since. */
  lastDuplicateMethod: DuplicateComparisonMode | null;
  gridSelectionIds: Set<string>;
  gridSelectionAnchorId: string | null;
  // Card sizing
  cardScale: number;

  // Undo
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  /** The videos the last undo or redo changed, for Review to show; the id makes each one count. */
  historyJump: { videoIds: string[]; id: number } | null;

  // Statistics
  stats: VideoStats;
  sidebarAggregates: SidebarAggregates;

  // Notifications
  toasts: ToastNotification[];

  /** `folderKey`s of recent-session folders found unreachable at startup or when opened. */
  unreachableFolders: ReadonlySet<string>;

  // Actions
  setDirectory: (dir: string | null) => Promise<void>;
  addDirectory: (dir: string) => void;
  setDirectories: (dirs: string[]) => Promise<void>;
  /** Loads `available` (default: all of the session's folders) and remembers the whole session. */
  openSession: (session: SavedSession, available?: string[]) => Promise<void>;
  /** Opens a saved session's reachable folders and reports the rest; false when none can be opened. */
  reopenSession: (session: SavedSession) => Promise<boolean>;
  /** Unloads one of several loaded folders; its videos are dropped in place when nothing is running. */
  removeDirectory: (dir: string) => Promise<void>;
  /** Records which folders could and could not be reached, for the recent-session lists. */
  markFolderReachability: (reachable: string[], missing: string[]) => void;
  setIncludeSubfolders: (val: boolean) => void;
  setVideos: (videos: Video[]) => void;
  updateVideoThumbnailsBatch: (batch: ThumbReadyEvent[]) => void;
  setVideoStatus: (videoId: string, status: VideoStatus) => void;
  /** Sets the videos to Pending and clears their bookmarks, and their rating and favourite when shown. */
  resetVideoDecisions: (videoIds: string[]) => void;
  /** Reverts the newest edit and says so in a toast; null when there is nothing to undo. */
  undo: () => UndoEntry | null;
  /** Applies the newest undone edit again; null when there is nothing to redo. */
  redo: () => UndoEntry | null;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setSortBy: (sortBy: SortField) => void;
  setSortOrder: (sortOrder: SortOrder) => void;
  setMinSizeFilter: (minSize: number) => void;
  setSizeFilterRange: (minSize: number, maxSize: number | null) => void;
  setMinDurationFilter: (seconds: number) => void;
  setDurationFilterRange: (minSeconds: number, maxSeconds: number | null) => void;
  setFolderFilter: (filter: FolderFilter | null) => void;
  setMinRatingFilter: (rating: RatingFilter) => void;
  setFavoritesFilter: (val: boolean) => void;
  setIncompatibleFilter: (val: boolean) => void;
  setDuplicateFilter: (val: boolean) => void;
  clearFilters: () => void;
  setGroupByFolder: (val: boolean) => void;
  setGridTopFolder: (folderPath: string | null) => void;
  requestGridFolderJump: (folderPath: string) => void;
  /** Selects the video and scrolls the grid to it. */
  requestGridVideoJump: (videoId: string) => void;
  setFolderSortBy: (sortBy: FolderSortField) => void;
  setFolderSortOrder: (order: SortOrder) => void;
  setIsScanning: (val: boolean) => void;
  setIsDeleting: (val: boolean) => void;
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
  /** `run` names the videos that took part and the scope, so the result can be stored. */
  applyDuplicateResult: (result: DuplicateResult, run?: { videos: Video[]; scope: DuplicateScope }) => void;
  /** Brings back the stored groups of the open session after its scan. */
  restoreDuplicateResults: () => Promise<LoadedDuplicateResults['status'] | 'skipped'>;
  addIgnoredDuplicatePairs: (pairKeys: string[]) => void;
  /** Shows the result of Find partial clips; `run` describes it for storage when no duplicate run did. */
  applyPartialClips: (clips: PartialClip[], run?: { videos: Video[]; scope: 'all' | 'filtered'; settingsKey?: string }, commonSoundVideos?: number) => void;
  setPartialClipsMode: (mode: boolean) => void;
  /** Marks each pair as not a match and takes it off the partial clip list. */
  dismissPartialClips: (pairs: Array<{ aId: string; bId: string }>) => void;
  removeIgnoredDuplicatePairs: (pairKeys: string[]) => void;
  clearIgnoredDuplicatePairs: () => void;
  setDuplicateProgress: (progress: DuplicateProgress | null) => void;
  setIsFindingDuplicates: (val: boolean) => void;
  setDuplicateViewMode: (mode: DuplicateViewMode) => void;
  setDuplicatePathFilter: (pathFilter: string) => void;
  setDuplicateMinSimilarity: (similarity: number) => void;
  setDuplicateSortBy: (sortBy: DuplicateSortField) => void;
  setDuplicateSortOrder: (order: SortOrder) => void;
  setPartialClipSortBy: (sortBy: PartialClipSortField) => void;
  setPartialClipSortOrder: (order: SortOrder) => void;
  setDuplicateScrollTop: (scrollTop: number) => void;
  setReviewPosition: (position: { index: number; total: number } | null) => void;
  setDuplicatePosition: (position: { group: number; total: number } | null) => void;
  /** Scrolls the duplicate list to the group (or partial clip entry) at this index among the shown ones. */
  requestDuplicateGroupJump: (index: number) => void;
  setLastDuplicateMethod: (method: DuplicateComparisonMode) => void;
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
  clearRecentSessions: () => void;
  removeRecentSession: (folders: string[]) => void;
  setVideoStatusesBatch: (videoIds: string[], status: VideoStatus) => void;
  setVideoRating: (videoId: string, rating: 0 | 1 | 2 | 3 | 4 | 5) => void;
  toggleFavorite: (videoId: string) => void;
  pushToast: (toast: ToastInput | string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  /** Holds a toast open while the pointer or keyboard focus is on it; resume continues the countdown. */
  pauseToast: (id: number) => void;
  resumeToast: (id: number) => void;
  clearToasts: () => void;

  // Settings Actions
  setIsSettingsModalOpen: (val: boolean) => void;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  saveSettings: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

// ── Auto-update ────────────────────────────────────────────────────
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'scheduled' | 'deferred' | 'up-to-date' | 'error';

export interface UpdateInfo {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  message?: string;
}

export type DistributionChannel = 'direct' | 'microsoft-store';

export interface DistributionInfo {
  channel: DistributionChannel;
}

export interface CacheLocationInfo {
  mode: CacheLocationMode;
  locations: Array<{
    label: string;
    path: string;
    ownership: 'package' | 'profile' | 'external';
    available: boolean;
    disposableOnReset: boolean;
  }>;
}

export interface LegacyInstallStatus {
  installed: boolean;
  eligible?: boolean;
  promptDismissed?: boolean;
  versionRelation?: 'older' | 'same' | 'newer' | 'unknown';
  displayName?: string;
  version?: string | null;
  installLocation?: string;
  uninstallerPath?: string;
  registryKey?: string;
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

/** Bundled legal documents the About panel can open. */
export type LegalFileName = 'license' | 'notices';

// ── Electron API (exposed via preload) ─────────────────────────────
export interface ElectronAPI {
  initialTheme: ColorTheme;
  /** The window started with the Windows 11 Mica material behind the title bar. */
  usesMica: boolean;
  /** Windows 11 22H2 or newer, where Mica is available. */
  micaSupported: boolean;
  /** Node's process.platform: 'win32', 'darwin' or 'linux'. */
  platform: string;
  selectDirectory: () => Promise<string | null>;
  getPathForFile: (file: File) => string;
  validateDroppedPath: (droppedPath: string) => Promise<{ valid: boolean; isDirectory: boolean }>;
  /** Resolves false when the path was refused or could not be shown. */
  openInExplorer: (filePath: string) => Promise<boolean>;
  scanDirectory: (dirPath: string, includeSubfolders: boolean) => Promise<ScanDirectoryResult>;
  resetLoadedDirectories: () => Promise<boolean>;
  /** Unloads one of several loaded folders without a rescan; false when main refused. */
  unloadDirectory: (dirPath: string) => Promise<boolean>;
  onScanProgress: (callback: (data: ScanProgress) => void) => () => void;
  processMetadata: (videos: MediaProbeVideoInput[], dirPath: string, options?: { force?: boolean }) => Promise<boolean>;
  onMetadataProgress: (callback: (data: ThumbProgress) => void) => () => void;
  onMetadataReadyBatch: (callback: (batch: ThumbReadyEvent[]) => void) => () => void;
  generateThumbnails: (videos: Video[], dirPath: string, options?: { force?: boolean }) => Promise<boolean>;
  cancelGeneration: () => Promise<boolean>;
  getProcessingPauseState: () => Promise<ProcessingPauseState>;
  setProcessingPaused: (paused: boolean) => Promise<ProcessingPauseState>;
  getPowerState: () => Promise<PowerState>;
  cancelFinishAction: () => Promise<PowerState>;
  onPowerState: (callback: (state: PowerState) => void) => () => void;
  onProcessingPauseState: (callback: (data: ProcessingPauseState) => void) => () => void;
  onThumbProgress: (callback: (data: ThumbProgress) => void) => () => void;
  onThumbReadyBatch: (callback: (batch: ThumbReadyEvent[]) => void) => () => void;
  findDuplicates: (videos: Video[], options?: { settings?: Partial<DuplicateSettings>; checkAllNearMisses?: boolean }) => Promise<DuplicateResult>;
  /** Pairs in `skipPairKeys` (already duplicates) are not searched. Uses the duplicate run's progress and cancel. */
  /** `skipPairKeys` are the shown groups' pairs; they apply only when `skipPairsSettingsKey` names the search's matching settings. */
  findPartialClips: (videos: Video[], options?: { settings?: Partial<DuplicateSettings>; skipPairKeys?: string[]; skipPairsSettingsKey?: string }) => Promise<PartialClipResult>;
  cancelDuplicateDetection: () => Promise<boolean>;
  onDuplicateProgress: (callback: (data: DuplicateProgress) => void) => () => void;
  onMenuAction: (callback: (action: MenuAction) => void) => () => void;
  saveCache: (dirPath: string, videos: Video[]) => Promise<boolean>;
  saveCacheAtomic: (dirPath: string, videos: Video[]) => Promise<boolean>;
  saveReviewState: (dirPath: string, updates: VideoReviewUpdate[]) => Promise<boolean>;
  clearCache: (dirPath: string) => Promise<boolean>;
  saveDuplicateResults: (session: DuplicateResultsSession, results: StoredDuplicateResults) => Promise<boolean>;
  loadDuplicateResults: (session: DuplicateResultsSession) => Promise<LoadedDuplicateResults>;
  clearDuplicateResults: (session: DuplicateResultsSession) => Promise<boolean>;
  batchDelete: (filePaths: string[]) => Promise<DeleteResult[]>;
  permanentlyDelete: (filePaths: string[]) => Promise<DeleteResult[]>;
  exportReport: (videos: Video[], dirPaths: string[]) => Promise<'saved' | 'cancelled' | 'error'>;
  chooseReportScope: () => Promise<'all' | 'filtered' | null>;
  setMenuState: (state: AppMenuState) => void;
  setTaskbarProgress: (progress: TaskbarProgress) => void;
  /** Opens the app menu or submenu with this command id, such as "File" or "Actions > When Processing Finishes". */
  openAppMenu: (id: string, x: number, y: number) => Promise<boolean>;
  getCommands: () => Promise<AppCommand[]>;
  runCommand: (id: string) => Promise<boolean>;
  /** Resolves false when the path was refused or the system could not open it. */
  openVideo: (filePath: string) => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;
  openLegalFile: (name: LegalFileName) => Promise<boolean>;
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
  getCacheLocationInfo: () => Promise<CacheLocationInfo>;
  openCacheFolder: (cachePath: string) => Promise<boolean>;
  copyCachePath: (cachePath: string) => Promise<boolean>;
  getDistributionInfo: () => Promise<DistributionInfo>;
  onStoreTransitionReady: (callback: () => void) => () => void;
  getLegacyInstallStatus: () => Promise<LegacyInstallStatus>;
  dismissLegacyInstallPrompt: () => Promise<boolean>;
  uninstallLegacyInstall: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; status: string; error?: string }>;
  installUpdate: () => Promise<boolean>;
  scheduleUpdateOnExit: () => Promise<boolean>;
  deferUpdate: () => Promise<boolean>;
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
  /** Called when the app is quitting; resolves with the number of review changes still unsaved. */
  onFlushPendingSaves: (callback: () => Promise<number>) => () => void;
}

// ── Global augmentation ────────────────────────────────────────────
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    __VIDEOCULL_DEV_PERF__?: {
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
