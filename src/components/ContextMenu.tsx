import { memo, useCallback, useRef } from 'react';
import AppMenu, { type AppMenuItem } from './AppMenu';

export type ContextMenuItem = Exclude<AppMenuItem, { type: 'heading' }>;

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

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

/** A right-click menu at the pointer. Esc gives focus back to where it was before it opened. */
const ContextMenu = memo(function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const previousFocusRef = useRef(document.activeElement);
  const handleClose = useCallback((refocus: boolean) => {
    if (refocus && previousFocusRef.current instanceof HTMLElement) previousFocusRef.current.focus();
    onClose();
  }, [onClose]);
  if (items.length === 0) return null;
  return <AppMenu items={items} x={x} y={y} onClose={handleClose} />;
});

export default ContextMenu;
