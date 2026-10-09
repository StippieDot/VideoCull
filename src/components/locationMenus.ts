import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Filter,
  FolderOpen,
  FolderTree,
  LayoutGrid,
  Play,
  History,
  ListOrdered,
  RefreshCw,
  ScanSearch,
  Settings,
  Shuffle,
} from 'lucide-react';
import type { DuplicateGroup, FolderFilter, Video, VideoStatus } from '../types';
import { trimSeparators, type AppMenuItem } from './AppMenu';
import { formatDuration, formatResolutionLabel, formatSize, folderInsideTest, getFolderLabel, getFolderPath, isFolderInside, normalizeFolder, plural } from '../utils';

export type LocationMenuItem = AppMenuItem;

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

/** Hides `hidden` parts after the first, never the last; null marks where they were. */
export function collapseSegments<T>(segments: T[], hidden: number): Array<T | null> {
  const count = Math.min(hidden, segments.length - 2);
  if (count <= 0) return segments;
  return [segments[0], null, ...segments.slice(1 + count)];
}

const SEPARATOR = (key: string): LocationMenuItem => ({ type: 'separator', key });

function isInsideFolder(video: Video, folder: string): boolean {
  return isFolderInside(getFolderPath(video), folder);
}

function countToReview(videos: Video[]): number {
  return videos.filter((video) => video.status === 'pending').length;
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

/** Whether any video lies in a folder below `parent`. */
export function hasSubfolders(videos: Video[], parent: string): boolean {
  const base = normalizeFolder(parent);
  const inside = folderInsideTest(parent);
  return videos.some((video) => {
    const folder = getFolderPath(video);
    return inside(folder) && normalizeFolder(folder) !== base;
  });
}

/** Subfolders of `parent` that hold videos, also further down, with what is in them. */
export function listSubfolders(videos: Video[], parent: string): FolderEntry[] {
  // Normalization collapses UNC separators; slicing needs the original path length.
  const prefixLength = parent.replace(/[\\/]+$/, '').length + 1;
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

/** Where the title bar path filters the grid. */
export interface PathScope {
  filterPath: string | null;
  directories: string[];
}

/** The folder the grid shows: the path filter, or the loaded folder when there is just one. */
function shownFolder(scope: PathScope): string | null {
  return scope.filterPath ?? (scope.directories.length === 1 ? scope.directories[0] : null);
}

/** Filtering to a folder that holds every loaded folder is the same as no filter. */
function filterFor(folder: string, scope: PathScope): string | null {
  return scope.directories.every((root) => isFolderInside(root, folder)) ? null : folder;
}

function sameFolder(a: string | null, b: string): boolean {
  return a !== null && normalizeFolder(a) === normalizeFolder(b);
}

/**
 * The list behind a `›` in the path: all of the folder before it, then each folder one level
 * down. Choosing one filters the grid to it and everything below it; the folder shown is ticked.
 */
export function buildSubfolderMenu(videos: Video[], parent: string, scope: PathScope, actions: LocationActions): LocationMenu {
  const shown = shownFolder(scope);
  const all = videos.filter((video) => isInsideFolder(video, parent));
  const allEntry = { path: parent, label: parent, count: all.length, toReview: countToReview(all) };
  const items: LocationMenuItem[] = [
    {
      type: 'item',
      key: 'all',
      label: `All of ${lastPart(parent)}`,
      detail: folderDetail(allEntry),
      muted: allEntry.toReview === 0,
      checked: sameFolder(shown, parent),
      onSelect: () => actions.filterToPath(filterFor(parent, scope)),
    },
    SEPARATOR('sep-all'),
    ...listSubfolders(videos, parent).map((entry): LocationMenuItem => ({
      type: 'item',
      key: entry.path,
      label: entry.label,
      detail: folderDetail(entry),
      muted: entry.toReview === 0,
      checked: shown !== null && isFolderInside(shown, entry.path),
      onSelect: () => actions.filterToPath(filterFor(entry.path, scope)),
    })),
  ];
  return { kind: 'list', items: trimSeparators(items) };
}

/** With several loaded folders: show them all, or one of them. */
const RECENT_IN_ROOTS_MENU = 5;

/** Every loaded folder to filter to, then recent sessions to open instead. */
export function buildRootsMenu(videos: Video[], scope: PathScope, recent: string[], actions: LocationActions): LocationMenu {
  const loaded = new Set(scope.directories.map(normalizeFolder));
  const others = recent.filter((folder) => !loaded.has(normalizeFolder(folder))).slice(0, RECENT_IN_ROOTS_MENU);
  const entry = (path: string, inside: Video[]) => ({ path, label: path, count: inside.length, toReview: countToReview(inside) });
  const all = entry('', videos);
  return {
    kind: 'list',
    items: [
      {
        type: 'item',
        key: 'all',
        label: 'All Loaded Folders',
        detail: folderDetail(all),
        muted: all.toReview === 0,
        checked: scope.filterPath === null,
        onSelect: () => actions.filterToPath(null),
      },
      SEPARATOR('sep-all'),
      ...scope.directories.map((root): LocationMenuItem => {
        const rootEntry = entry(root, videos.filter((video) => isInsideFolder(video, root)));
        return {
          type: 'item',
          key: root,
          label: root,
          detail: folderDetail(rootEntry),
          muted: rootEntry.toReview === 0,
          checked: scope.filterPath !== null && isFolderInside(scope.filterPath, root),
          onSelect: () => actions.filterToPath(root),
        };
      }),
      ...(others.length > 0 ? [
        SEPARATOR('sep-recent'),
        { type: 'heading' as const, key: 'recent', label: 'Open Recent' },
        ...others.map((folder): LocationMenuItem => ({
          type: 'item',
          key: `recent:${folder}`,
          label: folder,
          icon: History,
          radio: false,
          onSelect: () => actions.openRecent(folder),
        })),
      ] : []),
    ],
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
  /** Shows only this folder and everything below it in the grid; null shows every loaded folder. */
  filterToPath: (folder: string | null) => void;
  /** Whether the folder filter also shows the folders below it. */
  setIncludeSubfolders: (includeSubfolders: boolean) => void;
  regenerateThumbnails: (videos: Video[]) => void;
  reveal: (path: string) => void;
  copyPath: (path: string) => void;
  playExternally: (path: string) => void;
  openFolderSearch: () => void;
  showFolderInGrid: (folder: string) => void;
  findDuplicates: () => void;
  switchDuplicateMethod: () => void;
  openDuplicateSettings: () => void;
  backToGrid: () => void;
  /** Opens a recent session in place of the loaded folders. */
  openRecent: (folder: string) => void;
  /** Focuses the group number beside the duplicates part, to type a group to go to. */
  goToGroup: () => void;
}

export interface FolderMenuContext {
  mode: 'grid' | 'review';
  folder: string;
  videos: Video[];
  filteredVideos: Video[];
  directories: string[];
  /** Review can narrow to a folder unless it was opened on a fixed set of videos (duplicates). */
  canNarrowReview: boolean;
  filter?: FolderFilter | null;
}

export function buildFolderMenu(context: FolderMenuContext, actions: LocationActions): LocationMenu {
  const { folder, mode } = context;
  const folderVideos = context.videos.filter((video) => isInsideFolder(video, folder));
  const hasOwnVideos = context.videos.some((video) => normalizeFolder(getFolderPath(video)) === normalizeFolder(folder));
  const items: LocationMenuItem[] = [];

  if (mode === 'grid' && hasOwnVideos) {
    items.push({ type: 'item', key: 'review', label: 'Review This Folder', icon: Play, onSelect: () => actions.reviewFolder(folder) });
  }
  if (mode === 'review' && hasOwnVideos) {
    if (context.canNarrowReview) {
      items.push({ type: 'item', key: 'review-only', label: 'Review Only This Folder', icon: Filter, onSelect: () => actions.reviewOnlyFolder(folder) });
    }
    items.push({ type: 'item', key: 'show-in-grid', label: 'Show Folder in Grid', icon: LayoutGrid, onSelect: () => actions.showFolderInGrid(folder) });
  }
  const { filter } = context;
  if (mode === 'grid' && filter && normalizeFolder(filter.path) === normalizeFolder(folder)) {
    items.push({
      type: 'item',
      key: 'subfolders',
      label: 'Include Subfolders',
      checked: filter.includeSubfolders,
      onSelect: () => actions.setIncludeSubfolders(!filter.includeSubfolders),
    });
  }
  if (mode === 'grid' && folderVideos.length > 0) {
    items.push({ type: 'item', key: 'thumbs', label: 'Regenerate Thumbnails', icon: RefreshCw, onSelect: () => actions.regenerateThumbnails(folderVideos) });
  }
  items.push(
    SEPARATOR('sep-path'),
    { type: 'item', key: 'reveal', label: 'Reveal in Explorer', icon: FolderOpen, onSelect: () => actions.reveal(folder) },
    { type: 'item', key: 'copy', label: 'Copy Path', icon: Copy, onSelect: () => actions.copyPath(folder) },
  );

  const firstFolder = context.filteredVideos[0] && getFolderPath(context.filteredVideos[0]);
  if (mode === 'grid' && context.filteredVideos.some((video) => getFolderPath(video) !== firstFolder)) {
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

/** `otherMethod` names the comparison method the groups were not found with, to run again with it. */
export function buildDuplicatesMenu(groups: DuplicateGroup[], videos: Video[], otherMethod: string, actions: LocationActions): LocationMenu {
  const videoCount = new Set(groups.flatMap((group) => group.videoIds)).size;
  const reclaim = reclaimableBytes(groups, new Map(videos.map((video) => [video.id, video])));
  return {
    kind: 'duplicates',
    title: 'Duplicates',
    detail: `${plural(groups.length, 'group')} · ${plural(videoCount, 'video')} · ${formatSize(reclaim)} to reclaim`,
    items: [
      { type: 'item', key: 'go-to', label: 'Go to Group...', icon: ListOrdered, onSelect: actions.goToGroup },
      SEPARATOR('sep-go-to'),
      { type: 'item', key: 'find', label: 'Find Duplicates Again', icon: ScanSearch, onSelect: actions.findDuplicates },
      { type: 'item', key: 'switch', label: `Find Again with ${otherMethod}`, icon: Shuffle, onSelect: actions.switchDuplicateMethod },
      { type: 'item', key: 'settings', label: 'Duplicate Settings', icon: Settings, onSelect: actions.openDuplicateSettings },
      SEPARATOR('sep-back'),
      { type: 'item', key: 'back', label: 'Back to Grid', icon: ArrowLeft, onSelect: actions.backToGrid },
    ],
  };
}
