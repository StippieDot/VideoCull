import { MAX_RECENT_SESSIONS, pruneRecentSessions, rememberSession, sameSessionFolders, sessionKey, sessionLabel } from '../../src/sessions';
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
  const validator = vi.fn(async (path: string) => {
    if (path === 'throw') throw new Error('boom');
    return { valid: path !== 'missing', isDirectory: path.startsWith('folder') };
  });

  test('keeps a session while any of its folders exists and drops it when none do', async () => {
    const kept = recent(['missing', 'folder-a']);
    await expect(pruneRecentSessions([kept, recent(['missing', 'throw']), recent(['folder-b'])], validator))
      .resolves.toEqual([kept, recent(['folder-b'])]);
  });
});
