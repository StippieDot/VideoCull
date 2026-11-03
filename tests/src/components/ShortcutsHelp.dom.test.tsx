// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import ShortcutsHelp from '../../../src/components/ShortcutsHelp';
import { ALL_SHORTCUTS, FIXED_SHORTCUTS } from '../../../src/keybinds';

test('shows every shortcut in a titled box, dims fixed keys, and links to the shortcut settings', async () => {
  const onOpenShortcutSettings = vi.fn();
  render(<ShortcutsHelp onClose={() => {}} onOpenShortcutSettings={onOpenShortcutSettings} />);

  const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  expect(dialog.querySelectorAll('.shortcuts-row')).toHaveLength(ALL_SHORTCUTS.length + FIXED_SHORTCUTS.length);
  expect(within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
    .toEqual(['Review · Navigation', 'Review · Decisions', 'Review · Playback', 'Review · While playing', 'App', 'Folders & search', 'Videos']);
  expect(dialog.querySelectorAll('.shortcuts-keys-fixed')).toHaveLength(FIXED_SHORTCUTS.length);

  await userEvent.click(within(dialog).getByRole('button', { name: 'Change shortcuts' }));
  expect(onOpenShortcutSettings).toHaveBeenCalledTimes(1);
});
