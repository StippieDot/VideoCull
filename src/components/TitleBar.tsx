import { useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Pause, Play, Power, Search } from 'lucide-react';
import useStore from '../store';
import usePowerState from '../hooks/usePowerState';
import useProcessingPauseState from '../hooks/useProcessingPauseState';
import type { VideoStore } from '../types';
import videoCullIcon from '../assets/videocull-icon.png';
import { formatRecentPath } from '../utils';
import './TitleBar.css';

// Must match the top-level menus in electron/app-menu.js; the main process opens them by label.
const MENUS = [
  { label: 'File', accessKey: 'f' },
  { label: 'Actions', accessKey: 'a' },
  { label: 'View', accessKey: 'v' },
  { label: 'Video', accessKey: 'd' },
  { label: 'Help', accessKey: 'h' },
] as const;

type MenuLabel = typeof MENUS[number]['label'];

const GENERATION_LABELS = { metadata: 'Reading video info', media: 'Media data', thumbnails: 'Thumbnails' } as const;

/** What is processing right now, for the title bar; null when idle. */
function selectProcessingStatus(state: VideoStore): { label: string; detail: string; fraction: number | null } | null {
  const count = (current: number, total: number) => `${current.toLocaleString()} / ${total.toLocaleString()}`;
  if (state.isGenerating) {
    const { current, total, phase } = state.genProgress;
    return {
      label: GENERATION_LABELS[phase ?? 'thumbnails'],
      detail: count(current, total),
      fraction: total > 0 ? current / total : null,
    };
  }
  if (state.isFindingDuplicates && state.duplicateProgress) {
    const { stage, current, total } = state.duplicateProgress;
    return { label: stage, detail: total > 0 ? count(current, total) : '', fraction: total > 0 ? current / total : null };
  }
  if (state.isScanning) {
    return { label: 'Scanning', detail: `${state.scanProgress.found.toLocaleString()} found`, fraction: null };
  }
  return null;
}

const FINISH_ACTION_TITLES = {
  none: 'When processing finishes: do nothing',
  sleep: 'When processing finishes: sleep',
  shutdown: 'When processing finishes: shut down',
} as const;

function MenuLabelText({ label, accessKey, showAccessKey }: { label: string; accessKey: string; showAccessKey: boolean }) {
  const index = label.toLowerCase().indexOf(accessKey);
  if (!showAccessKey || index < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, index)}
      <span className="title-bar-access-key">{label[index]}</span>
      {label.slice(index + 1)}
    </>
  );
}

/**
 * Replaces the Windows title bar and menu bar. The menus themselves stay native: each button opens
 * the matching application menu, so enabled states and shortcuts come from one place. Windows draws
 * the window buttons on the right (titleBarOverlay).
 */
