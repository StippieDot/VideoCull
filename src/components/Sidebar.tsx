import { useMemo, useState, type CSSProperties } from 'react';
import type { ColorTheme, DuplicateSortField, StatusFilter, ToastInput, ToastKind } from '../types';
import type { SortField } from '../types';
import useStore from '../store';
import { beginDevInteraction } from '../perf-dev';
import { formatKeybind } from '../keybinds';
import { DEFAULT_KEYBINDS } from '../keybind-defaults';
import { formatDeleteConfirmation, formatSize, formatRelativeTime, formatRecentPath } from '../utils';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail, buildRecentFolderMenu } from './contextMenuBuilders';
import {
  FolderOpen, RefreshCw, Play, Trash2, Filter,
  ArrowUpDown, HardDrive, FileVideo, X, Maximize2, Settings, ChevronDown,
  Heart, Star, AlertTriangle, Volume2, VolumeX, CopyCheck, Grid3X3, List, CircleHelp, Moon, Sun
} from 'lucide-react';
import './Sidebar.css';

interface SidebarProps {
  onRescan: () => void;
  onDirectoryPicked: (path: string) => void;
  onNotify: (toast: ToastInput | string, kind?: ToastKind) => void;
  onOpenSettings: () => void;
  onCloseSession: () => void;
  onFindDuplicates: () => void;
  onOpenDuplicateSettings: () => void;
  onOpenDocumentation: () => void;
  globalMute: boolean;
  globalMuteEnabled: boolean;
  globalMuteLabel: string;
  onToggleGlobalMute: () => void;
  theme: ColorTheme;
  onToggleTheme: () => void;
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const BYTE_UNITS = [1, 1024, 1024 ** 2, 1024 ** 3, 1024 ** 4];
const RANGE_THUMB_INSET = 26;

function roundUpNice(value: number): number {
  if (value <= 0) return 0;
  let step = 1;
  if (value > 500) step = 100;
  else if (value > 100) step = 50;
  else if (value > 50) step = 10;
  else if (value > 10) step = 5;
  return Math.ceil(value / step) * step;
}

function roundUpSizeBytes(bytes: number): number {
  if (bytes <= 0) return 0;
  const unitIndex = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const roundedValue = roundUpNice(bytes / BYTE_UNITS[unitIndex]);
  if (roundedValue >= 1000 && unitIndex < BYTE_UNITS.length - 1) {
    return BYTE_UNITS[unitIndex + 1];
  }
  return Math.ceil(roundedValue * BYTE_UNITS[unitIndex]);
}

function roundUpDurationSeconds(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds <= 60) return Math.ceil(seconds / 5) * 5;
  if (seconds <= 5 * 60) return Math.ceil(seconds / 15) * 15;
  if (seconds <= 60 * 60) return Math.ceil(seconds / (5 * 60)) * 5 * 60;
  if (seconds <= 3 * 60 * 60) return Math.ceil(seconds / (15 * 60)) * 15 * 60;
  if (seconds <= 12 * 60 * 60) return Math.ceil(seconds / (30 * 60)) * 30 * 60;
  return Math.ceil(seconds / (60 * 60)) * 60 * 60;
}

function formatSliderSize(bytes: number): string {
  return formatSize(bytes).replace('.0 ', ' ');
}

function getRangeTrackStyle(min: number, max: number, selectedMin: number, selectedMax: number): CSSProperties {
  const span = max - min;
  if (span <= 0) {
    return { '--range-fill-left': '0%', '--range-fill-right': '100%', '--range-fill-visible': '0' } as CSSProperties;
  }
  const start = ((selectedMin - min) / span) * 100;
  const end = ((selectedMax - min) / span) * 100;
  const clampedStart = Math.max(0, Math.min(100, start));
  const clampedEnd = Math.max(0, Math.min(100, end));
  const hasVisibleFill = clampedEnd > clampedStart;
  const leftInset = RANGE_THUMB_INSET - (clampedStart / 100) * RANGE_THUMB_INSET * 2;
  const rightPercent = 100 - clampedEnd;
  const rightInset = RANGE_THUMB_INSET - (rightPercent / 100) * RANGE_THUMB_INSET * 2;
  return {
    '--range-fill-left': `calc(${clampedStart}% + ${leftInset}px)`,
    '--range-fill-right': `calc(${rightPercent}% + ${rightInset}px)`,
    '--range-fill-visible': hasVisibleFill ? '1' : '0',
  } as CSSProperties;
}

