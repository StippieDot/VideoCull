import { useRef, useState, useEffect, useCallback, useMemo, useLayoutEffect, type AriaAttributes, type CSSProperties, type MouseEvent as ReactMouseEvent, type UIEvent as ReactUIEvent } from 'react';
import { List } from 'react-window';
import type { ListImperativeAPI } from 'react-window';
import type { Video } from '../types';
import useStore from '../store';
import VideoCard from './VideoCard';
import { formatSize, isWebSupported } from '../utils';
import { Check, ChevronDown, RefreshCw, SkipForward, RotateCcw, Trash2, X, Play } from 'lucide-react';
import './GridMode.css';

const BASE_CARD_WIDTH = 450;
const BASE_CARD_HEIGHT = 360;
const GAP = 12;
const HEADER_HEIGHT = 44;

let persistedGridScroll = { directory: null as string | null, offset: 0 };

interface HeaderRow {
  type: 'header';
  label: string;
  folderPath: string;
  count: number;
  totalSize: number;
}

interface CardsRow {
  type: 'cards';
  videos: Video[];
}

type RowItem = HeaderRow | CardsRow;

interface GridModeProps {
  onReviewFolder: (folderPath: string) => void;
  onRegenerateThumbnails: (videos: Video[]) => Promise<void>;
}

interface GridRowData {
  rows: RowItem[];
  columnWidth: number;
  cardHeight: number;
  selectedIds: Set<string>;
  isSelectionMode: boolean;
  handleCardClick: (video: Video, event: ReactMouseEvent) => void;
  handleCardPlay: (video: Video, event: ReactMouseEvent) => void;
  onReviewFolder: (folderPath: string) => void;
  persistCurrentScroll: () => void;
  toggleSelection: (video: Video, event: ReactMouseEvent) => void;
}

/** Extract display-friendly folder name relative to root directory */
function getFolderLabel(video: Video, rootDirs: string[]): string {
  const sep = video.path.includes('/') ? '/' : '\\';
  const dir = video.path.substring(0, video.path.lastIndexOf(sep));

  if (rootDirs.length === 0) return dir;

  const rootDir = rootDirs.find((root) => dir === root || dir.startsWith(root + sep));
  if (!rootDir) return dir;

  // Show relative path from root, or "Root" for top-level
  if (dir === rootDir) {
    const rootName = rootDir.split(/[/\\]/).filter(Boolean).slice(-1)[0] || rootDir;
    return rootDirs.length > 1 ? `${rootName} / Root` : 'Root';
  }
  const relative = dir.startsWith(rootDir + sep)
    ? dir.substring(rootDir.length + 1)
    : dir;
  if (rootDirs.length <= 1) return relative || 'Root';
  const rootName = rootDir.split(/[/\\]/).filter(Boolean).slice(-1)[0] || rootDir;
  return relative ? `${rootName} / ${relative}` : `${rootName} / Root`;
}

function getFolderPath(video: Video): string {
  const sep = video.path.includes('/') ? '/' : '\\';
  return video.path.substring(0, video.path.lastIndexOf(sep));
}

function Row({ index, style, ariaAttributes, ...data }: { index: number; style: CSSProperties; ariaAttributes: AriaAttributes & { role: 'listitem' } } & GridRowData) {
  const {
    rows,
    columnWidth,
    cardHeight,
    selectedIds,
    isSelectionMode,
    handleCardClick,
    handleCardPlay,
    onReviewFolder,
    persistCurrentScroll,
    toggleSelection,
  } = data;
  const item = rows[index];

  if (item.type === 'header') {
    return (
      <div style={style} className="grid-group-header" {...ariaAttributes}>
        <span className="grid-group-label">{item.label}</span>
        <span className="grid-group-meta">
          <span className="grid-group-count">{item.count}</span>
          <span className="grid-group-size">{formatSize(item.totalSize)}</span>
          <button
            className="grid-group-review-btn"
            onClick={() => {
              persistCurrentScroll();
              onReviewFolder(item.folderPath);
            }}
            title={`Review ${item.label}`}
          >
            <Play size={11} />
            Review
          </button>
        </span>
      </div>
    );
  }

  return (
    <div style={style} className="grid-card-row" {...ariaAttributes}>
      {item.videos.map((video, colIdx) => (
        <div
          key={video.id}
          className="grid-card-cell"
          style={{
            width: columnWidth,
            height: cardHeight,
            marginLeft: colIdx === 0 ? GAP : GAP / 2,
            marginRight: colIdx === item.videos.length - 1 ? GAP : GAP / 2,
            paddingTop: GAP / 2,
          }}
        >
          <VideoCard
            video={video}
            isSelected={selectedIds.has(video.id)}
            showSelectionControls={isSelectionMode}
            onClick={handleCardClick}
            onPlay={handleCardPlay}
            onToggleSelect={toggleSelection}
          />
        </div>
      ))}
    </div>
  );
}