export default function TitleBar({ isPrivate, onOpenCommandPalette }: { isPrivate: boolean; onOpenCommandPalette: () => void }) {
  const directories = useStore((s) => s.directories);
  // Serialised so the bar only re-renders when the shown status changes, not on every store update.
  const statusJson = useStore((s) => JSON.stringify(selectProcessingStatus(s)));
  const status = useMemo(() => JSON.parse(statusJson) as ReturnType<typeof selectProcessingStatus>, [statusJson]);
  const power = usePowerState();
  const pauseStatus = useProcessingPauseState().status;
  const paused = pauseStatus !== 'running';
  const finishButtonRef = useRef<HTMLButtonElement>(null);
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuLabel | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const buttonRefs = useRef(new Map<MenuLabel, HTMLButtonElement>());

  const open = async (label: MenuLabel) => {
    const button = buttonRefs.current.get(label);
    if (!button || !window.electronAPI) return;
    const rect = button.getBoundingClientRect();
    setOpenMenu(label);
    try {
      await window.electronAPI.openAppMenu([label], rect.left, rect.bottom);
    } finally {
      setOpenMenu(null);
    }
  };

  const openFolderMenu = async () => {
    const rect = folderButtonRef.current?.getBoundingClientRect();
    if (!rect || !window.electronAPI) return;
    setFolderMenuOpen(true);
    try {
      await window.electronAPI.openFolderMenu(rect.left, rect.bottom);
    } finally {
      setFolderMenuOpen(false);
    }
  };

  const openFinishActionMenu = () => {
    const rect = finishButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    void window.electronAPI?.openAppMenu(['Actions', 'When Processing Finishes'], rect.left, rect.bottom);
  };
  const openRef = useRef(open);
  openRef.current = open;

  // Alt+letter opens a menu, as with the native menu bar; holding Alt shows the access keys.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setAltHeld(true);
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const menu = MENUS.find((entry) => entry.accessKey === event.key.toLowerCase());
      if (!menu) return;
      event.preventDefault();
      setAltHeld(false);
      void openRef.current(menu.label);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(false);
    };
    const handleBlur = () => setAltHeld(false);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const sessionTitle = isPrivate || directories.length === 0
    ? 'VideoCull'
    : directories.length === 1
      ? formatRecentPath(directories[0])
      : `${formatRecentPath(directories[0])} + ${directories.length - 1} more`;

  return (
    <header className="title-bar">
      <img className="title-bar-icon" src={videoCullIcon} alt="" draggable={false} />
      <nav className="title-bar-menus" aria-label="Application menu">
        {MENUS.map(({ label, accessKey }) => (
          <button
            key={label}
            ref={(element) => {
              if (element) buttonRefs.current.set(label, element);
              else buttonRefs.current.delete(label);
            }}
            type="button"
            className={`title-bar-menu-button${openMenu === label ? ' open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openMenu === label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void open(label)}
          >
            <MenuLabelText label={label} accessKey={accessKey} showAccessKey={altHeld} />
          </button>
        ))}
      </nav>
      <div className="title-bar-center">
        {isPrivate || directories.length === 0 ? (
          <div className="title-bar-title">{sessionTitle}</div>
        ) : (
          <button
            ref={folderButtonRef}
            type="button"
            className={`title-bar-title title-bar-folder${folderMenuOpen ? ' open' : ''}`}
            title={directories.join('\n')}
            aria-haspopup="menu"
            aria-expanded={folderMenuOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void openFolderMenu()}
          >
            {sessionTitle}
          </button>
        )}
      </div>
      {status && (
        <div className="title-bar-progress" aria-hidden="true">
          <div
            className={`title-bar-progress-fill${status.fraction === null ? ' indeterminate' : ''}${paused ? ' paused' : ''}`}
            style={status.fraction === null ? undefined : { width: `${Math.min(100, status.fraction * 100)}%` }}
          />
        </div>
      )}
      <div className="title-bar-actions">
        {status && !isPrivate && (
          <div className="title-bar-status-pill">
            <span className="title-bar-status" role="status">
              <span className="title-bar-status-label">{status.label}</span>
              {status.detail && <span>{status.detail}</span>}
              {paused && <span className="title-bar-status-paused">Paused</span>}
            </span>
            <button
              type="button"
              className={`title-bar-icon-button${paused ? ' paused' : ''}`}
              title={pauseStatus === 'running' ? 'Pause processing' : pauseStatus === 'pausing' ? 'Pausing...' : 'Resume processing'}
              aria-label={pauseStatus === 'running' ? 'Pause processing' : 'Resume processing'}
              disabled={pauseStatus === 'pausing'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void window.electronAPI?.setProcessingPaused(pauseStatus === 'running')}
            >
              {pauseStatus === 'running' ? <Pause size={14} /> : <Play size={14} />}
            </button>
          </div>
        )}
        {!isPrivate && (
          <button
            type="button"
            className="title-bar-icon-button"
            title="Search commands (Ctrl+K)"
            aria-label="Search commands"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onOpenCommandPalette}
          >
            <Search size={14} />
          </button>
        )}
        {power.processing && !isPrivate && (
          <button
            ref={finishButtonRef}
            type="button"
            className={`title-bar-icon-button${power.finishAction !== 'none' ? ' active' : ''}`}
            title={FINISH_ACTION_TITLES[power.finishAction]}
            aria-label={FINISH_ACTION_TITLES[power.finishAction]}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openFinishActionMenu}
          >
            {power.finishAction === 'shutdown' ? <Power size={14} /> : <Moon size={14} />}
          </button>
        )}
      </div>
    </header>
  );
}
