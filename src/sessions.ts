import type { RecentSession, SavedSession } from './types';

export const MAX_RECENT_SESSIONS = 8;

/**
 * A folder in a form where equal Windows folders compare equal. Kept in step with `realPathKey` in
 * electron/scanner.js, which compares the same paths on the main-process side.
 */
export function folderKey(folder: string): string {
  return folder.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Identifies a session: the same for the same folders in any order and letter case, so every place
 * that tells sessions apart agrees. `|` cannot appear in a Windows path.
 */
export function sessionKey(folders: string[]): string {
  return [...new Set(folders.map(folderKey))].sort().join('|');
}

/** Two sessions are the same when they hold the same folders, in any order and letter case. */
export function sameSessionFolders(a: string[], b: string[]): boolean {
  return sessionKey(a) === sessionKey(b);
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

/**
 * The folders a recent session shows: the ones that can be reached, or all of them when none can,
 * so an entry never shows up empty.
 */
export function shownFolders(folders: string[], unreachable: ReadonlySet<string>): string[] {
  const reachable = folders.filter((folder) => !unreachable.has(folderKey(folder)));
  return reachable.length > 0 ? reachable : folders;
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

/** Whether a path is a folder that can be opened now (the preload's validateDroppedPath). */
export type FolderValidator = (path: string) => Promise<{ valid: boolean; isDirectory: boolean }>;

/** Splits folders into the ones that can be opened now and the ones that cannot. */
export async function checkSessionFolders(
  folders: string[],
  validator: FolderValidator,
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

/** The drive (`E:\`) or network share (`\\server\share\`) a folder lives on; null when there is none. */
export function folderVolume(folder: string): string | null {
  const normalized = folder.replace(/\//g, '\\');
  const share = /^\\\\[^\\]+\\[^\\]+/.exec(normalized);
  if (share) return `${share[0]}\\`;
  const drive = /^[a-z]:/i.exec(normalized);
  return drive ? `${drive[0]}\\` : null;
}

/**
 * A recent session is dropped at startup only when none of its folders exist any more. A folder whose
 * drive or share cannot be reached (unplugged, offline) is not gone: its session stays, marked
 * unavailable. Also returns every folder of the kept sessions that cannot be reached, which the lists
 * leave out.
 */
export async function pruneRecentSessions(
  recents: RecentSession[],
  validator: FolderValidator,
): Promise<{ recentSessions: RecentSession[]; missingFolders: string[] }> {
  const checked = await Promise.all(recents.map((recent) => checkSessionFolders(recent.folders, validator)));
  const volumes = [...new Set(checked.flatMap((result) => result.missing.map(folderVolume)))]
    .filter((volume): volume is string => volume !== null);
  const { reachable: reachableVolumes } = await checkSessionFolders(volumes, validator);
  const onReachableVolume = new Set(reachableVolumes.map(folderKey));
  // Only a folder on a drive or share that is there now is known to be deleted.
  const isGone = (folder: string) => {
    const volume = folderVolume(folder);
    return volume !== null && onReachableVolume.has(folderKey(volume));
  };
  const keep = checked.map((result) => result.reachable.length > 0 || !result.missing.every(isGone));
  return {
    recentSessions: recents.filter((_, index) => keep[index]),
    missingFolders: checked.filter((_, index) => keep[index]).flatMap((result) => result.missing),
  };
}
