import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Film, Filter, Folder, X } from 'lucide-react';
import useStore, { DUPLICATE_METHOD_NAMES, otherDuplicateMethod, videosOutsideFolderFilter } from '../store';
import type { FolderFilter, Video } from '../types';
import { isFolderInside, normalizeFolder } from '../utils';
import AppMenu from './AppMenu';
import { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail } from './contextMenuBuilders';
import DuplicateStepper from './DuplicateStepper';
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
  switchDuplicateMethod: () => void;
  openDuplicateSettings: () => void;
  openFolderSearch: () => void;
  openRecent: (folder: string) => void;
}

type Segment = PathSegment & {
  kind: 'folder' | 'video' | 'duplicates';
  /** The folder the grid is filtered to: drawn as a chip with a clear button. */
  filtered?: boolean;
  /** Below the loaded or filtered folder: only where the grid is scrolled to, not a filter. */
  position?: boolean;
};

/**
 * The bar's parts in order. In the grid the path is the loaded or filtered folder, then (in grey)
 * the folder the grid is scrolled to. As in Explorer's address bar, selecting a folder filters the
 * grid to it, each `›` lists the folders one level down, and with several loaded folders a leading
 * button picks one; the ▾ after the last part (or right-click) opens what can be done there. In
 * Review and duplicate groups, a part opens its menu directly.
 */
type Control =
  | { type: 'segment'; segment: Segment; last: boolean }
  /** The ▾ after the last part in the grid: that folder's menu. */
  | { type: 'actions'; segment: Segment }
  | { type: 'subfolders'; parent: string }
  | { type: 'roots' }
  /** Several loaded folders and no folder chosen: the session's name. */
  | { type: 'text' }
  /** The middle of a long path; opens a list of the folders it hides. */
  | { type: 'ellipsis'; hidden: Segment[] }
  | { type: 'separator' };

const INTERACTIVE = new Set<Control['type']>(['segment', 'actions', 'subfolders', 'roots', 'ellipsis']);

interface Location {
  segments: Segment[];
  /** Grid: parts filter and the `›` lists browse folders. Review and duplicates show a plain path. */
  browsable: boolean;
  filter: FolderFilter | null;
}

/** Where the open video is in the videos being reviewed. */
function ReviewCount() {
  const position = useStore((s) => s.reviewPosition);
  if (!position) return null;
  return <span className="location-bar-count">{(position.index + 1).toLocaleString()} / {position.total.toLocaleString()}</span>;
}

/** The title bar's location: the folder at the top of the grid, the video in review, or the duplicate groups. */
function useLocation(): Location | null {
  const reviewMode = useStore((s) => s.reviewMode);
  const duplicateGroupsMode = useStore((s) => s.duplicateGroupsMode);
  const reviewPath = useStore((s) => s.activeReviewVideoPath);
  const filter = useStore((s) => s.folderFilter);
  const filterPath = filter?.path ?? null;
  const gridTopFolder = useStore((s) => s.gridTopFolder);
  const directories = useStore((s) => s.directories);

  return useMemo(() => {
    if (directories.length === 0) return null;
    // Playing a video from a duplicate group keeps the duplicate list open underneath, so Review goes first.
    if (!(reviewMode && reviewPath) && duplicateGroupsMode) {
      return { segments: [{ kind: 'duplicates', label: 'Duplicates', path: 'duplicates' }], browsable: false, filter: null };
    }
    if (reviewMode && reviewPath) {
      const parts = splitPath(reviewPath);
      return {
        segments: parts.map((segment, index) => ({ ...segment, kind: index === parts.length - 1 ? 'video' : 'folder' })),
        browsable: false,
        filter: null,
      };
    }
    // The top folder lags a render behind a filter change, so it only counts once inside the filter.
    const topFolder = gridTopFolder && (filterPath
      ? isFolderInside(gridTopFolder, filterPath)
      : directories.some((root) => isFolderInside(gridTopFolder, root))) ? gridTopFolder : null;
    const folder = topFolder ?? filterPath ?? (directories.length === 1 ? directories[0] : null);
    if (!folder) return { segments: [], browsable: true, filter };
    const filterKey = filterPath && normalizeFolder(filterPath);
    const scopeFolder = filterPath ?? directories.find((root) => isFolderInside(folder, root)) ?? folder;
    const scopeLength = splitPath(scopeFolder).length;
    return {
      segments: splitPath(folder).map((segment, index) => ({
        ...segment,
        kind: 'folder',
        filtered: normalizeFolder(segment.path) === filterKey,
        position: index >= scopeLength,
      })),
      browsable: true,
      filter,
    };
  }, [directories, duplicateGroupsMode, gridTopFolder, filter, filterPath, reviewMode, reviewPath]);
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
    const last = fullIndex === segments.length - 1;
    controls.push({ type: 'segment', segment, last });
    if (browsable && last) controls.push({ type: 'actions', segment });
  });
  if (browsable && lastHasSubfolders) {
    controls.push({ type: 'subfolders', parent: segments[segments.length - 1].path });
  }
  return controls;
}

