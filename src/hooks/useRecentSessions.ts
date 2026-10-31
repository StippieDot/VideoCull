import useStore from '../store';
import { checkSessionFolders, folderKey, sessionKey, sessionLabel, shownFolders } from '../sessions';
import { formatRecentPath, formatRelativeTime } from '../utils';
import { copyTextToClipboard } from '../components/ContextMenu';
import { buildCopyPathSuccessDetail, buildRecentFolderMenu } from '../components/contextMenuBuilders';
import { revealInExplorer } from '../appCommands';
import type { RecentSession, ToastInput, ToastKind } from '../types';

type Notify = (toast: ToastInput | string, kind?: ToastKind) => void;

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** What the recent-session lists (start screen and sidebar) can do with an entry. */
export default function useRecentSessions(onNotify: Notify, onOpened?: () => void) {
  const recentSessions = useStore((s) => s.settings.recentSessions);
  const directories = useStore((s) => s.directories);
  const unreachable = useStore((s) => s.unreachableFolders);

  const isMissing = (folder: string) => unreachable.has(folderKey(folder));
  const isUnavailable = (recent: RecentSession) => recent.folders.every(isMissing);

  /** "Videos / Trips", or "Videos / Trips + 2 more" for a session with several reachable folders. */
  const name = (recent: RecentSession) => sessionLabel(shownFolders(recent.folders, unreachable).map(formatRecentPath));

  const open = async (recent: RecentSession) => {
    if (await useStore.getState().reopenSession(recent)) onOpened?.();
  };

  const addToSession = async (recent: RecentSession) => {
    const validator = window.electronAPI?.validateDroppedPath;
    const { reachable, missing } = validator
      ? await checkSessionFolders(recent.folders, validator)
      : { reachable: recent.folders, missing: [] };
    useStore.getState().markFolderReachability(reachable, missing);
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
      detail: name(recent),
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

  /** "Unavailable", or when the session was last opened. */
  const meta = (recent: RecentSession) => (isUnavailable(recent) ? 'Unavailable' : formatRelativeTime(recent.openedAt));

  /** Every folder of the session, unreachable ones marked, then when it was opened. */
  const tooltip = (recent: RecentSession) => {
    const folders = recent.folders.map((folder) => (isMissing(folder) ? `${folder} (unavailable)` : folder));
    return `${folders.join('\n')} • ${isUnavailable(recent) ? 'unavailable' : `opened ${formatRelativeTime(recent.openedAt)}`}`;
  };

  const menuItems = (recent: RecentSession, withRemove: boolean) => buildRecentFolderMenu({
    folders: recent.folders,
    loadedDirectories: directories,
    onOpen: () => void open(recent),
    onAddToSession: () => void addToSession(recent),
    onReveal: () => revealInExplorer(shownFolders(recent.folders, unreachable)[0]),
    onCopyPath: () => void copyPaths(recent),
    ...(withRemove ? { onRemove: () => remove(recent) } : {}),
  });

  return { recentSessions, open, remove, clearAll, name, meta, tooltip, menuItems };
}
