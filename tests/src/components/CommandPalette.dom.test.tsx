// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import CommandPalette, { filterCommands, formatAccelerator } from '../../../src/components/CommandPalette';
import type { AppCommand } from '../../../src/types';

// jsdom has no layout, so no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const COMMANDS: AppCommand[] = [
  { id: 'File > Open Folder', path: ['File', 'Open Folder...'], accelerator: 'CmdOrCtrl+O', enabled: true, checked: null },
  { id: 'View > Sort By > Size', path: ['View', 'Sort By', 'Size'], accelerator: null, enabled: true, checked: false },
  { id: 'View > Sort By > Name', path: ['View', 'Sort By', 'Name'], accelerator: null, enabled: true, checked: true },
  { id: 'File > Rescan', path: ['File', 'Rescan'], accelerator: 'F5', enabled: false, checked: null },
];

test('matches every query word anywhere in the menu path', () => {
  expect(filterCommands(COMMANDS, 'sort size').map((command) => command.id)).toEqual(['View > Sort By > Size']);
  expect(filterCommands(COMMANDS, '  ')).toHaveLength(4);
});

test('shows accelerators the way Windows users write them', () => {
  expect(formatAccelerator('CmdOrCtrl+Plus')).toBe('Ctrl++');
  expect(formatAccelerator('CmdOrCtrl+Shift+E')).toBe('Ctrl+Shift+E');
});

test('runs the highlighted command with the keyboard and skips disabled ones', async () => {
  const runCommand = vi.fn().mockResolvedValue(true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    getCommands: vi.fn().mockResolvedValue(COMMANDS),
    runCommand,
  };
  const onClose = vi.fn();
  render(<CommandPalette onClose={onClose} />);
  await screen.findByText('Open Folder...');
  const input = screen.getByPlaceholderText('Search commands');

  fireEvent.change(input, { target: { value: 'rescan' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(runCommand).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: 'sort' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onClose).toHaveBeenCalled();
  expect(runCommand).toHaveBeenCalledWith('View > Sort By > Name');
});
