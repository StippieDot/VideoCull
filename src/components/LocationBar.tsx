import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Copy, Film, Folder } from 'lucide-react';
import useStore from '../store';
import type { Video } from '../types';
import { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail } from './contextMenuBuilders';
import {
  buildDuplicatesMenu,
  buildFolderMenu,
  buildVideoMenu,
  collapseSegments,
  splitPath,
  type LocationActions,
  type LocationMenu,
  type LocationMenuAction,
  type LocationMenuItem,
  type PathSegment,
} from './locationMenus';
import './LocationBar.css';

/** What only the app shell can do; LocationBar does the rest itself. */
export interface LocationBarAppActions {
  reviewFolder: (folder: string) => void;
  regenerateThumbnails: (videos: Video[]) => void;
  findDuplicates: () => void;
  openDuplicateSettings: () => void;
}

type Segment = PathSegment & { kind: 'folder' | 'video' | 'duplicates' };

function isInsideAny(folder: string, roots: string[]): boolean {
  const target = folder.toLowerCase();
  return roots.some((root) => {
    const base = root.replace(/[\\/]+$/, '').toLowerCase();
    return target === base || target.startsWith(`${base}\\`) || target.startsWith(`${base}/`);
  });
}

/** The title bar's location: the grid folder on screen, the video in review, or the duplicate groups. */
function useSegments(): Segment[] | null {
  const reviewMode = useStore((s) => s.reviewMode);
  const duplicateGroupsMode = useStore((s) => s.duplicateGroupsMode);
  const duplicateGroupCount = useStore((s) => s.duplicateGroups.length);
  const reviewPath = useStore((s) => s.activeReviewVideoPath);
  const gridTopFolder = useStore((s) => s.gridTopFolder);
  const folderFilterPath = useStore((s) => s.folderFilterPath);
  const directories = useStore((s) => s.directories);

  return useMemo(() => {
    if (directories.length === 0) return null;
    if (duplicateGroupsMode) {
      const label = `Duplicates · ${duplicateGroupCount.toLocaleString()} ${duplicateGroupCount === 1 ? 'group' : 'groups'}`;
      return [{ kind: 'duplicates', label, path: 'duplicates' }];
    }
    if (reviewMode && reviewPath) {
      const segments = splitPath(reviewPath);
      return segments.map((segment, index) => ({ ...segment, kind: index === segments.length - 1 ? 'video' : 'folder' }));
    }
    const folder = (gridTopFolder && isInsideAny(gridTopFolder, directories) ? gridTopFolder : null)
      ?? folderFilterPath
      ?? (directories.length === 1 ? directories[0] : null);
    return folder ? splitPath(folder).map((segment) => ({ ...segment, kind: 'folder' })) : null;
  }, [directories, duplicateGroupCount, duplicateGroupsMode, folderFilterPath, gridTopFolder, reviewMode, reviewPath]);
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
      showOnlyFolder: (folder) => store().setFolderFilterPath(folder),
      regenerateThumbnails: (videos) => appRef.current.regenerateThumbnails(videos),
      reveal: (path) => void window.electronAPI?.openInExplorer(path),
      copyPath: (path) => {
        copyTextToClipboard(path).then(
          () => store().pushToast({ title: 'Path copied', detail: buildCopyPathSuccessDetail(path), kind: 'success' }),
          () => store().pushToast({ title: 'Copy failed', detail: 'The path could not be copied to the clipboard.', kind: 'error' }),
        );
      },
      playExternally: (path) => void window.electronAPI?.openVideo(path),
      goToFolder: (folder) => store().requestGridFolderJump(folder),
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

function buildMenu(segment: Segment, actions: LocationActions): LocationMenu | null {
  const state = useStore.getState();
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
    folderFilterPath: state.folderFilterPath,
    canNarrowReview,
  }, actions);
}

/**
 * Centre of the title bar: a breadcrumb of what is on screen. Each part opens a menu with what can
 * be done there, drawn by the app (not a native popup) so it can show a header and counts.
 */
