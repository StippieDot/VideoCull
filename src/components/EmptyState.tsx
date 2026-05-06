import useStore from '../store';
import { FolderOpen, Film, Settings, X } from 'lucide-react';
import type { ToastInput, ToastKind } from '../types';
import { formatKeybind } from '../keybinds';
import { formatRelativeTime, formatRecentPath } from '../utils';
import './EmptyState.css';

interface EmptyStateProps {
  onNotify: (toast: ToastInput | string, kind?: ToastKind) => void;
}

export default function EmptyState({ onNotify }: EmptyStateProps) {
  const setDirectory = useStore((s) => s.setDirectory);
  const includeSubfolders = useStore((s) => s.includeSubfolders);
  const setIncludeSubfolders = useStore((s) => s.setIncludeSubfolders);
  const settings = useStore((s) => s.settings);
  const recentDirectories = settings.recentDirectories;
  const recentDirectoryTimestamps = settings.recentDirectoryTimestamps;
  const clearRecentDirectories = useStore((s) => s.clearRecentDirectories);
  const removeRecentDirectory = useStore((s) => s.removeRecentDirectory);



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
      removeRecentDirectory(dir);
      onNotify({
        title: 'Recent unavailable',
        detail: formatRecentPath(dir),
        kind: 'error',
        dedupeKey: `recent-unavailable:${dir}`,
      });
      return;
    }
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

  return (
    <div className="empty-state">
      <button className="settings-icon-btn empty-state-settings" onClick={() => useStore.getState().setIsSettingsModalOpen(true)} title="Preferences (Ctrl+,)">
        <Settings size={20} />
      </button>
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
                  title={`${dir} \u2022 opened ${formatRelativeTime(recentDirectoryTimestamps[dir])}`}
                  onClick={() => void handleOpenRecent(dir)}
                >
                  <span className="empty-recent-main">{formatRecentPath(dir)}</span>
                  <span className="empty-recent-meta">{formatRelativeTime(recentDirectoryTimestamps[dir])}</span>
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
    </div>
  );
}
