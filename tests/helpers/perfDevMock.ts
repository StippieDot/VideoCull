import { vi } from 'vitest';

export const beginDevInteraction = vi.fn();
export const completeDevInteractionOnNextPaint = vi.fn();
export const measureDevNextPaint = vi.fn();
export const recordDevPerf = vi.fn();
export const recordDevCounter = vi.fn();
export const recordReactCommit = vi.fn();

export function resetPerfDevMock() {
  beginDevInteraction.mockReset();
  completeDevInteractionOnNextPaint.mockReset();
  measureDevNextPaint.mockReset();
  recordDevPerf.mockReset();
  recordDevCounter.mockReset();
  recordReactCommit.mockReset();
}
