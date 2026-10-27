import { useState } from 'react';
import useStore from '../store';
import { CircleHelp, FolderOpen, Moon, Settings, Sun, X } from 'lucide-react';
import type { RecentSession, ToastInput, ToastKind } from '../types';
import { formatKeybind } from '../keybinds';
import { DEFAULT_KEYBINDS } from '../keybind-defaults';
import ContextMenu from './ContextMenu';
import { PRODUCT } from '../product';
import videoCullIcon from '../assets/videocull-icon.png';
import './EmptyState.css';
import useRecentSessions, { recentSessionName } from '../hooks/useRecentSessions';
import { sessionKey } from '../sessions';

interface EmptyStateProps {
  onNotify: (toast: ToastInput | string, kind?: ToastKind) => void;
  onOpenDocumentation: () => void;
  onToggleTheme: () => void;
}

export default function EmptyState({ onNotify, onOpenDocumentation, onToggleTheme }: EmptyStateProps) {
  const setDirectory = useStore((s) => s.setDirectory);
  const includeSubfolders = useStore((s) => s.includeSubfolders);
  const setIncludeSubfolders = useStore((s) => s.setIncludeSubfolders);
  const settings = useStore((s) => s.settings);
  const recents = useRecentSessions(onNotify);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; recent: RecentSession } | null>(null);

  const handleSelect = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setDirectory(dir);
  };

  return (
    <div className="empty-state">
      <div className="empty-state-actions">
        <button
          className="settings-icon-btn empty-state-settings-btn"
          onClick={onToggleTheme}
          title={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode (${formatKeybind(settings.keyToggleTheme ?? DEFAULT_KEYBINDS.keyToggleTheme)})`}
          aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {settings.theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button className="settings-icon-btn empty-state-settings-btn" onClick={onOpenDocumentation} title="Open documentation" aria-label="Open documentation">
          <CircleHelp size={20} />
        </button>
        <button className="settings-icon-btn empty-state-settings-btn" onClick={() => useStore.getState().setIsSettingsModalOpen(true)} title="Preferences (Ctrl+,)" aria-label="Open preferences">
          <Settings size={20} />
        </button>
      </div>
      <div className="empty-icon">
        <img src={videoCullIcon} alt="" aria-hidden="true" />
      </div>
      <h2 className="empty-title">{PRODUCT.displayName}</h2>
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

      {recents.recentSessions.length > 0 && (
        <div className="empty-recents">
          <div className="empty-recents-header">
            <p className="empty-recents-title">Recent folders</p>
            <button className="empty-recents-clear" onClick={recents.clearAll}>
              Clear all
            </button>
          </div>
          <ul className="empty-recents-list">
            {recents.recentSessions.slice(0, 5).map((recent) => (
              <li key={sessionKey(recent.folders)} className="empty-recent-row">
                <button
                  className="empty-recent-item"
                  title={recents.tooltip(recent)}
                  onClick={() => void recents.open(recent)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, recent });
                  }}
                >
                  <span className="empty-recent-main">{recentSessionName(recent)}</span>
                  <span className="empty-recent-meta">{recents.meta(recent)}</span>
                </button>
                <button
                  className="empty-recent-remove"
                  title={`Remove ${recentSessionName(recent)} from recent folders`}
                  aria-label={`Remove ${recentSessionName(recent)} from recent folders`}
                  onClick={() => recents.remove(recent)}
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
          items={recents.menuItems(contextMenu.recent, false)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
