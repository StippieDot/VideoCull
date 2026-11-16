import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { List } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import useStore from '../store';
import useActiveValue from '../hooks/useActiveValue';
import type { DuplicateGroup, DuplicateViewMode, Video } from '../types';
import {
  formatDuration,
  formatFps,
  formatResolutionLabel,
  formatSize,
} from '../utils';
import {
  beginDevInteraction,
  completeDevInteractionOnNextPaint,
  measureDevNextPaint,
  recordDevPerf,
} from '../perf-dev';
import VideoCard from './VideoCard';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import {
  buildDuplicateGalleryRows,
  buildDuplicateRowsRows,
  computeDuplicateGalleryLayout,
  DUPLICATE_GALLERY_CARD_GAP,
  DUPLICATE_GALLERY_ROW_PADDING,
  DUPLICATE_GROUP_GAP,
  getDuplicateVirtualRowHeight,
  type DuplicateVirtualRow,
} from './duplicateVirtualRows';
import {
  buildCopyPathSuccessDetail,
  buildDuplicateGroupHeaderMenu,
  buildDuplicateVideoMenu,
  canPlayDuplicateGroupKeeper,
} from './contextMenuBuilders';
import { Ban, Check, CheckCircle2, Play, SkipForward, Trash2 } from 'lucide-react';
import './DuplicateGroupsView.css';
import { openVideoExternally, revealInExplorer } from '../appCommands';
import { KEEPER_RULE_LABELS } from '../keybind-defaults';
import { rebuildDuplicateGroups } from '../duplicateGroupRebuild';

type MetricState = 'best' | 'equal' | 'worse';
type MetricFlags = Record<string, MetricState>;
type DuplicateGroupView = {
  group: DuplicateGroup;
  videos: Video[];
  groupSize: number;
  totalSize: number;
  searchText: string;
  bestFlags: Map<string, MetricFlags>;
};

type DuplicateGroupViewCacheEntry = {
  videoRefs: Video[];
  view: DuplicateGroupView;
};

type DuplicateGroupViewCache = Map<string, DuplicateGroupViewCacheEntry>;

type DuplicateContextMenuState =
  | {
      kind: 'video';
      x: number;
      y: number;
      groupId: string;
      videoId: string;
    }
  | {
      kind: 'group';
      x: number;
      y: number;
      groupId: string;
    };

type DuplicateRowItemProps = {
  video: Video;
  groupVideoIds: string[];
  groupId: string;
  suggestedKeeperId: string | null;
  manualSuggestedKeeperId: string | null | undefined;
  flags: MetricFlags;
  /** Why this video is not the suggested keeper; shown only while the keeper is not chosen by hand. */
  keeperReason: string | null;
  /** For the suggested keeper: which rule chose it. */
  keeperDecision: string | null;
  isSelected: boolean;
  isLastInGroup: boolean;
  onToggleSelection: (video: Video) => void;
  onPlayVideo: (videoId: string, scopeIds: string[]) => void;
  onOpenVideoContextMenu: (event: React.MouseEvent, groupId: string, videoId: string) => void;
};

type DuplicateGalleryCardProps = {
  video: Video;
  groupVideoIds: string[];
  groupId: string;
  isSelected: boolean;
  onToggleSelection: (video: Video) => void;
  onPlayVideo: (videoId: string, scopeIds: string[]) => void;
  onOpenVideoContextMenu: (event: React.MouseEvent, groupId: string, videoId: string) => void;
  /** Reports the frame shape of a loaded thumbnail, which sets the row height. */
  onThumbnailAspect: (videoId: string, aspect: number) => void;
};

type DuplicateRowRuntimeData = {
  rows: DuplicateVirtualRow[];
  groupViewsById: Map<string, DuplicateGroupView>;
  videosById: Map<string, Video>;
  selectedIds: Set<string>;
  galleryCardWidth: number;
  dismissGroup: (group: DuplicateGroup) => void;
  selectSuggestedDuplicatesForGroup: (groupView: DuplicateGroupView) => void;
  handleToggleSelection: (video: Video) => void;
  handlePlayVideo: (videoId: string, scopeIds: string[]) => void;
  handleOpenVideoContextMenu: (event: React.MouseEvent, groupId: string, videoId: string) => void;
  handleOpenGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
  reportThumbnailAspect: (videoId: string, aspect: number) => void;
};

type DuplicateRowRenderSignals = {
  galleryCardWidth: number;
  rowContentVersion: number;
  selectionVersion: number;
  viewMode: DuplicateViewMode;
};

let duplicateRowRuntime: DuplicateRowRuntimeData | null = null;
let duplicateRowRuntimeOwner: symbol | null = null;

function thumbSrc(video: Video): string | null {
  if (video.thumbnails[0]) return `thumb://local/${encodeURIComponent(video.thumbnails[0])}`;
  return video.osThumbnail ?? null;
}

function bitrateLabel(video: Video): string {
  const bitrate = video.videoBitrate ?? video.totalBitrate;
  if (!bitrate) return 'bitrate --';
  return `${Math.round(bitrate / 1000).toLocaleString()} kbps`;
}

function computeBestFlags(videos: Video[]): Map<string, MetricFlags> {
  const flags = new Map<string, MetricFlags>();
  for (const v of videos) flags.set(v.id, {});
  if (videos.length < 2) return flags;

  const qualityMetrics: { key: string; value: (v: Video) => number; higher: boolean }[] = [
    { key: 'resolution', value: (v) => (v.width ?? 0) * (v.height ?? 0), higher: true },
    { key: 'fps', value: (v) => v.fps ?? 0, higher: true },
    { key: 'bitrate', value: (v) => v.videoBitrate ?? v.totalBitrate ?? 0, higher: true },
    { key: 'duration', value: (v) => v.durationSecs ?? 0, higher: true },
  ];

  for (const metric of qualityMetrics) {
    const values = videos.map((v) => metric.value(v));
    const best = metric.higher ? Math.max(...values) : Math.min(...values);
    const allEqual = values.every((val) => val === best);
    for (let i = 0; i < videos.length; i += 1) {
      flags.get(videos[i].id)![metric.key] = allEqual
        ? 'equal'
        : values[i] === best
          ? 'best'
          : 'worse';
    }
  }
  const sizes = videos.map((v) => v.sizeBytes ?? 0);
  const bestSize = Math.max(...sizes);
  const allSizesEqual = sizes.every((size) => size === bestSize);
  for (let i = 0; i < videos.length; i += 1) {
    flags.get(videos[i].id)!.size = allSizesEqual ? 'equal' : sizes[i] === bestSize ? 'best' : 'worse';
  }
  return flags;
}

