// ── Keybind data type ──────────────────────────────────────────────
export interface Keybind {
  readonly key: string;    // KeyboardEvent.key, lowercased (e.g. 'k', 'arrowleft', ' ')
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

// ── Shortcut group / context ───────────────────────────────────────
export type ShortcutGroup = 'Review mode' | 'Preview' | 'Global';

// 'playing' / 'not-playing' disambiguates context-dependent keys
// (e.g. ArrowLeft = prev video when not playing, seek -5s when playing)
export type ShortcutContext = 'playing' | 'not-playing';

export interface ShortcutDef {
  readonly id: KeybindSettingKey;
  readonly description: string;
  readonly group: ShortcutGroup;
  readonly context?: ShortcutContext; // undefined = fires regardless of play state
}

export type KeybindSettingKey =
  | 'keyKeep' | 'keyDelete' | 'keySkip' | 'keyReset' | 'keyUndo' | 'keyPlay'
  | 'keyPrevVideo' | 'keyNextVideo' | 'keyEnterPlay' | 'keyExternalPlayer'
  | 'keyNextUndecided'
  | 'keySeekBack' | 'keySeekForward' | 'keySpeedDown' | 'keySpeedUp'
  | 'keyBookmark' | 'keyShowHelp'
  | 'keyGlobalMute' | 'keySearch'
  | 'keyPreviewSeekBack' | 'keyPreviewSeekForward';

export const ALL_SHORTCUTS: ShortcutDef[] = [
  // Navigation (only fires when not playing)
  { id: 'keyPrevVideo',          description: 'Previous video',            group: 'Review mode', context: 'not-playing' },
  { id: 'keyNextVideo',          description: 'Next video',                group: 'Review mode', context: 'not-playing' },
  // Decision actions
  { id: 'keyKeep',               description: 'Mark as Keep',              group: 'Review mode' },
  { id: 'keyDelete',             description: 'Mark as Delete',            group: 'Review mode' },
  { id: 'keySkip',               description: 'Skip (no decision)',        group: 'Review mode' },
  { id: 'keyReset',              description: 'Reset to Pending',          group: 'Review mode' },
  { id: 'keyUndo',               description: 'Undo last action',          group: 'Review mode' },
  // Playback controls
  { id: 'keyPlay',               description: 'Play / Pause',              group: 'Review mode' },
  { id: 'keyEnterPlay',          description: 'Play / Pause (alternate)',  group: 'Review mode' },
  { id: 'keyExternalPlayer',     description: 'Open in external player',   group: 'Review mode' },
  { id: 'keyNextUndecided',      description: 'Next undecided',            group: 'Review mode' },
  // While playing
  { id: 'keySeekBack',           description: 'Rewind 5s',                 group: 'Review mode', context: 'playing' },
  { id: 'keySeekForward',        description: 'Forward 5s',                group: 'Review mode', context: 'playing' },
  { id: 'keySpeedDown',          description: 'Decrease speed',            group: 'Review mode', context: 'playing' },
  { id: 'keySpeedUp',            description: 'Increase speed',            group: 'Review mode', context: 'playing' },
  { id: 'keyBookmark',           description: 'Bookmark current position', group: 'Review mode', context: 'playing' },
  // Preview modal
  { id: 'keyPreviewSeekBack',    description: 'Rewind 5s',                 group: 'Preview' },
  { id: 'keyPreviewSeekForward', description: 'Forward 5s',                group: 'Preview' },
  // Global
  { id: 'keyShowHelp',           description: 'Show keyboard shortcuts',   group: 'Global' },
  { id: 'keyGlobalMute',         description: 'Toggle global mute',        group: 'Global' },
  { id: 'keySearch',             description: 'Search loaded videos',      group: 'Global' },
];

// Fixed shortcuts that are never configurable (displayed in help only)
export interface FixedShortcut {
  readonly keys: string[];
  readonly description: string;
  readonly group: ShortcutGroup;
}

export const FIXED_SHORTCUTS: FixedShortcut[] = [
  { keys: ['Esc'], description: 'Stop playing / Exit review', group: 'Review mode' },
  { keys: ['Esc'], description: 'Close preview',              group: 'Preview' },
  { keys: ['Ctrl+,'],          description: 'Open settings',         group: 'Global' },
  { keys: ['Ctrl+O'],          description: 'Open folder',           group: 'Global' },
  { keys: ['F5'],              description: 'Rescan directory',      group: 'Global' },
  { keys: ['Ctrl+Backspace'],  description: 'Delete marked videos',  group: 'Global' },
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
export function matchesKeybind(event: KeyboardEvent, bind: Keybind): boolean {
  return (
    event.key.toLowerCase() === bind.key &&
    event.ctrlKey  === bind.ctrl  &&
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
    ctrl:  event.ctrlKey,
    shift: event.shiftKey,
    alt:   event.altKey,
  };
}

// ── Format a Keybind for display ───────────────────────────────────
export function formatKeybind(bind: Keybind): string {
  const parts: string[] = [];
  if (bind.ctrl)  parts.push('Ctrl');
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
  return null;
}
