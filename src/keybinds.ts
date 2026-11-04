import { fileManagerName, isModKeyDown, modKeyName } from './utils';

// ── Keybind data type ──────────────────────────────────────────────
export interface Keybind {
  readonly key: string;    // KeyboardEvent.key, lowercased (e.g. 'k', 'arrowleft', ' ')
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

// ── Shortcut group / context ───────────────────────────────────────
export type ShortcutGroup = 'Review mode' | 'Global';

// 'playing' / 'not-playing' disambiguates context-dependent keys
// (e.g. ArrowLeft = prev video when not playing, seek -5s when playing)
export type ShortcutContext = 'playing' | 'not-playing';

export type ShortcutSection = 'Navigation' | 'Decisions' | 'Playback' | 'While playing' | 'Folders & search' | 'Videos' | 'App';

export interface ShortcutDef {
  readonly id: KeybindSettingKey;
  readonly description: string;
  readonly group: ShortcutGroup;
  readonly section: ShortcutSection; // how Settings clusters it; group decides which keys may conflict
  readonly context?: ShortcutContext; // undefined = fires regardless of play state
}

export type KeybindSettingKey =
  | 'keyKeep' | 'keyDelete' | 'keySkip' | 'keyReset' | 'keyUndo' | 'keyPlay'
  | 'keyPrevVideo' | 'keyNextVideo' | 'keyEnterPlay' | 'keyExternalPlayer'
  | 'keyNextUndecided'
  | 'keySeekBack' | 'keySeekForward' | 'keySpeedDown' | 'keySpeedUp'
  | 'keyBookmark' | 'keyShowHelp'
  | 'keyGlobalMute' | 'keyToggleTheme' | 'keySearch';

export const ALL_SHORTCUTS: ShortcutDef[] = [
  { id: 'keyPrevVideo',          description: 'Previous video',            group: 'Review mode', section: 'Navigation', context: 'not-playing' },
  { id: 'keyNextVideo',          description: 'Next video',                group: 'Review mode', section: 'Navigation', context: 'not-playing' },
  { id: 'keyNextUndecided',      description: 'Next undecided',            group: 'Review mode', section: 'Navigation' },
  { id: 'keyKeep',               description: 'Mark as Keep',              group: 'Review mode', section: 'Decisions' },
  { id: 'keyDelete',             description: 'Mark as Delete',            group: 'Review mode', section: 'Decisions' },
  { id: 'keySkip',               description: 'Skip (no decision)',        group: 'Review mode', section: 'Decisions' },
  { id: 'keyReset',              description: 'Reset to Pending',          group: 'Review mode', section: 'Decisions' },
  { id: 'keyUndo',               description: 'Undo last action',          group: 'Review mode', section: 'Decisions' },
  { id: 'keyPlay',               description: 'Play / Pause',              group: 'Review mode', section: 'Playback' },
  { id: 'keyEnterPlay',          description: 'Play / Back to thumbnails', group: 'Review mode', section: 'Playback' },
  { id: 'keyExternalPlayer',     description: 'Open in external player',   group: 'Review mode', section: 'Playback' },
  { id: 'keySeekBack',           description: 'Rewind 5s',                 group: 'Review mode', section: 'While playing', context: 'playing' },
  { id: 'keySeekForward',        description: 'Forward 5s',                group: 'Review mode', section: 'While playing', context: 'playing' },
  { id: 'keySpeedDown',          description: 'Decrease speed',            group: 'Review mode', section: 'While playing', context: 'playing' },
  { id: 'keySpeedUp',            description: 'Increase speed',            group: 'Review mode', section: 'While playing', context: 'playing' },
  { id: 'keyBookmark',           description: 'Bookmark current position', group: 'Review mode', section: 'While playing', context: 'playing' },
  { id: 'keyShowHelp',           description: 'Show keyboard shortcuts',   group: 'Global', section: 'App' },
  { id: 'keyGlobalMute',         description: 'Toggle global mute',        group: 'Global', section: 'App' },
  { id: 'keyToggleTheme',        description: 'Toggle color theme',        group: 'Global', section: 'App' },
  { id: 'keySearch',             description: 'Search loaded videos',      group: 'Global', section: 'Folders & search' },
];

// Fixed shortcuts that are never configurable (displayed in help only)
export interface FixedShortcut {
  readonly keys: string[];
  readonly description: string;
  readonly group: ShortcutGroup;
  readonly section: ShortcutSection;
  // The player's own key: a configured Review shortcut on it wins, so it is not a conflict.
  readonly playerKey?: boolean;
}

const MOD = modKeyName();

export const FIXED_SHORTCUTS: FixedShortcut[] = [
  { keys: ['Esc'], description: 'Stop playing / Exit review', group: 'Review mode', section: 'Playback' },
  { keys: ['J', 'L'], description: 'Back / forward 10s', group: 'Review mode', section: 'While playing', playerKey: true },
  { keys: ['0-9'], description: 'Jump to 0-90% of the video', group: 'Review mode', section: 'While playing', playerKey: true },
  { keys: ['Home', 'End'], description: 'Jump to start / end', group: 'Review mode', section: 'While playing', playerKey: true },
  { keys: ['↑', '↓'], description: 'Volume up / down', group: 'Review mode', section: 'While playing', playerKey: true },
  { keys: ['F'], description: 'Player fullscreen', group: 'Review mode', section: 'While playing', playerKey: true },
  { keys: ['I'], description: 'Picture-in-picture', group: 'Review mode', section: 'While playing', playerKey: true },
  { keys: [`${MOD}+,`],          description: 'Open settings',         group: 'Global', section: 'App' },
  { keys: [`${MOD}+O`],          description: 'Open folder',           group: 'Global', section: 'Folders & search' },
  { keys: ['F5'],              description: 'Rescan',                group: 'Global', section: 'Folders & search' },
  { keys: [`${MOD}+Shift+E`],    description: 'Export report',         group: 'Global', section: 'Videos' },
  { keys: [`${MOD}+Z`],          description: 'Undo last action',      group: 'Global', section: 'Videos' },
  { keys: [`${MOD}+Backspace`],  description: 'Delete marked videos',  group: 'Global', section: 'Videos' },
  { keys: [`${MOD}++`, `${MOD}+=`], description: 'Larger cards',         group: 'Global', section: 'Videos' },
  { keys: [`${MOD}+-`],          description: 'Smaller cards',         group: 'Global', section: 'Videos' },
  { keys: [`${MOD}+E`],         description: `Reveal in ${fileManagerName()}`, group: 'Global', section: 'Videos' },
  { keys: [`${MOD}+P`],          description: 'Play externally',      group: 'Global', section: 'Videos' },
  { keys: [`${MOD}+K`],          description: 'Find a command, folder or video', group: 'Global', section: 'Folders & search' },
  { keys: [`${MOD}+G`],          description: 'Go to folder',          group: 'Global', section: 'Folders & search' },
  { keys: [`${MOD}+L`],          description: 'Focus the path',        group: 'Global', section: 'Folders & search' },
  { keys: ['Alt+Left', 'Alt+Right'], description: 'Previous / next folder filter', group: 'Global', section: 'Folders & search' },
  { keys: ['F1'],              description: 'Open documentation',    group: 'Global', section: 'App' },
  { keys: ['F11'],             description: 'Toggle fullscreen',     group: 'Global', section: 'App' },
  { keys: ['Shift+Esc'],       description: 'Toggle privacy screen', group: 'Global', section: 'App' },
];

// ── Creation helper ────────────────────────────────────────────────
export function kb(
  key: string,
  mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean }
): Keybind {
  return {
    key: key.toLowerCase(),
    ctrl:  mods?.ctrl  ?? false,
    shift: mods?.shift ?? false,
    alt:   mods?.alt   ?? false,
  };
}

