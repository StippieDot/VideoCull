import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import useStore, { videosOutsideFolderFilter } from '../store';
import type { AppCommand, Video } from '../types';
import { runAppCommand } from '../appCommands';
import { getFolderLabel, isFolderShownByFilter } from '../utils';
import { listGridFolders, type FolderEntry } from './locationMenus';
import './CommandPalette.css';

type Source = 'commands' | 'folders' | 'videos';
const PREFIXES: Record<string, Source> = { '>': 'commands', '/': 'folders', '@': 'videos' };
const SECTION_TITLES: Record<Source, string> = { commands: 'Commands', folders: 'Folders', videos: 'Videos' };
/** Without a prefix every source shows only its best few. */
const SECTION_LIMIT = 5;
const VIDEO_LIMIT = 100;
const RECENT_LIMIT = 20;
/** Picks this session, newest first, as `kind:id`; they rank first in every source. */
let recentPicks: string[] = [];

/** Electron accelerator text as people know it: "CmdOrCtrl+Plus" becomes "Ctrl++". */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl')
    .replace(/Plus/g, '+')
    .replace(/Escape/g, 'Esc')
    .replace(/Comma/g, ',');
}

/** A leading `>`, `/` or `@` narrows the search to commands, folders or videos. */
export function parseQuery(query: string): { source: Source | null; text: string; words: string[] } {
  const source = PREFIXES[query[0]] ?? null;
  const text = (source ? query.slice(1) : query).trim();
  return { source, text, words: text.toLowerCase().split(/\s+/).filter(Boolean) };
}

const matches = (text: string, words: string[]) => words.every((word) => text.includes(word));

