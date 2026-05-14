import { useEffect, useMemo, useRef, useState } from 'react';
import useStore from '../store';
import type { DuplicateGroup, Video } from '../types';
import { formatDuration, formatFps, formatSize, formatResolutionLabel } from '../utils';
import VideoCard from './VideoCard';
import { Ban, CheckCircle2, Play, Trash2 } from 'lucide-react';
import './DuplicateGroupsView.css';

let savedDuplicateScrollTop = 0;

function thumbSrc(video: Video): string {
  if (video.thumbnails[0]) return `thumb://local/${encodeURIComponent(video.thumbnails[0])}`;
  return video.osThumbnail ?? '';
}

function bitrateLabel(video: Video): string {
  const bitrate = video.videoBitrate ?? video.totalBitrate;
  if (!bitrate) return 'bitrate --';
  return `${Math.round(bitrate / 1000).toLocaleString()} kbps`;
}

function videoMeta(video: Video): string {
  return [
    formatResolutionLabel(video.width, video.height),
    formatFps(video.fps),
    bitrateLabel(video),
    formatDuration(video.durationSecs),
    formatSize(video.sizeBytes),
  ].filter(Boolean).join(' / ');
}

function parentPath(filePath: string): string {
  const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSeparator >= 0 ? filePath.slice(0, lastSeparator) : filePath;
}

function groupTotalSize(group: DuplicateGroup, videosById: Map<string, Video>): number {
  return group.videoIds.reduce((sum, id) => sum + (videosById.get(id)?.sizeBytes ?? 0), 0);
}

function duplicatePairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function pairKeysForGroup(group: DuplicateGroup): string[] {
  const keys: string[] = [];
  for (let i = 0; i < group.videoIds.length; i++) {
    for (let j = i + 1; j < group.videoIds.length; j++) {
      keys.push(duplicatePairKey(group.videoIds[i], group.videoIds[j]));
    }
  }
  return keys;
}