function haveSameVideoRefs(previous: Video[], current: Video[]): boolean {
  return previous.length === current.length
    && previous.every((video, index) => video === current[index]);
}

function buildDuplicateGroupViews(
  groups: DuplicateGroup[],
  videosById: Map<string, Video>,
  previousCache: DuplicateGroupViewCache
) {
  const nextCache: DuplicateGroupViewCache = new Map();
  const views: DuplicateGroupView[] = [];
  let recomputedCount = 0;

  for (const group of groups) {
    const groupVideos = group.videoIds
      .map((id) => videosById.get(id))
      .filter((video): video is Video => Boolean(video));
    const cached = previousCache.get(group.id);
    let view: DuplicateGroupView;

    if (cached && haveSameVideoRefs(cached.videoRefs, groupVideos)) {
      view = cached.view.group === group
        ? cached.view
        : { ...cached.view, group, groupSize: group.videoIds.length };
    } else {
      recomputedCount += 1;
      view = {
        group,
        videos: groupVideos,
        groupSize: group.videoIds.length,
        totalSize: groupVideos.reduce((sum, video) => sum + (video.sizeBytes ?? 0), 0),
        searchText: groupVideos
          .map((video) => `${video.filename} ${video.path}`)
          .join('\n')
          .toLowerCase(),
        bestFlags: computeBestFlags(groupVideos),
      };
    }

    nextCache.set(group.id, { videoRefs: groupVideos, view });
    views.push(view);
  }

  return { views, cache: nextCache, recomputedCount };
}

function parentPath(filePath: string): string {
  const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSeparator >= 0 ? filePath.slice(0, lastSeparator) : filePath;
}

function duplicatePairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function pairKeysForGroup(group: DuplicateGroup): string[] {
  const keys: string[] = [];
  for (let i = 0; i < group.videoIds.length; i += 1) {
    for (let j = i + 1; j < group.videoIds.length; j += 1) {
      keys.push(duplicatePairKey(group.videoIds[i], group.videoIds[j]));
    }
  }
  return keys;
}

function statusBadgeContent(video: Video) {
  if (video.status === 'keep') {
    return { label: 'Marked keep', icon: <Check size={12} />, className: 'keep' };
  }
  if (video.status === 'delete') {
    return { label: 'Marked delete', icon: <Trash2 size={12} />, className: 'delete' };
  }
  if (video.status === 'skipped') {
    return { label: 'Skipped', icon: <SkipForward size={12} />, className: 'skipped' };
  }
  return null;
}

const DuplicateRowItem = memo(function DuplicateRowItem({
  video,
  groupVideoIds,
  groupId,
  suggestedKeeperId,
  manualSuggestedKeeperId,
  flags,
  keeperReason,
  keeperDecision,
  isSelected,
  isLastInGroup,
  onToggleSelection,
  onPlayVideo,
  onOpenVideoContextMenu,
}: DuplicateRowItemProps) {
  const statusBadge = statusBadgeContent(video);
  const thumbnailSrc = thumbSrc(video);
  const chip = (key: string, label: string) => {
    const state = flags[key] ?? 'equal';
    return (
      <span key={key} className={`meta-chip ${state}`}>
        {label}
      </span>
    );
  };

  return (
    <div
      className={`duplicate-row ${suggestedKeeperId === video.id ? 'keeper' : ''} ${video.status !== 'pending' ? `status-${video.status}` : ''} ${isSelected ? 'selected' : ''} ${isLastInGroup ? 'last-in-group' : ''}`}
      onContextMenu={(event) => onOpenVideoContextMenu(event, groupId, video.id)}
    >
      <label className="duplicate-select-cell" title="Select video">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelection(video)}
        />
      </label>
      {thumbnailSrc && <img src={thumbnailSrc} alt="" />}
      <div className="duplicate-row-copy">
        <div className="duplicate-row-title">
          <strong>{video.filename}</strong>
          {statusBadge && (
            <span className={`duplicate-inline-flag ${statusBadge.className}`}>
              {statusBadge.icon}
              {statusBadge.label}
            </span>
          )}
        </div>
        <span className="duplicate-row-path" title={video.path}>
          {parentPath(video.path)}
        </span>
        <span className="duplicate-meta-chips">
          {chip('resolution', formatResolutionLabel(video.width, video.height))}
          {chip('fps', formatFps(video.fps))}
          {chip('bitrate', bitrateLabel(video))}
          {chip('duration', formatDuration(video.durationSecs))}
          {chip('size', formatSize(video.sizeBytes))}
        </span>
        {keeperReason && <span className="duplicate-row-reason">Not suggested: {keeperReason}</span>}
      </div>
      {suggestedKeeperId === video.id && (
        <span className="duplicate-keeper-badge" title={keeperDecision ?? undefined}>
          <CheckCircle2 size={13} />
          {manualSuggestedKeeperId === video.id ? 'Selected keeper' : 'Suggested keeper'}
        </span>
      )}
      <button
        className="duplicate-play-btn"
        onClick={() => onPlayVideo(video.id, groupVideoIds)}
        title="Play in review mode"
      >
        <Play size={14} />
      </button>
    </div>
  );
});

/** Frame shape of each video's loaded thumbnails, kept for the session so rows keep their height. */
const thumbnailAspects = new Map<string, number>();