function SidebarProgressSection() {
  const isScanning = useStore((s) => s.isScanning);
  const scanProgress = useStore((s) => s.scanProgress);
  const isGenerating = useStore((s) => s.isGenerating);
  const genProgress = useStore((s) => s.genProgress);

  if (!isScanning && !isGenerating) return null;

  const generationLabel =
    genProgress.phase === 'metadata'
      ? 'Metadata...'
      : genProgress.phase === 'media'
        ? 'Media data...'
        : 'Thumbnails...';

  return (
    <section className="sidebar-section">
      {isScanning && (
        <div className="progress-info">
          <span className="progress-label">Scanning...</span>
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
  );
}

function DuplicateProgressInfo() {
  const isFindingDuplicates = useStore((s) => s.isFindingDuplicates);
  const duplicateProgress = useStore((s) => s.duplicateProgress);

  if (!isFindingDuplicates || !duplicateProgress) return null;

  return (
    <div className="progress-info duplicate-progress-info">
      <span className="progress-label">{duplicateProgress.stage}</span>
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${duplicateProgress.total > 0 ? (duplicateProgress.current / duplicateProgress.total) * 100 : 0}%` }}
        />
      </div>
      <span className="progress-detail">
        {duplicateProgress.total > 0 ? `${duplicateProgress.current} / ${duplicateProgress.total}` : 'Preparing...'}
      </span>
    </div>
  );
}

function SidebarDuplicateSection({
  onFindDuplicates,
  onOpenDuplicateSettings,
}: Pick<SidebarProps, 'onFindDuplicates' | 'onOpenDuplicateSettings'>) {
  const duplicateSettings = useStore((s) => s.settings.duplicates);
  const statsTotal = useStore((s) => s.stats.total);
  const videoCount = useStore((s) => s.videos.length);
  const duplicateCount = useStore((s) => s.sidebarAggregates.duplicateCount);
  const duplicateGroupCount = useStore((s) => s.duplicateGroups.length);
  const duplicateGroupsMode = useStore((s) => s.duplicateGroupsMode);
  const setDuplicateGroupsMode = useStore((s) => s.setDuplicateGroupsMode);
  const duplicateViewMode = useStore((s) => s.duplicateViewMode);
  const setDuplicateViewMode = useStore((s) => s.setDuplicateViewMode);
  const duplicatePathFilter = useStore((s) => s.duplicatePathFilter);
  const setDuplicatePathFilter = useStore((s) => s.setDuplicatePathFilter);
  const duplicateMinSimilarity = useStore((s) => s.duplicateMinSimilarity);
  const setDuplicateMinSimilarity = useStore((s) => s.setDuplicateMinSimilarity);
  const duplicateSortBy = useStore((s) => s.duplicateSortBy);
  const setDuplicateSortBy = useStore((s) => s.setDuplicateSortBy);
  const duplicateSortOrder = useStore((s) => s.duplicateSortOrder);
  const setDuplicateSortOrder = useStore((s) => s.setDuplicateSortOrder);
  const clearDuplicateListFilters = useStore((s) => s.clearDuplicateListFilters);
  const isFindingDuplicates = useStore((s) => s.isFindingDuplicates);
  const isGenerating = useStore((s) => s.isGenerating);
  const generationPhase = useStore((s) => s.genProgress.phase);

  if (statsTotal <= 0) return null;

  const metadataRunning = isGenerating && generationPhase === 'metadata';
  const duplicateDisabled = isFindingDuplicates || metadataRunning || videoCount < 2;
  const duplicateDisabledTitle = metadataRunning
    ? 'Available after metadata has finished updating'
    : videoCount < 2
      ? 'Duplicate detection needs at least two videos'
      : 'Find mostly identical whole-video duplicates';
  const duplicateListFiltersActive =
    duplicatePathFilter.trim() !== '' ||
    duplicateMinSimilarity > 0 ||
    duplicateSortBy !== 'similarity' ||
    duplicateSortOrder !== 'desc';

  if (!duplicateSettings.enabled && duplicateGroupsMode) {
    return (
      <section className="sidebar-section sidebar-duplicate-mode-section">
        <h3 className="sidebar-section-title">
          <CopyCheck size={14} /> Duplicates
        </h3>
        <p className="help-text">Duplicate detection is disabled.</p>
        <button className="btn btn-outline sidebar-wide-action" onClick={() => setDuplicateGroupsMode(false)}>
          Back to Grid
        </button>
        <button className="btn btn-outline sidebar-wide-action" onClick={onOpenDuplicateSettings}>
          <Settings size={14} />
          Duplicate Settings
        </button>
      </section>
    );
  }

  if (!duplicateSettings.enabled) {
    return (
      <section className="sidebar-section">
        <button className="btn btn-outline sidebar-wide-action" onClick={onOpenDuplicateSettings}>
          Enable duplicate detection
        </button>
      </section>
    );
  }

  if (duplicateGroupsMode) {
    return (
      <section className="sidebar-section sidebar-duplicate-mode-section">
        <h3 className="sidebar-section-title">
          <CopyCheck size={14} /> Duplicates
        </h3>

        <div className="duplicate-mode-summary">
          <strong>{duplicateGroupCount}</strong>
          <span>{duplicateGroupCount === 1 ? 'group' : 'groups'} / {duplicateCount} videos</span>
        </div>

        <div className="duplicate-sidebar-view-toggle" role="tablist" aria-label="Duplicate view mode">
          <button
            type="button"
            className={duplicateViewMode === 'rows' ? 'active' : ''}
            onClick={() => setDuplicateViewMode('rows')}
            aria-pressed={duplicateViewMode === 'rows'}
          >
            <List size={14} />
            Rows
          </button>
          <button
            type="button"
            className={duplicateViewMode === 'gallery' ? 'active' : ''}
            onClick={() => setDuplicateViewMode('gallery')}
            aria-pressed={duplicateViewMode === 'gallery'}
          >
            <Grid3X3 size={14} />
            Gallery
          </button>
        </div>

        <div className="duplicate-sidebar-controls">
          <div className="duplicate-sidebar-heading-row">
            <span className="sort-label">Filter / sort</span>
            {duplicateListFiltersActive && (
              <button
                type="button"
                className="filter-reset-btn"
                onClick={clearDuplicateListFilters}
                title="Reset duplicate filters"
                aria-label="Reset duplicate filters"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <label className="duplicate-sidebar-field">
            <span>Path contains</span>
            <input
              type="text"
              value={duplicatePathFilter}
              onChange={(e) => setDuplicatePathFilter(e.target.value)}
              placeholder="folder or filename"
            />
          </label>

          <label className="duplicate-sidebar-field">
            <span>Minimum similarity</span>
            <div className="duplicate-sidebar-inline">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={duplicateMinSimilarity}
                onChange={(e) => setDuplicateMinSimilarity(Number(e.target.value))}
              />
              <strong>{duplicateMinSimilarity}%</strong>
            </div>
          </label>

          <label className="duplicate-sidebar-field">
            <span>Sort by</span>
            <div className="sort-row">
              <select
                className="sidebar-select"
                value={duplicateSortBy}
                onChange={(e) => {
                  beginDevInteraction('duplicates.sort');
                  setDuplicateSortBy(e.target.value as DuplicateSortField);
                }}
              >
                <option value="similarity">Similarity</option>
                <option value="groupSize">Group count</option>
                <option value="totalSize">Total size</option>
              </select>
              <button
                className="btn btn-icon"
                onClick={() => {
                  beginDevInteraction('duplicates.sort');
                  setDuplicateSortOrder(duplicateSortOrder === 'asc' ? 'desc' : 'asc');
                }}
                title={duplicateSortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                <ArrowUpDown size={14} style={{ transform: duplicateSortOrder === 'desc' ? 'scaleY(-1)' : 'none' }} />
              </button>
            </div>
          </label>
        </div>

        <button
          className="btn btn-primary sidebar-wide-action"
          onClick={onFindDuplicates}
          disabled={duplicateDisabled}
          title={metadataRunning ? duplicateDisabledTitle : 'Run duplicate detection again'}
        >
          <RefreshCw size={14} />
          {isFindingDuplicates ? 'Finding duplicates...' : metadataRunning ? 'Waiting for metadata...' : 'Run Again'}
        </button>

        <button className="btn btn-outline sidebar-wide-action" onClick={() => setDuplicateGroupsMode(false)}>
          Back to Grid
        </button>

        <button className="btn btn-outline sidebar-wide-action" onClick={onOpenDuplicateSettings}>
          <Settings size={14} />
          Duplicate Settings
        </button>

        <DuplicateProgressInfo />
      </section>
    );
  }

  return (
    <section className="sidebar-section">
      <button
        className="btn btn-primary sidebar-wide-action"
        onClick={onFindDuplicates}
        disabled={duplicateDisabled}
        title={duplicateDisabledTitle}
      >
        <CopyCheck size={14} />
        {isFindingDuplicates ? 'Finding duplicates...' : metadataRunning ? 'Waiting for metadata...' : 'Find Duplicates'}
      </button>
      <DuplicateProgressInfo />
      {duplicateGroupCount > 0 && (
        <button
          className={`btn btn-outline sidebar-wide-action ${duplicateGroupsMode ? 'btn-toggle-active' : ''}`}
          onClick={() => setDuplicateGroupsMode(!duplicateGroupsMode)}
        >
          {duplicateGroupsMode ? 'Back to Grid' : `Duplicate Groups (${duplicateGroupCount})`}
        </button>
      )}
    </section>
  );
}

function SidebarFiltersSection({
  showFilters,
  onToggleFilters,
}: {
  showFilters: boolean;
  onToggleFilters: () => void;
}) {
  const statusFilter = useStore((s) => s.statusFilter);
  const setStatusFilter = useStore((s) => s.setStatusFilter);
  const folderFilterPath = useStore((s) => s.folderFilterPath);
  const setFolderFilterPath = useStore((s) => s.setFolderFilterPath);
  const minSizeFilter = useStore((s) => s.minSizeFilter);
  const maxSizeFilter = useStore((s) => s.maxSizeFilter);
  const setSizeFilterRange = useStore((s) => s.setSizeFilterRange);
  const minDurationFilter = useStore((s) => s.minDurationFilter);
  const maxDurationFilter = useStore((s) => s.maxDurationFilter);
  const setDurationFilterRange = useStore((s) => s.setDurationFilterRange);
  const minRatingFilter = useStore((s) => s.minRatingFilter);
  const setMinRatingFilter = useStore((s) => s.setMinRatingFilter);
  const favoritesFilter = useStore((s) => s.favoritesFilter);
  const setFavoritesFilter = useStore((s) => s.setFavoritesFilter);
  const incompatibleFilter = useStore((s) => s.incompatibleFilter);
  const setIncompatibleFilter = useStore((s) => s.setIncompatibleFilter);
  const duplicateFilter = useStore((s) => s.duplicateFilter);
  const setDuplicateFilter = useStore((s) => s.setDuplicateFilter);
  const features = useStore((s) => s.settings.features);
  const filteredVideoCount = useStore((s) => s.filteredVideos.length);
  const videoCount = useStore((s) => s.videos.length);
  const sidebarAggregates = useStore((s) => s.sidebarAggregates);

  const formatDurationInput = (seconds: number): string => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    if (safeSeconds >= 60 * 60) {
      const hours = Math.floor(safeSeconds / (60 * 60));
      const mins = Math.floor((safeSeconds % (60 * 60)) / 60);
      return `${hours}h ${mins}m`;
    }
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const sizeRangeMax = roundUpSizeBytes(sidebarAggregates.maxSizeBytes);
  const sizeRange = {
    min: 0,
    max: sizeRangeMax,
    step: sizeRangeMax > 0 ? Math.max(1, Math.floor(sizeRangeMax / 120)) : 1,
  };
  const durationRangeMax = roundUpDurationSeconds(Math.ceil(sidebarAggregates.maxDurationSeconds));
  const durationRange = {
    min: 0,
    max: durationRangeMax,
    step: durationRangeMax >= 60 * 60 ? 60 : durationRangeMax >= 10 * 60 ? 15 : 1,
  };

  const effectiveMinSize = sizeRange.max > sizeRange.min
    ? clamp(minSizeFilter > 0 ? minSizeFilter : sizeRange.min, sizeRange.min, sizeRange.max)
    : sizeRange.min;
  const effectiveMaxSize = sizeRange.max > sizeRange.min
    ? clamp(maxSizeFilter ?? sizeRange.max, effectiveMinSize, sizeRange.max)
    : sizeRange.max;
  const effectiveMinDuration = durationRange.max > durationRange.min
    ? clamp(minDurationFilter > 0 ? minDurationFilter : durationRange.min, durationRange.min, durationRange.max)
    : durationRange.min;
  const effectiveMaxDuration = durationRange.max > durationRange.min
    ? clamp(maxDurationFilter ?? durationRange.max, effectiveMinDuration, durationRange.max)
    : durationRange.max;
  const hasSizeRange = sizeRange.max > sizeRange.min;
  const hasDurationRange = durationRange.max > durationRange.min;
  const hasSizeFilter = minSizeFilter > 0 || maxSizeFilter !== null;
  const hasDurationFilter = minDurationFilter > 0 || maxDurationFilter !== null;
  const hasRatingFilter = minRatingFilter > 0;
  const duplicateCount = sidebarAggregates.duplicateCount;
  const incompatibleCount = sidebarAggregates.incompatibleCount;
  const hasIncompatibleVideos = incompatibleCount > 0;
  const hasExtraFilter = favoritesFilter || incompatibleFilter || duplicateFilter;
  const hasAnyFilter = statusFilter !== 'all' || Boolean(folderFilterPath) || hasExtraFilter || hasRatingFilter || hasSizeFilter || hasDurationFilter;
  const filteredSummary = `${filteredVideoCount} / ${videoCount}`;
  const sizeRangeStyle = getRangeTrackStyle(sizeRange.min, sizeRange.max, effectiveMinSize, effectiveMaxSize);
  const durationRangeStyle = getRangeTrackStyle(durationRange.min, durationRange.max, effectiveMinDuration, effectiveMaxDuration);

  const updateSizeRange = (nextMin: number, nextMax: number) => {
    const safeMin = clamp(Math.min(nextMin, nextMax), sizeRange.min, sizeRange.max);
    const safeMax = clamp(Math.max(nextMin, nextMax), safeMin, sizeRange.max);
    setSizeFilterRange(safeMin <= sizeRange.min ? 0 : safeMin, safeMax >= sizeRange.max ? null : safeMax);
  };

  const updateDurationRange = (nextMin: number, nextMax: number) => {
    const safeMin = clamp(Math.min(nextMin, nextMax), durationRange.min, durationRange.max);
    const safeMax = clamp(Math.max(nextMin, nextMax), safeMin, durationRange.max);
    setDurationFilterRange(safeMin <= durationRange.min ? 0 : safeMin, safeMax >= durationRange.max ? null : safeMax);
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setFolderFilterPath(null);
    setFavoritesFilter(false);
    setIncompatibleFilter(false);
    setDuplicateFilter(false);
    setMinRatingFilter(0);
    setSizeFilterRange(0, null);
    setDurationFilterRange(0, null);
  };

  return (
    <section className="sidebar-section sidebar-collapsible-section">
      <div className="sidebar-section-toggle-row">
        <button className="sidebar-section-toggle" onClick={onToggleFilters} aria-expanded={showFilters}>
          <span className="sidebar-section-title">
            <Filter size={14} /> Filters
          </span>
          <span className="filter-header-meta">
            <span className={hasAnyFilter ? 'filter-count filter-count-active' : 'filter-count'}>{filteredSummary}</span>
          </span>
        </button>
        {hasAnyFilter && (
          <button
            type="button"
            className="filter-clear-all-btn"
            onClick={clearFilters}
            title="Clear all filters"
            aria-label="Clear all filters"
          >
            <X size={13} />
          </button>
        )}
        <button
          type="button"
          className="filter-chevron-btn"
          onClick={onToggleFilters}
          title={showFilters ? 'Collapse filters' : 'Expand filters'}
          aria-label={showFilters ? 'Collapse filters' : 'Expand filters'}
          aria-expanded={showFilters}
        >
          <ChevronDown size={14} className={showFilters ? 'chevron-open' : ''} />
        </button>
      </div>

      {showFilters && (
        <div className="sidebar-section-content">
          {(features.favorites || (features.compatibilityCheck && hasIncompatibleVideos)) && (
            <div className="filter-pills filter-pills-extra">
              {features.favorites && (
                <button
                  className={`pill ${favoritesFilter ? 'pill-active' : ''}`}
                  onClick={() => setFavoritesFilter(!favoritesFilter)}
                  title={favoritesFilter ? 'Clear favorites filter' : 'Show only favorite videos'}
                >
                  <Heart size={12} /> Favorites
                  {favoritesFilter && <X size={11} className="pill-clear-icon" />}
                </button>
              )}
              {features.compatibilityCheck && hasIncompatibleVideos && (
                <button
                  className={`pill pill-delete ${incompatibleFilter ? 'pill-active' : ''}`}
                  onClick={() => setIncompatibleFilter(!incompatibleFilter)}
                  title={incompatibleFilter ? 'Clear incompatible filter' : 'Show only videos that need the external player'}
                >
                  <AlertTriangle size={12} />
                  <span className="pill-text">Incompatible</span>
                  {incompatibleFilter ? <X size={11} className="pill-clear-icon" /> : <span className="pill-count">{incompatibleCount}</span>}
                </button>
              )}
              {duplicateCount > 0 && (
                <button
                  className={`pill ${duplicateFilter ? 'pill-active' : ''}`}
                  onClick={() => setDuplicateFilter(!duplicateFilter)}
                  title={duplicateFilter ? 'Clear duplicates filter' : 'Show only duplicate videos'}
                >
                  <CopyCheck size={12} />
                  <span className="pill-text">Duplicates</span>
                  {duplicateFilter ? <X size={11} className="pill-clear-icon" /> : <span className="pill-count">{duplicateCount}</span>}
                </button>
              )}
            </div>
          )}

          {features.ratings && (
            <div className="filter-field">
              <span className="filter-input-label">
                <Star size={11} /> Rating
              </span>
              <div className={`filter-star-row ${minRatingFilter > 0 ? 'has-rating' : ''}`} aria-label="Minimum rating filter">
                {([1, 2, 3, 4, 5] as const).map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    className={`filter-star-btn ${minRatingFilter >= rating ? 'active' : ''}`}
                    onClick={() => setMinRatingFilter(minRatingFilter === rating ? 0 : rating)}
                    title={rating === 1 ? 'Show 1+ star videos' : `Show ${rating}+ star videos`}
                    aria-label={rating === 1 ? 'Show 1 or more star videos' : `Show ${rating} or more star videos`}
                    aria-pressed={minRatingFilter >= rating}
                  >
                    <Star size={15} fill={minRatingFilter >= rating ? 'currentColor' : 'none'} />
                  </button>
                ))}
                {minRatingFilter > 0 && (
                  <button
                    type="button"
                    className="filter-star-clear"
                    onClick={() => setMinRatingFilter(0)}
                    title="Clear rating filter"
                    aria-label="Clear rating filter"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="filter-field">
            <div className="filter-field-heading">
              <span className="filter-input-label">File size</span>
              {hasSizeFilter && (
                <button
                  type="button"
                  className="filter-reset-btn"
                  onClick={() => setSizeFilterRange(0, null)}
                  title="Reset file size filter"
                  aria-label="Reset file size filter"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="range-filter">
              <div className="range-values">
                <span>{formatSliderSize(effectiveMinSize)}</span>
                <span>{formatSliderSize(effectiveMaxSize)}</span>
              </div>
              <div className="range-slider" style={sizeRangeStyle}>
                <input
                  className="range-input"
                  type="range"
                  min={sizeRange.min}
                  max={sizeRange.max}
                  step={sizeRange.step}
                  value={effectiveMinSize}
                  disabled={!hasSizeRange}
                  onChange={(e) => updateSizeRange(Number(e.target.value), effectiveMaxSize)}
                  aria-label="Minimum file size"
                />
                <input
                  className="range-input"
                  type="range"
                  min={sizeRange.min}
                  max={sizeRange.max}
                  step={sizeRange.step}
                  value={effectiveMaxSize}
                  disabled={!hasSizeRange}
                  onChange={(e) => updateSizeRange(effectiveMinSize, Number(e.target.value))}
                  aria-label="Maximum file size"
                />
              </div>
            </div>
          </div>

          <div className="filter-field">
            <div className="filter-field-heading">
              <span className="filter-input-label">Duration</span>
              {hasDurationFilter && (
                <button
                  type="button"
                  className="filter-reset-btn"
                  onClick={() => setDurationFilterRange(0, null)}
                  title="Reset duration filter"
                  aria-label="Reset duration filter"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="range-filter">
              <div className="range-values">
                <span>{formatDurationInput(effectiveMinDuration)}</span>
                <span>{formatDurationInput(effectiveMaxDuration)}</span>
              </div>
              <div className="range-slider" style={durationRangeStyle}>
                <input
                  className="range-input"
                  type="range"
                  min={durationRange.min}
                  max={durationRange.max}
                  step={durationRange.step}
                  value={effectiveMinDuration}
                  disabled={!hasDurationRange}
                  onChange={(e) => updateDurationRange(Number(e.target.value), effectiveMaxDuration)}
                  aria-label="Minimum duration"
                />
                <input
                  className="range-input"
                  type="range"
                  min={durationRange.min}
                  max={durationRange.max}
                  step={durationRange.step}
                  value={effectiveMaxDuration}
                  disabled={!hasDurationRange}
                  onChange={(e) => updateDurationRange(effectiveMinDuration, Number(e.target.value))}
                  aria-label="Maximum duration"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Sidebar({
  onRescan,
  onDirectoryPicked,
  onNotify,
  onOpenSettings,
  onCloseSession,
  onFindDuplicates,
  onOpenDuplicateSettings,
  onOpenDocumentation,
  globalMute,
  globalMuteEnabled,
  globalMuteLabel,
  onToggleGlobalMute,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const directory = useStore((s) => s.directory);
  const themeKeybind = useStore((s) => s.settings.keyToggleTheme);
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
  const features = useStore((s) => s.settings.features);
  const stats = useStore((s) => s.stats);
  const videoCount = useStore((s) => s.videos.length);
  const filteredVideoCount = useStore((s) => s.filteredVideos.length);
  const isScanning = useStore((s) => s.isScanning);
  const setReviewMode = useStore((s) => s.setReviewMode);
  const setReviewIndex = useStore((s) => s.setReviewIndex);
  const duplicateGroupsMode = useStore((s) => s.duplicateGroupsMode);
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
  const addDirectory = useStore((s) => s.addDirectory);

  const [isDeleting, setIsDeleting] = useState(false);
  const [showRecents, setShowRecents] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showSort, setShowSort] = useState(true);
  const [showView, setShowView] = useState(true);
  const [recentContextMenu, setRecentContextMenu] = useState<{ x: number; y: number; dir: string } | null>(null);
  const [unavailableRecents, setUnavailableRecents] = useState<Set<string>>(() => new Set());

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
      setUnavailableRecents((prev) => new Set(prev).add(dir));
      onNotify({
        title: 'Folder unavailable',
        detail: formatRecentPath(dir),
        kind: 'warning',
        dedupeKey: `recent-unavailable:${dir}`,
      });
      return;
    }
    setUnavailableRecents((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Set(prev);
      next.delete(dir);
      return next;
    });
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

  const handleAddRecentToSession = async (dir: string) => {
    if (!window.electronAPI) {
      addDirectory(dir);
      return;
    }
    const result = await window.electronAPI.validateDroppedPath(dir);
    if (!result.valid || !result.isDirectory) {
      setUnavailableRecents((prev) => new Set(prev).add(dir));
      onNotify({
        title: 'Folder unavailable',
        detail: formatRecentPath(dir),
        kind: 'warning',
        dedupeKey: `recent-unavailable:${dir}`,
      });
      return;
    }
    setUnavailableRecents((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Set(prev);
      next.delete(dir);
      return next;
    });
    const beforeDirs = useStore.getState().directories;
    addDirectory(dir);
    const afterDirs = useStore.getState().directories;
    const changed = !sameStrings(beforeDirs, afterDirs);
    onNotify(changed
      ? {
        title: 'Folder added',
        detail: formatRecentPath(dir),
        kind: 'success',
        dedupeKey: `recent-added:${dir}`,
      }
      : {
        title: 'Folder already covered',
        detail: formatRecentPath(dir),
        kind: 'info',
        dedupeKey: `recent-covered:${dir}`,
      });
  };

  const handleCopyRecentPath = async (dir: string) => {
    try {
      await copyTextToClipboard(dir);
      onNotify({
        title: 'Path copied',
        detail: buildCopyPathSuccessDetail(dir),
        kind: 'success',
      });
    } catch (error) {
      console.error('Failed to copy path:', error);
      onNotify({
        title: 'Copy failed',
        detail: 'The path could not be copied to the clipboard.',
        kind: 'error',
      });
    }
  };

  const recentContextMenuItems = useMemo(() => {
    if (!recentContextMenu) return [];
    return buildRecentFolderMenu({
      directory: recentContextMenu.dir,
      loadedDirectories: directories,
      onOpen: () => {
        void handleOpenRecent(recentContextMenu.dir);
      },
      onAddToSession: () => {
        void handleAddRecentToSession(recentContextMenu.dir);
      },
      onReveal: () => {
        void window.electronAPI?.openInExplorer(recentContextMenu.dir);
      },
      onCopyPath: () => {
        void handleCopyRecentPath(recentContextMenu.dir);
      },
    });
  }, [directories, recentContextMenu]);


  const handleBatchDelete = async () => {
    if (!window.electronAPI) return;
    const { videos: currentVideos, isScanning: scanningNow } = useStore.getState();
    if (scanningNow) return;
    const toDelete = currentVideos.filter((v) => v.status === 'delete');
    if (toDelete.length === 0) return;

    const confirmed = window.confirm(formatDeleteConfirmation({
      count: toDelete.length,
      sizeBytes: stats.deleteSize,
      removeEmptyFoldersAfterDelete: useStore.getState().settings.removeEmptyFoldersAfterDelete,
    }));
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
        ? ` ${removedFolderCount} empty ${removedFolderCount === 1 ? 'folder was' : 'folders were'} cleaned up.`
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

  const statusStatItems: { key: StatusFilter; label: string; value: number; className: string }[] = [
    { key: 'all', label: 'All', value: stats.total, className: 'stat-total' },
    { key: 'pending', label: 'Pending', value: stats.pending, className: 'stat-pending' },
    { key: 'keep', label: 'Keep', value: stats.keep, className: 'stat-keep' },
    { key: 'skipped', label: 'Skipped', value: stats.skipped, className: 'stat-skipped' },
    { key: 'delete', label: 'Delete', value: stats.delete, className: 'stat-delete' },
  ];
  const reviewLabel = filteredVideoCount === videoCount
    ? `Review ${filteredVideoCount} ${filteredVideoCount === 1 ? 'video' : 'videos'}`
    : `Review ${filteredVideoCount} filtered`;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-logo">
          <FileVideo size={22} />
          Video Cull
        </h1>
        <div className="sidebar-header-actions">
          <button
            className="sidebar-icon-btn"
            onClick={onToggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode (${formatKeybind(themeKeybind ?? DEFAULT_KEYBINDS.keyToggleTheme)})`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="sidebar-icon-btn"
            onClick={onOpenDocumentation}
            title="Open documentation"
            aria-label="Open documentation"
          >
            <CircleHelp size={16} />
          </button>
          {globalMuteEnabled && (
            <button
              className={`sidebar-icon-btn ${globalMute ? 'active' : ''}`}
              onClick={onToggleGlobalMute}
              title={`${globalMute ? 'Unmute' : 'Mute'} in-app playback (${globalMuteLabel})`}
              aria-label={globalMute ? 'Unmute in-app playback' : 'Mute in-app playback'}
            >
              {globalMute ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          )}
        </div>
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
                    title={`${d} \u2022 ${unavailableRecents.has(d) ? 'unavailable' : `opened ${formatRelativeTime(recentDirectoryTimestamps[d])}`}`}
                    onClick={() => void handleOpenRecent(d)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setRecentContextMenu({ x: event.clientX, y: event.clientY, dir: d });
                    }}
                  >
                    <FolderOpen size={12} />
                    <span className="recents-item-copy">
                      <span className="recents-item-path">{formatRecentPath(d)}</span>
                      <span className="recents-item-meta">
                        {unavailableRecents.has(d) ? 'Unavailable' : formatRelativeTime(recentDirectoryTimestamps[d])}
                      </span>
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

      <SidebarProgressSection />

      <SidebarDuplicateSection
        onFindDuplicates={onFindDuplicates}
        onOpenDuplicateSettings={onOpenDuplicateSettings}
      />
      {recentContextMenu && (
        <ContextMenu
          x={recentContextMenu.x}
          y={recentContextMenu.y}
          items={recentContextMenuItems}
          onClose={() => setRecentContextMenu(null)}
        />
      )}

      {stats.total > 0 && !duplicateGroupsMode && (
        <section className="sidebar-section sidebar-library-section">
          <h3 className="sidebar-section-title">Status</h3>
          <div className="stat-grid status-filter-grid">
            {statusStatItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`stat-item ${item.className} ${statusFilter === item.key ? 'stat-active' : ''}`}
                onClick={() => setStatusFilter(item.key)}
                aria-pressed={statusFilter === item.key}
                title={`Show ${item.label.toLowerCase()} videos`}
              >
                <span className="stat-value">{item.value}</span>
                <span className="stat-label">{item.label}</span>
              </button>
            ))}
          </div>
          {stats.deleteSize > 0 && (
            <p className="delete-size-note">
              <Trash2 size={13} />
              {formatSize(stats.deleteSize)} to free up
            </p>
          )}
        </section>
      )}

      {stats.total > 0 && !duplicateGroupsMode && (
        <SidebarFiltersSection
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters((v) => !v)}
        />
      )}

      {stats.total > 0 && !duplicateGroupsMode && (
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

      {stats.total > 0 && !duplicateGroupsMode && (
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
                <div
                  className="range-slider view-range-shell"
                  style={getRangeTrackStyle(0.6, 2, 0.6, cardScale)}
                >
                  <input
                    type="range"
                    className="range-input"
                    min={0.6}
                    max={2}
                    step={0.1}
                    value={cardScale}
                    onChange={(e) => setCardScale(Number(e.target.value))}
                  />
                </div>
                <span className="slider-value">{Math.round(cardScale * 100)}%</span>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="sidebar-footer">
        {stats.total > 0 && stats.delete > 0 && (
          <button
            className="btn btn-danger sidebar-delete-btn"
            onClick={handleBatchDelete}
            disabled={isDeleting || isScanning}
          >
            <Trash2 size={16} />
            {isScanning
              ? 'Scanning...'
              : isDeleting
              ? 'Deleting...'
              : `Delete ${stats.delete} videos (${formatSize(stats.deleteSize)})`}
          </button>
        )}

        <div className="sidebar-footer-row">
          <button className="settings-icon-btn" onClick={onOpenSettings} title="Preferences (Ctrl+,)" aria-label="Preferences">
            <Settings size={18} />
          </button>

          {filteredVideoCount > 0 && !duplicateGroupsMode && (
            <button
              className="btn btn-accent sidebar-review-btn"
              onClick={handleStartReview}
            >
              <Play size={16} />
              {reviewLabel}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
