// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import AppMenu from '../../../src/components/AppMenu';
import ContextMenu from '../../../src/components/ContextMenu';

Element.prototype.scrollIntoView = vi.fn();

const focused = () => document.activeElement?.textContent;

test('the keyboard moves past separators and disabled items, and a letter jumps to the next match', () => {
  const onClose = vi.fn();
  render(
    <AppMenu
      label="Actions"
      x={0}
      y={0}
      onClose={onClose}
      items={[
        { type: 'separator', key: 'leading' },
        { key: 'reveal', label: 'Reveal', onSelect: vi.fn() },
        { type: 'separator', key: 'middle' },
        { key: 'rename', label: 'Rename', disabled: true, onSelect: vi.fn() },
        { key: 'refresh', label: 'Refresh', onSelect: vi.fn() },
        { key: 'copy', label: 'Copy', onSelect: vi.fn() },
      ]}
    />,
  );
  const menu = screen.getByRole('menu', { name: 'Actions' });
  // The leading separator is dropped; focus starts on the first usable item.
  expect(menu.firstElementChild?.getAttribute('role')).toBe('menuitem');
  expect(focused()).toBe('Reveal');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(focused()).toBe('Refresh');
  fireEvent.keyDown(menu, { key: 'r' });
  expect(focused()).toBe('Reveal');
  fireEvent.keyDown(menu, { key: 'End' });
  expect(focused()).toBe('Copy');
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledWith(true);
});

test('a context menu gives focus back to where it was when Esc closes it', () => {
  const opener = document.body.appendChild(document.createElement('button'));
  opener.focus();
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(<ContextMenu x={10} y={10} onClose={onClose} items={[{ key: 'keep', label: 'Keep', onSelect }]} />);
  expect(focused()).toBe('Keep');

  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
  expect(document.activeElement).toBe(opener);

  act(() => screen.getByRole('menuitem', { name: 'Keep' }).click());
  expect(onSelect).toHaveBeenCalled();
});