const DuplicateGalleryCard = memo(function DuplicateGalleryCard({
  video,
  onThumbnailAspect,
  groupVideoIds,
  groupId,
  isSelected,
  onToggleSelection,
  onPlayVideo,
  onOpenVideoContextMenu,
}: DuplicateGalleryCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const handleLoad = (event: Event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.classList.contains('thumb-img') && image.naturalHeight > 0) {
        onThumbnailAspect(video.id, image.naturalWidth / image.naturalHeight);
      }
    };
    // Image load events do not bubble, but an ancestor still sees them while capturing.
    element.addEventListener('load', handleLoad, true);
    return () => element.removeEventListener('load', handleLoad, true);
  }, [onThumbnailAspect, video.id]);

  return (
    <div ref={cardRef} className="duplicate-gallery-card" onContextMenu={(event) => onOpenVideoContextMenu(event, groupId, video.id)}>
      <VideoCard
        video={video}
        showSelectionControls
        isSelected={isSelected}
        onToggleSelect={() => onToggleSelection(video)}
        onPlay={() => onPlayVideo(video.id, groupVideoIds)}
      />
    </div>
  );
});

function keeperDecisionLabel(group: DuplicateGroup): string | null {
  if (!group.keeperRule) return null;
  if (group.keeperRule === 'path') return 'No difference found; chosen by file name';
  const rule = KEEPER_RULE_LABELS[group.keeperRule]?.title ?? group.keeperRule;
  return group.keeperTieBreak ? `Decided by ${rule} (tie-break)` : `Decided by ${rule}`;
}

/** Warnings that ask for a look before deleting, and plain facts about how the group matched. */
function groupEvidenceNotes(group: DuplicateGroup): { warnings: string[]; notes: string[] } {
  const warnings: string[] = [];
  if (group.confidence === 'low') {
    if (group.comparedSamples === 1) warnings.push('Single-frame match — check before deleting');
    if (group.static) warnings.push('Little movement — check before deleting');
  }
  const notes: string[] = [];
  if (group.borderAdjusted) notes.push('Black bars ignored');
  if (group.flipped) notes.push('Mirrored');
  if (group.partialFingerprint) notes.push('Partly unreadable');
  if (group.timingAdjusted) notes.push('Starts a moment earlier or later');
  if (group.durationDifferenceSecs) notes.push(`Lengths differ by ${group.durationDifferenceSecs.toFixed(1)} s`);
  return { warnings, notes };
}

const DuplicateGroupHeaderPanel = memo(function DuplicateGroupHeaderPanel({
  groupView,
  onDismissGroup,
  onSelectSuggestedDeletions,
  onOpenGroupContextMenu,
}: {
  groupView: DuplicateGroupView;
  onDismissGroup: (group: DuplicateGroup) => void;
  onSelectSuggestedDeletions: (groupView: DuplicateGroupView) => void;
  onOpenGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
}) {
  const { warnings, notes } = groupEvidenceNotes(groupView.group);
  return (
    <div className="duplicate-group-panel duplicate-group-panel-header">
      <div
        className="duplicate-group-header"
        onContextMenu={(event) => onOpenGroupContextMenu(event, groupView.group.id)}
      >
        <div className="duplicate-group-title">
          <span
            className={`duplicate-match-badge ${groupView.group.matchType === 'exact' ? 'exact' : 'potential'}`}
          >
            {groupView.group.matchType === 'exact' ? 'Exact matches' : 'Potential duplicates'}
          </span>
          <strong
            title={groupView.group.averageSimilarity != null
              ? `Weakest match ${groupView.group.similarity.toFixed(1)}% · average ${groupView.group.averageSimilarity.toFixed(1)}%`
              : undefined}
          >
            {groupView.group.similarity.toFixed(1)}%
          </strong>
          <em className="duplicate-group-fact">{groupView.groupSize} videos</em>
          <em className="duplicate-group-fact">{formatSize(groupView.totalSize)}</em>
          {warnings.map((warning) => (
            <span key={warning} className="duplicate-match-badge low-confidence">{warning}</span>
          ))}
          {/* Only the description gives way when the header is narrow; the full text is in the tooltip. */}
          <span className="duplicate-group-notes" title={[groupView.group.reason, ...notes].join(' · ')}>
            <em>{groupView.group.reason}</em>
            {notes.map((note) => <em key={note}>{note}</em>)}
          </span>
        </div>
        <div className="duplicate-group-actions">
          <button
            className="duplicate-group-action-btn select"
            onClick={() => onSelectSuggestedDeletions(groupView)}
            title="Select the suggested non-keeper videos in this group"
          >
            <Trash2 size={13} />
            Select for deletion
          </button>
          <button
            className="duplicate-group-action-btn"
            onClick={() => onDismissGroup(groupView.group)}
          >
            <Ban size={13} />
            Dismiss group
          </button>
        </div>
      </div>
    </div>
  );
});

