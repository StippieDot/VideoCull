import type { RecentSession, SavedSession } from './types';

export const MAX_RECENT_SESSIONS = 8;

function folderKey(folder: string): string {
  return folder.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** Two sessions are the same when they hold the same folders, in any order and letter case. */
export function sameSessionFolders(a: string[], b: string[]): boolean {
  const keys = new Set(a.map(folderKey));
  const other = new Set(b.map(folderKey));
  return keys.size === other.size && [...keys].every((key) => other.has(key));
}

/** Identifies a recent session in menus and lists; `|` cannot appear in a Windows path. */
export function sessionKey(folders: string[]): string {
  return folders.join('|');
}

/**
 * Moves `session` to the front of the recents. `replacing` names the folders the session held
 * before this change, so adding a folder updates that entry instead of creating another one.
 */
export function rememberSession(
  recents: RecentSession[],
  session: SavedSession,
  now: number,
  replacing: string[] = session.folders,
): RecentSession[] {
  const rest = recents.filter((recent) => (
    !sameSessionFolders(recent.folders, session.folders) && !sameSessionFolders(recent.folders, replacing)
  ));
  return [{ ...session, openedAt: now }, ...rest].slice(0, MAX_RECENT_SESSIONS);
}

/** One folder shows its path; several show the first and how many more. */
export function sessionLabel(folders: string[]): string {
  return folders.length > 1 ? `${folders[0]} + ${folders.length - 1} more` : folders[0] ?? '';
}

function isFolderList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((folder) => typeof folder === 'string' && folder.length > 0);
}

export function parseSavedSession(value: unknown): SavedSession | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isFolderList(raw.folders)) return null;
  return { folders: [...raw.folders], includeSubfolders: raw.includeSubfolders !== false };
}

/**
 * Recent sessions from settings on disk. Settings written before sessions existed only hold
 * single folders; each becomes a one-folder session with its own opened time.
 */
export function parseRecentSessions(raw: Record<string, unknown>): RecentSession[] {
  if (Array.isArray(raw.recentSessions)) {
    return raw.recentSessions.flatMap((value): RecentSession[] => {
      const session = parseSavedSession(value);
      if (!session) return [];
      const openedAt = Number((value as Record<string, unknown>).openedAt);
      return [{ ...session, openedAt: Number.isFinite(openedAt) ? openedAt : 0 }];
    }).slice(0, MAX_RECENT_SESSIONS);
  }
  const folders = Array.isArray(raw.recentDirectories)
    ? raw.recentDirectories.filter((folder): folder is string => typeof folder === 'string' && folder.length > 0)
    : [];
  const timestamps = raw.recentDirectoryTimestamps && typeof raw.recentDirectoryTimestamps === 'object'
    ? raw.recentDirectoryTimestamps as Record<string, unknown>
    : {};
  return folders.slice(0, MAX_RECENT_SESSIONS).map((folder) => ({
    folders: [folder],
    // Subfolders were a per-run choice before sessions; on is the app default.
    includeSubfolders: true,
    openedAt: typeof timestamps[folder] === 'number' ? timestamps[folder] as number : 0,
  }));
}

/** Splits folders into the ones that can be opened now and the ones that cannot. */
export async function checkSessionFolders(
  folders: string[],
  validator: (path: string) => Promise<{ valid: boolean; isDirectory: boolean }>,
): Promise<{ reachable: string[]; missing: string[] }> {
  const results = await Promise.all(folders.map(async (folder) => {
    try {
      const result = await validator(folder);
      return result.valid && result.isDirectory;
    } catch {
      return false;
    }
  }));
  return {
    reachable: folders.filter((_, index) => results[index]),
    missing: folders.filter((_, index) => !results[index]),
  };
}

/** A recent session is dropped at startup only when none of its folders exist any more. */
export async function pruneRecentSessions(
  recents: RecentSession[],
  validator: (path: string) => Promise<{ valid: boolean; isDirectory: boolean }>,
): Promise<RecentSession[]> {
  const checked = await Promise.all(recents.map((recent) => checkSessionFolders(recent.folders, validator)));
  return recents.filter((_, index) => checked[index].reachable.length > 0);
}
