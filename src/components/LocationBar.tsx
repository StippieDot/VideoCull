import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Film, Filter, Folder } from 'lucide-react';
import useStore, { videosOutsideFolderFilter } from '../store';
import type { Video } from '../types';
import { isFolderInside, normalizeFolder } from '../utils';
import AppMenu from './AppMenu';
import { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail } from './contextMenuBuilders';
import {
  buildDuplicatesMenu,
  buildFolderMenu,
  buildRootsMenu,
  buildSubfolderMenu,
  buildVideoMenu,
  collapseSegments,
  hasSubfolders,
  splitPath,
  type LocationActions,
  type LocationMenu,
  type PathSegment,
} from './locationMenus';
import './LocationBar.css';

/** What only the app shell can do; LocationBar does the rest itself. */
export interface LocationBarAppActions {
  reviewFolder: (folder: string) => void;
  regenerateThumbnails: (videos: Video[]) => void;
  findDuplicates: () => void;
  openDuplicateSettings: () => void;
  openFolderSearch: () => void;
}

type Segment = PathSegment & { kind: 'folder' | 'video' | 'duplicates'; filtered?: boolean };

/**
 * The bar's parts in order. Path parts open what can be done there. In the grid, the path follows
 * the folder at the top of the grid (or the folder the grid is filtered to): each `›` lists the
 * folders one level down to filter to (like Explorer's address bar), and with several loaded
 * folders a leading button picks one.
 */
type Control =
  | { type: 'segment'; segment: Segment; last: boolean }
  | { type: 'subfolders'; parent: string }
  | { type: 'roots' }
  /** Several loaded folders and no folder chosen: the session's name. */
  | { type: 'text' }
  /** The middle of a long path; opens a list of the folders it hides. */
  | { type: 'ellipsis'; hidden: Segment[] }
  | { type: 'separator' };

const INTERACTIVE = new Set<Control['type']>(['segment', 'subfolders', 'roots', 'ellipsis']);

interface Location {
  segments: Segment[];
  /** Grid: the `›` lists browse folders. Review and duplicates show a plain path. */
  browsable: boolean;
}

/** The title bar's location: the folder at the top of the grid, the video in review, or the duplicate groups. */
function useLocation(): Location | null {
  const reviewMode = useStore((s) => s.reviewMode);
  const duplicateGroupsMode = useStore((s) => s.duplicateGroupsMode);
  const duplicateGroupCount = useStore((s) => s.duplicateGroups.length);
  const reviewPath = useStore((s) => s.activeReviewVideoPath);
  const filterPath = useStore((s) => s.folderFilter?.path ?? null);
  const gridTopFolder = useStore((s) => s.gridTopFolder);
  const directories = useStore((s) => s.directories);

  return useMemo(() => {
    if (directories.length === 0) return null;
    if (duplicateGroupsMode) {
      const label = `Duplicates · ${duplicateGroupCount.toLocaleString()} ${duplicateGroupCount === 1 ? 'group' : 'groups'}`;
      return { segments: [{ kind: 'duplicates', label, path: 'duplicates' }], browsable: false };
    }
    if (reviewMode && reviewPath) {
      const parts = splitPath(reviewPath);
      return {
        segments: parts.map((segment, index) => ({ ...segment, kind: index === parts.length - 1 ? 'video' : 'folder' })),
        browsable: false,
      };
    }
    // The top folder lags a render behind a filter change, so it only counts once inside the filter.
    const topFolder = gridTopFolder && (filterPath
      ? isFolderInside(gridTopFolder, filterPath)
      : directories.some((root) => isFolderInside(gridTopFolder, root))) ? gridTopFolder : null;
    const folder = topFolder ?? filterPath ?? (directories.length === 1 ? directories[0] : null);
    const filterKey = filterPath && normalizeFolder(filterPath);
    return {
      segments: folder
        ? splitPath(folder).map((segment) => ({ ...segment, kind: 'folder', filtered: normalizeFolder(segment.path) === filterKey }))
        : [],
      browsable: true,
    };
  }, [directories, duplicateGroupCount, duplicateGroupsMode, gridTopFolder, filterPath, reviewMode, reviewPath]);
}

