import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useLayoutEffect,
  type MouseEvent as ReactMouseEvent,
  type UIEvent as ReactUIEvent,
} from 'react';
import { List } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import type { Video } from '../types';
import useStore from '../store';
import VideoCard from './VideoCard';
import { formatSize, isWebSupported } from '../utils';
import { Check, ChevronDown, RefreshCw, SkipForward, RotateCcw, Trash2, X, Play } from 'lucide-react';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import {
  buildCopyPathSuccessDetail,
  buildFolderHeaderMenu,
  buildLibraryGridVideoMenu,
} from './contextMenuBuilders';
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
  videoIds: string[];
}

interface CardsRow {
  type: 'cards';
  videoIds: string[];
}

type RowItem = HeaderRow | CardsRow;

interface GridModeProps {
  onReviewFolder: (folderPath: string) => void;
  onRegenerateThumbnails: (videos: Video[]) => Promise<void>;
}

interface GridRowData {
  rows: RowItem[];
  videosById: Map<string, Video>;
  folderSizeByPath: Map<string, number>;
  filteredFolderSizeByPath: Map<string, number>;
  columnWidth: number;
  cardHeight: number;
  selectedIds: Set<string>;
  isSelectionMode: boolean;
  handleCardClick: (video: Video, event: ReactMouseEvent) => void;
  handleCardPlay: (video: Video, event: ReactMouseEvent) => void;
  handleCardContextMenu: (video: Video, event: ReactMouseEvent) => void;
  onReviewFolder: (folderPath: string) => void;
  onHeaderContextMenu: (item: HeaderRow, event: ReactMouseEvent) => void;
  persistCurrentScroll: () => void;
  toggleSelection: (video: Video, event: ReactMouseEvent) => void;
}

interface GridRowRenderSignals {
  cardHeight: number;
  columnWidth: number;
  rowContentVersion: number;
  selectionVersion: number;
}

interface GridRowsResult {
  rows: RowItem[];
  headerIndexes: number[];
  filteredVideoIds: string[];
}

interface CachedGridRows extends GridRowsResult {
  columnCount: number;
  directoriesKey: string;
  groupByFolder: boolean;
}

let gridRowRuntime: GridRowData | null = null;

