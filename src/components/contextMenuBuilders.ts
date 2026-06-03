import type { DuplicateGroup, Video } from '../types';
import type { ContextMenuItem } from './ContextMenu';

type Action = () => void;

function separator(key: string): ContextMenuItem {
  return { type: 'separator', key };
}

export function buildLibraryGridVideoMenu(actions: {
  onPlay: Action;
  onOpenExternal: Action;
  onReveal: Action;
  onResetPending: Action;
  onRegenerateThumbnails: Action;
  onCopyPath: Action;
}): ContextMenuItem[] {
  return [
    { key: 'play', label: 'Play', onSelect: actions.onPlay },
    { key: 'external', label: 'Open in external player', onSelect: actions.onOpenExternal },
    { key: 'reveal', label: 'Reveal in Explorer', onSelect: actions.onReveal },
    separator('sep-top'),
    { key: 'reset', label: 'Reset to pending', onSelect: actions.onResetPending, tone: 'secondary' },
    { key: 'thumbs', label: 'Regenerate thumbnails', onSelect: actions.onRegenerateThumbnails },
    separator('sep-bottom'),
    { key: 'copy', label: 'Copy full path', onSelect: actions.onCopyPath, tone: 'secondary' },
  ];
}

export function buildDuplicateVideoMenu(actions: {
  onPlay: Action;
  onOpenExternal: Action;
  onReveal: Action;
  onMarkDelete: Action;
  onMarkKeep: Action;
  onResetPending: Action;
  onSetSelectedKeeper: Action;
  onCopyPath: Action;
}): ContextMenuItem[] {
  return [
    { key: 'play', label: 'Play', onSelect: actions.onPlay },
    { key: 'external', label: 'Open in external player', onSelect: actions.onOpenExternal },
    { key: 'reveal', label: 'Reveal in Explorer', onSelect: actions.onReveal },
    separator('sep-top'),
    { key: 'delete', label: 'Mark Delete', onSelect: actions.onMarkDelete, tone: 'danger' },
    { key: 'keep', label: 'Mark Keep', onSelect: actions.onMarkKeep },
    { key: 'reset', label: 'Reset pending', onSelect: actions.onResetPending, tone: 'secondary' },
    { key: 'keeper', label: 'Mark as selected keeper', onSelect: actions.onSetSelectedKeeper },
    separator('sep-bottom'),
    { key: 'copy', label: 'Copy full path', onSelect: actions.onCopyPath, tone: 'secondary' },
  ];
}

export function buildDuplicateGroupHeaderMenu(args: {
  group: DuplicateGroup;
  canPlaySelectedKeeper: boolean;
  onDismissGroup: Action;
  onSelectSuggestedDeletions: Action;
  onClearManualKeeperOverride: Action;
  onPlaySelectedKeeper: Action;
}): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { key: 'dismiss', label: 'Dismiss group', onSelect: args.onDismissGroup, tone: 'danger' },
    { key: 'select', label: 'Select suggested deletions', onSelect: args.onSelectSuggestedDeletions },
    separator('sep-main'),
  ];
  if (args.group.manualSuggestedKeeperId) {
    items.push({
      key: 'clear-keeper',
      label: 'Clear manual keeper override',
      onSelect: args.onClearManualKeeperOverride,
      tone: 'secondary',
    });
  }
  items.push({
    key: 'play-keeper',
    label: 'Play selected keeper',
    onSelect: args.onPlaySelectedKeeper,
    disabled: !args.canPlaySelectedKeeper,
  });
  return items;
}

export function buildReviewVideoMenu(actions: {
  onOpenExternal: Action;
  onReveal: Action;
  onCopyPath: Action;
}): ContextMenuItem[] {
  return [
    { key: 'external', label: 'Open in external player', onSelect: actions.onOpenExternal },
    { key: 'reveal', label: 'Reveal in Explorer', onSelect: actions.onReveal },
    separator('sep-main'),
    { key: 'copy', label: 'Copy full path', onSelect: actions.onCopyPath, tone: 'secondary' },
  ];
}

export function buildFolderHeaderMenu(actions: {
  onReviewFolder: Action;
  onFilterToFolder: Action;
  onRevealFolder: Action;
  onCopyFolderPath: Action;
  onMarkKeep: Action;
  onMarkDelete: Action;
  onResetPending: Action;
  onRegenerateThumbnails: Action;
}): ContextMenuItem[] {
  return [
    { key: 'review', label: 'Review this folder', onSelect: actions.onReviewFolder },
    { key: 'filter', label: 'Filter to this folder', onSelect: actions.onFilterToFolder },
    { key: 'reveal', label: 'Reveal folder in Explorer', onSelect: actions.onRevealFolder },
    { key: 'copy', label: 'Copy folder path', onSelect: actions.onCopyFolderPath, tone: 'secondary' },
    separator('sep-main'),
    { key: 'keep', label: 'Mark all in folder as Keep', onSelect: actions.onMarkKeep },
    { key: 'delete', label: 'Mark all in folder as Delete', onSelect: actions.onMarkDelete, tone: 'danger' },
    { key: 'reset', label: 'Reset all videos in folder to pending', onSelect: actions.onResetPending, tone: 'secondary' },
    { key: 'thumbs', label: 'Regenerate thumbnails for folder', onSelect: actions.onRegenerateThumbnails },
  ];
}

export function buildRecentFolderMenu(args: {
  directory: string;
  loadedDirectories: string[];
  onOpen: Action;
  onAddToSession: Action;
  onReveal: Action;
  onCopyPath: Action;
}): ContextMenuItem[] {
  const normalizedTarget = normalizePath(args.directory);
  const alreadyLoaded = args.loadedDirectories.some((dir) => normalizePath(dir) === normalizedTarget);
  return [
    { key: 'open', label: 'Open', onSelect: args.onOpen },
    { key: 'add', label: 'Add to session', onSelect: args.onAddToSession, disabled: alreadyLoaded },
    separator('sep-main'),
    { key: 'reveal', label: 'Reveal in Explorer', onSelect: args.onReveal },
    { key: 'copy', label: 'Copy path', onSelect: args.onCopyPath, tone: 'secondary' },
  ];
}

export function normalizePath(value: string): string {
  return value.replace(/[\\/]+/g, '\\').toLowerCase();
}

export function buildCopyPathSuccessDetail(pathValue: string): string {
  const trimmed = pathValue.trim();
  return trimmed.length > 80 ? `Copied ${trimmed.slice(0, 77)}...` : `Copied ${trimmed}`;
}

export function canPlayDuplicateGroupKeeper(group: DuplicateGroup, videosById: Map<string, Video>): boolean {
  return Boolean(group.suggestedKeeperId && videosById.get(group.suggestedKeeperId));
}
