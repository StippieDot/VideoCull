import { describe, expect, it, vi } from 'vitest';
import { deleteMarkedVideos, summarizeDeleteResults } from '../../src/deletion';
import type { DeleteFailureReason, DeleteResult } from '../../src/types';

const locked = 'D:\videos\locked.mp4';
const trashed = 'D:\videos\trashed.mp4';
const fail = (path: string, reason: DeleteFailureReason, method: 'trash' | 'permanent' = 'trash'): DeleteResult =>
  ({ path, success: false, method, reason });
const ok = (path: string, method: 'trash' | 'permanent' = 'trash'): DeleteResult => ({ path, success: true, method });

describe('deleteMarkedVideos', () => {
  it('shows the exact failed paths and replaces only those results after confirmation', async () => {
    const confirmPermanentDelete = vi.fn().mockResolvedValue(true);
    const permanentlyDelete = vi.fn().mockResolvedValue([ok(locked, 'permanent')]);

    const results = await deleteMarkedVideos({
      filePaths: [trashed, locked],
      moveToTrash: vi.fn().mockResolvedValue([ok(trashed), fail(locked, 'trash-unavailable')]),
      permanentlyDelete,
      confirmPermanentDelete,
    });

    expect(confirmPermanentDelete).toHaveBeenCalledWith([locked]);
    expect(permanentlyDelete).toHaveBeenCalledWith([locked]);
    expect(results).toEqual([ok(trashed), ok(locked, 'permanent')]);
  });

  it('does not permanently delete files when review is cancelled', async () => {
    const permanentlyDelete = vi.fn();
    const failed = fail(locked, 'trash-unavailable');
    const results = await deleteMarkedVideos({
      filePaths: [locked],
      moveToTrash: vi.fn().mockResolvedValue([failed]),
      permanentlyDelete,
      confirmPermanentDelete: vi.fn().mockResolvedValue(false),
    });

    expect(permanentlyDelete).not.toHaveBeenCalled();
    expect(results).toEqual([failed]);
  });

  const neverPermanent: Array<DeleteFailureReason | undefined> =
    ['changed', 'unverifiable', 'out-of-scope', 'in-use', 'permission', 'not-found', 'unknown', undefined];
  it.each(neverPermanent)('never offers the permanent delete for %s', async (reason) => {
    const confirmPermanentDelete = vi.fn().mockResolvedValue(true);
    const permanentlyDelete = vi.fn();
    const failed = { path: locked, success: false, method: 'trash' as const, reason };
    const results = await deleteMarkedVideos({
      filePaths: [locked],
      moveToTrash: vi.fn().mockResolvedValue([failed]),
      permanentlyDelete,
      confirmPermanentDelete,
      confirmRetry: vi.fn().mockResolvedValue(false),
    });

    expect(confirmPermanentDelete).not.toHaveBeenCalled();
    expect(permanentlyDelete).not.toHaveBeenCalled();
    expect(results).toEqual([failed]);
  });

  it('retries only the files that were in use, and only when asked', async () => {
    const moveToTrash = vi.fn()
      .mockResolvedValueOnce([ok(trashed), fail(locked, 'in-use'), fail('D:\videos\denied.mp4', 'permission')])
      .mockResolvedValueOnce([ok(locked)]);
    const confirmRetry = vi.fn().mockResolvedValue(true);

    const results = await deleteMarkedVideos({
      filePaths: [trashed, locked, 'D:\videos\denied.mp4'],
      moveToTrash,
      permanentlyDelete: vi.fn(),
      confirmPermanentDelete: vi.fn(),
      confirmRetry,
    });

    expect(confirmRetry).toHaveBeenCalledWith([locked]);
    expect(moveToTrash).toHaveBeenLastCalledWith([locked]);
    expect(results.map((r) => r.success)).toEqual([true, true, false]);
  });

  it('keeps the failure when the retry is declined', async () => {
    const moveToTrash = vi.fn().mockResolvedValue([fail(locked, 'in-use')]);
    const results = await deleteMarkedVideos({
      filePaths: [locked],
      moveToTrash,
      permanentlyDelete: vi.fn(),
      confirmPermanentDelete: vi.fn(),
      confirmRetry: vi.fn().mockResolvedValue(false),
    });
    expect(moveToTrash).toHaveBeenCalledTimes(1);
    expect(results).toEqual([fail(locked, 'in-use')]);
  });

  it('asks again while the file stays busy, then offers the permanent delete if the retry finds no Recycle Bin', async () => {
    const moveToTrash = vi.fn()
      .mockResolvedValueOnce([fail(locked, 'in-use')])
      .mockResolvedValueOnce([fail(locked, 'trash-unavailable')]);
    const confirmPermanentDelete = vi.fn().mockResolvedValue(false);
    await deleteMarkedVideos({
      filePaths: [locked],
      moveToTrash,
      permanentlyDelete: vi.fn(),
      confirmPermanentDelete,
      confirmRetry: vi.fn().mockResolvedValue(true),
    });
    expect(confirmPermanentDelete).toHaveBeenCalledWith([locked]);
  });
});

describe('summarizeDeleteResults', () => {
  it('names every reason in a failure', () => {
    const reasons: Array<[DeleteFailureReason, string]> = [
      ['changed', 'changed since the scan'],
      ['unverifiable', 'could not be checked'],
      ['out-of-scope', 'outside the loaded folders'],
      ['in-use', 'in use'],
      ['permission', 'permission denied'],
      ['not-found', 'no longer exists'],
      ['trash-unavailable', 'available'],
      ['unknown', 'unknown error'],
    ];
    for (const [reason, text] of reasons) {
      const summary = summarizeDeleteResults([fail(locked, reason)]);
      expect(summary).toMatchObject({ title: 'Delete failed', kind: 'error' });
      expect(summary.detail).toContain(text);
    }
  });

  it('groups counts per reason and reports a partial result', () => {
    const summary = summarizeDeleteResults([ok(trashed), fail('a', 'in-use'), fail('b', 'in-use'), fail('c', 'permission')]);
    expect(summary.title).toBe('Delete partly failed');
    expect(summary.detail).toContain('1 removed, 3 failed (2 in use, 1 permission denied)');
  });

  it('reports permanent deletes as a warning and plain success with freed size', () => {
    expect(summarizeDeleteResults([ok(locked, 'permanent')])).toMatchObject({ title: 'Permanently deleted', kind: 'warning' });
    const success = summarizeDeleteResults([ok(trashed)], { freedBytes: 2048 });
    expect(success).toMatchObject({ kind: 'success' });
    expect(success.detail).toContain('1 video removed');
    expect(success.detail).toContain('freed');
  });

  it('mentions cleaned-up folders once per folder', () => {
    const summary = summarizeDeleteResults([{ ...ok(trashed), removedFolder: 'D:\videos' }, { ...ok(locked), removedFolder: 'D:\videos' }]);
    expect(summary.detail).toContain('1 empty folder was cleaned up.');
  });
});