export default function LocationBar({ sessionTitle, appActions }: { sessionTitle: string; appActions: LocationBarAppActions }) {
  const segments = useSegments();
  const actions = useLocationActions(appActions);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());
  const visible = useMemo(() => (segments ? collapseSegments(segments) : []), [segments]);

  // The location can change under an open menu (grid scrolled, next video); close it then.
  useEffect(() => setOpenIndex(null), [segments]);

  const close = useCallback((refocus: boolean) => {
    setOpenIndex((index) => {
      if (refocus && index !== null) buttonRefs.current.get(index)?.focus();
      return null;
    });
  }, []);

  const switchSegment = useCallback((direction: -1 | 1) => {
    setOpenIndex((index) => {
      if (index === null) return index;
      for (let next = index + direction; next >= 0 && next < visible.length; next += direction) {
        if (visible[next]) return next;
      }
      return index;
    });
  }, [visible]);

  if (!segments) return <div className="title-bar-title">{sessionTitle}</div>;

  const lastSegment = segments[segments.length - 1];
  const fullPath = lastSegment?.kind === 'duplicates' ? undefined : lastSegment?.path;
  const openSegment = openIndex !== null ? visible[openIndex] : null;
  const menu = openSegment ? buildMenu(openSegment, actions) : null;
  const anchor = openIndex !== null ? buttonRefs.current.get(openIndex)?.getBoundingClientRect() : undefined;

  return (
    <nav className="location-bar" aria-label="Location" title={fullPath}>
      {visible.map((segment, index) => {
        const last = index === visible.length - 1;
        return (
          <Fragment key={segment?.path ?? 'collapsed'}>
            {index > 0 && <ChevronRight size={12} className="location-bar-separator" aria-hidden="true" />}
            {segment ? (
              <button
                ref={(element) => {
                  if (element) buttonRefs.current.set(index, element);
                  else buttonRefs.current.delete(index);
                }}
                type="button"
                className={`location-bar-segment${last ? ' current' : ''}${openIndex === index ? ' open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={openIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setOpenIndex(index);
                  }
                }}
              >
                <span className="location-bar-label">{segment.label}</span>
                {last && <ChevronDown size={12} aria-hidden="true" />}
              </button>
            ) : (
              <span className="location-bar-ellipsis">…</span>
            )}
          </Fragment>
        );
      })}
      {menu && anchor && (
        <LocationMenuPopup
          key={openIndex}
          menu={menu}
          left={anchor.left}
          top={anchor.bottom + 4}
          onClose={close}
          onSwitchSegment={switchSegment}
        />
      )}
    </nav>
  );
}

const HEADER_ICONS = { folder: Folder, video: Film, duplicates: Copy } as const;
const VIEWPORT_GUTTER = 8;

type FocusTarget = { index: number; subIndex: number | null };

function focusableIndexes(items: LocationMenuItem[]): number[] {
  return items.flatMap((item, index) => (item.type === 'separator' ? [] : [index]));
}

function stepIndex(list: number[], current: number, delta: number): number {
  const position = list.indexOf(current);
  return list[(position + delta + list.length) % list.length] ?? current;
}

export function LocationMenuPopup({ menu, left, top, onClose, onSwitchSegment }: {
  menu: LocationMenu;
  left: number;
  top: number;
  onClose: (refocus: boolean) => void;
  onSwitchSegment: (direction: -1 | 1) => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusable = useMemo(() => focusableIndexes(menu.items), [menu.items]);
  const [focus, setFocus] = useState<FocusTarget>({ index: focusable[0] ?? 0, subIndex: null });
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const [position, setPosition] = useState({ left, top });

  useLayoutEffect(() => {
    const rect = popupRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(VIEWPORT_GUTTER, Math.min(left, window.innerWidth - rect.width - VIEWPORT_GUTTER)), top });
  }, [left, top]);

  useEffect(() => {
    const element = itemRefs.current.get(`${focus.index}:${focus.subIndex ?? ''}`);
    element?.focus();
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [focus, submenuIndex]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      // Segment buttons toggle the menu themselves.
      if (popupRef.current?.contains(target) || target.closest?.('.location-bar')) return;
      onClose(false);
    };
    const handleBlur = () => onClose(false);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('resize', handleBlur);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleBlur);
    };
  }, [onClose]);

  const run = (item: LocationMenuAction) => {
    onClose(false);
    item.onSelect();
  };

  const openSubmenu = (index: number) => {
    const item = menu.items[index];
    if (item?.type !== 'submenu' || item.items.length === 0) return;
    setSubmenuIndex(index);
    setFocus({ index, subIndex: Math.max(0, item.items.findIndex((entry) => entry.current)) });
  };

  const closeSubmenu = () => {
    setSubmenuIndex(null);
    setFocus({ index: focus.index, subIndex: null });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const item = menu.items[focus.index];
    const submenu = item?.type === 'submenu' && focus.subIndex !== null ? item.items : null;
    const moveSub = (delta: number) => setFocus({
      index: focus.index,
      subIndex: submenu ? ((focus.subIndex ?? 0) + delta + submenu.length) % submenu.length : null,
    });
    const keys: Record<string, () => void> = {
      ArrowDown: () => (submenu ? moveSub(1) : setFocus({ index: stepIndex(focusable, focus.index, 1), subIndex: null })),
      ArrowUp: () => (submenu ? moveSub(-1) : setFocus({ index: stepIndex(focusable, focus.index, -1), subIndex: null })),
      Home: () => setFocus(submenu ? { index: focus.index, subIndex: 0 } : { index: focusable[0], subIndex: null }),
      End: () => setFocus(submenu
        ? { index: focus.index, subIndex: submenu.length - 1 }
        : { index: focusable[focusable.length - 1], subIndex: null }),
      ArrowRight: () => (item?.type === 'submenu' && !submenu ? openSubmenu(focus.index) : onSwitchSegment(1)),
      ArrowLeft: () => (submenu ? closeSubmenu() : onSwitchSegment(-1)),
      Escape: () => (submenu ? closeSubmenu() : onClose(true)),
      Tab: () => onClose(false),
    };
    const handler = keys[event.key];
    if (!handler) return;
    if (event.key !== 'Tab') event.preventDefault();
    event.stopPropagation();
    handler();
  };

  const HeaderIcon = HEADER_ICONS[menu.kind];
  const itemRef = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) itemRefs.current.set(key, element);
    else itemRefs.current.delete(key);
  };

  return createPortal(
    <div
      ref={popupRef}
      className="app-context-menu location-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={menu.title}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="location-menu-header">
        <HeaderIcon size={16} aria-hidden="true" />
        <div className="location-menu-header-text">
          <div className="location-menu-title">{menu.title}</div>
          <div className="location-menu-detail">{menu.detail}</div>
        </div>
      </div>
      {menu.items.map((item, index) => {
        if (item.type === 'separator') return <div key={item.key} className="app-context-menu-separator" role="separator" />;
        const Icon = item.icon;
        if (item.type === 'submenu') {
          const open = submenuIndex === index;
          return (
            <div key={item.key} className="location-menu-submenu-anchor" onMouseEnter={() => openSubmenu(index)} onMouseLeave={() => setSubmenuIndex(null)}>
              <button
                ref={itemRef(`${index}:`)}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                className="app-context-menu-item location-menu-item"
                onClick={() => openSubmenu(index)}
              >
                <span className="location-menu-icon">{Icon && <Icon size={14} />}</span>
                <span className="location-menu-label">{item.label}</span>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
              {open && (
                <div className="app-context-menu location-menu location-menu-submenu" role="menu" aria-label={item.label}>
                  {item.items.map((entry, subIndex) => (
                    <button
                      key={entry.key}
                      ref={itemRef(`${index}:${subIndex}`)}
                      type="button"
                      role="menuitemradio"
                      aria-checked={Boolean(entry.current)}
                      className="app-context-menu-item location-menu-item"
                      onClick={() => run(entry)}
                    >
                      <span className="location-menu-icon">{entry.current && <Check size={14} />}</span>
                      <span className="location-menu-label">{entry.label}</span>
                      {entry.detail && <span className="location-menu-item-detail">{entry.detail}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={item.key}
            ref={itemRef(`${index}:`)}
            type="button"
            role="menuitem"
            className="app-context-menu-item location-menu-item"
            onMouseEnter={() => setSubmenuIndex(null)}
            onClick={() => run(item)}
          >
            <span className="location-menu-icon">{Icon && <Icon size={14} />}</span>
            <span className="location-menu-label">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
