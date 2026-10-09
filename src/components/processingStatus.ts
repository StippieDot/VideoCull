import type { DuplicateProgress, ScanProgress, ThumbProgress } from '../types';

export interface ProcessingJob {
  id: 'media' | 'duplicates' | 'scan';
  label: string;
  /** Counts or a percentage; empty while the size of the job is not known yet. */
  detail: string;
  /** 0–1, or null when there is no end to measure against (scanning). */
  fraction: number | null;
}

export interface ProcessingInputs {
  isGenerating: boolean;
  genProgress: ThumbProgress;
  isFindingDuplicates: boolean;
  duplicateProgress: DuplicateProgress | null;
  isScanning: boolean;
  scanProgress: ScanProgress;
}

const GENERATION_LABELS = { metadata: 'Reading video info', media: 'Media data', thumbnails: 'Thumbnails' } as const;

// These stages count pairs of videos, which run into the millions: a percentage reads better.
const PAIR_STAGES = new Set<DuplicateProgress['stage']>(['Comparing pHashes', 'Confirming visual matches']);

const count = (current: number, total: number) => `${current.toLocaleString()} / ${total.toLocaleString()}`;

/** Everything processing right now, most important first; empty when idle. */
export function listProcessingJobs(state: ProcessingInputs): ProcessingJob[] {
  const jobs: ProcessingJob[] = [];
  if (state.isGenerating) {
    const { current, total, phase } = state.genProgress;
    jobs.push({
      id: 'media',
      label: GENERATION_LABELS[phase ?? 'thumbnails'],
      detail: total > 0 ? count(current, total) : '',
      fraction: total > 0 ? current / total : null,
    });
  }
  if (state.isFindingDuplicates && state.duplicateProgress) {
    const { stage, current, total } = state.duplicateProgress;
    jobs.push({
      id: 'duplicates',
      label: stage,
      detail: total <= 0 ? '' : PAIR_STAGES.has(stage) ? `${Math.floor((current / total) * 100)}%` : count(current, total),
      fraction: total > 0 ? current / total : null,
    });
  }
  if (state.isScanning) {
    jobs.push({ id: 'scan', label: 'Scanning', detail: `${state.scanProgress.found.toLocaleString()} found`, fraction: null });
  }
  return jobs;
}

/** How much history the rate is taken over, and how much it needs before it is shown. */
const RATE_WINDOW_MS = 30_000;
const MIN_SPAN_MS = 10_000;
const MIN_FRACTION = 0.01;

/**
 * Time left for one job, from its progress over about the last 30 seconds. Starts over when the job
 * (or its stage) changes or goes backwards, and shows nothing until it has 10 seconds of data.
 */
export class TimeLeftEstimator {
  private samples: Array<{ at: number; fraction: number }> = [];
  private key = '';

  /** Seconds left, or null when there is not enough to go on yet. */
  update(key: string, fraction: number | null, now: number): number | null {
    const last = this.samples[this.samples.length - 1];
    if (key !== this.key || fraction === null || (last && fraction < last.fraction)) {
      this.key = key;
      this.samples = [];
    }
    if (fraction === null) return null;
    const newest = this.samples[this.samples.length - 1];
    if (!newest || newest.fraction !== fraction) this.samples.push({ at: now, fraction });
    // Keep the newest sample older than the window, so the span stays near 30 seconds.
    while (this.samples.length > 2 && now - this.samples[1].at >= RATE_WINDOW_MS) this.samples.shift();
    const first = this.samples[0];
    const span = now - first.at;
    const done = fraction - first.fraction;
    if (span < MIN_SPAN_MS || fraction < MIN_FRACTION || done <= 0) return null;
    return ((1 - fraction) * span) / done / 1000;
  }

  reset(): void {
    this.samples = [];
    this.key = '';
  }
}

/** "<1 min left", "~4 min left", "~1 h 20 min left". */
export function formatTimeLeft(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '<1 min left';
  if (minutes < 60) return `~${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours} h left` : `~${hours} h ${rest} min left`;
}
