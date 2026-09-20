import { describe, expect, it, vi } from 'vitest';
import { deleteWithPermanentReview } from '../../src/deletion';

describe('deleteWithPermanentReview', () => {
  it('shows the exact failed paths and replaces only those results after confirmation', async () => {
    const confirmPermanentDelete = vi.fn().mockResolvedValue(true);
    const permanentlyDelete = vi.fn().mockResolvedValue([
      { path: 'D:\\videos\\locked.mp4', success: true, method: 'permanent' },
    ]);

    const results = await deleteWithPermanentReview({
      filePaths: ['D:\\videos\\trashed.mp4', 'D:\\videos\\locked.mp4'],
      moveToTrash: vi.fn().mockResolvedValue([
        { path: 'D:\\videos\\trashed.mp4', success: true, method: 'trash' },
        { path: 'D:\\videos\\locked.mp4', success: false, method: 'trash' },
      ]),
      permanentlyDelete,
      confirmPermanentDelete,
    });

    expect(confirmPermanentDelete).toHaveBeenCalledWith(['D:\\videos\\locked.mp4']);
    expect(permanentlyDelete).toHaveBeenCalledWith(['D:\\videos\\locked.mp4']);
    expect(results).toEqual([
      { path: 'D:\\videos\\trashed.mp4', success: true, method: 'trash' },
      { path: 'D:\\videos\\locked.mp4', success: true, method: 'permanent' },
    ]);
  });

  it('does not permanently delete files when review is cancelled', async () => {
    const permanentlyDelete = vi.fn();
    const failedResult = { path: 'D:\\videos\\locked.mp4', success: false, method: 'trash' as const };
    const results = await deleteWithPermanentReview({
      filePaths: [failedResult.path],
      moveToTrash: vi.fn().mockResolvedValue([failedResult]),
      permanentlyDelete,
      confirmPermanentDelete: vi.fn().mockResolvedValue(false),
    });

    expect(permanentlyDelete).not.toHaveBeenCalled();
    expect(results).toEqual([failedResult]);
  });
});