function byRecent<T>(items: T[], key: (item: T) => string, recent: string[]): T[] {
  if (recent.length === 0) return items;
  const rank = (item: T) => {
    const index = recent.indexOf(key(item));
    return index < 0 ? recent.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** Every query word must appear somewhere in the command's menu path. */
export function filterCommands(commands: AppCommand[], query: string): AppCommand[] {
  const { words } = parseQuery(query);
  return commands.filter((command) => matches(command.path.join(' ').toLowerCase(), words));
}

/** Every query word must appear in the folder's path. Empty: recent picks, then most left to review. */
export function rankFolders(folders: FolderEntry[], words: string[], recent: string[]): FolderEntry[] {
  const found = words.length > 0
    ? folders.filter((folder) => matches(folder.label.toLowerCase(), words))
    : [...folders].sort((a, b) => b.toReview - a.toReview);
  return byRecent(found, (folder) => `folder:${folder.path}`, recent);
}

function findVideos(videos: Video[], words: string[], limit: number): Video[] {
  if (words.length === 0) return [];
  const found: Video[] = [];
  for (const video of videos) {
    if (!matches(video.path.toLowerCase(), words)) continue;
    found.push(video);
    if (found.length >= limit) break;
  }
  return byRecent(found, (video) => `video:${video.id}`, recentPicks);
}

interface Row {
  key: string;
  section: string;
  label: string;
  parent?: string;
  detail?: string;
  checked?: boolean;
  disabled?: boolean;
  muted?: boolean;
  hint: string;
  run: (modifiers: { shift: boolean; ctrl: boolean }) => void;
}

function remember(key: string) {
  recentPicks = [key, ...recentPicks.filter((entry) => entry !== key)].slice(0, RECENT_LIMIT);
}

function leaveToGrid() {
  const state = useStore.getState();
  if (state.reviewMode) state.setReviewMode(false);
  if (state.duplicateGroupsMode) state.setDuplicateGroupsMode(false);
}

const splitLabel = (label: string) => label.split(/\s*[\\/]\s*/);

/** The menu's commands, fetched once when the palette opens. */
function useCommands(): AppCommand[] {
  const [commands, setCommands] = useState<AppCommand[]>([]);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.getCommands().then((list) => {
      if (!cancelled) setCommands(list);
    }, (err) => {
      console.warn('[app] Failed to load the command list:', err);
      useStore.getState().pushToast({ title: 'Commands unavailable', detail: 'The command list could not be loaded.', kind: 'error', dedupeKey: 'command-list-failed' });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return commands;
}

interface PaletteSources {
  commands: AppCommand[];
  folders: ReturnType<typeof listGridFolders>;
  videos: Video[];
  directories: string[];
}

/** The rows for a query: menu commands, folders and videos, each section limited unless it was asked for. */
function buildRows(query: string, { commands, folders, videos, directories }: PaletteSources, onClose: () => void): Row[] {
  const { source, text, words } = parseQuery(query);
  const limit = (max: number) => (source ? max : SECTION_LIMIT);
  const result: Row[] = [];
  if (!source || source === 'commands') {
    const found = byRecent(filterCommands(commands, text), (command) => `command:${command.id}`, recentPicks);
    for (const command of found.slice(0, limit(Infinity))) {
      result.push({
        key: `command:${command.id}`,
        section: SECTION_TITLES.commands,
        label: command.path[command.path.length - 1],
        parent: command.path.slice(0, -1).join(' › '),
        detail: command.accelerator ? formatAccelerator(command.accelerator) : undefined,
        checked: command.checked === true,
        disabled: !command.enabled,
        hint: 'Enter to run',
        run: () => {
          // Close first: many commands open a dialog of their own.
          onClose();
          void runAppCommand(command.id);
        },
      });
    }
  }
  if (!source || source === 'folders') {
    for (const folder of rankFolders(folders, words, recentPicks).slice(0, limit(Infinity))) {
      const parts = splitLabel(folder.label);
      result.push({
        key: `folder:${folder.path}`,
        section: SECTION_TITLES.folders,
        label: parts[parts.length - 1],
        parent: parts.slice(0, -1).join(' › '),
        detail: folder.toReview > 0
          ? `${folder.toReview.toLocaleString()} to review`
          : `${folder.count.toLocaleString()} ${folder.count === 1 ? 'video' : 'videos'}`,
        muted: folder.toReview === 0,
        hint: 'Enter to go to the folder · Shift+Enter to filter to it',
        run: ({ shift }) => {
          onClose();
          leaveToGrid();
          const state = useStore.getState();
          if (shift) state.setFolderFilter({ path: folder.path, includeSubfolders: true });
          else if (!isFolderShownByFilter(folder.path, state.folderFilter)) state.setFolderFilter(null);
          state.requestGridFolderJump(folder.path);
        },
      });
    }
  }
  if (!source || source === 'videos') {
    for (const video of findVideos(videos, words, limit(VIDEO_LIMIT))) {
      result.push({
        key: `video:${video.id}`,
        section: SECTION_TITLES.videos,
        label: video.filename,
        parent: splitLabel(getFolderLabel(video, directories)).join(' › '),
        hint: 'Enter to select it in the grid · Ctrl+Enter to review it',
        run: ({ ctrl }) => {
          onClose();
          const state = useStore.getState();
          if (!ctrl) {
            leaveToGrid();
            state.requestGridVideoJump(video.id);
            return;
          }
          if (state.duplicateGroupsMode) state.setDuplicateGroupsMode(false);
          state.enterReviewAndPlay(video.id);
        },
      });
    }
    if (text) {
      result.push({
        key: 'search',
        section: '',
        label: `Search videos for “${text}”`,
        hint: 'Enter to search the grid',
        run: () => {
          onClose();
          leaveToGrid();
          useStore.getState().setSearchQuery(text);
        },
      });
    }
  }
  return result;
}

/** Find and run any menu command, go to a folder or find a video (Ctrl+K; Ctrl+G starts with `/`). */
export default function CommandPalette({ onClose, initialQuery = '' }: { onClose: () => void; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const { folders, videos, directories } = useMemo(() => {
    const state = useStore.getState();
    return {
      folders: listGridFolders(videosOutsideFolderFilter(state), state.directories),
      videos: state.filteredVideos,
      directories: state.directories,
    };
  }, []);

  const commands = useCommands();

  const rows = useMemo(
    () => buildRows(query, { commands, folders, videos, directories }, onClose),
    [commands, directories, folders, onClose, query, videos],
  );

  const safeIndex = Math.min(activeIndex, Math.max(0, rows.length - 1));
  const activeRow = rows[safeIndex];

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const run = (row: Row | undefined, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!row || row.disabled) return;
    if (row.key !== 'search') remember(row.key);
    row.run(modifiers);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((rows.length + safeIndex + step) % Math.max(1, rows.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(activeRow, { shift: event.shiftKey, ctrl: event.ctrlKey });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-label="Quick open" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-search">
          <Search size={15} />
          <input
            autoFocus
            value={query}
            placeholder="Search commands, folders and videos"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={activeRow ? `command-palette-${safeIndex}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ul className="command-palette-results" id="command-palette-results" role="listbox" ref={listRef}>
          {rows.length === 0 && <li className="command-palette-empty">No matches</li>}
          {rows.map((row, index) => (
            <li key={row.key} role="presentation">
              {row.section && row.section !== rows[index - 1]?.section && (
                <div className="command-palette-section" aria-hidden="true">{row.section}</div>
              )}
              <div
                id={`command-palette-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === safeIndex}
                aria-disabled={row.disabled || undefined}
                className={`command-palette-item${index === safeIndex ? ' active' : ''}${row.disabled || row.muted ? ' disabled' : ''}`}
                onMouseMove={() => setActiveIndex(index)}
                onClick={(event) => run(row, { shift: event.shiftKey, ctrl: event.ctrlKey })}
              >
                <span className="command-palette-check">{row.checked && <Check size={13} />}</span>
                <span className="command-palette-label">
                  {row.parent && <span className="command-palette-parent">{row.parent} › </span>}
                  {row.label}
                </span>
                {row.detail && <kbd>{row.detail}</kbd>}
              </div>
            </li>
          ))}
        </ul>
        <div className="command-palette-footer">
          {(query.trim() && activeRow?.hint) || 'Type > for commands, / for folders, @ for videos'}
        </div>
      </div>
    </div>
  );
}