/**
 * Back and forward through the folder filters chosen in the path (Alt+Left / Alt+Right), like a
 * browser. Only choices made here count, not Review This Folder; it starts over with each session.
 */
function useFilterHistory() {
  const directories = useStore((s) => s.directories);
  const history = useRef<{ back: Array<FolderFilter | null>; forward: Array<FolderFilter | null> }>({ back: [], forward: [] });
  useEffect(() => {
    history.current = { back: [], forward: [] };
  }, [directories]);
  return useMemo(() => {
    const setFilter = (filter: FolderFilter | null) => {
      const state = useStore.getState();
      state.setFolderFilter(filter);
      // Otherwise the grid keeps the old scroll offset and lands somewhere inside the new folder.
      if (filter) state.requestGridFolderJump(filter.path);
    };
    return {
      navigate: (filter: FolderFilter | null) => {
        const current = useStore.getState().folderFilter;
        if (current?.path === filter?.path && current?.includeSubfolders === filter?.includeSubfolders) return;
        history.current = { back: [...history.current.back, current], forward: [] };
        setFilter(filter);
      },
      step: (direction: -1 | 1) => {
        const { back, forward } = history.current;
        const from = direction === -1 ? back : forward;
        if (from.length === 0) return;
        const target = from[from.length - 1];
        const current = useStore.getState().folderFilter;
        history.current = direction === -1
          ? { back: back.slice(0, -1), forward: [...forward, current] }
          : { back: [...back, current], forward: forward.slice(0, -1) };
        setFilter(target);
      },
    };
  }, []);
}

function useLocationActions(app: LocationBarAppActions, navigate: (filter: FolderFilter | null) => void): LocationActions {
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
      filterToPath: (folder) => navigate(folder ? { path: folder, includeSubfolders: true } : null),
      setIncludeSubfolders: (includeSubfolders) => {
        const filter = store().folderFilter;
        if (filter) navigate({ ...filter, includeSubfolders });
      },
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
      openRecent: (folder) => appRef.current.openRecent(folder),
      showFolderInGrid: (folder) => {
        store().setReviewMode(false);
        store().requestGridFolderJump(folder);
      },
      findDuplicates: () => appRef.current.findDuplicates(),
      switchDuplicateMethod: () => appRef.current.switchDuplicateMethod(),
      openDuplicateSettings: () => appRef.current.openDuplicateSettings(),
      backToGrid: () => store().setDuplicateGroupsMode(false),
      goToGroup: () => document.querySelector<HTMLInputElement>('.duplicate-stepper-input')?.focus(),
    };
  }, [navigate]);
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
  if (control.type === 'roots') return buildRootsMenu(videosOutsideFolderFilter(state), scope, state.settings.recentDirectories ?? [], actions);
  if (control.type === 'subfolders') return buildSubfolderMenu(videosOutsideFolderFilter(state), control.parent, scope, actions);
  if (control.type !== 'segment' && control.type !== 'actions') return null;
  const { segment } = control;
  if (segment.kind === 'duplicates') return buildDuplicatesMenu(state.duplicateGroups, state.videos, DUPLICATE_METHOD_NAMES[otherDuplicateMethod(state)], actions);
  const canNarrowReview = !state.duplicateGroupsMode;
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
    filter: state.folderFilter,
  }, actions);
}

