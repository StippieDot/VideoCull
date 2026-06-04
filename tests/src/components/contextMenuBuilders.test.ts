import type { ContextMenuItem } from '../../../src/components/ContextMenu';
import {
  buildDuplicateGroupHeaderMenu,
  buildDuplicateVideoMenu,
  buildFolderHeaderMenu,
  buildLibraryGridVideoMenu,
  buildRecentFolderMenu,
  buildReviewVideoMenu,
} from '../../../src/components/contextMenuBuilders';
import type { DuplicateGroup } from '../../../src/types';

const noop = () => {};

function labels(items: ContextMenuItem[]) {
  return items
    .filter((item) => item.type !== 'separator')
    .map((item) => ({ label: item.label, disabled: item.disabled ?? false }));
}

test('library grid video menu contains only approved items in order', () => {
  const items = buildLibraryGridVideoMenu({
    onPlay: noop,
    onOpenExternal: noop,
    onReveal: noop,
    onResetPending: noop,
    onRegenerateThumbnails: noop,
    onCopyPath: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Play', disabled: false },
    { label: 'Open in external player', disabled: false },
    { label: 'Reveal in Explorer', disabled: false },
    { label: 'Reset to pending', disabled: false },
    { label: 'Regenerate thumbnails', disabled: false },
    { label: 'Copy full path', disabled: false },
  ]);
});

test('duplicate video menu contains only approved items in order', () => {
  const items = buildDuplicateVideoMenu({
    onPlay: noop,
    onOpenExternal: noop,
    onReveal: noop,
    onMarkDelete: noop,
    onMarkKeep: noop,
    onResetPending: noop,
    onExcludeFromGroup: noop,
    onSetSelectedKeeper: noop,
    onCopyPath: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Play', disabled: false },
    { label: 'Open in external player', disabled: false },
    { label: 'Reveal in Explorer', disabled: false },
    { label: 'Mark Delete', disabled: false },
    { label: 'Mark Keep', disabled: false },
    { label: 'Reset pending', disabled: false },
    { label: 'Exclude from this group', disabled: false },
    { label: 'Mark as selected keeper', disabled: false },
    { label: 'Copy full path', disabled: false },
  ]);
});

test('duplicate header menu hides manual keeper clear action when not applicable', () => {
  const group = {
    id: 'g1',
    videoIds: ['a', 'b'],
    similarity: 100,
    matchType: 'exact',
    suggestedKeeperId: 'a',
    reason: 'Exact file match',
    manualSuggestedKeeperId: null,
  } satisfies DuplicateGroup;

  const items = buildDuplicateGroupHeaderMenu({
    group,
    canPlaySelectedKeeper: true,
    onDismissGroup: noop,
    onSelectSuggestedDeletions: noop,
    onClearManualKeeperOverride: noop,
    onPlaySelectedKeeper: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Dismiss group', disabled: false },
    { label: 'Select suggested deletions', disabled: false },
    { label: 'Play selected keeper', disabled: false },
  ]);
});

test('duplicate header menu disables keeper playback when no keeper resolves', () => {
  const group = {
    id: 'g1',
    videoIds: ['a', 'b'],
    similarity: 99,
    matchType: 'mixed',
    suggestedKeeperId: null,
    reason: 'Mixed',
  } satisfies DuplicateGroup;

  const items = buildDuplicateGroupHeaderMenu({
    group,
    canPlaySelectedKeeper: false,
    onDismissGroup: noop,
    onSelectSuggestedDeletions: noop,
    onClearManualKeeperOverride: noop,
    onPlaySelectedKeeper: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Dismiss group', disabled: false },
    { label: 'Select suggested deletions', disabled: false },
    { label: 'Play selected keeper', disabled: true },
  ]);
});

test('review mode menu contains only approved items in order', () => {
  const items = buildReviewVideoMenu({
    onOpenExternal: noop,
    onReveal: noop,
    onCopyPath: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Open in external player', disabled: false },
    { label: 'Reveal in Explorer', disabled: false },
    { label: 'Copy full path', disabled: false },
  ]);
});

test('folder header menu contains only approved items in order', () => {
  const items = buildFolderHeaderMenu({
    onReviewFolder: noop,
    onFilterToFolder: noop,
    onRevealFolder: noop,
    onCopyFolderPath: noop,
    onMarkKeep: noop,
    onMarkDelete: noop,
    onResetPending: noop,
    onRegenerateThumbnails: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Review this folder', disabled: false },
    { label: 'Filter to this folder', disabled: false },
    { label: 'Reveal folder in Explorer', disabled: false },
    { label: 'Copy folder path', disabled: false },
    { label: 'Mark all in folder as Keep', disabled: false },
    { label: 'Mark all in folder as Delete', disabled: false },
    { label: 'Reset all videos in folder to pending', disabled: false },
    { label: 'Regenerate thumbnails for folder', disabled: false },
  ]);
});

test('recent folder menu disables add to session for already-loaded roots', () => {
  const items = buildRecentFolderMenu({
    directory: 'F:/Videos',
    loadedDirectories: ['f:\\videos'],
    onOpen: noop,
    onAddToSession: noop,
    onReveal: noop,
    onCopyPath: noop,
  });

  expect(labels(items)).toEqual([
    { label: 'Open', disabled: false },
    { label: 'Add to session', disabled: true },
    { label: 'Reveal in Explorer', disabled: false },
    { label: 'Copy path', disabled: false },
  ]);
});
