type DevPerfSampleOptions = {
  items?: number;
};

type DevPerfCounter = {
  count: number;
  total: number;
  max: number;
};

type DevPerfTiming = {
  count: number;
  totalMs: number;
  maxMs: number;
  totalItems: number;
  lastReportAt: number;
};

export type DevPerfSnapshot = RendererPerformanceSnapshot;

export type DevPerfGlobal = {
  getSnapshot: () => DevPerfSnapshot;
  getCombinedSnapshot: () => Promise<{
    renderer: DevPerfSnapshot;
    main: PerformanceStatsSnapshot | undefined;
  }>;
  reset: () => void;
  resetAll: () => Promise<void>;
};

const REPORT_INTERVAL_MS = 5000;
const counters = new Map<string, DevPerfCounter>();
const timings = new Map<string, DevPerfTiming>();
let longTaskObserver: PerformanceObserver | null = null;

function devPerfEnabled() {
  return import.meta.env.DEV && typeof performance !== 'undefined';
}

function ensureCounter(name: string): DevPerfCounter {
  const existing = counters.get(name);
  if (existing) return existing;
  const initial = { count: 0, total: 0, max: 0 };
  counters.set(name, initial);
  return initial;
}

function ensureTiming(name: string): DevPerfTiming {
  const existing = timings.get(name);
  if (existing) return existing;
  const initial = { count: 0, totalMs: 0, maxMs: 0, totalItems: 0, lastReportAt: Date.now() };
  timings.set(name, initial);
  return initial;
}

function maybeReportTiming(name: string, timing: DevPerfTiming) {
  const now = Date.now();
  if (now - timing.lastReportAt < REPORT_INTERVAL_MS) return;
  const averageMs = timing.totalMs / Math.max(1, timing.count);
  const averageItems = timing.totalItems / Math.max(1, timing.count);
  console.debug(
    `[perf] ${name}: count=${timing.count} avg=${averageMs.toFixed(2)}ms max=${timing.maxMs.toFixed(2)}ms avgItems=${averageItems.toFixed(1)}`
  );
  timing.lastReportAt = now;
}

export function recordDevCounter(name: string, amount = 1) {
  if (!devPerfEnabled()) return;
  const counter = ensureCounter(name);
  counter.count += 1;
  counter.total += amount;
  counter.max = Math.max(counter.max, amount);
}

export function recordDevPerf(name: string, durationMs: number, options: DevPerfSampleOptions = {}) {
  if (!devPerfEnabled()) return;
  const timing = ensureTiming(name);
  timing.count += 1;
  timing.totalMs += durationMs;
  timing.maxMs = Math.max(timing.maxMs, durationMs);
  timing.totalItems += options.items ?? 0;
  maybeReportTiming(name, timing);
}

export function recordReactCommit(
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
  context: string
) {
  if (!devPerfEnabled()) return;
  recordDevCounter(`${id}.commitCount.${context}`);
  recordDevCounter(`${id}.commitPhase.${phase}`);
  recordDevPerf(`${id}.commitDuration.${context}`, actualDuration);
  recordDevPerf(`${id}.baseDuration.${context}`, baseDuration);
  recordDevPerf(`${id}.commitLatency.${context}`, Math.max(0, commitTime - startTime));
}

export function startLongTaskObserver() {
  if (!devPerfEnabled() || longTaskObserver || typeof PerformanceObserver === 'undefined') return;
  if (!(PerformanceObserver as typeof PerformanceObserver & { supportedEntryTypes?: string[] }).supportedEntryTypes?.includes('longtask')) {
    return;
  }

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordDevCounter('renderer.longTaskCount');
        recordDevPerf('renderer.longTaskDuration', entry.duration);
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch (err) {
    console.debug('[perf] longtask observer unavailable', err);
    longTaskObserver = null;
  }
}

function snapshotCounters() {
  return Object.fromEntries(Array.from(counters.entries()).map(([key, value]) => [key, { ...value }]));
}

function snapshotTimings() {
  return Object.fromEntries(Array.from(timings.entries()).map(([key, value]) => {
    const { lastReportAt: _lastReportAt, ...timing } = value;
    return [key, { ...timing }];
  }));
}

export function getDevPerfSnapshot(): DevPerfSnapshot {
  return {
    counters: snapshotCounters(),
    timings: snapshotTimings(),
    latestRuns: {},
  };
}

export function resetDevPerf() {
  counters.clear();
  timings.clear();
}

export function installDevPerfGlobal() {
  if (!devPerfEnabled() || typeof window === 'undefined') return;

  const globalApi: DevPerfGlobal = {
    getSnapshot: () => getDevPerfSnapshot(),
    getCombinedSnapshot: async () => ({
      renderer: getDevPerfSnapshot(),
      main: await window.electronAPI?.getPerformanceStats?.(),
    }),
    reset: () => resetDevPerf(),
    resetAll: async () => {
      resetDevPerf();
      await window.electronAPI?.resetPerformanceStats?.();
    },
  };

  window.__VIDEO_CULL_DEV_PERF__ = globalApi;
}
import type { PerformanceStatsSnapshot, RendererPerformanceSnapshot } from './types';