export default function DuplicateGroupsView() {
  const videos = useStore((s) => s.videos);
  const groups = useStore((s) => s.duplicateGroups);
  const viewMode = useStore((s) => s.duplicateViewMode);
  const setVideoStatusesBatch = useStore((s) => s.setVideoStatusesBatch);
  const enterReviewAndPlay = useStore((s) => s.enterReviewAndPlay);
  const settings = useStore((s) => s.settings.duplicates);
  const duplicatePathFilter = useStore((s) => s.duplicatePathFilter);
  const duplicateMinSimilarity = useStore((s) => s.duplicateMinSimilarity);
  const duplicateSortBy = useStore((s) => s.duplicateSortBy);
  const duplicateSortOrder = useStore((s) => s.duplicateSortOrder);
  const setDuplicateGroups = useStore((s) => s.setDuplicateGroups);
  const addIgnoredDuplicatePairs = useStore((s) => s.addIgnoredDuplicatePairs);
  const removeIgnoredDuplicatePairs = useStore((s) => s.removeIgnoredDuplicatePairs);
  const pushToast = useStore((s) => s.pushToast);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const videosById = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const visibleGroups = useMemo(() => {
    const pathQuery = duplicatePathFilter.trim().toLowerCase();
    const filtered = groups.filter((group) => {
      if (group.similarity < duplicateMinSimilarity) return false;
      if (!pathQuery) return true;
      return group.videoIds.some((id) => {
        const video = videosById.get(id);
        return Boolean(video && `${video.filename} ${video.path}`.toLowerCase().includes(pathQuery));
      });
    });

    return [...filtered].sort((a, b) => {
      let diff = 0;
      if (duplicateSortBy === 'similarity') diff = a.similarity - b.similarity;
      else if (duplicateSortBy === 'groupSize') diff = a.videoIds.length - b.videoIds.length;
      else if (duplicateSortBy === 'totalSize') diff = groupTotalSize(a, videosById) - groupTotalSize(b, videosById);
      if (diff === 0) diff = b.similarity - a.similarity;
      return duplicateSortOrder === 'asc' ? diff : -diff;
    });
  }, [duplicateMinSimilarity, duplicatePathFilter, duplicateSortBy, duplicateSortOrder, groups, videosById]);

  const videosForGroup = (group: DuplicateGroup) => group.videoIds
    .map((id) => videosById.get(id))
    .filter((video): video is Video => Boolean(video));

  const isProtectedFromSuggestion = (video: Video) => (
    (settings.protectKeep && video.status === 'keep') ||
    (settings.protectSkipped && video.status === 'skipped')
  );

  const getMarkableDuplicateIds = (scopeGroups: DuplicateGroup[]) => {
    const ids: string[] = [];
    for (const group of scopeGroups) {
      for (const videoId of group.videoIds) {
        const video = videosById.get(videoId);
        if (!video || group.suggestedKeeperId === videoId) continue;
        if (isProtectedFromSuggestion(video)) continue;
        ids.push(videoId);
      }
    }
    return ids;
  };

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = savedDuplicateScrollTop;
  }, []);

  const toggleVideoSelection = (video: Video) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.id)) next.delete(video.id);
      else next.add(video.id);
      return next;
    });
  };

  const selectSuggestedDuplicates = () => {
    setSelectedIds(new Set(getMarkableDuplicateIds(visibleGroups)));
  };

  const markSelectedDuplicates = () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const video = videosById.get(id);
      return Boolean(video);
    });
    if (ids.length === 0) return;
    setVideoStatusesBatch(ids, 'delete');
    setSelectedIds(new Set());
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
    const group = visibleGroups.find((candidate) => ids.every((id) => candidate.videoIds.includes(id))) ?? null;
    return group ? { ids: ids as [string, string], group } : null;
  }, [selectedIds, visibleGroups]);

  const ignorePairsWithUndo = (nextIgnoredPairKeys: string[], groupsToHide: DuplicateGroup[], title: string, detail: string) => {
    if (nextIgnoredPairKeys.length === 0) return;
    const hiddenGroupIds = new Set(groupsToHide.map((group) => group.id));
    const removedGroups = hiddenGroupIds.size > 0 ? groups.filter((group) => hiddenGroupIds.has(group.id)) : [];
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
          // Merge the removed groups back into the current list instead of
          // restoring a stale snapshot. This avoids un-dismissing groups the
          // user dealt with separately between the dismiss and the undo.
          const currentGroups = useStore.getState().duplicateGroups;
          const currentIds = new Set(currentGroups.map((group) => group.id));
          const toRestore = removedGroups.filter((group) => !currentIds.has(group.id));
          if (toRestore.length > 0) {
            setDuplicateGroups([...currentGroups, ...toRestore]);
          }
        }
      },
    });
  };

  const dismissGroup = (group: DuplicateGroup) => {
    ignorePairsWithUndo(
      pairKeysForGroup(group),
      [group],
      'Group dismissed',
      'This group will be ignored in future duplicate runs.'
    );
  };

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

  const renderToolbar = () => (
    <div className="duplicate-toolbar">
      <div>
        <h2>Duplicates</h2>
        <span>
          {visibleGroups.length} / {groups.length} groups
          {' / '}
          {visibleGroups.reduce((sum, group) => sum + group.videoIds.length, 0)} videos
        </span>
      </div>
      <div className="duplicate-toolbar-actions">
        <button className="duplicate-action-btn secondary" onClick={selectSuggestedDuplicates}>
          Select duplicates
        </button>
        {selectedCount > 0 && (
          <button className="duplicate-action-btn secondary" onClick={() => setSelectedIds(new Set())}>
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
        <button className="duplicate-action-btn" onClick={markSelectedDuplicates} disabled={selectedCount === 0}>
          <Trash2 size={14} />
          Mark selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
      </div>
    </div>
  );

  const renderGroupHeader = (group: DuplicateGroup) => (
    <div className="duplicate-group-header">
      <div className="duplicate-group-title">
        <strong>{group.similarity.toFixed(1)}%</strong>
        <em>{group.videoIds.length} videos</em>
        <em>{formatSize(groupTotalSize(group, videosById))}</em>
      </div>
      <button className="duplicate-group-dismiss-btn" onClick={() => dismissGroup(group)}>
        <Ban size={13} />
        Dismiss group
      </button>
    </div>
  );

  const renderRows = () => (
    <div className="duplicate-group-list">
      {visibleGroups.map((group) => (
        <section key={group.id} className="duplicate-group">
          {renderGroupHeader(group)}
          <div className="duplicate-row-list">
            {videosForGroup(group).map((video) => (
              <div
                key={video.id}
                className={`duplicate-row ${group.suggestedKeeperId === video.id ? 'keeper' : ''} ${selectedIds.has(video.id) ? 'selected' : ''}`}
              >
                <label className="duplicate-select-cell" title="Select video">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(video.id)}
                    onChange={() => toggleVideoSelection(video)}
                  />
                </label>
                <img src={thumbSrc(video)} alt="" />
                <div className="duplicate-row-copy">
                  <strong>{video.filename}</strong>
                  <span className="duplicate-row-path" title={video.path}>{parentPath(video.path)}</span>
                  <span>{videoMeta(video)}</span>
                </div>
                {group.suggestedKeeperId === video.id && <span className="duplicate-keeper-badge"><CheckCircle2 size={13} /> Suggested keeper</span>}
                <button className="duplicate-play-btn" onClick={() => enterReviewAndPlay(video.id, group.videoIds)} title="Play in review mode">
                  <Play size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );

  const renderGallery = () => (
    <div className="duplicate-gallery">
      {visibleGroups.map((group) => (
        <section key={group.id} className="duplicate-group">
          {renderGroupHeader(group)}
          <div className="duplicate-card-grid">
            {videosForGroup(group).map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                showSelectionControls
                isSelected={selectedIds.has(video.id)}
                onToggleSelect={() => toggleVideoSelection(video)}
                onPlay={() => enterReviewAndPlay(video.id, group.videoIds)}
              />
            ))}
          </div>
        </section>
      ))}
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

  if (visibleGroups.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="duplicate-groups-view"
        onScroll={(event) => { savedDuplicateScrollTop = event.currentTarget.scrollTop; }}
      >
        {renderToolbar()}
        <div className="duplicate-empty">
          <h2>No groups match the current filters</h2>
          <p>Adjust the duplicate filters in the sidebar to show more groups.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="duplicate-groups-view"
      onScroll={(event) => { savedDuplicateScrollTop = event.currentTarget.scrollTop; }}
    >
      {renderToolbar()}
      {viewMode === 'rows' && renderRows()}
      {viewMode === 'gallery' && renderGallery()}
    </div>
  );
}