function DuplicateVirtualRowRenderer({
  index,
  style,
  ariaAttributes,
}: RowComponentProps<DuplicateRowRenderSignals>) {
  const runtime = duplicateRowRuntime;
  if (!runtime) return null;

  const row = runtime.rows[index];
  const groupView = runtime.groupViewsById.get(row.groupId);
  if (!row || !groupView) return null;

  const topGap = row.type === 'group-header' && !row.isFirstGroup ? DUPLICATE_GROUP_GAP : 0;
  const rowStyle = {
    ...style,
    boxSizing: 'border-box' as const,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: topGap,
  };

  if (row.type === 'group-header') {
    return (
      <div style={rowStyle} className="duplicate-virtual-row-shell group-header" {...ariaAttributes}>
        <DuplicateGroupHeaderPanel
          groupView={groupView}
          onDismissGroup={runtime.dismissGroup}
          onSelectSuggestedDeletions={runtime.selectSuggestedDuplicatesForGroup}
          onOpenGroupContextMenu={runtime.handleOpenGroupContextMenu}
        />
      </div>
    );
  }

  if (row.type === 'video-row') {
    const video = runtime.videosById.get(row.videoId);
    if (!video) return null;
    return (
      <div style={rowStyle} className="duplicate-virtual-row-shell video-row" {...ariaAttributes}>
        <div className={`duplicate-group-panel duplicate-group-panel-row ${row.isLastInGroup ? 'group-end' : ''}`}>
          <DuplicateRowItem
            video={video}
            groupId={groupView.group.id}
            groupVideoIds={groupView.group.videoIds}
            suggestedKeeperId={groupView.group.suggestedKeeperId}
            manualSuggestedKeeperId={groupView.group.manualSuggestedKeeperId}
            flags={groupView.bestFlags.get(video.id) ?? {}}
            keeperReason={groupView.group.manualSuggestedKeeperId ? null : groupView.group.keeperReasons?.[video.id] ?? null}
            keeperDecision={groupView.group.manualSuggestedKeeperId ? null : keeperDecisionLabel(groupView.group)}
            isSelected={runtime.selectedIds.has(video.id)}
            isLastInGroup={row.isLastInGroup}
            onToggleSelection={runtime.handleToggleSelection}
            onPlayVideo={runtime.handlePlayVideo}
            onOpenVideoContextMenu={runtime.handleOpenVideoContextMenu}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={rowStyle} className="duplicate-virtual-row-shell gallery-row" {...ariaAttributes}>
      <div className={`duplicate-group-panel duplicate-group-panel-gallery ${row.isLastInGroup ? 'group-end' : ''}`}>
        <div
          className="duplicate-card-grid-row"
          style={{
            gridTemplateColumns: `repeat(${row.videoIds.length}, minmax(0, ${runtime.galleryCardWidth}px))`,
          }}
        >
          {row.videoIds.map((videoId) => {
            const video = runtime.videosById.get(videoId);
            if (!video) return null;
            return (
              <div
                key={video.id}
                className="duplicate-card-grid-cell"
                style={{ height: row.cardHeight }}
              >
                <DuplicateGalleryCard
                  video={video}
                  onThumbnailAspect={runtime.reportThumbnailAspect}
                  groupId={groupView.group.id}
                  groupVideoIds={groupView.group.videoIds}
                  isSelected={runtime.selectedIds.has(video.id)}
                  onToggleSelection={runtime.handleToggleSelection}
                  onPlayVideo={runtime.handlePlayVideo}
                  onOpenVideoContextMenu={runtime.handleOpenVideoContextMenu}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DuplicateGroupsView() {
  const videos = useStore((s) => s.videos);
  const groups = useStore((s) => s.duplicateGroups);
  const viewMode = useStore((s) => s.duplicateViewMode);
  const reviewMode = useStore((s) => s.reviewMode);
  const setVideoStatusesBatch = useStore((s) => s.setVideoStatusesBatch);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const protectKeep = useStore((s) => s.settings.duplicates.protectKeep);
  const protectSkipped = useStore((s) => s.settings.duplicates.protectSkipped);
  const duplicatePathFilter = useStore((s) => s.duplicatePathFilter);
  const duplicateMinSimilarity = useStore((s) => s.duplicateMinSimilarity);
  const duplicateSortBy = useStore((s) => s.duplicateSortBy);
  const duplicateSortOrder = useStore((s) => s.duplicateSortOrder);
  const setDuplicateGroups = useStore((s) => s.setDuplicateGroups);
  const setManualDuplicateKeeper = useStore((s) => s.setManualDuplicateKeeper);
  const setDuplicateScrollTop = useStore((s) => s.setDuplicateScrollTop);
  const addIgnoredDuplicatePairs = useStore((s) => s.addIgnoredDuplicatePairs);
  const removeIgnoredDuplicatePairs = useStore((s) => s.removeIgnoredDuplicatePairs);
  const pushToast = useStore((s) => s.pushToast);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<DuplicateContextMenuState | null>(null);
  const listShellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const previousReviewModeRef = useRef(reviewMode);
  const restoringScrollRef = useRef(false);
  const lastRowsRef = useRef<DuplicateVirtualRow[] | null>(null);
  const rowContentVersionRef = useRef(0);
  const lastSelectedIdsRef = useRef(selectedIds);
  const selectionVersionRef = useRef(0);
  const groupViewCacheRef = useRef<DuplicateGroupViewCache>(new Map());
  const runtimeOwnerRef = useRef(Symbol('duplicate-row-runtime'));
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const activeVideos = useActiveValue(videos, !reviewMode);
  const activeGroups = useActiveValue(groups, !reviewMode);

  const videosById = useMemo(
    () => new Map(activeVideos.map((video) => [video.id, video])),
    [activeVideos]
  );

  const groupViews = useMemo<DuplicateGroupView[]>(() => {
    const startedAt = performance.now();
    const built = buildDuplicateGroupViews(activeGroups, videosById, groupViewCacheRef.current);
    groupViewCacheRef.current = built.cache;
    recordDevPerf('duplicates.groupViews.compute', performance.now() - startedAt, {
      items: built.recomputedCount,
    });
    return built.views;
  }, [activeGroups, videosById]);

  const visibleGroupViews = useMemo(() => {
    const startedAt = performance.now();
    const pathQuery = duplicatePathFilter.trim().toLowerCase();
    const filtered = groupViews.filter(({ group, searchText }) => {
      if (group.similarity < duplicateMinSimilarity) return false;
      if (!pathQuery) return true;
      return searchText.includes(pathQuery);
    });

    const isLow = (view: DuplicateGroupView) => (view.group.confidence === 'low' ? 1 : 0);
    const sorted = [...filtered].sort((a, b) => {
      // Matches that need a check stay after the others in either sort order.
      if (isLow(a) !== isLow(b)) return isLow(a) - isLow(b);
      let diff = 0;
      if (duplicateSortBy === 'similarity') diff = a.group.similarity - b.group.similarity;
      else if (duplicateSortBy === 'groupSize') diff = a.groupSize - b.groupSize;
      else if (duplicateSortBy === 'totalSize') diff = a.totalSize - b.totalSize;
      if (diff === 0 && duplicateSortBy !== 'groupSize') diff = a.groupSize - b.groupSize;
      if (diff === 0 && duplicateSortBy !== 'totalSize') diff = a.totalSize - b.totalSize;
      if (diff === 0) diff = b.group.similarity - a.group.similarity;
      return duplicateSortOrder === 'asc' ? diff : -diff;
    });
    recordDevPerf('duplicates.visibleGroups.compute', performance.now() - startedAt, {
      items: filtered.length,
    });
    return sorted;
  }, [
    duplicateMinSimilarity,
    duplicatePathFilter,
    duplicateSortBy,
    duplicateSortOrder,
    groupViews,
  ]);

  const groupViewsById = useMemo(
    () => new Map(visibleGroupViews.map((groupView) => [groupView.group.id, groupView])),
    [visibleGroupViews]
  );

  const visibleVideoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const groupView of visibleGroupViews) {
      for (const video of groupView.videos) ids.add(video.id);
    }
    return ids;
  }, [visibleGroupViews]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => visibleVideoIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleVideoIds]);

  useEffect(() => {
    if (!contextMenu) return;
    if (!groupViewsById.has(contextMenu.groupId)) {
      setContextMenu(null);
      return;
    }
    if (contextMenu.kind === 'video' && !visibleVideoIds.has(contextMenu.videoId)) {
      setContextMenu(null);
    }
  }, [contextMenu, groupViewsById, visibleVideoIds]);

  useEffect(() => {
    const shell = listShellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const isProtectedFromSuggestion = useCallback((video: Video) => (
    (protectKeep && video.status === 'keep') ||
    (protectSkipped && video.status === 'skipped')
  ), [protectKeep, protectSkipped]);

  const getMarkableDuplicateIds = useCallback((scopeGroups: DuplicateGroupView[]) => {
    const ids: string[] = [];
    for (const { group, videos: groupVideos } of scopeGroups) {
      for (const video of groupVideos) {
        if (group.suggestedKeeperId === video.id) continue;
        if (isProtectedFromSuggestion(video)) continue;
        ids.push(video.id);
      }
    }
    return ids;
  }, [isProtectedFromSuggestion]);

  useEffect(() => {
    completeDevInteractionOnNextPaint('duplicates.sort');
  }, [
    duplicateSortBy,
    duplicateSortOrder,
    duplicateMinSimilarity,
    duplicatePathFilter,
    visibleGroupViews,
  ]);

  useEffect(() => {
    completeDevInteractionOnNextPaint('duplicates.select');
  }, [selectedIds]);

  const toggleVideoSelection = useCallback((video: Video) => {
    beginDevInteraction('duplicates.select');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.id)) next.delete(video.id);
      else next.add(video.id);
      return next;
    });
  }, []);

  const openVideoContextMenu = useCallback((event: React.MouseEvent, groupId: string, videoId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'video',
      x: event.clientX,
      y: event.clientY,
      groupId,
      videoId,
    });
  }, []);

  const openGroupContextMenu = useCallback((event: React.MouseEvent, groupId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'group',
      x: event.clientX,
      y: event.clientY,
      groupId,
    });
  }, []);

  const handlePlayVideo = useCallback((videoId: string, scopeIds: string[]) => {
    const currentScrollTop = listRef.current?.element?.scrollTop;
    if (typeof currentScrollTop === 'number' && Number.isFinite(currentScrollTop)) {
      setDuplicateScrollTop(currentScrollTop);
    }
    beginDevInteraction('review.enter');
    enterReviewAndPlay(videoId, scopeIds);
  }, [enterReviewAndPlay, setDuplicateScrollTop]);

  const selectSuggestedDuplicates = () => {
    const startedAt = performance.now();
    setSelectedIds(new Set(getMarkableDuplicateIds(visibleGroupViews)));
    measureDevNextPaint('duplicates.selectSuggested.nextPaint', startedAt);
  };

  const selectSuggestedDuplicatesForGroup = useCallback((groupView: DuplicateGroupView) => {
    const groupVideoIds = new Set(groupView.group.videoIds);
    const groupIds = getMarkableDuplicateIds([groupView]);
    setSelectedIds((previousIds) => {
      const nextIds = new Set(
        Array.from(previousIds).filter((id) => !groupVideoIds.has(id))
      );
      for (const id of groupIds) nextIds.add(id);
      if (
        nextIds.size === previousIds.size &&
        Array.from(nextIds).every((id) => previousIds.has(id))
      ) return previousIds;
      return nextIds;
    });
  }, [getMarkableDuplicateIds]);

  const markSelectedDuplicates = () => {
    const startedAt = performance.now();
    const ids = Array.from(selectedIds).filter((id) => Boolean(videosById.get(id)));
    if (ids.length === 0) return;
    setVideoStatusesBatch(ids, 'delete');
    measureDevNextPaint('duplicates.markSelected.nextPaint', startedAt);
    pushToast({
      title: 'Duplicates marked',
      detail: `${ids.length} ${ids.length === 1 ? 'video' : 'videos'} marked for deletion. Nothing was deleted from disk.`,
      kind: 'success',
    });
  };

  const selectedCount = selectedIds.size;
  const selectedPair = useMemo(() => {
    if (selectedIds.size !== 2) return null;
    const ids = Array.from(selectedIds);
    const groupView =
      visibleGroupViews.find(({ group }) => ids.every((id) => group.videoIds.includes(id))) ?? null;
    return groupView ? { ids: ids as [string, string], group: groupView.group } : null;
  }, [selectedIds, visibleGroupViews]);

  const ignorePairsWithUndo = useCallback((
    nextIgnoredPairKeys: string[],
    groupsToHide: DuplicateGroup[],
    selectionIdsToRemove: string[],
    title: string,
    detail: string,
    // Groups rebuilt without the ignored pairs; they take the place of the hidden groups.
    replacementGroups: DuplicateGroup[] = []
  ) => {
    if (nextIgnoredPairKeys.length === 0) return;
    const hiddenGroupIds = new Set(groupsToHide.map((group) => group.id));
    const replacementIds = new Set(replacementGroups.map((group) => group.id));
    const removedGroups =
      hiddenGroupIds.size > 0
        ? groups.filter((group) => hiddenGroupIds.has(group.id))
        : [];
    addIgnoredDuplicatePairs(nextIgnoredPairKeys);
    if (hiddenGroupIds.size > 0) {
      let replaced = false;
      setDuplicateGroups(groups.flatMap((group) => {
        if (!hiddenGroupIds.has(group.id)) return [group];
        if (replaced) return [];
        replaced = true;
        return replacementGroups;
      }));
    }
    if (selectionIdsToRemove.length > 0) {
      const idsToRemove = new Set(selectionIdsToRemove);
      setSelectedIds((previousIds) => {
        if (!selectionIdsToRemove.some((id) => previousIds.has(id))) return previousIds;
        return new Set(Array.from(previousIds).filter((id) => !idsToRemove.has(id)));
      });
    }
    pushToast({
      title,
      detail,
      kind: 'info',
      durationMs: 8000,
      actionLabel: 'Undo',
      action: () => {
        removeIgnoredDuplicatePairs(nextIgnoredPairKeys);
        if (removedGroups.length > 0) {
          const currentGroups = useStore.getState().duplicateGroups.filter((group) => !replacementIds.has(group.id));
          const currentIds = new Set(currentGroups.map((group) => group.id));
          const toRestore = removedGroups.filter((group) => !currentIds.has(group.id));
          if (toRestore.length > 0 || replacementIds.size > 0) {
            setDuplicateGroups([...currentGroups, ...toRestore]);
          }
        }
      },
    });
  }, [
    addIgnoredDuplicatePairs,
    groups,
    pushToast,
    removeIgnoredDuplicatePairs,
    setDuplicateGroups,
  ]);

  const dismissGroup = useCallback((group: DuplicateGroup) => {
    ignorePairsWithUndo(
      pairKeysForGroup(group),
      [group],
      group.videoIds,
      'Group dismissed',
      'This group will be ignored in future duplicate runs.'
    );
  }, [ignorePairsWithUndo]);

  const dismissSelectedPair = () => {
    if (!selectedPair) return;
    const { group } = selectedPair;
    const pairKey = duplicatePairKey(selectedPair.ids[0], selectedPair.ids[1]);
    if (group.videoIds.length === 2 || !group.pairs) {
      const hideCurrentGroup = group.videoIds.length === 2 ? [group] : [];
      ignorePairsWithUndo(
        [pairKey],
        hideCurrentGroup,
        selectedPair.ids,
        'Pair marked as not a match',
        hideCurrentGroup.length > 0
          ? 'This pair will be ignored in future duplicate runs.'
          : 'This pair is saved as ignored. Run duplicate detection again to rebuild this group.'
      );
      return;
    }
    // The group keeps its other matches: rebuilt without this pair it may stay whole or split.
    const rebuilt = rebuildDuplicateGroups([group], { ignoredPairKeys: new Set([pairKey]) }, videosById);
    ignorePairsWithUndo(
      [pairKey],
      [group],
      selectedPair.ids,
      'Pair marked as not a match',
      rebuilt.length === 1
        ? 'This pair will be ignored in future duplicate runs. The rest of the group still matches.'
        : 'This pair will be ignored in future duplicate runs. The group was rebuilt from its remaining matches.',
      rebuilt
    );
  };

  const excludeVideoFromGroup = useCallback((group: DuplicateGroup, videoId: string) => {
    if (!group.videoIds.includes(videoId)) return;

    const pairKeys = group.videoIds
      .filter((id) => id !== videoId)
      .map((id) => duplicatePairKey(videoId, id));
    if (pairKeys.length === 0) return;

    const originalGroupIndex = groups.findIndex((entry) => entry.id === group.id);
    // Without the video, the rest is rebuilt from the matches that remain between them.
    const rebuilt = rebuildDuplicateGroups([group], { removedVideoIds: new Set([videoId]) }, videosById);
    const rebuiltIds = new Set(rebuilt.map((entry) => entry.id));
    const nextGroups = groups.flatMap((entry) => (entry.id === group.id ? rebuilt : [entry]));

    addIgnoredDuplicatePairs(pairKeys);
    setDuplicateGroups(nextGroups);
    setSelectedIds((prev) => {
      if (!prev.has(videoId)) return prev;
      const next = new Set(prev);
      next.delete(videoId);
      return next;
    });

    const removedVideo = videosById.get(videoId);
    pushToast({
      title: 'Video excluded from group',
      detail: removedVideo
        ? `${removedVideo.filename} will be ignored against the rest of this group in future duplicate runs.`
        : 'This video will be ignored against the rest of this group in future duplicate runs.',
      kind: 'info',
      durationMs: 8000,
      actionLabel: 'Undo',
      action: () => {
        removeIgnoredDuplicatePairs(pairKeys);
        const currentGroups = useStore.getState().duplicateGroups;
        const withoutGroup = currentGroups.filter((entry) => entry.id !== group.id && !rebuiltIds.has(entry.id));
        const restoredGroups = [...withoutGroup];
        const insertIndex = originalGroupIndex >= 0
          ? Math.min(originalGroupIndex, restoredGroups.length)
          : restoredGroups.length;
        restoredGroups.splice(insertIndex, 0, group);
        setDuplicateGroups(restoredGroups);
      },
    });
  }, [
    addIgnoredDuplicatePairs,
    groups,
    pushToast,
    removeIgnoredDuplicatePairs,
    setDuplicateGroups,
    videosById,
  ]);

  const handleSetSelectedKeeper = useCallback((groupId: string, videoId: string | null) => {
    setManualDuplicateKeeper(groupId, videoId);
    const group = groupViewsById.get(groupId);
    const video = videoId ? videosById.get(videoId) : null;
    if (videoId && group && video) {
      pushToast({
        title: 'Selected keeper updated',
        detail: `${video.filename} is now the selected keeper for this group.`,
        kind: 'success',
      });
      return;
    }
    if (group) {
      pushToast({
        title: 'Keeper override cleared',
        detail: 'This group now uses the automatic keeper suggestion again.',
        kind: 'info',
      });
    }
  }, [groupViewsById, pushToast, setManualDuplicateKeeper, videosById]);

  // Phone videos often report their size before rotation, so the loaded thumbnails correct it.
  const [thumbnailAspectVersion, setThumbnailAspectVersion] = useState(0);
  const aspectFrameRef = useRef(0);
  useEffect(() => () => window.cancelAnimationFrame(aspectFrameRef.current), []);
  const reportThumbnailAspect = useCallback((videoId: string, aspect: number) => {
    const known = thumbnailAspects.get(videoId);
    if (known && Math.abs(known - aspect) < 0.01) return;
    thumbnailAspects.set(videoId, aspect);
    window.cancelAnimationFrame(aspectFrameRef.current);
    // One row update for all thumbnails that load in the same frame.
    aspectFrameRef.current = window.requestAnimationFrame(() => setThumbnailAspectVersion((version) => version + 1));
  }, []);

  const galleryLayout = useMemo(
    () => computeDuplicateGalleryLayout(dimensions.width),
    [dimensions.width]
  );

  const virtualRows = useMemo(() => {
    if (viewMode === 'rows') {
      return buildDuplicateRowsRows(visibleGroupViews);
    }
    const aspectOf = (videoId: string) => {
      const measured = thumbnailAspects.get(videoId);
      if (measured) return measured;
      const video = videosById.get(videoId);
      return video?.width && video.height ? video.width / video.height : null;
    };
    return buildDuplicateGalleryRows(visibleGroupViews, galleryLayout, aspectOf);
    // thumbnailAspectVersion: the measured shapes live outside React state.
  }, [galleryLayout, thumbnailAspectVersion, videosById, viewMode, visibleGroupViews]);

  if (lastRowsRef.current !== virtualRows) {
    lastRowsRef.current = virtualRows;
    rowContentVersionRef.current += 1;
  }

  if (lastSelectedIdsRef.current !== selectedIds) {
    lastSelectedIdsRef.current = selectedIds;
    selectionVersionRef.current += 1;
  }

  const getItemSize = useCallback(
    (index: number) => getDuplicateVirtualRowHeight(virtualRows[index]!),
    [virtualRows]
  );

  const itemData = useMemo<DuplicateRowRuntimeData>(() => ({
    rows: virtualRows,
    groupViewsById,
    videosById,
    selectedIds,
    galleryCardWidth: galleryLayout.cardWidth,
    dismissGroup,
    selectSuggestedDuplicatesForGroup,
    handleToggleSelection: toggleVideoSelection,
    handlePlayVideo,
    handleOpenVideoContextMenu: openVideoContextMenu,
    handleOpenGroupContextMenu: openGroupContextMenu,
    reportThumbnailAspect,
  }), [
    dismissGroup,
    galleryLayout.cardWidth,
    groupViewsById,
    openGroupContextMenu,
    openVideoContextMenu,
    handlePlayVideo,
    reportThumbnailAspect,
    selectSuggestedDuplicatesForGroup,
    selectedIds,
    toggleVideoSelection,
    videosById,
    virtualRows,
  ]);

  duplicateRowRuntimeOwner = runtimeOwnerRef.current;
  duplicateRowRuntime = itemData;

  useLayoutEffect(() => {
    duplicateRowRuntimeOwner = runtimeOwnerRef.current;
    duplicateRowRuntime = itemData;
    return () => {
      if (duplicateRowRuntimeOwner !== runtimeOwnerRef.current) return;
      duplicateRowRuntimeOwner = null;
      duplicateRowRuntime = null;
    };
  }, [itemData]);

  const rowRenderSignals = useMemo<DuplicateRowRenderSignals>(() => ({
    galleryCardWidth: galleryLayout.cardWidth,
    rowContentVersion: rowContentVersionRef.current,
    selectionVersion: selectionVersionRef.current,
    viewMode,
  }), [galleryLayout.cardWidth, selectedIds, viewMode, virtualRows]);

  useLayoutEffect(() => {
    const wasReviewMode = previousReviewModeRef.current;
    previousReviewModeRef.current = reviewMode;
    if (reviewMode) restoringScrollRef.current = false;
    else if (wasReviewMode) restoringScrollRef.current = true;

    // Read, not subscribed: as a dependency every scroll event re-ran this and, with smooth wheel
    // scrolling a frame ahead of the stored value, pulled the list back to where it just was.
    const duplicateScrollTop = useStore.getState().duplicateScrollTop;
    const element = listRef.current?.element;
    if (!element) return;
    if (Math.abs(element.scrollTop - duplicateScrollTop) > 1) {
      element.scrollTop = duplicateScrollTop;
    }
    if (!restoringScrollRef.current) return;

    let frameOne = 0;
    let frameTwo = 0;
    const restore = () => {
      const element = listRef.current?.element;
      if (!element) return;
      if (Math.abs(element.scrollTop - duplicateScrollTop) > 1) {
        element.scrollTop = duplicateScrollTop;
      }
    };
    frameOne = window.requestAnimationFrame(() => {
      restore();
      frameTwo = window.requestAnimationFrame(() => {
        restore();
        restoringScrollRef.current = false;
      });
    });
    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, [dimensions.height, dimensions.width, reviewMode, viewMode, virtualRows.length]);

  const handleRowsRendered = useCallback(({ startIndex }: { startIndex: number; stopIndex: number }) => {
    const row = virtualRows[startIndex];
    if (row) useStore.getState().setDuplicatePosition({ group: row.groupIndex, total: visibleGroupViews.length });
  }, [virtualRows, visibleGroupViews.length]);
  useEffect(() => () => useStore.getState().setDuplicatePosition(null), []);

  const duplicateGroupJump = useStore((s) => s.duplicateGroupJump);
  const handledGroupJumpRef = useRef(duplicateGroupJump?.id ?? 0);
  useEffect(() => {
    if (!duplicateGroupJump || handledGroupJumpRef.current === duplicateGroupJump.id || reviewMode) return;
    const rowIndex = virtualRows.findIndex((row) => row.type === 'group-header' && row.groupIndex === duplicateGroupJump.index);
    if (rowIndex < 0) return;
    handledGroupJumpRef.current = duplicateGroupJump.id;
    listRef.current?.scrollToRow({ index: rowIndex, align: 'start' });
  }, [duplicateGroupJump, reviewMode, virtualRows]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (reviewMode || restoringScrollRef.current) return;
    setDuplicateScrollTop(event.currentTarget.scrollTop);
  }, [reviewMode, setDuplicateScrollTop]);

  const visibleVideoCount = useMemo(
    () => visibleGroupViews.reduce((sum, groupView) => sum + groupView.groupSize, 0),
    [visibleGroupViews]
  );

  const contextMenuGroup = contextMenu ? groupViewsById.get(contextMenu.groupId) ?? null : null;
  const contextMenuVideo =
    contextMenu?.kind === 'video'
      ? videosById.get(contextMenu.videoId) ?? null
      : null;

  const handleCopyPath = useCallback(async (pathValue: string) => {
    try {
      await copyTextToClipboard(pathValue);
      pushToast({
        title: 'Path copied',
        detail: buildCopyPathSuccessDetail(pathValue),
        kind: 'success',
      });
    } catch (error) {
      console.error('Failed to copy path:', error);
      pushToast({
        title: 'Copy failed',
        detail: 'The path could not be copied to the clipboard.',
        kind: 'error',
      });
    }
  }, [pushToast]);

  const contextMenuItems = useMemo(() => {
    if (!contextMenuGroup) return [];
    if (contextMenu?.kind === 'group') {
      return buildDuplicateGroupHeaderMenu({
        group: contextMenuGroup.group,
        canPlaySelectedKeeper: canPlayDuplicateGroupKeeper(contextMenuGroup.group, videosById),
        onDismissGroup: () => dismissGroup(contextMenuGroup.group),
        onSelectSuggestedDeletions: () => selectSuggestedDuplicatesForGroup(contextMenuGroup),
        onClearManualKeeperOverride: () => handleSetSelectedKeeper(contextMenuGroup.group.id, null),
        onPlaySelectedKeeper: () => {
          const keeperId = contextMenuGroup.group.suggestedKeeperId;
          if (!keeperId) return;
          handlePlayVideo(keeperId, contextMenuGroup.group.videoIds);
        },
      });
    }
    if (!contextMenuVideo) return [];
    return buildDuplicateVideoMenu({
      onPlay: () => handlePlayVideo(contextMenuVideo.id, contextMenuGroup.group.videoIds),
      onOpenExternal: () => {
        openVideoExternally(contextMenuVideo.path);
      },
      onReveal: () => {
        revealInExplorer(contextMenuVideo.path);
      },
      onMarkDelete: () => setVideoStatusesBatch([contextMenuVideo.id], 'delete'),
      onMarkKeep: () => setVideoStatusesBatch([contextMenuVideo.id], 'keep'),
      onResetPending: () => setVideoStatusesBatch([contextMenuVideo.id], 'pending'),
      onExcludeFromGroup: () => excludeVideoFromGroup(contextMenuGroup.group, contextMenuVideo.id),
      onSetSelectedKeeper: () => handleSetSelectedKeeper(contextMenuGroup.group.id, contextMenuVideo.id),
      onCopyPath: () => {
        void handleCopyPath(contextMenuVideo.path);
      },
    });
  }, [
    contextMenu,
    contextMenuGroup,
    contextMenuVideo,
    dismissGroup,
    excludeVideoFromGroup,
    handleCopyPath,
    handlePlayVideo,
    handleSetSelectedKeeper,
    selectSuggestedDuplicatesForGroup,
    setVideoStatusesBatch,
    videosById,
  ]);

  const renderToolbar = () => (
    <div className="duplicate-toolbar">
      <div>
        <h2>Duplicates</h2>
        <span>
          {visibleGroupViews.length} / {activeGroups.length} groups / {visibleVideoCount} videos
        </span>
      </div>
      <div className="duplicate-toolbar-actions">
        <button
          className="duplicate-action-btn secondary"
          onClick={selectSuggestedDuplicates}
          title="Select the suggested non-keeper videos in the visible groups. Files are not deleted until you confirm batch deletion."
        >
          Select suggested deletions
        </button>
        {selectedCount > 0 && (
          <button
            className="duplicate-action-btn secondary"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selected
          </button>
        )}
        <button
          className="duplicate-action-btn secondary"
          onClick={dismissSelectedPair}
          disabled={!selectedPair}
          title={selectedPair ? 'Mark the selected pair as not a match' : 'Select exactly two videos in the same group'}
        >
          <Ban size={14} />
          Not a match
        </button>
        <button
          className="duplicate-action-btn"
          onClick={markSelectedDuplicates}
          disabled={selectedCount === 0}
          title="Mark the selected videos for deletion review. Files are not deleted until you confirm batch deletion."
        >
          <Trash2 size={14} />
          Mark selected as Delete{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </div>
    </div>
  );

  if (activeGroups.length === 0) {
    return (
      <div className="duplicate-empty">
        <h2>No duplicate groups</h2>
        <p>Run duplicate detection from the sidebar to build groups.</p>
      </div>
    );
  }

  return (
    <div className="duplicate-groups-view">
      {renderToolbar()}
      <div className="duplicate-list-shell" ref={listShellRef}>
        {visibleGroupViews.length === 0 ? (
          <div className="duplicate-empty duplicate-empty-panel">
            <h2>No groups match the current filters</h2>
            <p>Adjust the duplicate filters in the sidebar to show more groups.</p>
          </div>
        ) : dimensions.height > 0 && dimensions.width > 0 ? (
          <List
            listRef={listRef}
            rowCount={virtualRows.length}
            rowComponent={DuplicateVirtualRowRenderer}
            rowHeight={getItemSize}
            rowProps={rowRenderSignals}
            overscanCount={2}
            onRowsRendered={handleRowsRendered}
            onScroll={handleScroll}
            style={{ height: dimensions.height, width: dimensions.width }}
          />
        ) : null}
      </div>
      {contextMenu && contextMenuGroup && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export default memo(DuplicateGroupsView);

export const __test__ = {
  buildDuplicateGroupViews,
  hasActiveRowRuntime: () => duplicateRowRuntime !== null,
};
