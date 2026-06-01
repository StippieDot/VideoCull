const counters = new Map();
const timings = new Map();
const latestRuns = new Map();
const activeRuns = new Map();
let nextRunId = 0;

function reset() {
  counters.clear();
  timings.clear();
  latestRuns.clear();
  activeRuns.clear();
}

function ensureCounter(name) {
  const existing = counters.get(name);
  if (existing) return existing;
  const initial = { count: 0, total: 0, max: 0 };
  counters.set(name, initial);
  return initial;
}

function recordCounter(name, amount = 1) {
  const counter = ensureCounter(name);
  counter.count += 1;
  counter.total += amount;
  counter.max = Math.max(counter.max, amount);
}

function ensureTiming(name) {
  const existing = timings.get(name);
  if (existing) return existing;
  const initial = { count: 0, totalMs: 0, maxMs: 0, totalItems: 0 };
  timings.set(name, initial);
  return initial;
}

function recordTiming(name, durationMs, options = {}) {
  const timing = ensureTiming(name);
  timing.count += 1;
  timing.totalMs += durationMs;
  timing.maxMs = Math.max(timing.maxMs, durationMs);
  timing.totalItems += options.items ?? 0;
}

function beginRun(name, meta = {}) {
  const run = {
    id: ++nextRunId,
    name,
    meta,
    startedAt: performance.now(),
    counters: {},
    timings: {},
  };
  activeRuns.set(name, run);
  return run;
}

function recordRunCounter(run, name, amount = 1) {
  if (!run) return;
  const current = run.counters[name] ?? { count: 0, total: 0, max: 0 };
  current.count += 1;
  current.total += amount;
  current.max = Math.max(current.max, amount);
  run.counters[name] = current;
  recordCounter(`${run.name}.${name}`, amount);
}

function recordRunTiming(run, name, durationMs, options = {}) {
  if (!run) return;
  const current = run.timings[name] ?? { count: 0, totalMs: 0, maxMs: 0, totalItems: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.totalItems += options.items ?? 0;
  run.timings[name] = current;
  recordTiming(`${run.name}.${name}`, durationMs, options);
}

function getActiveRun(name) {
  return activeRuns.get(name) ?? null;
}

function finishRun(run, extra = {}) {
  if (!run) return null;
  if (activeRuns.get(run.name) === run) {
    activeRuns.delete(run.name);
  }
  const durationMs = performance.now() - run.startedAt;
  const snapshot = {
    id: run.id,
    name: run.name,
    meta: run.meta,
    extra,
    durationMs,
    counters: run.counters,
    timings: run.timings,
    finishedAt: Date.now(),
  };
  latestRuns.set(run.name, snapshot);
  recordTiming(`${run.name}.total`, durationMs);
  return snapshot;
}

function snapshotMap(map) {
  return Object.fromEntries(Array.from(map.entries()).map(([key, value]) => [key, { ...value }]));
}

function getSnapshot() {
  return {
    counters: snapshotMap(counters),
    timings: snapshotMap(timings),
    latestRuns: snapshotMap(latestRuns),
  };
}

module.exports = {
  beginRun,
  finishRun,
  getActiveRun,
  getSnapshot,
  recordCounter,
  recordRunCounter,
  recordRunTiming,
  recordTiming,
  reset,
};
