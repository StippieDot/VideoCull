import { useState } from 'react';
import type { StatusFilter, ToastInput, ToastKind } from '../types';
import type { SortField } from '../types';
import useStore from '../store';
import { formatSize, formatRelativeTime, formatRecentPath } from '../utils';
import {
  FolderOpen, RefreshCw, Play, Trash2, Filter,
  ArrowUpDown, HardDrive, FileVideo, Check, X, Clock, SkipForward, Maximize2, Settings, ChevronDown,
  Heart, Star, AlertTriangle
} from 'lucide-react';
import './Sidebar.css';

interface SidebarProps {
  onRescan: () => void;
  onDirectoryPicked: (path: string) => void;
  onNotify: (toast: ToastInput | string, kind?: ToastKind) => void;
  onOpenSettings: () => void;
  onCloseSession: () => void;
}

export default function Sidebar({ onRescan, onDirectoryPicked, onNotify, onOpenSettings, onCloseSession }: SidebarProps) {
  const directory = useStore((s) => s.directory);
  const directories = useStore((s) => s.directories);
  const setDirectory = useStore((s) => s.setDirectory);
  const includeSubfolders = useStore((s) => s.includeSubfolders);
  const setIncludeSubfolders = useStore((s) => s.setIncludeSubfolders);
  const statusFilter = useStore((s) => s.statusFilter);
  const setStatusFilter = useStore((s) => s.setStatusFilter);
  const sortBy = useStore((s) => s.sortBy);
  const setSortBy = useStore((s) => s.setSortBy);
  const sortOrder = useStore((s) => s.sortOrder);
  const setSortOrder = useStore((s) => s.setSortOrder);
  const minSizeFilter = useStore((s) => s.minSizeFilter);
  const setMinSizeFilter = useStore((s) => s.setMinSizeFilter);
  const minDurationFilter = useStore((s) => s.minDurationFilter);
  const setMinDurationFilter = useStore((s) => s.setMinDurationFilter);
  const ratedFilter = useStore((s) => s.ratedFilter);
  const setRatedFilter = useStore((s) => s.setRatedFilter);
  const favoritesFilter = useStore((s) => s.favoritesFilter);
  const setFavoritesFilter = useStore((s) => s.setFavoritesFilter);
  const incompatibleFilter = useStore((s) => s.incompatibleFilter);
  const setIncompatibleFilter = useStore((s) => s.setIncompatibleFilter);
  const features = useStore((s) => s.settings.features);
  const stats = useStore((s) => s.stats);
  const isScanning = useStore((s) => s.isScanning);
  const scanProgress = useStore((s) => s.scanProgress);
  const isGenerating = useStore((s) => s.isGenerating);
  const genProgress = useStore((s) => s.genProgress);
  const setReviewMode = useStore((s) => s.setReviewMode);
  const setReviewIndex = useStore((s) => s.setReviewIndex);
  const filteredVideos = useStore((s) => s.filteredVideos);
  const videos = useStore((s) => s.videos);
  const cardScale = useStore((s) => s.cardScale);
  const setCardScale = useStore((s) => s.setCardScale);
  const groupByFolder = useStore((s) => s.groupByFolder);
  const setGroupByFolder = useStore((s) => s.setGroupByFolder);
  const folderSortBy = useStore((s) => s.folderSortBy);
  const setFolderSortBy = useStore((s) => s.setFolderSortBy);
  const folderSortOrder = useStore((s) => s.folderSortOrder);
  const setFolderSortOrder = useStore((s) => s.setFolderSortOrder);
  const recentDirectories = useStore((s) => s.settings.recentDirectories);
  const recentDirectoryTimestamps = useStore((s) => s.settings.recentDirectoryTimestamps);
  const clearRecentDirectories = useStore((s) => s.clearRecentDirectories);
  const removeRecentDirectory = useStore((s) => s.removeRecentDirectory);

  const [isDeleting, setIsDeleting] = useState(false);
  const [showRecents, setShowRecents] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showSort, setShowSort] = useState(true);
  const [showView, setShowView] = useState(true);

  const handleSelectDir = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.selectDirectory();
    if (dir) onDirectoryPicked(dir);
  };

  const handleOpenRecent = async (dir: string) => {
    if (!window.electronAPI) {
      setDirectory(dir);
      setShowRecents(false);
      return;
    }
    const result = await window.electronAPI.validateDroppedPath(dir);
    if (!result.valid || !result.isDirectory) {
      removeRecentDirectory(dir);
      onNotify({
        title: 'Recent unavailable',
        detail: formatRecentPath(dir),
        kind: 'error',
        dedupeKey: `recent-unavailable:${dir}`,
      });
      return;
    }
    onDirectoryPicked(dir);
    setShowRecents(false);
  };

  const handleRemoveRecent = (dir: string) => {
    removeRecentDirectory(dir);
    onNotify({
      title: 'Recent removed',
      detail: formatRecentPath(dir),
      kind: 'info',
      dedupeKey: `recent-removed:${dir}`,
    });
  };


  const handleBatchDelete = async () => {
    if (!window.electronAPI) return;
    const toDelete = videos.filter((v) => v.status === 'delete');
    if (toDelete.length === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to move ${toDelete.length} videos (${formatSize(stats.deleteSize)}) to the Recycle Bin?`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const results = await window.electronAPI.batchDelete(toDelete.map((v) => v.path));
      const succeeded = results.filter((r) => r.success).map((r) => r.path);
      useStore.getState().removeDeletedVideos(succeeded);
      const permanentSuccessCount = results.filter((r) => r.method === 'permanent' && r.success).length;
      const permanentFailureCount = results.filter((r) => r.method === 'permanent' && !r.success).length;
      const failedCount = results.filter((r) => !r.success).length;
      const removedFolderCount = new Set(results.map((r) => r.removedFolder).filter(Boolean)).size;
      const folderDetail = removedFolderCount > 0
        ? ` ${removedFolderCount} empty ${removedFolderCount === 1 ? 'folder was' : 'folders were'} removed.`
        : '';
      if (permanentSuccessCount > 0 && failedCount > 0) {
        onNotify({
          title: 'Delete partly failed',
          detail: `${succeeded.length} removed, ${failedCount} failed. ${permanentSuccessCount} skipped Recycle Bin.${folderDetail}`,
          kind: 'error',
        });
      } else if (permanentSuccessCount > 0) {
        onNotify({
          title: 'Permanently deleted',
          detail: `${permanentSuccessCount} ${permanentSuccessCount === 1 ? 'file' : 'files'} skipped Recycle Bin.${folderDetail}`,
          kind: 'warning',
        });
      } else if (permanentFailureCount > 0 || failedCount > 0) {
        onNotify({
          title: 'Delete failed',
          detail: `${failedCount} ${failedCount === 1 ? 'file could' : 'files could'} not be removed.`,
          kind: 'error',
        });
      } else {
        onNotify({
          title: 'Moved to Recycle Bin',
          detail: `${succeeded.length} ${succeeded.length === 1 ? 'video' : 'videos'} removed, ${formatSize(stats.deleteSize)} freed.${folderDetail}`,
          kind: 'success',
        });
      }
    } catch (err) {
      console.error('Delete failed:', err);
      onNotify({
        title: 'Delete failed',
        detail: 'The file operation did not complete.',
        kind: 'error',
      });
    }
    setIsDeleting(false);
  };

  const handleStartReview = () => {
    setReviewIndex(0);
    setReviewMode(true);
  };

  const minSizeOptions = [
    { label: 'All sizes', value: 0 },
    { label: '> 50 MB', value: 50 * 1024 * 1024 },
    { label: '> 100 MB', value: 100 * 1024 * 1024 },
    { label: '> 500 MB', value: 500 * 1024 * 1024 },
    { label: '> 1 GB', value: 1024 * 1024 * 1024 },
  ];

  const filterOptions: { key: StatusFilter; label: string; icon?: React.ReactNode }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending', icon: <Clock size={12} /> },
    { key: 'skipped', label: 'Skipped', icon: <SkipForward size={12} /> },
    { key: 'keep', label: 'Keep', icon: <Check size={12} /> },
    { key: 'delete', label: 'Delete', icon: <X size={12} /> },
  ];

  const formatDurationInput = (seconds: number): string => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const reviewLabel = filteredVideos.length === videos.length
    ? `Review ${filteredVideos.length} ${filteredVideos.length === 1 ? 'video' : 'videos'}`
    : `Review ${filteredVideos.length} filtered`;

  const hasIncompatibleVideos = videos.some((v) => v.compatible === false);
  const generationLabel =
    genProgress.phase === 'metadata'
      ? 'Metadata...'
      : genProgress.phase === 'media'
        ? 'Media data...'
        : 'Thumbnails...';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-logo">
          <FileVideo size={22} />
          Video Cull
        </h1>
      </div>

      <section className="sidebar-section sidebar-session-section">
        <div className="session-card">
          <div className="session-card-main">
            <HardDrive size={14} />
            <div className="session-card-copy">
              <span className="session-label">Current folder</span>
              <span className="session-path" title={directories.join('\n') || directory || undefined}>
                {directories.length > 1 ? `${directories.length} folders loaded` : directory}
              </span>
              <label className="session-subfolders-toggle">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(e) => setIncludeSubfolders(e.target.checked)}
                />
                <span className="session-subfolders-box" />
                <span>Include subfolders</span>
              </label>
            </div>
          </div>
        </div>

        {recentDirectories.length > 1 && (
          <button
            className="recents-header-btn"
            title="Show recent folders"
            aria-expanded={showRecents}
            aria-controls="sidebar-recents-list"
            onClick={() => setShowRecents((v) => !v)}
          >
            <span>Recent folders</span>
            <ChevronDown size={14} className={showRecents ? 'chevron-open' : ''} />
          </button>
        )}

        {showRecents && recentDirectories.length > 1 && (
          <div className="recents-panel">
            <ul className="recents-list" id="sidebar-recents-list">
              {recentDirectories.slice(0, 5).map((d) => (
                <li key={d} className="recents-row">
                  <button
                    className={`recents-item ${d === directory ? 'recents-item-active' : ''}`}
                    title={`${d} \u2022 opened ${formatRelativeTime(recentDirectoryTimestamps[d])}`}
                    disabled={d === directory}
                    onClick={() => void handleOpenRecent(d)}
                  >
                    <FolderOpen size={12} />
                    <span className="recents-item-copy">
                      <span className="recents-item-path">{formatRecentPath(d)}</span>
                      <span className="recents-item-meta">{formatRelativeTime(recentDirectoryTimestamps[d])}</span>
                    </span>
                  </button>
                  <button
                    className="recents-remove-btn"
                    title={`Remove ${formatRecentPath(d)} from recent folders`}
                    aria-label={`Remove ${formatRecentPath(d)} from recent folders`}
                    onClick={() => handleRemoveRecent(d)}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="recents-clear-btn"
              onClick={() => {
                const removedCount = recentDirectories.length;
                clearRecentDirectories();
                setShowRecents(false);
                onNotify({
                  title: 'Recents cleared',
                  detail: `${removedCount} ${removedCount === 1 ? 'entry' : 'entries'} removed.`,
                  kind: 'info',
                });
              }}
            >
              Clear all recent folders
            </button>
          </div>
        )}

        <div className="session-action-row">
          <button className="btn btn-primary session-action-btn" onClick={handleSelectDir}>
            Change
          </button>

          <button className="btn btn-outline session-action-btn" onClick={onRescan} disabled={isScanning}>
            Rescan
          </button>

          <button className="btn btn-outline btn-close-session session-action-btn" onClick={onCloseSession}>
            Close
          </button>
        </div>
      </section>

      {(isScanning || isGenerating) && (
        <section className="sidebar-section">
          {isScanning && (
            <div className="progress-info">
              <span className="progress-label">Scanning…</span>
              <span className="progress-detail">{scanProgress.found} videos found</span>
            </div>
          )}
          {isGenerating && (
            <div className="progress-info">
              <span className="progress-label">{generationLabel}</span>
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${genProgress.total > 0 ? (genProgress.current / genProgress.total) * 100 : 0}%` }}
                />
              </div>
              <span className="progress-detail">
                {genProgress.current} / {genProgress.total}
              </span>
            </div>
          )}
        </section>
      )}

      {stats.total > 0 && (
        <section className="sidebar-section">
          <h3 className="sidebar-section-title">Statistics</h3>
          <div className="stat-grid">
            <div className="stat-item stat-total">
              <span className="stat-value">{stats.total}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat-item stat-pending">
              <span className="stat-value">{stats.pending}</span>
              <span className="stat-label">Pending</span>
            </div>
            <div className="stat-item stat-keep">
              <span className="stat-value">{stats.keep}</span>
              <span className="stat-label">Keep</span>
            </div>
            <div className="stat-item stat-skipped">
              <span className="stat-value">{stats.skipped}</span>
              <span className="stat-label">Skipped</span>
            </div>
            <div className="stat-item stat-delete">
              <span className="stat-value">{stats.delete}</span>
              <span className="stat-label">Delete</span>
            </div>
          </div>
          {stats.deleteSize > 0 && (
            <p className="delete-size-note">
              <Trash2 size={13} />
              {formatSize(stats.deleteSize)} to free up
            </p>
          )}
        </section>
      )}

      {stats.total > 0 && (
        <section className="sidebar-section sidebar-collapsible-section">
          <button className="sidebar-section-toggle" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <span className="sidebar-section-title">
              <Filter size={14} /> Filters
            </span>
            <ChevronDown size={14} className={showFilters ? 'chevron-open' : ''} />
          </button>

          {showFilters && (
            <div className="sidebar-section-content">
              <div className="filter-pills">
                {filterOptions.map((f) => (
                  <button
                    key={f.key}
                    className={`pill ${statusFilter === f.key ? 'pill-active' : ''} ${f.key !== 'all' ? `pill-${f.key}` : ''}`}
                    onClick={() => setStatusFilter(f.key)}
                  >
                    {f.icon}{f.label}
                  </button>
                ))}
              </div>

              {(features.ratings || features.favorites || (features.compatibilityCheck && hasIncompatibleVideos)) && (
                <div className="filter-pills filter-pills-extra">
                  {features.favorites && (
                    <button
                      className={`pill ${favoritesFilter ? 'pill-active' : ''}`}
                      onClick={() => setFavoritesFilter(!favoritesFilter)}
                      title="Show only favorite videos"
                    >
                      <Heart size={12} /> Favorites
                    </button>
                  )}
                  {features.ratings && (
                    <button
                      className={`pill ${ratedFilter ? 'pill-active' : ''}`}
                      onClick={() => setRatedFilter(!ratedFilter)}
                      title="Show only rated videos"
                    >
                      <Star size={12} /> Rated only
                    </button>
                  )}
                  {features.compatibilityCheck && hasIncompatibleVideos && (
                    <button
                      className={`pill pill-delete ${incompatibleFilter ? 'pill-active' : ''}`}
                      onClick={() => setIncompatibleFilter(!incompatibleFilter)}
                      title="Show only videos that need the external player"
                    >
                      <AlertTriangle size={12} /> Incompatible
                    </button>
                  )}
                </div>
              )}

              <div className="filter-field">
                <label className="filter-input-label" htmlFor="size-filter">File size</label>
                <select
                  id="size-filter"
                  className="sidebar-select"
                  value={minSizeFilter}
                  onChange={(e) => setMinSizeFilter(Number(e.target.value))}
                >
                  {minSizeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="filter-field">
                <label className="filter-input-label" htmlFor="min-duration-filter">Minimum duration</label>
                <input
                  id="min-duration-filter"
                  className="sidebar-number-input"
                  type="number"
                  min={0}
                  step={1}
                  value={minDurationFilter}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const safeValue = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
                    setMinDurationFilter(safeValue);
                  }}
                />
                <span className="filter-input-help">Seconds, equivalent: {formatDurationInput(minDurationFilter)}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {stats.total > 0 && (
        <section className="sidebar-section sidebar-collapsible-section">
          <button className="sidebar-section-toggle" onClick={() => setShowSort((v) => !v)} aria-expanded={showSort}>
            <span className="sidebar-section-title">
              <ArrowUpDown size={14} /> Sort
            </span>
            <ChevronDown size={14} className={showSort ? 'chevron-open' : ''} />
          </button>

          {showSort && (
            <div className="sidebar-section-content">
              <button
                className={`btn btn-toggle ${groupByFolder ? 'btn-toggle-active' : ''}`}
                onClick={() => setGroupByFolder(!groupByFolder)}
                title="Group videos by subfolder"
              >
                <FolderOpen size={14} />
                Group by folder
              </button>

              {groupByFolder ? (
                <div className="sort-nested-options">
                  <div className="sort-group">
                    <span className="sort-label">Folder order</span>
                    <div className="sort-row">
                      <select
                        className="sidebar-select"
                        value={folderSortBy}
                        onChange={(e) => setFolderSortBy(e.target.value as 'name' | 'size')}
                      >
                        <option value="name">Name</option>
                        <option value="size">Size</option>
                      </select>
                      <button
                        className="btn btn-icon"
                        onClick={() => setFolderSortOrder(folderSortOrder === 'asc' ? 'desc' : 'asc')}
                        title={folderSortOrder === 'asc' ? 'Ascending' : 'Descending'}
                      >
                        <ArrowUpDown size={14} style={{ transform: folderSortOrder === 'desc' ? 'scaleY(-1)' : 'none' }} />
                      </button>
                    </div>
                  </div>
                  <div className="sort-group">
                    <span className="sort-label">Within folder</span>
                    <div className="sort-row">
                      <select
                        className="sidebar-select"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortField)}
                      >
                        <option value="name">Name</option>
                        <option value="size">Size</option>
                        <option value="duration">Duration</option>
                        <option value="date">Date</option>
                        {features.ratings && <option value="rating">Rating</option>}
                        {features.codecBadges && <option value="resolution">Resolution</option>}
                        {features.codecBadges && <option value="fps">FPS</option>}
                      </select>
                      <button
                        className="btn btn-icon"
                        onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                        title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                      >
                        <ArrowUpDown size={14} style={{ transform: sortOrder === 'desc' ? 'scaleY(-1)' : 'none' }} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="sort-row">
                  <select
                    className="sidebar-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortField)}
                  >
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                    <option value="duration">Duration</option>
                    <option value="date">Date</option>
                    {features.ratings && <option value="rating">Rating</option>}
                    {features.codecBadges && <option value="resolution">Resolution</option>}
                    {features.codecBadges && <option value="fps">FPS</option>}
                  </select>
                  <button
                    className="btn btn-icon"
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  >
                    <ArrowUpDown size={14} style={{ transform: sortOrder === 'desc' ? 'scaleY(-1)' : 'none' }} />
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {stats.total > 0 && (
        <section className="sidebar-section sidebar-collapsible-section">
          <button className="sidebar-section-toggle" onClick={() => setShowView((v) => !v)} aria-expanded={showView}>
            <span className="sidebar-section-title">
              <Maximize2 size={14} /> View
            </span>
            <ChevronDown size={14} className={showView ? 'chevron-open' : ''} />
          </button>

          {showView && (
            <div className="sidebar-section-content">
              <div className="slider-row">
                <span className="view-slider-label">Card size</span>
                <input
                  type="range"
                  className="sidebar-slider"
                  min={0.6}
                  max={2}
                  step={0.1}
                  value={cardScale}
                  onChange={(e) => setCardScale(Number(e.target.value))}
                />
                <span className="slider-value">{Math.round(cardScale * 100)}%</span>
              </div>
            </div>
          )}
        </section>
      )}

      {stats.total > 0 && (
        <div className="sidebar-actions">
          {stats.delete > 0 && (
            <button
              className="btn btn-danger"
              onClick={handleBatchDelete}
              disabled={isDeleting}
            >
              <Trash2 size={16} />
              {isDeleting
                ? 'Deleting…'
                : `Delete ${stats.delete} videos (${formatSize(stats.deleteSize)})`}
            </button>
          )}
        </div>
      )}

      <div className="sidebar-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <button className="settings-icon-btn" onClick={onOpenSettings} title="Preferences (Ctrl+,)" style={{ flexShrink: 0 }}>
          <Settings size={18} />
        </button>

        {filteredVideos.length > 0 && (
          <button 
            className="btn btn-accent" 
            onClick={handleStartReview} 
            style={{ flex: 1, padding: '8px', fontSize: '13px' }}
          >
            <Play size={16} />
            {reviewLabel}
          </button>
        )}
      </div>
    </aside>
  );
}
