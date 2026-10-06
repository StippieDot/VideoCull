import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Filter,
  FilterX,
  FolderOpen,
  FolderTree,
  LayoutGrid,
  Play,
  RefreshCw,
  ScanSearch,
  Settings,
} from 'lucide-react';
import type { DuplicateGroup, Video, VideoStatus } from '../types';
import { formatDuration, formatResolutionLabel, formatSize, getFolderLabel, getFolderPath, isFolderInside } from '../utils';

export type LocationMenuAction = {
  type: 'item';
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Right-aligned extra text, such as a folder's count in Go to Folder. */
  detail?: string;
  current?: boolean;
  /** Dimmed: a folder with nothing left to review. */
  muted?: boolean;
  onSelect: () => void;
};

export type LocationMenuItem = LocationMenuAction | { type: 'separator'; key: string };

export interface LocationMenu {
  kind: 'folder' | 'video' | 'duplicates' | 'list';
  /** Shown as a header with the detail line; a plain list of places has none. */
  title?: string;
  detail?: string;
  items: LocationMenuItem[];
}

export interface PathSegment {
  label: string;
  path: string;
}

/** "P:\Downloads\New" → P:, Downloads, New, each with the full path up to that part. */
export function splitPath(fullPath: string): PathSegment[] {
  const sep = fullPath.includes('\\') ? '\\' : '/';
  const uncMatch = /^(\\\\[^\\]+\\[^\\]+)(.*)$/.exec(fullPath);
  const root = uncMatch ? uncMatch[1] : '';
  const rest = uncMatch ? uncMatch[2] : fullPath;
  const parts = rest.split(/[\\/]/).filter(Boolean);
  const segments: PathSegment[] = root ? [{ label: root, path: root }] : [];
  let current = root || (rest.startsWith(sep) ? sep : '');
  for (const part of parts) {
    current = current === '' || current.endsWith(sep) ? `${current}${part}` : `${current}${sep}${part}`;
    // A drive root needs its separator to stay a folder ("P:\", not "P:").
    segments.push({ label: part, path: /^[A-Za-z]:$/.test(current) ? `${current}${sep}` : current });
  }
  return segments;
}

function lastPart(fullPath: string): string {
  const segments = splitPath(fullPath);
  return segments[segments.length - 1]?.label ?? fullPath;
}

/** Keeps the first part and the last `tail` parts; null marks the hidden middle. */
export function collapseSegments<T>(segments: T[], tail = 3): Array<T | null> {
  if (segments.length <= tail + 2) return segments;
  return [segments[0], null, ...segments.slice(-tail)];
}

const SEPARATOR = (key: string): LocationMenuItem => ({ type: 'separator', key });

function normalizeFolder(value: string): string {
  return value.replace(/[\\/]+$/, '').toLowerCase();
}

function isInsideFolder(video: Video, folder: string): boolean {
  return isFolderInside(getFolderPath(video), folder);
}

