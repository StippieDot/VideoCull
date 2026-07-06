import { useMemo, useState } from 'react';
import useStore from '../store';
import { CircleHelp, FolderOpen, Film, Settings, X } from 'lucide-react';
import type { ToastInput, ToastKind } from '../types';
import { formatKeybind } from '../keybinds';
import { formatRelativeTime, formatRecentPath } from '../utils';
import ContextMenu, { copyTextToClipboard } from './ContextMenu';
import { buildCopyPathSuccessDetail, buildRecentFolderMenu } from './contextMenuBuilders';
import './EmptyState.css';

interface EmptyStateProps {
  onNotify: (toast: ToastInput | string, kind?: ToastKind) => void;
  onOpenDocumentation: () => void;
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export default function EmptyState({ onNotify, onOpenDocumentation }: EmptyStateProps) {
  const setDirectory = useStore((s) => s.setDirectory);
  const includeSubfolders = useStore((s) => s.includeSubfolders);
  const setIncludeSubfolders = useStore((s) => s.setIncludeSubfolders);
  const settings = useStore((s) => s.settings);
  const recentDirectories = settings.recentDirectories;
  const recentDirectoryTimestamps = settings.recentDirectoryTimestamps;
  const clearRecentDirectories = useStore((s) => s.clearRecentDirectories);
  const removeRecentDirectory = useStore((s) => s.removeRecentDirectory);
  const directories = useStore((s) => s.directories);
  const addDirectory = useStore((s) => s.addDirectory);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; dir: string } | null>(null);
  const [unavailableRecents, setUnavailableRecents] = useState<Set<string>>(() => new Set());



  const handleSelect = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setDirectory(dir);
  };

  const handleOpenRecent = async (dir: string) => {
    if (!window.electronAPI) {
      setDirectory(dir);
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
    setDirectory(dir);
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
    if (!contextMenu) return [];
    return buildRecentFolderMenu({
      directory: contextMenu.dir,
      loadedDirectories: directories,
      onOpen: () => {
        void handleOpenRecent(contextMenu.dir);
      },
      onAddToSession: () => {
        void handleAddRecentToSession(contextMenu.dir);
      },
      onReveal: () => {
        void window.electronAPI?.openInExplorer(contextMenu.dir);
      },
      onCopyPath: () => {
        void handleCopyRecentPath(contextMenu.dir);
      },
    });
  }, [contextMenu, directories]);

  return (
    <div className="empty-state">
      <div className="empty-state-actions">
        <button className="settings-icon-btn empty-state-settings-btn" onClick={onOpenDocumentation} title="Open documentation" aria-label="Open documentation">
          <CircleHelp size={20} />
        </button>
        <button className="settings-icon-btn empty-state-settings-btn" onClick={() => useStore.getState().setIsSettingsModalOpen(true)} title="Preferences (Ctrl+,)" aria-label="Open preferences">
          <Settings size={20} />
        </button>
      </div>
      <div className="empty-icon">
        <Film size={56} strokeWidth={1.2} />
      </div>
      <h2 className="empty-title">Video Cull</h2>
      <p className="empty-desc">
        Select a folder to start reviewing your video collection.<br />
        Quickly sort, keep, or delete videos using thumbnails.
      </p>
      <button className="empty-btn" onClick={handleSelect}>
        <FolderOpen size={20} strokeWidth={2.5} />
        Open Directory
      </button>

      <label className="empty-subfolders">
        <input 
          type="checkbox" 
          checked={includeSubfolders}
          onChange={(e) => setIncludeSubfolders(e.target.checked)}
        />
        Include subfolders
      </label>

      {recentDirectories.length > 0 && (
        <div className="empty-recents">
          <div className="empty-recents-header">
            <p className="empty-recents-title">Recent folders</p>
            <button
              className="empty-recents-clear"
              onClick={() => {
                const removedCount = recentDirectories.length;
                clearRecentDirectories();
                onNotify({
                  title: 'Recents cleared',
                  detail: `${removedCount} ${removedCount === 1 ? 'entry' : 'entries'} removed.`,
                  kind: 'info',
                });
              }}
            >
              Clear all
            </button>
          </div>
          <ul className="empty-recents-list">
            {recentDirectories.slice(0, 5).map((dir) => (
              <li key={dir} className="empty-recent-row">
                <button
                  className="empty-recent-item"
                  title={`${dir} \u2022 ${unavailableRecents.has(dir) ? 'unavailable' : `opened ${formatRelativeTime(recentDirectoryTimestamps[dir])}`}`}
                  onClick={() => void handleOpenRecent(dir)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, dir });
                  }}
                >
                  <span className="empty-recent-main">{formatRecentPath(dir)}</span>
                  <span className="empty-recent-meta">
                    {unavailableRecents.has(dir) ? 'Unavailable' : formatRelativeTime(recentDirectoryTimestamps[dir])}
                  </span>
                </button>
                <button
                  className="empty-recent-remove"
                  title={`Remove ${formatRecentPath(dir)} from recent folders`}
                  aria-label={`Remove ${formatRecentPath(dir)} from recent folders`}
                  onClick={() => handleRemoveRecent(dir)}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="empty-shortcuts">
        <span><kbd>{formatKeybind(settings.keyKeep)}</kbd> Keep</span>
        <span><kbd>{formatKeybind(settings.keyDelete)}</kbd> Delete</span>
        <span><kbd>{formatKeybind(settings.keySkip)}</kbd> Skip</span>
        <span><kbd>{formatKeybind(settings.keyUndo)}</kbd> Undo</span>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={recentContextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