function getFolderLabel(video: Video, rootDirs: string[]): string {
  const sep = video.path.includes('/') ? '/' : '\\';
  const dir = video.path.substring(0, video.path.lastIndexOf(sep));

  if (rootDirs.length === 0) return dir;

  const rootDir = rootDirs.find((root) => dir === root || dir.startsWith(root + sep));
  if (!rootDir) return dir;

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

function formatFolderSize(bytes: number): string {
  return formatSize(bytes).replace(/\.0\s/, ' ').replace(/\s/g, '');
}

function sameVideoIdOrder(videos: Video[], ids: string[]) {
  if (videos.length !== ids.length) return false;
  for (let i = 0; i < videos.length; i += 1) {
    if (videos[i]?.id !== ids[i]) return false;
  }
  return true;
}

function buildGridRows(
  filteredVideos: Video[],
  columnCount: number,
  groupByFolder: boolean,
  directories: string[]
): GridRowsResult {
  const filteredVideoIds = filteredVideos.map((video) => video.id);

  if (!groupByFolder) {
    const rows: RowItem[] = [];
    for (let i = 0; i < filteredVideoIds.length; i += columnCount) {
      rows.push({ type: 'cards', videoIds: filteredVideoIds.slice(i, i + columnCount) });
    }
    return { rows, headerIndexes: [], filteredVideoIds };
  }

  const groups: Array<{ label: string; folderPath: string; videoIds: string[] }> = [];
  let currentLabel: string | null = null;
  let currentFolderPath: string | null = null;
  let currentGroupIds: string[] = [];

  for (const video of filteredVideos) {
    const label = getFolderLabel(video, directories);
    const folderPath = getFolderPath(video);
    if (label !== currentLabel) {
      if (currentLabel !== null && currentFolderPath !== null && currentGroupIds.length > 0) {
        groups.push({ label: currentLabel, folderPath: currentFolderPath, videoIds: currentGroupIds });
      }
      currentLabel = label;
      currentFolderPath = folderPath;
      currentGroupIds = [];
    }
    currentGroupIds.push(video.id);
  }

  if (currentLabel !== null && currentFolderPath !== null && currentGroupIds.length > 0) {
    groups.push({ label: currentLabel, folderPath: currentFolderPath, videoIds: currentGroupIds });
  }

  const rows: RowItem[] = [];
  const headerIndexes: number[] = [];
  for (const group of groups) {
    if (groups.length > 1) {
      headerIndexes.push(rows.length);
      rows.push({
        type: 'header',
        label: group.label,
        folderPath: group.folderPath,
        count: group.videoIds.length,
        videoIds: group.videoIds,
      });
    }
    for (let i = 0; i < group.videoIds.length; i += columnCount) {
      rows.push({ type: 'cards', videoIds: group.videoIds.slice(i, i + columnCount) });
    }
  }

  return { rows, headerIndexes, filteredVideoIds };
}

function getLastSelectedIdInOrder(ids: Set<string>, indexById: Map<string, number>): string | null {
  let lastSelectedId: string | null = null;
  let lastSelectedIndex = -1;

  for (const id of ids) {
    const index = indexById.get(id);
    if (index === undefined || index < lastSelectedIndex) continue;
    lastSelectedIndex = index;
    lastSelectedId = id;
  }

  return lastSelectedId;
}

function getRangeAnchorIdForSelection(
  ids: Set<string>,
  targetIndex: number,
  indexById: Map<string, number>
): string | null {
  let firstSelectedId: string | null = null;
  let firstSelectedIndex = Number.POSITIVE_INFINITY;
  let nearestBeforeId: string | null = null;
  let nearestBeforeIndex = -1;
  let nearestAtOrBeforeId: string | null = null;
  let nearestAtOrBeforeIndex = -1;
  let hasAfter = false;

  for (const id of ids) {
    const index = indexById.get(id);
    if (index === undefined) continue;

    if (index < firstSelectedIndex) {
      firstSelectedIndex = index;
      firstSelectedId = id;
    }

    if (index < targetIndex && index > nearestBeforeIndex) {
      nearestBeforeIndex = index;
      nearestBeforeId = id;
    }

    if (index <= targetIndex && index > nearestAtOrBeforeIndex) {
      nearestAtOrBeforeIndex = index;
      nearestAtOrBeforeId = id;
    }

    if (index > targetIndex) {
      hasAfter = true;
    }
  }

  if (!firstSelectedId) return null;
  if (nearestBeforeId && hasAfter) return nearestBeforeId;
  if (nearestAtOrBeforeId) return nearestAtOrBeforeId;
  return firstSelectedId;
}

function Row({ index, style, ariaAttributes }: RowComponentProps<GridRowRenderSignals>) {
  const data = gridRowRuntime;
  if (!data) return null;

  const {
    rows,
    videosById,
    folderSizeByPath,
    filteredFolderSizeByPath,
    columnWidth,
    cardHeight,
    selectedIds,
    isSelectionMode,
    handleCardClick,
    handleCardPlay,
    handleCardContextMenu,
    onReviewFolder,
    onHeaderContextMenu,
    persistCurrentScroll,
    toggleSelection,
  } = data;

  const item = rows[index];

  if (item.type === 'header') {
    const filteredSize = filteredFolderSizeByPath.get(item.folderPath) ?? 0;
    const totalSize = folderSizeByPath.get(item.folderPath) ?? filteredSize;
    return (
      <div
        style={style}
        className="grid-group-header"
        onContextMenu={(event) => onHeaderContextMenu(item, event)}
        {...ariaAttributes}
      >
        <span className="grid-group-label">{item.label}</span>
        <span className="grid-group-meta">
          <span className="grid-group-count">{item.count}</span>
          <span
            className="grid-group-size"
            title={filteredSize !== totalSize
              ? `${formatSize(filteredSize)} filtered / ${formatSize(totalSize)} total`
              : formatSize(totalSize)}
          >
            {filteredSize !== totalSize
              ? `${formatFolderSize(filteredSize)}/${formatFolderSize(totalSize)}`
              : formatFolderSize(totalSize)}
          </span>
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

  const rowVideos = item.videoIds
    .map((videoId) => videosById.get(videoId))
    .filter((video): video is Video => Boolean(video));

  return (
    <div style={style} className="grid-card-row" {...ariaAttributes}>
      {rowVideos.map((video, colIdx) => (
        <div
          key={video.id}
          className="grid-card-cell"
          style={{
            width: columnWidth,
            height: cardHeight,
            marginLeft: colIdx === 0 ? GAP : GAP / 2,
            marginRight: colIdx === rowVideos.length - 1 ? GAP : GAP / 2,
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
            onContextMenu={handleCardContextMenu}
          />
        </div>
      ))}
    </div>
  );
}

export default function GridMode({ onReviewFolder, onRegenerateThumbnails }: GridModeProps) {
  const filteredVideos = useStore((s) => s.filteredVideos);
  const videos = useStore((s) => s.videos);
  const setVideoStatusesBatch = useStore((s) => s.setVideoStatusesBatch);
  const pushToast = useStore((s) => s.pushToast);
  const setFolderFilterPath = useStore((s) => s.setFolderFilterPath);
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
  const lastRowsRef = useRef<RowItem[] | null>(null);
  const lastVideosRef = useRef<Video[] | null>(null);
  const rowStructureCacheRef = useRef<CachedGridRows | null>(null);
  const rowContentVersionRef = useRef(0);
  const lastSelectedIdsRef = useRef(selectedIds);
  const selectionVersionRef = useRef(0);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [contextMenu, setContextMenu] = useState<{
    kind: 'video' | 'folder';
    x: number;
    y: number;
    videoId?: string;
    folderPath?: string;
  } | null>(null);
  const isSelectionMode = selectedIds.size > 0;
  const videosById = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const directoriesKey = useMemo(() => directories.join('\0'), [directories]);

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

  const folderSizeByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const video of videos) {
      const folderPath = getFolderPath(video);
      map.set(folderPath, (map.get(folderPath) ?? 0) + video.sizeBytes);
    }
    return map;
  }, [videos]);

  const filteredFolderSizeByPath = useMemo(() => {
    const map = new Map<string, number>();
    for (const video of filteredVideos) {
      const folderPath = getFolderPath(video);
      map.set(folderPath, (map.get(folderPath) ?? 0) + video.sizeBytes);
    }
    return map;
  }, [filteredVideos]);

  const { rows, headerIndexes, filteredVideoIds } = useMemo(() => {
    const cached = rowStructureCacheRef.current;
    if (
      cached &&
      cached.columnCount === columnCount &&
      cached.groupByFolder === groupByFolder &&
      cached.directoriesKey === directoriesKey &&
      sameVideoIdOrder(filteredVideos, cached.filteredVideoIds)
    ) {
      return cached;
    }

    const nextRows = buildGridRows(filteredVideos, columnCount, groupByFolder, directories);
    const nextCache: CachedGridRows = {
      ...nextRows,
      columnCount,
      directoriesKey,
      groupByFolder,
    };
    rowStructureCacheRef.current = nextCache;
    return nextCache;
  }, [columnCount, directories, directoriesKey, filteredVideos, groupByFolder]);

  const filteredIdSet = useMemo(() => new Set(filteredVideoIds), [filteredVideoIds]);
  const filteredIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < filteredVideoIds.length; i += 1) {
      map.set(filteredVideoIds[i], i);
    }
    return map;
  }, [filteredVideoIds]);

  useEffect(() => {
    if (selectedIds.size > 0) {
      const next = new Set(Array.from(selectedIds).filter((id) => filteredIdSet.has(id)));
      if (next.size !== selectedIds.size) setGridSelectionIds(next);
    }

    if (selectionAnchorId && !filteredIdSet.has(selectionAnchorId)) {
      setGridSelectionAnchorId(null);
    }
  }, [filteredIdSet, selectedIds, selectionAnchorId, setGridSelectionIds, setGridSelectionAnchorId]);

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
  }, [clearGridSelection, isSelectionMode]);

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
    (index: number) => (rows[index].type === 'header' ? HEADER_HEIGHT : cardHeight + GAP),
    [cardHeight, rows]
  );

  const getLastSelectedInList = useCallback((ids: Set<string>): string | null => (
    getLastSelectedIdInOrder(ids, filteredIndexById)
  ), [filteredIndexById]);

  const getRangeAnchorId = useCallback((ids: Set<string>, targetIndex: number): string | null => (
    getRangeAnchorIdForSelection(ids, targetIndex, filteredIndexById)
  ), [filteredIndexById]);

  const applyRangeSelection = useCallback((targetId: string) => {
    const targetIndex = filteredIndexById.get(targetId);
    if (targetIndex === undefined) return;

    setGridSelectionIds((prev) => {
      const currentAnchorId = getRangeAnchorId(prev, targetIndex)
        ?? (selectionAnchorId && prev.has(selectionAnchorId) ? selectionAnchorId : getLastSelectedInList(prev));

      if (!currentAnchorId) {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      }

      const anchorIndex = filteredIndexById.get(currentAnchorId);
      if (anchorIndex === undefined) {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const next = new Set(prev);
      for (let i = start; i <= end; i += 1) {
        const id = filteredVideoIds[i];
        if (id) next.add(id);
      }
      return next;
    });
    setGridSelectionAnchorId(targetId);
  }, [filteredIndexById, filteredVideoIds, getLastSelectedInList, getRangeAnchorId, selectionAnchorId, setGridSelectionAnchorId, setGridSelectionIds]);

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
  }, [applyRangeSelection, getLastSelectedInList, selectionAnchorId, setGridSelectionAnchorId, setGridSelectionIds]);

  const handleCardClick = useCallback((video: Video, event: ReactMouseEvent) => {
    if (isSelectionMode || event.shiftKey) {
      toggleSelection(video, event);
      return;
    }

    const idx = filteredIndexById.get(video.id);
    if (idx === undefined) return;

    persistCurrentScroll();
    const state = useStore.getState();
    state.setReviewIndex(idx);
    state.setReviewMode(true);
  }, [filteredIndexById, isSelectionMode, persistCurrentScroll, toggleSelection]);

  const handleCardPlay = useCallback((video: Video, event: ReactMouseEvent) => {
    persistCurrentScroll();
    const canPlayInReview = isWebSupported(video.path) && (!compatibilityCheckEnabled || video.compatible !== false);
    if (canPlayInReview && !event.ctrlKey) {
      useStore.getState().enterReviewAndPlay(video.id);
    } else if (window.electronAPI) {
      window.electronAPI.openVideo(video.path);
    }
  }, [compatibilityCheckEnabled, persistCurrentScroll]);

  const notifyCopiedPath = useCallback((pathValue: string) => {
    pushToast({
      title: 'Path copied',
      detail: buildCopyPathSuccessDetail(pathValue),
      kind: 'success',
    });
  }, [pushToast]);

  const notifyCopyFailed = useCallback(() => {
    pushToast({
      title: 'Copy failed',
      detail: 'The path could not be copied to the clipboard.',
      kind: 'error',
    });
  }, [pushToast]);

  const handleCopyPath = useCallback(async (pathValue: string) => {
    try {
      await copyTextToClipboard(pathValue);
      notifyCopiedPath(pathValue);
    } catch (error) {
      console.error('Failed to copy path:', error);
      notifyCopyFailed();
    }
  }, [notifyCopiedPath, notifyCopyFailed]);

  const handleCardContextMenu = useCallback((video: Video, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'video',
      x: event.clientX,
      y: event.clientY,
      videoId: video.id,
    });
  }, []);

  const handleHeaderContextMenu = useCallback((item: HeaderRow, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: 'folder',
      x: event.clientX,
      y: event.clientY,
      folderPath: item.folderPath,
    });
  }, []);

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
  }, [clearGridSelection, pushToast, selectedIds, setVideoStatusesBatch]);

  const handleBatchRegenerateThumbnails = useCallback(async () => {
    const ids = new Set(selectedIds);
    if (ids.size === 0 || isScanning || isGenerating) return;

    const selectedVideos = Array.from(ids)
      .map((id) => videosById.get(id))
      .filter((video): video is Video => Boolean(video));
    if (selectedVideos.length === 0) return;

    await onRegenerateThumbnails(selectedVideos);
    clearGridSelection();
  }, [clearGridSelection, isGenerating, isScanning, onRegenerateThumbnails, selectedIds, videosById]);

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
    videosById,
    folderSizeByPath,
    filteredFolderSizeByPath,
    columnWidth,
    cardHeight,
    selectedIds,
    isSelectionMode,
    handleCardClick,
    handleCardPlay,
    handleCardContextMenu,
    onReviewFolder,
    onHeaderContextMenu: handleHeaderContextMenu,
    persistCurrentScroll,
    toggleSelection,
  }), [
    rows,
    videosById,
    folderSizeByPath,
    filteredFolderSizeByPath,
    columnWidth,
    cardHeight,
    selectedIds,
    isSelectionMode,
    handleCardClick,
    handleCardPlay,
    handleCardContextMenu,
    onReviewFolder,
    handleHeaderContextMenu,
    persistCurrentScroll,
    toggleSelection,
  ]);

  if (lastRowsRef.current !== rows) {
    lastRowsRef.current = rows;
    rowContentVersionRef.current += 1;
  }

  if (lastVideosRef.current !== videos) {
    lastVideosRef.current = videos;
    rowContentVersionRef.current += 1;
  }

  if (lastSelectedIdsRef.current !== selectedIds) {
    lastSelectedIdsRef.current = selectedIds;
    selectionVersionRef.current += 1;
  }

  gridRowRuntime = itemData;

  const rowRenderSignals = useMemo<GridRowRenderSignals>(() => ({
    cardHeight,
    columnWidth,
    rowContentVersion: rowContentVersionRef.current,
    selectionVersion: selectionVersionRef.current,
  }), [cardHeight, columnWidth, rows, selectedIds, videos]);

  const contextMenuVideo = contextMenu?.kind === 'video' && contextMenu.videoId
    ? videosById.get(contextMenu.videoId) ?? null
    : null;
  const contextMenuFolder = contextMenu?.kind === 'folder' && contextMenu.folderPath
    ? rows.find((item): item is HeaderRow => item.type === 'header' && item.folderPath === contextMenu.folderPath) ?? null
    : null;

  const folderContextMenuItems = useMemo(() => {
    if (!contextMenuFolder) return [];

    const folderVideos = contextMenuFolder.videoIds
      .map((videoId) => videosById.get(videoId))
      .filter((video): video is Video => Boolean(video));
    const folderVideoIds = folderVideos.map((video) => video.id);

    return buildFolderHeaderMenu({
      onReviewFolder: () => {
        persistCurrentScroll();
        onReviewFolder(contextMenuFolder.folderPath);
      },
      onFilterToFolder: () => setFolderFilterPath(contextMenuFolder.folderPath),
      onRevealFolder: () => {
        void window.electronAPI?.openInExplorer(contextMenuFolder.folderPath);
      },
      onCopyFolderPath: () => {
        void handleCopyPath(contextMenuFolder.folderPath);
      },
      onMarkKeep: () => setVideoStatusesBatch(folderVideoIds, 'keep'),
      onMarkDelete: () => setVideoStatusesBatch(folderVideoIds, 'delete'),
      onResetPending: () => setVideoStatusesBatch(folderVideoIds, 'pending'),
      onRegenerateThumbnails: () => {
        void onRegenerateThumbnails(folderVideos);
      },
    });
  }, [contextMenuFolder, handleCopyPath, onRegenerateThumbnails, onReviewFolder, persistCurrentScroll, setFolderFilterPath, setVideoStatusesBatch, videosById]);

  const videoContextMenuItems = useMemo(() => {
    if (!contextMenuVideo) return [];
    return buildLibraryGridVideoMenu({
      onPlay: () => {
        const syntheticEvent = { ctrlKey: false } as ReactMouseEvent;
        handleCardPlay(contextMenuVideo, syntheticEvent);
      },
      onOpenExternal: () => {
        void window.electronAPI?.openVideo(contextMenuVideo.path);
      },
      onReveal: () => {
        void window.electronAPI?.openInExplorer(contextMenuVideo.path);
      },
      onResetPending: () => setVideoStatusesBatch([contextMenuVideo.id], 'pending'),
      onRegenerateThumbnails: () => {
        void onRegenerateThumbnails([contextMenuVideo]);
      },
      onCopyPath: () => {
        void handleCopyPath(contextMenuVideo.path);
      },
    });
  }, [contextMenuVideo, handleCardPlay, handleCopyPath, onRegenerateThumbnails, setVideoStatusesBatch]);

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
          rowProps={rowRenderSignals}
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.kind === 'video' ? videoContextMenuItems : folderContextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export const __test__ = {
  sameVideoIdOrder,
  buildGridRows,
  getLastSelectedIdInOrder,
  getRangeAnchorIdForSelection,
};
