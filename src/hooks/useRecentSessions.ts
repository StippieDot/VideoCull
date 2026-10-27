import { useState } from 'react';
import useStore from '../store';
import { checkSessionFolders, sessionKey, sessionLabel } from '../sessions';
import { formatRecentPath, formatRelativeTime } from '../utils';
import { copyTextToClipboard } from '../components/ContextMenu';
import { buildCopyPathSuccessDetail, buildRecentFolderMenu } from '../components/contextMenuBuilders';
import { revealInExplorer } from '../appCommands';
import type { RecentSession, ToastInput, ToastKind } from '../types';

type Notify = (toast: ToastInput | string, kind?: ToastKind) => void;

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** "Videos / Trips", or "Videos / Trips + 2 more" for a session with several folders. */
export function recentSessionName(recent: RecentSession): string {
  return sessionLabel(recent.folders.map(formatRecentPath));
}

/** What the recent-session lists (start screen and sidebar) can do with an entry. */
export default function useRecentSessions(onNotify: Notify, onOpened?: () => void) {
  const recentSessions = useStore((s) => s.settings.recentSessions);
  const directories = useStore((s) => s.directories);
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());

  const markAvailable = (recent: RecentSession, available: boolean) => {
    const key = sessionKey(recent.folders);
    setUnavailable((prev) => {
      if (prev.has(key) !== available) return prev;
      const next = new Set(prev);
      if (available) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const open = async (recent: RecentSession) => {
    const opened = await useStore.getState().reopenSession(recent);
    markAvailable(recent, opened);
    if (opened) onOpened?.();
  };

  const addToSession = async (recent: RecentSession) => {
    const validator = window.electronAPI?.validateDroppedPath;
    const { reachable, missing } = validator
      ? await checkSessionFolders(recent.folders, validator)
      : { reachable: recent.folders, missing: [] };
    markAvailable(recent, reachable.length > 0);
    if (missing.length > 0) {
      onNotify({
        title: reachable.length === 0 ? 'Folder unavailable' : `${missing.length} ${missing.length === 1 ? 'folder' : 'folders'} not added`,
        detail: missing.map(formatRecentPath).join('\n'),
        kind: 'warning',
        dedupeKey: `recent-unavailable:${sessionKey(recent.folders)}`,
      });
    }
    if (reachable.length === 0) return;
    const before = useStore.getState().directories;
    for (const folder of reachable) useStore.getState().addDirectory(folder);
    const changed = !sameStrings(before, useStore.getState().directories);
    const detail = sessionLabel(reachable.map(formatRecentPath));
    onNotify(changed
      ? { title: reachable.length === 1 ? 'Folder added' : 'Folders added', detail, kind: 'success', dedupeKey: `recent-added:${sessionKey(reachable)}` }
      : { title: 'Folder already covered', detail, kind: 'info', dedupeKey: `recent-covered:${sessionKey(reachable)}` });
  };

  const remove = (recent: RecentSession) => {
    useStore.getState().removeRecentSession(recent.folders);
    onNotify({
      title: 'Recent removed',
      detail: recentSessionName(recent),
      kind: 'info',
      dedupeKey: `recent-removed:${sessionKey(recent.folders)}`,
    });
  };

  const clearAll = () => {
    const removedCount = recentSessions.length;
    useStore.getState().clearRecentSessions();
    onNotify({
      title: 'Recents cleared',
      detail: `${removedCount} ${removedCount === 1 ? 'entry' : 'entries'} removed.`,
      kind: 'info',
    });
  };

  const copyPaths = async (recent: RecentSession) => {
    const text = recent.folders.join('\n');
    try {
      await copyTextToClipboard(text);
      onNotify({ title: 'Path copied', detail: buildCopyPathSuccessDetail(text), kind: 'success' });
    } catch (error) {
      console.error('Failed to copy path:', error);
      onNotify({ title: 'Copy failed', detail: 'The path could not be copied to the clipboard.', kind: 'error' });
    }
  };

  const isUnavailable = (recent: RecentSession) => unavailable.has(sessionKey(recent.folders));

  /** "Unavailable", or when the session was last opened. */
  const meta = (recent: RecentSession) => (isUnavailable(recent) ? 'Unavailable' : formatRelativeTime(recent.openedAt));

  /** Every folder of the session, then when it was opened. */
  const tooltip = (recent: RecentSession) => (
    `${recent.folders.join('\n')} • ${isUnavailable(recent) ? 'unavailable' : `opened ${formatRelativeTime(recent.openedAt)}`}`
  );

  const menuItems = (recent: RecentSession, withRemove: boolean) => buildRecentFolderMenu({
    folders: recent.folders,
    loadedDirectories: directories,
    onOpen: () => void open(recent),
    onAddToSession: () => void addToSession(recent),
    onReveal: () => revealInExplorer(recent.folders[0]),
    onCopyPath: () => void copyPaths(recent),
    ...(withRemove ? { onRemove: () => remove(recent) } : {}),
  });

  return { recentSessions, open, remove, clearAll, meta, tooltip, menuItems };
}