// ── Match a KeyboardEvent against a stored Keybind ─────────────────
// Cmd on macOS stands in for Ctrl, so stored "Ctrl" binds work on every platform.
export function matchesKeybind(event: KeyboardEvent, bind: Keybind): boolean {
  return (
    event.key.toLowerCase() === bind.key &&
    isModKeyDown(event) === bind.ctrl &&
    event.shiftKey === bind.shift &&
    event.altKey   === bind.alt
  );
}

// ── Equality check ─────────────────────────────────────────────────
export function keybindsEqual(a: Keybind, b: Keybind): boolean {
  return a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt;
}

// ── Build a Keybind from a KeyboardEvent (for recording) ───────────
// Returns null if only a modifier key was pressed (nothing to record yet).
export function keybindFromEvent(event: KeyboardEvent): Keybind | null {
  if (['control', 'shift', 'alt', 'meta'].includes(event.key.toLowerCase())) return null;
  return {
    key:   event.key.toLowerCase(),
    ctrl:  isModKeyDown(event),
    shift: event.shiftKey,
    alt:   event.altKey,
  };
}

// ── Format a Keybind for display ───────────────────────────────────
export function formatKeybind(bind: Keybind): string {
  const parts: string[] = [];
  if (bind.ctrl)  parts.push(modKeyName());
  if (bind.shift) parts.push('Shift');
  if (bind.alt)   parts.push('Alt');
  parts.push(formatKeyName(bind.key));
  return parts.join('+');
}

function formatKeyName(key: string): string {
  const MAP: Record<string, string> = {
    ' ':           'Space',
    'arrowleft':   '←',
    'arrowright':  '→',
    'arrowup':     '↑',
    'arrowdown':   '↓',
    'enter':       'Enter',
    'backspace':   'Backspace',
    'delete':      'Del',
    'tab':         'Tab',
    'escape':      'Esc',
    '[':           '[',
    ']':           ']',
  };
  return MAP[key] ?? key.toUpperCase();
}

// ── Conflict detection ─────────────────────────────────────────────
// Two shortcuts conflict if they share a keybind and could fire at the same time.
// Shortcuts with different contexts (playing vs not-playing) in the same group do NOT conflict.
export function findConflict(
  currentId: KeybindSettingKey,
  currentBind: Keybind,
  allBinds: Record<KeybindSettingKey, Keybind>
): string | null {
  const currentDef = ALL_SHORTCUTS.find((s) => s.id === currentId)!;

  for (const def of ALL_SHORTCUTS) {
    if (def.id === currentId) continue;
    if (!keybindsEqual(currentBind, allBinds[def.id])) continue;

    // Different groups only conflict if one is Global (fires everywhere)
    const sameGroup = def.group === currentDef.group;
    const eitherGlobal = def.group === 'Global' || currentDef.group === 'Global';
    if (!sameGroup && !eitherGlobal) continue;

    // Within the same group: context-separated binds are fine (e.g. ArrowLeft = prev/seek)
    if (sameGroup && def.context && currentDef.context && def.context !== currentDef.context) continue;

    return def.description;
  }

  // Fixed shortcuts are taken by the menu or the window before a configurable binding can fire.
  const pressed = formatKeybind(currentBind).replace('←', 'Left').replace('→', 'Right').toLowerCase();
  const fixed = FIXED_SHORTCUTS.find((shortcut) => (
    !shortcut.playerKey
    && (shortcut.group === 'Global' || shortcut.group === currentDef.group)
    && shortcut.keys.some((keys) => keys.toLowerCase() === pressed)
  ));
  return fixed?.description ?? null;
}
