import { MAX_RECENT_SESSIONS, folderKey, folderVolume, pruneRecentSessions, rememberSession, sameSessionFolders, sessionKey, sessionLabel, shownFolders } from '../../src/sessions';
import type { RecentSession } from '../../src/types';

const recent = (folders: string[], openedAt = 1): RecentSession => ({ folders, includeSubfolders: true, openedAt });

describe('sameSessionFolders', () => {
  test('ignores order, letter case and trailing separators', () => {
    expect(sameSessionFolders(['D:\\Trips', 'e:/clips/'], ['E:\\Clips', 'd:\\trips'])).toBe(true);
  });

  test('gives every spelling of one session the same key, so lists agree on which entry is meant', () => {
    expect(sessionKey(['D:\\Trips', 'E:\\Clips'])).toBe(sessionKey(['e:/clips/', 'd:\\TRIPS']));
    expect(sessionKey(['D:\\Trips'])).not.toBe(sessionKey(['D:\\Trips', 'E:\\Clips']));
  });

  test('differs when a folder is added or swapped', () => {
    expect(sameSessionFolders(['D:\\Trips'], ['D:\\Trips', 'E:\\Clips'])).toBe(false);
    expect(sameSessionFolders(['D:\\Trips'], ['D:\\Trip'])).toBe(false);
  });
});

describe('rememberSession', () => {
  test('moves a matching session to the front with the new subfolder choice', () => {
    const recents = [recent(['D:\\A']), recent(['E:\\B', 'D:\\A'])];
    expect(rememberSession(recents, { folders: ['d:\\a', 'e:\\b'], includeSubfolders: false }, 9)).toEqual([
      { folders: ['d:\\a', 'e:\\b'], includeSubfolders: false, openedAt: 9 },
      recent(['D:\\A']),
    ]);
  });

  test('adding a folder replaces the entry of the session it grew from', () => {
    const recents = [recent(['D:\\A']), recent(['F:\\Other'])];
    expect(rememberSession(recents, { folders: ['D:\\A', 'E:\\B'], includeSubfolders: true }, 9, ['D:\\A'])).toEqual([
      { folders: ['D:\\A', 'E:\\B'], includeSubfolders: true, openedAt: 9 },
      recent(['F:\\Other']),
    ]);
  });

  test('keeps at most the newest sessions', () => {
    const recents = Array.from({ length: MAX_RECENT_SESSIONS }, (_, index) => recent([`D:\\${index}`]));
    const next = rememberSession(recents, { folders: ['E:\\New'], includeSubfolders: true }, 9);
    expect(next).toHaveLength(MAX_RECENT_SESSIONS);
    expect(next[0].folders).toEqual(['E:\\New']);
    expect(next.some((entry) => entry.folders[0] === `D:\\${MAX_RECENT_SESSIONS - 1}`)).toBe(false);
  });
});

test('a session label names one folder, or the first and how many more', () => {
  expect(sessionLabel(['D:\\A'])).toBe('D:\\A');
  expect(sessionLabel(['D:\\A', 'E:\\B', 'F:\\C'])).toBe('D:\\A + 2 more');
});

describe('pruneRecentSessions', () => {
  // D: is there with D:\Trips and D:\Family; D:\Deleted is gone; E: (an unplugged drive) and the share are offline.
  const existing = new Set(['D:\\', 'D:\\Trips', 'D:\\Family']);
  const validator = vi.fn(async (path: string) => {
    if (path.startsWith('\\\\nas')) throw new Error('timed out');
    return { valid: existing.has(path), isDirectory: existing.has(path) };
  });

  test('keeps a session while any of its folders exists', async () => {
    const kept = recent(['D:\\Deleted', 'D:\\Trips']);
    await expect(pruneRecentSessions([kept], validator))
      .resolves.toEqual({ recentSessions: [kept], missingFolders: ['D:\\Deleted'] });
  });

  test('drops a session whose folders were deleted from a drive that is there', async () => {
    await expect(pruneRecentSessions([recent(['D:\\Deleted']), recent(['D:\\Family'])], validator))
      .resolves.toEqual({ recentSessions: [recent(['D:\\Family'])], missingFolders: [] });
  });

  test('keeps a session on an unplugged drive or offline share, marked unavailable', async () => {
    const offline = recent(['E:\\Holiday', '\\\\nas\\videos\\Clips']);
    await expect(pruneRecentSessions([offline], validator))
      .resolves.toEqual({ recentSessions: [offline], missingFolders: ['E:\\Holiday', '\\\\nas\\videos\\Clips'] });
  });
});

test('a folder lives on its drive or network share', () => {
  expect(folderVolume('E:\\Holiday\\2024')).toBe('E:\\');
  expect(folderVolume('\\\\nas\\videos\\Clips')).toBe('\\\\nas\\videos\\');
  expect(folderVolume('//nas/videos')).toBe('\\\\nas\\videos\\');
  expect(folderVolume('relative')).toBeNull();
});

test('a recent session shows only its reachable folders, or all of them when none can be reached', () => {
  const unreachable = new Set([folderKey('E:\\Offline')]);
  expect(shownFolders(['D:\\Trips', 'e:\\offline'], unreachable)).toEqual(['D:\\Trips']);
  expect(shownFolders(['E:\\Offline'], unreachable)).toEqual(['E:\\Offline']);
});
