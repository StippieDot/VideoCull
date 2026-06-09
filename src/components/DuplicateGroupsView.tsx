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
  DUPLICATE_GALLERY_CARD_HEIGHT,
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
};

type DuplicateRowRuntimeData = {
  rows: DuplicateVirtualRow[];
  groupViewsById: Map<string, DuplicateGroupView>;
  videosById: Map<string, Video>;
  selectedIds: Set<string>;
  galleryCardWidth: number;
  dismissGroup: (group: DuplicateGroup) => void;
  handleToggleSelection: (video: Video) => void;
  handlePlayVideo: (videoId: string, scopeIds: string[]) => void;
  handleOpenVideoContextMenu: (event: React.MouseEvent, groupId: string, videoId: string) => void;
  handleOpenGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
};

type DuplicateRowRenderSignals = {
  galleryCardWidth: number;
  rowContentVersion: number;
  selectionVersion: number;
  viewMode: DuplicateViewMode;
};

let duplicateRowRuntime: DuplicateRowRuntimeData | null = null;

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

  const metrics: { key: string; value: (v: Video) => number; higher: boolean }[] = [
    { key: 'resolution', value: (v) => (v.width ?? 0) * (v.height ?? 0), higher: true },
    { key: 'fps', value: (v) => v.fps ?? 0, higher: true },
    { key: 'bitrate', value: (v) => v.videoBitrate ?? v.totalBitrate ?? 0, higher: true },
    { key: 'duration', value: (v) => v.durationSecs ?? 0, higher: true },
    { key: 'size', value: (v) => v.sizeBytes ?? 0, higher: false },
  ];

  for (const metric of metrics) {
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
  return flags;
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
      </div>
      {suggestedKeeperId === video.id && (
        <span className="duplicate-keeper-badge">
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

const DuplicateGalleryCard = memo(function DuplicateGalleryCard({
  video,
  groupVideoIds,
  groupId,
  isSelected,
  onToggleSelection,
  onPlayVideo,
  onOpenVideoContextMenu,
}: DuplicateGalleryCardProps) {
  return (
    <div onContextMenu={(event) => onOpenVideoContextMenu(event, groupId, video.id)}>
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

const DuplicateGroupHeaderPanel = memo(function DuplicateGroupHeaderPanel({
  groupView,
  onDismissGroup,
  onOpenGroupContextMenu,
}: {
  groupView: DuplicateGroupView;
  onDismissGroup: (group: DuplicateGroup) => void;
  onOpenGroupContextMenu: (event: React.MouseEvent, groupId: string) => void;
}) {
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
          <strong>{groupView.group.similarity.toFixed(1)}%</strong>
          <em>{groupView.groupSize} videos</em>
          <em>{formatSize(groupView.totalSize)}</em>
          <em>{groupView.group.reason}</em>
        </div>
        <button
          className="duplicate-group-dismiss-btn"
          onClick={() => onDismissGroup(groupView.group)}
        >
          <Ban size={13} />
          Dismiss group
        </button>
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
                style={{ height: DUPLICATE_GALLERY_CARD_HEIGHT }}
              >
                <DuplicateGalleryCard
                  video={video}
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
  const duplicateScrollTop = useStore((s) => s.duplicateScrollTop);
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
  const lastRowsRef = useRef<DuplicateVirtualRow[] | null>(null);
  const rowContentVersionRef = useRef(0);
  const lastSelectedIdsRef = useRef(selectedIds);
  const selectionVersionRef = useRef(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const videosById = useMemo(
    () => new Map(videos.map((video) => [video.id, video])),
    [videos]
  );

  const groupViews = useMemo<DuplicateGroupView[]>(() => {
    const startedAt = performance.now();
    const built = groups.map((group) => {
      const groupVideos = group.videoIds
        .map((id) => videosById.get(id))
        .filter((video): video is Video => Boolean(video));
      return {
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
    });
    recordDevPerf('duplicates.groupViews.compute', performance.now() - startedAt, {
      items: groups.length,
    });
    return built;
  }, [groups, videosById]);

  const visibleGroupViews = useMemo(() => {
    const startedAt = performance.now();
    const pathQuery = duplicatePathFilter.trim().toLowerCase();
    const filtered = groupViews.filter(({ group, searchText }) => {
      if (group.similarity < duplicateMinSimilarity) return false;
      if (!pathQuery) return true;
      return searchText.includes(pathQuery);
    });

    const sorted = [...filtered].sort((a, b) => {
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
    title: string,
    detail: string
  ) => {
    if (nextIgnoredPairKeys.length === 0) return;
    const hiddenGroupIds = new Set(groupsToHide.map((group) => group.id));
    const removedGroups =
      hiddenGroupIds.size > 0
        ? groups.filter((group) => hiddenGroupIds.has(group.id))
        : [];
    addIgnoredDuplicatePairs(nextIgnoredPairKeys);
    if (hiddenGroupIds.size > 0) {
      setDuplicateGroups(groups.filter((group) => !hiddenGroupIds.has(group.id)));
    }
    setSelectedIds(new Set());
    pushToast({
      title,
      detail,
      kind: 'info',
      durationMs: 8000,
      actionLabel: 'Undo',
      action: () => {
        removeIgnoredDuplicatePairs(nextIgnoredPairKeys);
        if (removedGroups.length > 0) {
          const currentGroups = useStore.getState().duplicateGroups;
          const currentIds = new Set(currentGroups.map((group) => group.id));
          const toRestore = removedGroups.filter((group) => !currentIds.has(group.id));
          if (toRestore.length > 0) {
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
      'Group dismissed',
      'This group will be ignored in future duplicate runs.'
    );
  }, [ignorePairsWithUndo]);

  const dismissSelectedPair = () => {
    if (!selectedPair) return;
    const hideCurrentGroup = selectedPair.group.videoIds.length === 2 ? [selectedPair.group] : [];
    ignorePairsWithUndo(
      [duplicatePairKey(selectedPair.ids[0], selectedPair.ids[1])],
      hideCurrentGroup,
      'Pair marked as not a match',
      hideCurrentGroup.length > 0
        ? 'This pair will be ignored in future duplicate runs.'
        : 'This pair is saved as ignored. Run duplicate detection again to rebuild this group.'
    );
  };

  const excludeVideoFromGroup = useCallback((group: DuplicateGroup, videoId: string) => {
    if (!group.videoIds.includes(videoId)) return;

    const pairKeys = group.videoIds
      .filter((id) => id !== videoId)
      .map((id) => duplicatePairKey(videoId, id));
    if (pairKeys.length === 0) return;

    const updatedVideoIds = group.videoIds.filter((id) => id !== videoId);
    const originalGroupIndex = groups.findIndex((entry) => entry.id === group.id);
    const nextGroups = groups.flatMap((entry) => {
      if (entry.id !== group.id) return [entry];
      if (updatedVideoIds.length < 2) return [];
      return [{
        ...entry,
        videoIds: updatedVideoIds,
        exactVideoIds: entry.exactVideoIds?.filter((id) => id !== videoId),
        manualSuggestedKeeperId: entry.manualSuggestedKeeperId === videoId ? null : entry.manualSuggestedKeeperId,
      }];
    });

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
        const withoutGroup = currentGroups.filter((entry) => entry.id !== group.id);
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

  const galleryLayout = useMemo(
    () => computeDuplicateGalleryLayout(dimensions.width),
    [dimensions.width]
  );

  const virtualRows = useMemo(() => {
    if (viewMode === 'rows') {
      return buildDuplicateRowsRows(visibleGroupViews);
    }
    return buildDuplicateGalleryRows(visibleGroupViews, galleryLayout);
  }, [galleryLayout, viewMode, visibleGroupViews]);

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
    handleToggleSelection: toggleVideoSelection,
    handlePlayVideo,
    handleOpenVideoContextMenu: openVideoContextMenu,
    handleOpenGroupContextMenu: openGroupContextMenu,
  }), [
    dismissGroup,
    galleryLayout.cardWidth,
    groupViewsById,
    openGroupContextMenu,
    openVideoContextMenu,
    handlePlayVideo,
    selectedIds,
    toggleVideoSelection,
    videosById,
    virtualRows,
  ]);

  duplicateRowRuntime = itemData;

  const rowRenderSignals = useMemo<DuplicateRowRenderSignals>(() => ({
    galleryCardWidth: galleryLayout.cardWidth,
    rowContentVersion: rowContentVersionRef.current,
    selectionVersion: selectionVersionRef.current,
    viewMode,
  }), [galleryLayout.cardWidth, selectedIds, viewMode, virtualRows]);

  useLayoutEffect(() => {
    const element = listRef.current?.element;
    if (!element) return;
    if (Math.abs(element.scrollTop - duplicateScrollTop) > 1) {
      element.scrollTop = duplicateScrollTop;
    }
  }, [dimensions.height, dimensions.width, duplicateScrollTop, reviewMode, viewMode, virtualRows.length]);

  useEffect(() => {
    if (reviewMode) return;
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
      frameTwo = window.requestAnimationFrame(restore);
    });
    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, [duplicateScrollTop, reviewMode, viewMode]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (reviewMode) return;
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

  const selectSuggestedDuplicatesForGroup = useCallback((groupView: DuplicateGroupView) => {
    setSelectedIds(new Set(getMarkableDuplicateIds([groupView])));
  }, [getMarkableDuplicateIds]);

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
        void window.electronAPI?.openVideo(contextMenuVideo.path);
      },
      onReveal: () => {
        void window.electronAPI?.openInExplorer(contextMenuVideo.path);
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
          {visibleGroupViews.length} / {groups.length} groups / {visibleVideoCount} videos
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
          Mark selected for deletion{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </div>
    </div>
  );

  if (groups.length === 0) {
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
