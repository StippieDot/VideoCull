import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderTree } from 'lucide-react';
import useStore from '../store';
import { listGridFolders, type FolderEntry } from './locationMenus';
import './CommandPalette.css';

const RECENT_LIMIT = 5;
/** Folders jumped to this session, newest first; shown before anything is typed. */
let recentFolders: string[] = [];

/** Every query word must appear in the folder's path. Empty: recent jumps, then most left to review. */
export function rankFolders(folders: FolderEntry[], query: string, recent: string[]): FolderEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return folders.filter((folder) => words.every((word) => folder.label.toLowerCase().includes(word)));
  }
  const recentRank = (folder: FolderEntry) => {
    const index = recent.indexOf(folder.path);
    return index < 0 ? recent.length : index;
  };
  return [...folders].sort((a, b) => recentRank(a) - recentRank(b) || b.toReview - a.toReview);
}

/** Jump the grid to any of its folders by typing part of the path (Ctrl+G). */
export default function FolderSearch({ onClose }: { onClose: () => void }) {
  const folders = useMemo(() => {
    const state = useStore.getState();
    return listGridFolders(state.filteredVideos, state.directories);
  }, []);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => rankFolders(folders, query, recentFolders), [folders, query]);
  const safeIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const go = (folder: FolderEntry | undefined) => {
    if (!folder) return;
    onClose();
    recentFolders = [folder.path, ...recentFolders.filter((path) => path !== folder.path)].slice(0, RECENT_LIMIT);
    const state = useStore.getState();
    if (state.reviewMode) state.setReviewMode(false);
    if (state.duplicateGroupsMode) state.setDuplicateGroupsMode(false);
    state.requestGridFolderJump(folder.path);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((results.length + safeIndex + step) % Math.max(1, results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[safeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-label="Go to folder" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-search">
          <FolderTree size={15} />
          <input
            autoFocus
            value={query}
            placeholder={`Go to folder (${folders.length.toLocaleString()} folders)`}
            role="combobox"
            aria-expanded="true"
            aria-controls="folder-search-results"
            aria-activedescendant={results[safeIndex] ? `folder-${safeIndex}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ul className="command-palette-results" id="folder-search-results" role="listbox" ref={listRef}>
          {results.length === 0 && <li className="command-palette-empty">No matching folders</li>}
          {results.map((folder, index) => {
            const parts = folder.label.split(/\s*[\\/]\s*/);
            return (
              <li
                key={folder.path}
                id={`folder-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === safeIndex}
                className={`command-palette-item${index === safeIndex ? ' active' : ''}${folder.toReview === 0 ? ' disabled' : ''}`}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => go(folder)}
              >
                <span className="command-palette-label">
                  {parts.length > 1 && <span className="command-palette-parent">{parts.slice(0, -1).join(' › ')} › </span>}
                  {parts[parts.length - 1]}
                </span>
                <kbd>
                  {folder.toReview > 0
                    ? `${folder.toReview.toLocaleString()} to review`
                    : `${folder.count.toLocaleString()} ${folder.count === 1 ? 'video' : 'videos'}`}
                </kbd>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