function buildControls(location: Location, hasRoots: boolean, lastHasSubfolders: boolean, hiddenCount: number): Control[] {
  const { segments, browsable } = location;
  const controls: Control[] = browsable && hasRoots ? [{ type: 'roots' }] : [];
  if (segments.length === 0) return [...controls, { type: 'text' }];
  const visible = collapseSegments(segments, hiddenCount);
  visible.forEach((segment, index) => {
    if (!segment) {
      const nextShown = visible[index + 1];
      controls.push(browsable
        ? { type: 'subfolders', parent: segments[0].path }
        : { type: 'separator' });
      controls.push({ type: 'ellipsis', hidden: segments.slice(1, nextShown ? segments.indexOf(nextShown) : -1) });
      return;
    }
    const fullIndex = segments.indexOf(segment);
    if (index > 0) {
      controls.push(browsable
        ? { type: 'subfolders', parent: segments[fullIndex - 1].path }
        : { type: 'separator' });
    }
    controls.push({ type: 'segment', segment, last: fullIndex === segments.length - 1 });
  });
  if (browsable && lastHasSubfolders) {
    controls.push({ type: 'subfolders', parent: segments[segments.length - 1].path });
  }
  return controls;
}

function useLocationActions(app: LocationBarAppActions): LocationActions {
  const appRef = useRef(app);
  appRef.current = app;
  return useMemo<LocationActions>(() => {
    const store = () => useStore.getState();
    return {
      reviewFolder: (folder) => appRef.current.reviewFolder(folder),
      reviewOnlyFolder: (folder) => {
        const videoPath = store().activeReviewVideoPath;
        appRef.current.reviewFolder(folder);
        // Stay on the open video instead of jumping to the folder's first one.
        const index = store().filteredVideos.findIndex((video) => video.path === videoPath);
        if (index >= 0) store().setReviewIndex(index);
      },
      filterToPath: (folder) => store().setFolderFilter(folder ? { path: folder, includeSubfolders: true } : null),
      regenerateThumbnails: (videos) => appRef.current.regenerateThumbnails(videos),
      reveal: (path) => void window.electronAPI?.openInExplorer(path),
      copyPath: (path) => {
        copyTextToClipboard(path).then(
          () => store().pushToast({ title: 'Path copied', detail: buildCopyPathSuccessDetail(path), kind: 'success' }),
          () => store().pushToast({ title: 'Copy failed', detail: 'The path could not be copied to the clipboard.', kind: 'error' }),
        );
      },
      playExternally: (path) => void window.electronAPI?.openVideo(path),
      openFolderSearch: () => appRef.current.openFolderSearch(),
      showFolderInGrid: (folder) => {
        store().setReviewMode(false);
        store().requestGridFolderJump(folder);
      },
      findDuplicates: () => appRef.current.findDuplicates(),
      openDuplicateSettings: () => appRef.current.openDuplicateSettings(),
      backToGrid: () => store().setDuplicateGroupsMode(false),
    };
  }, []);
}

function buildMenu(
  control: Control,
  location: Location,
  actions: LocationActions,
  pickHidden: (segment: Segment) => void,
): LocationMenu | null {
  const state = useStore.getState();
  if (control.type === 'ellipsis') {
    return {
      kind: 'list',
      items: control.hidden.map((segment) => ({
        type: 'item',
        key: segment.path,
        label: segment.label,
        icon: Folder,
        keepOpen: true,
        onSelect: () => pickHidden(segment),
      })),
    };
  }
  // The lists show every folder the other filters allow, so you can switch to one next to the current one.
  const scope = { filterPath: state.folderFilter?.path ?? null, directories: state.directories };
  if (control.type === 'roots') return buildRootsMenu(videosOutsideFolderFilter(state), scope, actions);
  if (control.type === 'subfolders') return buildSubfolderMenu(videosOutsideFolderFilter(state), control.parent, scope, actions);
  if (control.type !== 'segment') return null;
  const { segment } = control;
  if (segment.kind === 'duplicates') return buildDuplicatesMenu(state.duplicateGroups, state.videos, actions);
  const canNarrowReview = !state.reviewScopeIds;
  if (segment.kind === 'video') {
    const video = state.videos.find((entry) => entry.path === segment.path);
    return video ? buildVideoMenu(video, canNarrowReview, actions) : null;
  }
  return buildFolderMenu({
    mode: state.reviewMode ? 'review' : 'grid',
    folder: segment.path,
    videos: state.videos,
    filteredVideos: state.filteredVideos,
    directories: state.directories,
    canNarrowReview,
  }, actions);
}

