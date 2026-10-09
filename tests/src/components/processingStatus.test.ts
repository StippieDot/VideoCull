import { formatTimeLeft, listProcessingJobs, TimeLeftEstimator } from '../../../src/components/processingStatus';

test('every running job is listed, most important first', () => {
  const jobs = listProcessingJobs({
    isGenerating: true,
    genProgress: { current: 3, total: 10, phase: 'metadata' },
    isFindingDuplicates: true,
    duplicateProgress: { stage: 'Confirming visual matches', current: 1, total: 3 },
    isScanning: true,
    scanProgress: { found: 1200, currentFile: '' },
  });
  expect(jobs.map((job) => [job.label, job.detail, job.fraction])).toEqual([
    ['Reading video info', '3 / 10', 0.3],
    // Pair counts run into the millions, so a percentage.
    ['Confirming visual matches', '33%', 1 / 3],
    ['Scanning', `${(1200).toLocaleString()} found`, null],
  ]);
});

test('time left needs 10 seconds of progress, follows the recent rate and starts over for a new stage', () => {
  const estimator = new TimeLeftEstimator();
  expect(estimator.update('a', 0.1, 0)).toBeNull();
  expect(estimator.update('a', 0.15, 5_000)).toBeNull();
  // 10% in 10 s: the other 80% takes 80 s.
  expect(estimator.update('a', 0.2, 10_000)).toBeCloseTo(80);
  // Only about the last 30 seconds count: a slow start is forgotten.
  estimator.update('a', 0.3, 40_000);
  expect(estimator.update('a', 0.6, 70_000)).toBeCloseTo(40);
  // A new stage starts from nothing.
  expect(estimator.update('b', 0.7, 71_000)).toBeNull();
});

test('time left reads as minutes, or hours and minutes', () => {
  expect(formatTimeLeft(20)).toBe('<1 min left');
  expect(formatTimeLeft(250)).toBe('~4 min left');
  expect(formatTimeLeft(3_600)).toBe('~1 h left');
  expect(formatTimeLeft(4_800)).toBe('~1 h 20 min left');
});
