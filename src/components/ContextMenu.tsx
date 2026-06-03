import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export type ContextMenuItem =
  | {
      type?: 'item';
      key: string;
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      tone?: 'default' | 'secondary' | 'danger';
    }
  | {
      type: 'separator';
      key: string;
    };

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const VIEWPORT_GUTTER = 8;

function normalizeItems(items: ContextMenuItem[]): ContextMenuItem[] {
  const visible = items.filter((item) => item.type !== 'separator' || items.length > 1);
  const result: ContextMenuItem[] = [];
  for (const item of visible) {
    if (item.type === 'separator') {
      if (result.length === 0 || result[result.length - 1]?.type === 'separator') continue;
      result.push(item);
      continue;
    }
    result.push(item);
  }
  if (result[result.length - 1]?.type === 'separator') result.pop();
  return result;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Clipboard unavailable');
  }
}

const ContextMenu = memo(function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const normalizedItems = useMemo(() => normalizeItems(items), [items]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - rect.width - VIEWPORT_GUTTER);
    const maxTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - rect.height - VIEWPORT_GUTTER);
    setPosition({
      left: Math.min(Math.max(VIEWPORT_GUTTER, x), maxLeft),
      top: Math.min(Math.max(VIEWPORT_GUTTER, y), maxTop),
    });
  }, [normalizedItems, x, y]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();
    const handleResize = () => onClose();

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [onClose]);

  if (normalizedItems.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="app-context-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {normalizedItems.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.key} className="app-context-menu-separator" role="separator" />;
        }
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`app-context-menu-item ${item.tone === 'danger' ? 'danger' : item.tone === 'secondary' ? 'secondary' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
});

export default ContextMenu;
