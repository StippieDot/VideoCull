import { useEffect, useRef, useState } from 'react';
import useStore from '../store';
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
export default function TitleBar({ isPrivate }: { isPrivate: boolean }) {
  const directories = useStore((s) => s.directories);
  const [openMenu, setOpenMenu] = useState<MenuLabel | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const buttonRefs = useRef(new Map<MenuLabel, HTMLButtonElement>());

  const open = async (label: MenuLabel) => {
    const button = buttonRefs.current.get(label);
    if (!button || !window.electronAPI) return;
    const rect = button.getBoundingClientRect();
    setOpenMenu(label);
    try {
      await window.electronAPI.openAppMenu(label, rect.left, rect.bottom);
    } finally {
      setOpenMenu(null);
    }
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
      <div className="title-bar-title" title={isPrivate ? undefined : directories.join('\n')}>{sessionTitle}</div>
    </header>
  );
}
