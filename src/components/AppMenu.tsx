import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import './ContextMenu.css';
import './AppMenu.css';

export type AppMenuAction = {
  type?: 'item';
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Right-aligned extra text, such as a count or a shortcut. */
  detail?: string;
  /** Ticked; in a selection menu, the chosen one. */
  checked?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'secondary' | 'danger';
  /** Dimmed, such as a folder with nothing left to review. */
  muted?: boolean;
  /** Selecting it shows another menu in the same place instead of closing. */
  keepOpen?: boolean;
  onSelect: () => void;
};

export type AppMenuItem = AppMenuAction | { type: 'separator'; key: string };

export interface AppMenuHeader {
  icon: LucideIcon;
  title: string;
  detail?: string;
}

interface AppMenuProps {
  items: AppMenuItem[];
  x: number;
  y: number;
  /** Accessible name when there is no header. */
  label?: string;
  header?: AppMenuHeader;
  /** A list to pick one item from: radio items, focus starts on the checked one. */
  selection?: boolean;
  /** Long lists scroll instead of running off the window. */
  scrollable?: boolean;
  emptyText?: string;
  className?: string;
  /** `refocus` is true when the keyboard closed it (Esc), so focus can go back to its opener. */
  onClose: (refocus: boolean) => void;
  /** Left / Right: move to the neighbouring menu, as in a menu bar. */
  onSwitch?: (direction: -1 | 1) => void;
  /** Pointer downs inside elements matching this selector do not close it (buttons that toggle it). */
  keepOpenWithin?: string;
}

const VIEWPORT_GUTTER = 8;

/** Drops separators at either end and doubled ones, which conditional items leave behind. */
export function trimSeparators<T extends { type?: string }>(items: T[]): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (item.type === 'separator' && (result.length === 0 || result[result.length - 1].type === 'separator')) continue;
    result.push(item);
  }
  if (result[result.length - 1]?.type === 'separator') result.pop();
  return result;
}

function isAction(item: AppMenuItem): item is AppMenuAction {
  return item.type !== 'separator';
}

function stepIndex(list: number[], current: number, delta: number): number {
  const position = list.indexOf(current);
  return list[(position + delta + list.length) % list.length] ?? current;
}

/**
 * Every menu the app draws itself (all but the native File / Actions / View / Video / Help menus):
 * context menus, title bar path menus and pickers. Keyboard: arrows, Home / End, a letter jumps to
 * the next item starting with it, Esc closes, Tab closes and moves on.
 */
export default function AppMenu({
  items: rawItems, x, y, label, header, selection = false, scrollable = false, emptyText, className = '',
  onClose, onSwitch, keepOpenWithin,
}: AppMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const items = useMemo(() => trimSeparators(rawItems), [rawItems]);
  const focusable = useMemo(
    () => items.flatMap((item, index) => (isAction(item) && !item.disabled ? [index] : [])),
    [items],
  );
  const [focus, setFocus] = useState(() => {
    const checked = selection ? items.findIndex((item) => isAction(item) && item.checked) : -1;
    return checked >= 0 ? checked : focusable[0] ?? -1;
  });
  const [position, setPosition] = useState({ left: x, top: y });
  const showIcons = items.some((item) => isAction(item) && (item.icon || item.checked !== undefined));

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(VIEWPORT_GUTTER, Math.min(x, window.innerWidth - rect.width - VIEWPORT_GUTTER)),
      top: Math.max(VIEWPORT_GUTTER, Math.min(y, window.innerHeight - rect.height - VIEWPORT_GUTTER)),
    });
  }, [items, x, y]);

  useEffect(() => {
    const element = itemRefs.current.get(focus);
    element?.focus();
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [focus]);

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(menuRef.current?.contains(target));
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (inside(target) || (keepOpenWithin && target?.closest?.(keepOpenWithin))) return;
      onClose(false);
    };
    const handleScroll = (event: Event) => {
      if (!inside(event.target)) onClose(false);
    };
    const handleBlur = () => onClose(false);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('resize', handleBlur);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleBlur);
    };
  }, [keepOpenWithin, onClose]);

  const run = (item: AppMenuAction) => {
    if (item.disabled) return;
    if (!item.keepOpen) onClose(false);
    item.onSelect();
  };

  const jumpToLetter = (letter: string) => {
    const order = [...focusable.filter((index) => index > focus), ...focusable.filter((index) => index <= focus)];
    const match = order.find((index) => (items[index] as AppMenuAction).label.toLowerCase().startsWith(letter));
    if (match !== undefined) setFocus(match);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setFocus(stepIndex(focusable, focus, 1)),
      ArrowUp: () => setFocus(stepIndex(focusable, focus, -1)),
      Home: () => setFocus(focusable[0] ?? -1),
      End: () => setFocus(focusable[focusable.length - 1] ?? -1),
      ArrowRight: () => onSwitch?.(1),
      ArrowLeft: () => onSwitch?.(-1),
      Escape: () => onClose(true),
      Tab: () => onClose(false),
    };
    const handler = keys[event.key];
    const letter = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.trim() ? event.key.toLowerCase() : null;
    if (!handler && !letter) return;
    if (event.key !== 'Tab') event.preventDefault();
    // Keeps grid and Review shortcuts from also acting on keys meant for the menu.
    event.stopPropagation();
    if (handler) handler();
    else if (letter) jumpToLetter(letter);
  };

  const HeaderIcon = header?.icon;

  return createPortal(
    <div
      ref={menuRef}
      className={`app-context-menu app-menu${scrollable ? ' app-menu-scrollable' : ''}${className ? ` ${className}` : ''}`}
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={header?.title ?? label}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {header && HeaderIcon && (
        <div className="app-menu-header">
          <HeaderIcon size={16} aria-hidden="true" />
          <div className="app-menu-header-text">
            <div className="app-menu-title">{header.title}</div>
            {header.detail && <div className="app-menu-detail">{header.detail}</div>}
          </div>
        </div>
      )}
      {items.length === 0 && emptyText && <div className="app-menu-empty">{emptyText}</div>}
      {items.map((item, index) => {
        if (!isAction(item)) return <div key={item.key} className="app-context-menu-separator" role="separator" />;
        const Icon = item.checked ? Check : item.icon;
        const checkable = selection || item.checked !== undefined;
        return (
          <button
            key={item.key}
            ref={(element) => {
              if (element) itemRefs.current.set(index, element);
              else itemRefs.current.delete(index);
            }}
            type="button"
            role={selection ? 'menuitemradio' : checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? Boolean(item.checked) : undefined}
            disabled={item.disabled}
            tabIndex={index === focus ? 0 : -1}
            className={`app-context-menu-item app-menu-item${item.tone && item.tone !== 'default' ? ` ${item.tone}` : ''}${item.muted ? ' muted' : ''}`}
            onClick={() => run(item)}
          >
            {showIcons && <span className="app-menu-icon">{Icon && <Icon size={14} />}</span>}
            <span className="app-menu-label">{item.label}</span>
            {item.detail && <span className="app-menu-item-detail">{item.detail}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