function countToReview(videos: Video[]): number {
  return videos.filter((video) => video.status === 'pending').length;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

/** "212 videos · 40 to review · 3.2 GB" for everything in the folder and its subfolders. */
export function describeFolder(videos: Video[], folder: string): string {
  const inside = videos.filter((video) => isInsideFolder(video, folder));
  if (inside.length === 0) return 'No videos in this session';
  const bytes = inside.reduce((sum, video) => sum + video.sizeBytes, 0);
  return `${plural(inside.length, 'video')} · ${countToReview(inside).toLocaleString()} to review · ${formatSize(bytes)}`;
}

export interface FolderEntry {
  path: string;
  label: string;
  count: number;
  toReview: number;
}

function folderDetail(entry: FolderEntry): string {
  return entry.toReview > 0 ? `${entry.toReview.toLocaleString()} to review` : plural(entry.count, 'video');
}

/** Subfolders of `parent` that hold videos, also further down, with what is in them. */
export function listSubfolders(videos: Video[], parent: string): FolderEntry[] {
  const prefixLength = normalizeFolder(parent).length + 1;
  const children = new Map<string, { path: string; label: string; videos: Video[] }>();
  for (const video of videos) {
    const folder = getFolderPath(video);
    if (folder.length < prefixLength || !isFolderInside(folder, parent)) continue;
    const label = folder.slice(prefixLength).split(/[\\/]/)[0];
    const key = label.toLowerCase();
    const entry = children.get(key);
    if (entry) entry.videos.push(video);
    else children.set(key, { path: folder.slice(0, prefixLength + label.length), label, videos: [video] });
  }
  return [...children.values()]
    .map(({ path, label, videos: inside }) => ({ path, label, count: inside.length, toReview: countToReview(inside) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
}

/** The list behind a `›` in the path: the folders one level down, the current one ticked. */
export function buildSubfolderMenu(videos: Video[], parent: string, current: string | null, actions: LocationActions): LocationMenu {
  return {
    kind: 'list',
    items: listSubfolders(videos, parent).map((entry) => ({
      type: 'item',
      key: entry.path,
      label: entry.label,
      detail: folderDetail(entry),
      muted: entry.toReview === 0,
      current: current !== null && normalizeFolder(entry.path) === normalizeFolder(current),
      onSelect: () => actions.goToFolder(entry.path),
    })),
  };
}

/** The loaded folders, for switching between them when there are several. */
export function buildRootsMenu(videos: Video[], directories: string[], current: string | null, actions: LocationActions): LocationMenu {
  return {
    kind: 'list',
    items: directories.map((root) => {
      const inside = videos.filter((video) => isInsideFolder(video, root));
      return {
        type: 'item',
        key: root,
        label: root,
        detail: folderDetail({ path: root, label: root, count: inside.length, toReview: countToReview(inside) }),
        muted: countToReview(inside) === 0,
        current: current !== null && isFolderInside(current, root),
        onSelect: () => actions.goToFolder(root),
      };
    }),
  };
}

/** The grid's folders in grid order, for Go to Folder. */
export function listGridFolders(filteredVideos: Video[], directories: string[]): FolderEntry[] {
  const folders = new Map<string, { path: string; label: string; videos: Video[] }>();
  for (const video of filteredVideos) {
    const folderPath = getFolderPath(video);
    const entry = folders.get(folderPath);
    if (entry) entry.videos.push(video);
    else folders.set(folderPath, { path: folderPath, label: getFolderLabel(video, directories), videos: [video] });
  }
  return [...folders.values()].map(({ path, label, videos }) => ({ path, label, count: videos.length, toReview: countToReview(videos) }));
}

export interface LocationActions {
  reviewFolder: (folder: string) => void;
  reviewOnlyFolder: (folder: string) => void;
  showOnlyFolder: (folder: string | null) => void;
  regenerateThumbnails: (videos: Video[]) => void;
  reveal: (path: string) => void;
  copyPath: (path: string) => void;
  playExternally: (path: string) => void;
  /** Scrolls the grid to the folder, or to the first folder below it that has videos. */
  goToFolder: (folder: string) => void;
  openFolderSearch: () => void;
  showFolderInGrid: (folder: string) => void;
  findDuplicates: () => void;
  openDuplicateSettings: () => void;
  backToGrid: () => void;
}

export interface FolderMenuContext {
  mode: 'grid' | 'review';
  folder: string;
  videos: Video[];
  filteredVideos: Video[];
  directories: string[];
  folderFilterPath: string | null;
  /** Review can narrow to a folder unless it was opened on a fixed set of videos (duplicates). */
  canNarrowReview: boolean;
}

export function buildFolderMenu(context: FolderMenuContext, actions: LocationActions): LocationMenu {
  const { folder, mode } = context;
  const folderVideos = context.videos.filter((video) => isInsideFolder(video, folder));
  const hasOwnVideos = context.videos.some((video) => normalizeFolder(getFolderPath(video)) === normalizeFolder(folder));
  const items: LocationMenuItem[] = [];

  if (mode === 'grid' && hasOwnVideos) {
    items.push({ type: 'item', key: 'review', label: 'Review This Folder', icon: Play, onSelect: () => actions.reviewFolder(folder) });
    items.push(context.folderFilterPath !== null && normalizeFolder(context.folderFilterPath) === normalizeFolder(folder)
      ? { type: 'item', key: 'show-all', label: 'Show All Folders', icon: FilterX, onSelect: () => actions.showOnlyFolder(null) }
      : { type: 'item', key: 'show-only', label: 'Show Only This Folder', icon: Filter, onSelect: () => actions.showOnlyFolder(folder) });
  }
  if (mode === 'review' && hasOwnVideos) {
    if (context.canNarrowReview) {
      items.push({ type: 'item', key: 'review-only', label: 'Review Only This Folder', icon: Filter, onSelect: () => actions.reviewOnlyFolder(folder) });
    }
    items.push({ type: 'item', key: 'show-in-grid', label: 'Show Folder in Grid', icon: LayoutGrid, onSelect: () => actions.showFolderInGrid(folder) });
  }
  if (mode === 'grid' && folderVideos.length > 0) {
    items.push({ type: 'item', key: 'thumbs', label: 'Regenerate Thumbnails', icon: RefreshCw, onSelect: () => actions.regenerateThumbnails(folderVideos) });
  }
  items.push(
    SEPARATOR('sep-path'),
    { type: 'item', key: 'reveal', label: 'Reveal in Explorer', icon: FolderOpen, onSelect: () => actions.reveal(folder) },
    { type: 'item', key: 'copy', label: 'Copy Path', icon: Copy, onSelect: () => actions.copyPath(folder) },
  );

  if (mode === 'grid' && listGridFolders(context.filteredVideos, context.directories).length > 1) {
    items.push(SEPARATOR('sep-go'), {
      type: 'item', key: 'go-to', label: 'Go to Folder...', icon: FolderTree, detail: 'Ctrl+G', onSelect: actions.openFolderSearch,
    });
  }

  return {
    kind: 'folder',
    title: lastPart(folder),
    detail: describeFolder(context.videos, folder),
    items: trimSeparators(items),
  };
}

const STATUS_LABELS: Record<VideoStatus, string> = { pending: 'To review', keep: 'Keep', delete: 'Delete', skipped: 'Skipped' };

export function buildVideoMenu(video: Video, canNarrowReview: boolean, actions: LocationActions): LocationMenu {
  const folder = getFolderPath(video);
  const facts = [
    formatSize(video.sizeBytes),
    video.durationSecs ? formatDuration(video.durationSecs) : '',
    formatResolutionLabel(video.width, video.height),
    STATUS_LABELS[video.status],
  ].filter(Boolean);
  const items: LocationMenuItem[] = [
    { type: 'item', key: 'reveal', label: 'Reveal in Explorer', icon: FolderOpen, onSelect: () => actions.reveal(video.path) },
    { type: 'item', key: 'external', label: 'Play Externally', icon: ExternalLink, onSelect: () => actions.playExternally(video.path) },
    { type: 'item', key: 'copy', label: 'Copy Path', icon: Copy, onSelect: () => actions.copyPath(video.path) },
    SEPARATOR('sep-folder'),
  ];
  if (canNarrowReview) {
    items.push({ type: 'item', key: 'review-only', label: 'Review Only This Folder', icon: Filter, onSelect: () => actions.reviewOnlyFolder(folder) });
  }
  items.push({ type: 'item', key: 'show-in-grid', label: 'Show Folder in Grid', icon: LayoutGrid, onSelect: () => actions.showFolderInGrid(folder) });
  return { kind: 'video', title: lastPart(video.path), detail: facts.join(' · '), items };
}

/** Space freed by deleting every video in each group except the one it suggests keeping. */
export function reclaimableBytes(groups: DuplicateGroup[], videosById: Map<string, Video>): number {
  let total = 0;
  for (const group of groups) {
    const members = group.videoIds.map((id) => videosById.get(id)).filter((video): video is Video => Boolean(video));
    const keeperId = group.manualSuggestedKeeperId ?? group.suggestedKeeperId;
    const keeper = members.find((video) => video.id === keeperId)
      ?? members.reduce<Video | null>((largest, video) => (!largest || video.sizeBytes > largest.sizeBytes ? video : largest), null);
    for (const video of members) {
      if (video !== keeper) total += video.sizeBytes;
    }
  }
  return total;
}

export function buildDuplicatesMenu(groups: DuplicateGroup[], videos: Video[], actions: LocationActions): LocationMenu {
  const videoCount = new Set(groups.flatMap((group) => group.videoIds)).size;
  const reclaim = reclaimableBytes(groups, new Map(videos.map((video) => [video.id, video])));
  return {
    kind: 'duplicates',
    title: 'Duplicates',
    detail: `${plural(groups.length, 'group')} · ${plural(videoCount, 'video')} · ${formatSize(reclaim)} to reclaim`,
    items: [
      { type: 'item', key: 'find', label: 'Find Duplicates Again', icon: ScanSearch, onSelect: actions.findDuplicates },
      { type: 'item', key: 'settings', label: 'Duplicate Settings', icon: Settings, onSelect: actions.openDuplicateSettings },
      SEPARATOR('sep-back'),
      { type: 'item', key: 'back', label: 'Back to Grid', icon: ArrowLeft, onSelect: actions.backToGrid },
    ],
  };
}

function trimSeparators(items: LocationMenuItem[]): LocationMenuItem[] {
  return items.filter((item, index) => item.type !== 'separator'
    || (index > 0 && index < items.length - 1 && items[index - 1].type !== 'separator'));
}
