import { describe, expect, test } from 'vitest';
import { __test__ } from '../../../src/components/ReviewMode';
import { makeVideo } from '../../helpers/videoFactory';

describe('ReviewMode helpers', () => {
  test('builds review-scope progress and summary data in one pass', () => {
    const alpha = makeVideo('alpha', { status: 'pending' });
    const beta = makeVideo('beta', { status: 'keep' });
    const gamma = makeVideo('gamma', { status: 'delete', sizeBytes: 300 });
    const delta = makeVideo('delta', { status: 'skipped' });
    const videosById = new Map([
      [alpha.id, alpha],
      [beta.id, beta],
      [gamma.id, gamma],
      [delta.id, delta],
    ]);

    const result = __test__.buildReviewScope(videosById, ['alpha', 'missing', 'beta', 'gamma', 'delta']);

    expect(result.reviewVideos.map((video) => video.id)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(result.pendingIndexes).toEqual([0]);
    expect(result.decidedCount).toBe(3);
    expect(result.remainingCount).toBe(1);
    expect(result.progressPct).toBe(75);
    expect(result.summary).toEqual({
      keep: 1,
      delete: 1,
      skipped: 1,
      pending: 1,
      deleteSize: 300,
    });
  });
});