/**
 * Centre of the title bar: a breadcrumb of what is on screen. Each part opens a menu with what can
 * be done there, drawn by the app (not a native popup) so it can show a header and counts.
 */
export default function LocationBar({ sessionTitle, appActions }: { sessionTitle: string; appActions: LocationBarAppActions }) {
  const location = useLocation();
  const actions = useLocationActions(appActions);
  const filteredVideos = useStore((s) => s.filteredVideos);
  const rootCount = useStore((s) => s.directories.length);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // A folder picked from the "…" list; its own menu then replaces the list.
  const [hiddenPick, setHiddenPick] = useState<Segment | null>(null);
  useEffect(() => setHiddenPick(null), [openIndex]);
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());

  const lastFolder = location?.browsable ? location.segments[location.segments.length - 1]?.path ?? null : null;
  const lastHasSubfolders = useMemo(
    () => lastFolder !== null && hasSubfolders(filteredVideos, lastFolder),
    [filteredVideos, lastFolder],
  );
  // Middle parts hide only while the full path does not fit.
  const navRef = useRef<HTMLElement>(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  // The status pill narrows the centre of the title bar while processing (TitleBar.css).
  const processing = useStore((s) => s.isGenerating || s.isScanning || s.isFindingDuplicates);
  useLayoutEffect(() => setHiddenCount(0), [location, windowWidth, processing]);
  const maxHidden = Math.max(0, (location?.segments.length ?? 0) - 2);
  const controls = useMemo(
    () => (location ? buildControls(location, rootCount > 1, lastHasSubfolders, hiddenCount) : []),
    [hiddenCount, lastHasSubfolders, location, rootCount],
  );
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !location || hiddenCount >= maxHidden) return;
    const overflow = nav.scrollWidth - nav.clientWidth;
    if (overflow <= 0) return;
    const fits = hiddenCount === 0 ? partsToHide(nav, controls, location.segments, overflow) : null;
    // A miss (or no layout to measure) falls back to hiding one more part per render.
    setHiddenCount(fits !== null && fits > 0 ? Math.min(fits, maxHidden) : hiddenCount + 1);
  });

  // The location can change under an open menu (a filter chosen, the next video); close it then.
  useEffect(() => setOpenIndex(null), [location]);

  const close = useCallback((refocus: boolean) => {
    setOpenIndex((index) => {
      if (refocus && index !== null) buttonRefs.current.get(index)?.focus();
      return null;
    });
  }, []);

  const switchControl = useCallback((direction: -1 | 1) => {
    setOpenIndex((index) => {
      if (index === null) return index;
      for (let next = index + direction; next >= 0 && next < controls.length; next += direction) {
        if (INTERACTIVE.has(controls[next].type)) return next;
      }
      return index;
    });
  }, [controls]);

  const openControl = openIndex !== null ? controls[openIndex] ?? null : null;
  // Built when a menu opens, and again only when the grid's videos change (its counts), not on
  // every render while it is open.
  const menu = useMemo(() => {
    if (!openControl || !location) return null;
    return buildMenu(hiddenPick ? { type: 'segment', segment: hiddenPick, last: false } : openControl, location, actions, setHiddenPick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filteredVideos invalidates the counts read from the store
  }, [actions, filteredVideos, hiddenPick, location, openControl]);

  if (!location) return <div className="title-bar-title">{sessionTitle}</div>;

  const lastSegment = location.segments[location.segments.length - 1];
  const fullPath = !lastSegment || lastSegment.kind === 'duplicates' ? undefined : lastSegment.path;
  const anchor = openIndex !== null ? buttonRefs.current.get(openIndex)?.getBoundingClientRect() : undefined;

  const buttonProps = (index: number, label: string) => ({
    ref: (element: HTMLButtonElement | null) => {
      if (element) buttonRefs.current.set(index, element);
      else buttonRefs.current.delete(index);
    },
    type: 'button' as const,
    'aria-label': label,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': openIndex === index,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: () => setOpenIndex(openIndex === index ? null : index),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOpenIndex(index);
      }
    },
  });

  return (
    <nav
      ref={navRef}
      // Only when hiding every middle part is not enough do the parts shrink to fit.
      className={`location-bar${hiddenCount >= maxHidden ? ' squeezed' : ''}`}
      aria-label="Location"
      title={fullPath}
    >
      {controls.map((control, index) => {
        const open = openIndex === index ? ' open' : '';
        switch (control.type) {
          case 'segment':
            return (
              <button
                key={index}
                {...buttonProps(index, control.segment.filtered ? `${control.segment.label}, filtered` : control.segment.label)}
                className={`location-bar-segment${control.last ? ' current' : ''}${control.segment.filtered ? ' filtered' : ''}${open}`}
              >
                {control.segment.filtered && <Filter size={11} aria-hidden="true" />}
                <span className="location-bar-label">{control.segment.label}</span>
                {control.last && <ChevronDown size={12} aria-hidden="true" />}
              </button>
            );
          case 'subfolders':
            return (
              <button
                key={index}
                {...buttonProps(index, `Folders in ${splitPath(control.parent).pop()?.label ?? control.parent}`)}
                className={`location-bar-chevron${open}`}
              >
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            );
          case 'roots':
            return (
              <button key={index} {...buttonProps(index, 'Loaded folders')} className={`location-bar-chevron${open}`}>
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            );
          case 'text':
            return <span key={index} className="location-bar-text">{sessionTitle}</span>;
          case 'ellipsis':
            return (
              <button key={index} {...buttonProps(index, 'Hidden folders')} className={`location-bar-segment${open}`}>
                <span className="location-bar-label">…</span>
              </button>
            );
          default:
            return <Fragment key={index}><ChevronRight size={12} className="location-bar-separator" aria-hidden="true" /></Fragment>;
        }
      })}
      {menu && anchor && (
        <AppMenu
          key={`${openIndex}:${hiddenPick?.path ?? ''}`}
          items={menu.items}
          header={menu.title ? { icon: HEADER_ICONS[menu.kind], title: menu.title, detail: menu.detail } : undefined}
          label={hiddenPick?.label
            ?? (openControl?.type === 'segment' ? openControl.segment.label : buttonRefs.current.get(openIndex!)?.getAttribute('aria-label') ?? '')}
          selection={menu.kind === 'list'}
          scrollable={menu.kind === 'list'}
          emptyText="No folders with videos"
          className="location-menu"
          x={anchor.left}
          y={anchor.bottom + 4}
          onClose={close}
          onSwitch={switchControl}
          // The bar's buttons toggle their menus themselves.
          keepOpenWithin=".location-bar"
        />
      )}
    </nav>
  );
}

/** Width the "…" and the chevron before it take once parts are hidden. */
const ELLIPSIS_WIDTH = 40;

/**
 * How many middle parts to hide so the path fits, from the measured widths of the full path's
 * parts and the chevrons before them; null when they do not add up (nothing measured).
 */
export function partsToHide(nav: HTMLElement, controls: Control[], segments: Segment[], overflow: number): number | null {
  const widths = Array.from(nav.children, (child) => child.getBoundingClientRect().width);
  let freed = -ELLIPSIS_WIDTH;
  let count = 0;
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index];
    if (control.type !== 'segment') continue;
    const segmentIndex = segments.indexOf(control.segment);
    if (segmentIndex < 1 || segmentIndex > segments.length - 2) continue;
    freed += (widths[index] ?? 0) + (widths[index - 1] ?? 0);
    count += 1;
    if (freed >= overflow) return count;
  }
  return null;
}

const HEADER_ICONS = { folder: Folder, video: Film, duplicates: Copy, list: Folder } as const;