/**
 * Centre of the title bar: a breadcrumb of what is on screen. Each part opens a menu with what can
 * be done there, drawn by the app (not a native popup) so it can show a header and counts.
 */
export default function LocationBar({ sessionTitle, appActions }: { sessionTitle: string; appActions: LocationBarAppActions }) {
  const location = useLocation();
  const filterHistory = useFilterHistory();
  const navRef = useRef<HTMLElement>(null);
  const actions = useLocationActions(appActions, filterHistory.navigate);
  const browsable = location?.browsable ?? false;
  // Ctrl+L focuses the path, as the address bar in Explorer or a browser; Alt+Left / Alt+Right step
  // back and forward through the folder filters chosen in it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { target } = event;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
        const buttons = navRef.current?.querySelectorAll<HTMLButtonElement>('.location-bar-segment');
        const lastButton = buttons?.[buttons.length - 1];
        if (!lastButton) return;
        event.preventDefault();
        lastButton.focus();
      } else if (browsable && event.altKey && !event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        filterHistory.step(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [browsable, filterHistory]);
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

  const toggleMenu = (index: number) => setOpenIndex(openIndex === index ? null : index);
  const focusControl = (index: number, direction: -1 | 1) => {
    for (let next = index + direction; next >= 0 && next < controls.length; next += direction) {
      const button = buttonRefs.current.get(next);
      if (button) {
        button.focus();
        return;
      }
    }
  };
  /** `onActivate` replaces opening the menu on click; the menu then opens from the keyboard and right-click. */
  const buttonProps = (index: number, label: string, onActivate?: () => void) => ({
    ref: (element: HTMLButtonElement | null) => {
      if (element) buttonRefs.current.set(index, element);
      else buttonRefs.current.delete(index);
    },
    type: 'button' as const,
    'aria-label': label,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': openIndex === index,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: onActivate ?? (() => toggleMenu(index)),
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      setOpenIndex(index);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        setOpenIndex(index);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        focusControl(index, event.key === 'ArrowLeft' ? -1 : 1);
      }
    },
  });
  const filterTo = (segment: Segment, index: number) => {
    const { directories, folderFilter } = useStore.getState();
    // A folder that holds every loaded folder is the same as no filter.
    const all = directories.every((root) => isFolderInside(root, segment.path));
    // Nothing to filter, so the click opens the menu like any other part.
    if (all && !folderFilter) {
      toggleMenu(index);
      return;
    }
    filterHistory.navigate(all ? null : { path: segment.path, includeSubfolders: folderFilter?.path === segment.path ? folderFilter.includeSubfolders : true });
  };

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
          case 'segment': {
            const { segment, last } = control;
            const browsing = location.browsable && segment.kind === 'folder';
            const only = segment.filtered && location.filter?.includeSubfolders === false;
            const name = segment.filtered ? `${segment.label}, filtered${only ? ', this folder only' : ''}` : segment.label;
            const button = (
              <button
                key={index}
                {...buttonProps(index, name, browsing && !segment.filtered ? () => filterTo(segment, index) : undefined)}
                className={`location-bar-segment${last ? ' current' : ''}${segment.position ? ' position' : ''}${open}`}
                title={segment.position ? `Scrolled to: ${segment.path}` : undefined}
              >
                {segment.filtered && <Filter size={11} aria-hidden="true" />}
                <span className="location-bar-label">{segment.label}</span>
                {only && <span className="location-bar-only">only</span>}
                {segment.kind === 'video' && <ReviewCount />}
                {last && !location.browsable && <ChevronDown size={12} aria-hidden="true" />}
              </button>
            );
            if (segment.kind === 'duplicates') {
              return (
                <span key={index} className="location-bar-duplicates">
                  {button}
                  <DuplicateStepper />
                </span>
              );
            }
            if (!segment.filtered) return button;
            return (
              <span key={index} className="location-bar-chip">
                {button}
                <button
                  type="button"
                  className="location-bar-chip-clear"
                  aria-label="Clear folder filter"
                  title="Clear folder filter"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => filterHistory.navigate(null)}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            );
          }
          case 'actions':
            return (
              <button key={index} {...buttonProps(index, `${control.segment.label} actions`)} className={`location-bar-chevron location-bar-actions${open}`}>
                <ChevronDown size={12} aria-hidden="true" />
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
