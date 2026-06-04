import {
  ALL_SHORTCUTS,
  FIXED_SHORTCUTS,
  findConflict,
  formatKeybind,
  kb,
  keybindFromEvent,
  keybindsEqual,
  matchesKeybind,
  type Keybind,
  type KeybindSettingKey,
} from '../../src/keybinds';

function makeEvent(overrides: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: overrides.key,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
  } as KeyboardEvent;
}

function makeAllBinds(): Record<KeybindSettingKey, Keybind> {
  return Object.fromEntries(
    ALL_SHORTCUTS.map((shortcut) => [shortcut.id, kb(shortcut.id)])
  ) as Record<KeybindSettingKey, Keybind>;
}

describe('kb', () => {
  test('creates normalized keybind objects from mixed-case input', () => {
    expect(kb('K', { ctrl: true, alt: true })).toEqual({
      key: 'k',
      ctrl: true,
      shift: false,
      alt: true,
    });
  });
});

describe('key matching', () => {
  test('matches keyboard events only when the full shortcut matches', () => {
    const bind = kb('ArrowLeft', { ctrl: true });

    expect(matchesKeybind(makeEvent({ key: 'arrowleft', ctrlKey: true }), bind)).toBe(true);
    expect(matchesKeybind(makeEvent({ key: 'arrowleft' }), bind)).toBe(false);
  });

  test('treats normalized shortcuts with the same modifiers as equal', () => {
    const bind = kb('ArrowLeft', { ctrl: true });
    expect(keybindsEqual(bind, kb('arrowleft', { ctrl: true }))).toBe(true);
  });

  test('treats missing modifiers as a different shortcut', () => {
    const bind = kb('ArrowLeft', { ctrl: true });
    expect(keybindsEqual(bind, kb('arrowleft'))).toBe(false);
  });
});

describe('keybindFromEvent', () => {
  test('ignores modifier-only keys so users do not save incomplete shortcuts', () => {
    expect(keybindFromEvent(makeEvent({ key: 'Shift', shiftKey: true }))).toBeNull();
  });

  test('captures regular keys together with their active modifiers', () => {
    expect(keybindFromEvent(makeEvent({ key: 'K', ctrlKey: true, altKey: true }))).toEqual({
      key: 'k',
      ctrl: true,
      shift: false,
      alt: true,
    });
  });
});

describe('formatKeybind', () => {
  test('renders whitespace and arrow shortcuts in a user-readable form', () => {
    expect(formatKeybind(kb(' ', { ctrl: true }))).toBe('Ctrl+Space');
    expect(formatKeybind(kb('arrowleft', { shift: true }))).toBe('Shift+\u2190');
  });

  test('renders named navigation keys without losing their label', () => {
    expect(formatKeybind(kb('tab'))).toBe('Tab');
  });
});

describe('findConflict', () => {
  test('allows the same key in separate review contexts when the app treats them as non-conflicting', () => {
    const allBinds = makeAllBinds();
    allBinds.keyPrevVideo = kb('arrowleft');
    allBinds.keySeekBack = kb('arrowleft');

    expect(findConflict('keyPrevVideo', kb('arrowleft'), allBinds)).toBeNull();
  });

  test('blocks global conflicts that would make two shortcuts compete for the same key', () => {
    const allBinds = makeAllBinds();
    allBinds.keyGlobalMute = kb('m');
    allBinds.keyBookmark = kb('m');

    expect(findConflict('keyBookmark', kb('m'), allBinds)).toBe('Toggle global mute');
  });
});

describe('fixed shortcut metadata', () => {
  test('keeps the help entries needed by the shortcut reference UI', () => {
    expect(FIXED_SHORTCUTS).toEqual(
      expect.arrayContaining([
        { keys: ['Esc'], description: 'Stop playing / Exit review', group: 'Review mode' },
        { keys: ['Ctrl+Backspace'], description: 'Delete marked videos', group: 'Global' },
      ])
    );
  });
});