export default function GridMode({ onReviewFolder, onRegenerateThumbnails }: GridModeProps) {
  const filteredVideos = useStore((s) => s.filteredVideos);
  const videos = useStore((s) => s.videos);
  const setReviewMode = useStore((s) => s.setReviewMode);
  const setReviewIndex = useStore((s) => s.setReviewIndex);
  const setVideoStatusesBatch = useStore((s) => s.setVideoStatusesBatch);
  const pushToast = useStore((s) => s.pushToast);
  const selectedIds = useStore((s) => s.gridSelectionIds);
  const selectionAnchorId = useStore((s) => s.gridSelectionAnchorId);
  const setGridSelectionIds = useStore((s) => s.setGridSelectionIds);
  const setGridSelectionAnchorId = useStore((s) => s.setGridSelectionAnchorId);
  const clearGridSelection = useStore((s) => s.clearGridSelection);
  const cardScale = useStore((s) => s.cardScale);
  const groupByFolder = useStore((s) => s.groupByFolder);
  const directory = useStore((s) => s.directory);
  const directories = useStore((s) => s.directories);
  const compatibilityCheckEnabled = useStore((s) => s.settings.features.compatibilityCheck);
  const isScanning = useStore((s) => s.isScanning);
  const isGenerating = useStore((s) => s.isGenerating);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const restoredScrollRef = useRef(false);
  const visibleRowsRef = useRef({ startIndex: 0, stopIndex: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const isSelectionMode = selectedIds.size > 0;

  const initialScrollOffset = useMemo(() => {
    if (persistedGridScroll.directory !== directory) return 0;
    return persistedGridScroll.offset;
  }, [directory]);

  useEffect(() => {
    if (persistedGridScroll.directory !== directory) {
      persistedGridScroll = { directory, offset: 0 };
    }
    restoredScrollRef.current = false;
  }, [directory]);

  const cardWidth = Math.round(BASE_CARD_WIDTH * cardScale);
  const cardHeight = Math.round(BASE_CARD_HEIGHT * cardScale);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columnCount = Math.max(1, Math.floor((dimensions.width + GAP) / (cardWidth + GAP)));

  // Build flat row items: headers + card rows
  const folderSizeByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const video of videos) {
      const folderPath = getFolderPath(video);
      map.set(folderPath, (map.get(folderPath) ?? 0) + video.sizeBytes);
    }
    return map;
  }, [videos]);

  const { rows, rowStructureKey, headerIndexes } = useMemo(() => {
    if (!groupByFolder) {
      // No grouping — just chunk into rows of cards
      const result: RowItem[] = [];
      for (let i = 0; i < filteredVideos.length; i += columnCount) {
        const videosInRow = filteredVideos.slice(i, i + columnCount);
        result.push({ type: 'cards', videos: videosInRow });
      }
      const structureKey = result
        .map((row) => (row.type === 'cards' ? `c:${row.videos.length}` : 'h'))
        .join('|');
      return { rows: result, rowStructureKey: structureKey, headerIndexes: [] as number[] };
    }

    // Group by folder
    const groups: { label: string; videos: Video[] }[] = [];
    let currentLabel: string | null = null;
    let currentGroup: Video[] = [];

    for (const video of filteredVideos) {
      const label = getFolderLabel(video, directories);
      if (label !== currentLabel) {
        if (currentGroup.length > 0 && currentLabel !== null) {
          groups.push({ label: currentLabel, videos: currentGroup });
        }
        currentLabel = label;
        currentGroup = [video];
      } else {
        currentGroup.push(video);
      }
    }
    if (currentGroup.length > 0 && currentLabel !== null) {
      groups.push({ label: currentLabel, videos: currentGroup });
    }

    const result: RowItem[] = [];
    const nextHeaderIndexes: number[] = [];
    for (const group of groups) {
      // Only show headers if there are multiple groups
      if (groups.length > 1) {
        const folderPath = getFolderPath(group.videos[0]);
        nextHeaderIndexes.push(result.length);
        result.push({
          type: 'header',
          label: group.label,
          folderPath,
          count: group.videos.length,
          totalSize: folderSizeByPath.get(folderPath) ?? group.videos.reduce((sum, v) => sum + v.sizeBytes, 0),
        });
      }
      for (let i = 0; i < group.videos.length; i += columnCount) {
        const videosInRow = group.videos.slice(i, i + columnCount);
        result.push({ type: 'cards', videos: videosInRow });
      }
    }
    const structureKey = result
      .map((row) => (row.type === 'header' ? `h:${row.label}` : `c:${row.videos.length}`))
      .join('|');
    return { rows: result, rowStructureKey: structureKey, headerIndexes: nextHeaderIndexes };
  }, [filteredVideos, columnCount, groupByFolder, directories, folderSizeByPath]);

  useEffect(() => {
    if (selectedIds.size > 0) {
      const next = new Set(Array.from(selectedIds).filter((id) => filteredVideos.some((video) => video.id === id)));
      if (next.size !== selectedIds.size) setGridSelectionIds(next);
    }

    if (selectionAnchorId && !filteredVideos.some((video) => video.id === selectionAnchorId)) {
      setGridSelectionAnchorId(null);
    }
  }, [filteredVideos, selectedIds, selectionAnchorId, setGridSelectionIds, setGridSelectionAnchorId]);

  useEffect(() => {
    if (!isSelectionMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearGridSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectionMode, clearGridSelection]);

  const getRowTop = useCallback((rowIndex: number) => {
    let top = 0;
    for (let i = 0; i < rowIndex; i += 1) {
      top += rows[i]?.type === 'header' ? HEADER_HEIGHT : cardHeight + GAP;
    }
    return top;
  }, [cardHeight, rows]);

  const persistCurrentScroll = useCallback(() => {
    const element = listRef.current?.element;
    if (!element) return;
    persistedGridScroll = { directory, offset: element.scrollTop };
  }, [directory]);

  useLayoutEffect(() => {
    if (restoredScrollRef.current) return;
    const element = listRef.current?.element;
    if (!element) return;
    element.scrollTop = initialScrollOffset;
    restoredScrollRef.current = true;
  }, [dimensions.height, initialScrollOffset, rows.length]);

  const getItemSize = useCallback(
    (index: number, rowProps: GridRowData) => rowProps.rows[index].type === 'header' ? HEADER_HEIGHT : cardHeight + GAP,
    [cardHeight]
  );

  const getLastSelectedInList = useCallback((ids: Set<string>): string | null => {
    let lastSelectedId: string | null = null;
    for (const video of filteredVideos) {
      if (ids.has(video.id)) lastSelectedId = video.id;
    }
    return lastSelectedId;
  }, [filteredVideos]);

  const getRangeAnchorId = useCallback((ids: Set<string>, targetIndex: number): string | null => {
    const selectedIndexes: number[] = [];
    for (let i = 0; i < filteredVideos.length; i += 1) {
      const id = filteredVideos[i]?.id;
      if (id && ids.has(id)) selectedIndexes.push(i);
    }

    if (selectedIndexes.length === 0) return null;

    const hasBefore = selectedIndexes.some((idx) => idx < targetIndex);
    const hasAfter = selectedIndexes.some((idx) => idx > targetIndex);

    // In-between case: anchor from the nearest selected item before target.
    if (hasBefore && hasAfter) {
      for (let i = selectedIndexes.length - 1; i >= 0; i -= 1) {
        const idx = selectedIndexes[i];
        if (idx < targetIndex) {
          return filteredVideos[idx]?.id ?? null;
        }
      }
    }

    // Otherwise prefer nearest selected item at or before target.
    for (let i = targetIndex; i >= 0; i -= 1) {
      const id = filteredVideos[i]?.id;
      if (id && ids.has(id)) return id;
    }

    // Final fallback: first selected item in list.
    return filteredVideos[selectedIndexes[0]]?.id ?? null;
  }, [filteredVideos]);

  const applyRangeSelection = useCallback((targetId: string) => {
    const targetIndex = filteredVideos.findIndex((video) => video.id === targetId);
    if (targetIndex < 0) return;

    setGridSelectionIds((prev) => {
      const currentAnchorId = getRangeAnchorId(prev, targetIndex)
        ?? (selectionAnchorId && prev.has(selectionAnchorId) ? selectionAnchorId : getLastSelectedInList(prev));

      if (!currentAnchorId) {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      }

      const anchorIndex = filteredVideos.findIndex((video) => video.id === currentAnchorId);
      if (anchorIndex < 0) {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const next = new Set(prev);
      for (let i = start; i <= end; i += 1) {
        next.add(filteredVideos[i].id);
      }
      return next;
    });
    setGridSelectionAnchorId(targetId);
  }, [filteredVideos, getLastSelectedInList, getRangeAnchorId, selectionAnchorId, setGridSelectionIds, setGridSelectionAnchorId]);

  const toggleSelection = useCallback((video: Video, event: ReactMouseEvent) => {
    if (event.shiftKey) {
      applyRangeSelection(video.id);
      return;
    }

    let nextAnchorId: string | null = selectionAnchorId;
    setGridSelectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.id)) {
        next.delete(video.id);
        if (nextAnchorId === video.id) {
          nextAnchorId = getLastSelectedInList(next);
        }
      } else {
        next.add(video.id);
        nextAnchorId = video.id;
      }
      return next;
    });
    setGridSelectionAnchorId(nextAnchorId);
  }, [applyRangeSelection, getLastSelectedInList, selectionAnchorId, setGridSelectionIds, setGridSelectionAnchorId]);

  const handleCardClick = useCallback((video: Video, event: ReactMouseEvent) => {
    if (isSelectionMode || event.shiftKey) {
      toggleSelection(video, event);
      return;
    }

    const state = useStore.getState();
    const idx = state.filteredVideos.findIndex((v) => v.id === video.id);
    if (idx >= 0) {
      persistCurrentScroll();
      state.setReviewIndex(idx);
      state.setReviewMode(true);
    }
  }, [isSelectionMode, persistCurrentScroll, toggleSelection]);

  const handleCardPlay = useCallback((video: Video, event: ReactMouseEvent) => {
    persistCurrentScroll();
    const canPlayInReview = isWebSupported(video.path) && (!compatibilityCheckEnabled || video.compatible !== false);
    if (canPlayInReview && !event.ctrlKey) {
      useStore.getState().enterReviewAndPlay(video.id);
    } else if (window.electronAPI) {
      window.electronAPI.openVideo(video.path);
    }
  }, [compatibilityCheckEnabled, persistCurrentScroll]);

  const handleBatchStatus = useCallback((status: 'keep' | 'delete' | 'skipped' | 'pending') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setVideoStatusesBatch(ids, status);
    clearGridSelection();
    const statusLabel = status === 'skipped'
      ? 'Skipped'
      : status === 'pending'
        ? 'Pending'
        : status.charAt(0).toUpperCase() + status.slice(1);
    pushToast({
      title: status === 'pending' ? 'Selection reset' : 'Batch updated',
      detail: `${ids.length} ${ids.length === 1 ? 'video' : 'videos'} marked ${statusLabel}.`,
      kind: 'success',
      dedupeKey: `batch-status:${status}:${ids.join('|')}`,
    });
  }, [selectedIds, setVideoStatusesBatch, clearGridSelection, pushToast]);

  const handleBatchRegenerateThumbnails = useCallback(async () => {
    const ids = new Set(selectedIds);
    if (ids.size === 0 || isScanning || isGenerating) return;
    const selectedVideos = videos.filter((video) => ids.has(video.id));
    if (selectedVideos.length === 0) return;
    await onRegenerateThumbnails(selectedVideos);
    clearGridSelection();
  }, [clearGridSelection, isGenerating, isScanning, onRegenerateThumbnails, selectedIds, videos]);

  const handleClearSelection = useCallback(() => {
    clearGridSelection();
  }, [clearGridSelection]);

  const columnWidth = (dimensions.width - GAP * (columnCount + 1)) / columnCount;

  const handleScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    persistedGridScroll = { directory, offset: event.currentTarget.scrollTop };
  }, [directory]);

  const handleRowsRendered = useCallback((visibleRows: { startIndex: number; stopIndex: number }) => {
    visibleRowsRef.current = visibleRows;
  }, []);

  const handleNextFolder = useCallback(() => {
    if (headerIndexes.length === 0) return;
    const currentStart = visibleRowsRef.current.startIndex;
    const nextHeaderIndex = headerIndexes.find((index) => index > currentStart) ?? headerIndexes[0];
    listRef.current?.scrollToRow({ index: nextHeaderIndex, align: 'start', behavior: 'smooth' });
    persistedGridScroll = { directory, offset: getRowTop(nextHeaderIndex) };
  }, [directory, getRowTop, headerIndexes]);

  const itemData = useMemo<GridRowData>(() => ({
    rows,
    columnWidth,
    cardHeight,
    selectedIds,
    isSelectionMode,
    handleCardClick,
    handleCardPlay,
    onReviewFolder,
    persistCurrentScroll,
    toggleSelection,
  }), [rows, columnWidth, cardHeight, selectedIds, isSelectionMode, handleCardClick, handleCardPlay, onReviewFolder, persistCurrentScroll, toggleSelection]);

  return (
    <div className="grid-mode" ref={containerRef}>
      {filteredVideos.length === 0 ? (
        <div className="grid-empty">
          <p>No videos match your current filters.</p>
        </div>
      ) : (
        <List
          listRef={listRef}
          rowCount={rows.length}
          rowComponent={Row}
          rowHeight={getItemSize}
          rowProps={itemData}
          overscanCount={2}
          onRowsRendered={handleRowsRendered}
          onScroll={handleScroll}
          style={{ height: dimensions.height, width: dimensions.width }}
        />
      )}

      {headerIndexes.length > 1 && (
        <button className="grid-next-folder-btn" onClick={handleNextFolder} title="Go to next folder" aria-label="Go to next folder">
          <ChevronDown size={15} />
        </button>
      )}

      {selectedIds.size > 0 && (
        <div className="grid-batch-bar">
          <div className="grid-batch-count">{selectedIds.size} selected</div>
          <div className="grid-batch-actions">
            <button className="btn btn-ghost grid-batch-btn grid-batch-keep" onClick={() => handleBatchStatus('keep')}>
              <Check size={14} />
              Keep
            </button>
            <button className="btn btn-ghost grid-batch-btn grid-batch-delete" onClick={() => handleBatchStatus('delete')}>
              <Trash2 size={14} />
              Delete
            </button>
            <button className="btn btn-ghost grid-batch-btn grid-batch-skip" onClick={() => handleBatchStatus('skipped')}>
              <SkipForward size={14} />
              Skip
            </button>
            <button className="btn btn-ghost grid-batch-btn grid-batch-reset" onClick={() => handleBatchStatus('pending')}>
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              className="btn btn-ghost grid-batch-btn grid-batch-regenerate"
              onClick={handleBatchRegenerateThumbnails}
              disabled={isScanning || isGenerating}
              title="Regenerate thumbnails for selected videos"
            >
              <RefreshCw size={14} />
              Thumbs
            </button>
            <button className="btn btn-ghost grid-batch-btn grid-batch-clear" onClick={handleClearSelection}>
              <X size={14} />
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
