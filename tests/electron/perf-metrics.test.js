const assert = require('node:assert/strict');
const perfMetrics = require('../../electron/perf-metrics');

test('perf metrics records counters, timings, and run snapshots', async () => {
  perfMetrics.reset();

  perfMetrics.recordCounter('scanProgressEvents', 5);
  perfMetrics.recordTiming('computeFiltered', 12.5, { items: 100 });

  const run = perfMetrics.beginRun('duplicate', { videoCount: 4 });
  perfMetrics.recordRunCounter(run, 'duplicateFingerprintQueryCount');
  perfMetrics.recordRunTiming(run, 'duplicateFingerprintQueryMs', 3.25, { items: 4 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const finished = perfMetrics.finishRun(run, { status: 'ok' });
  const snapshot = perfMetrics.getSnapshot();

  assert.equal(snapshot.counters.scanProgressEvents.total, 5);
  assert.equal(snapshot.timings.computeFiltered.totalItems, 100);
  assert.equal(finished?.extra.status, 'ok');
  assert.equal(snapshot.latestRuns.duplicate.meta.videoCount, 4);
  assert.equal(snapshot.latestRuns.duplicate.counters.duplicateFingerprintQueryCount.count, 1);
  assert.equal(snapshot.latestRuns.duplicate.timings.duplicateFingerprintQueryMs.totalItems, 4);
  assert.ok(snapshot.timings['duplicate.total'].totalMs >= 0);
});

test('finishing an older run does not clear a newer active run with the same name', () => {
  perfMetrics.reset();

  const first = perfMetrics.beginRun('scan', { id: 'first' });
  const second = perfMetrics.beginRun('scan', { id: 'second' });
  perfMetrics.finishRun(first, { status: 'superseded' });

  assert.equal(perfMetrics.getActiveRun('scan')?.meta.id, 'second');

  perfMetrics.finishRun(second, { status: 'ok' });
  assert.equal(perfMetrics.getActiveRun('scan'), null);
});
