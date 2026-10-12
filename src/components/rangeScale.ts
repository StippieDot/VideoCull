/** Resolution of the slider track; positions run from 0 to RANGE_STEPS. */
export const RANGE_STEPS = 1000;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Library values are skewed: most videos are small and a few are huge, so a linear track puts nearly
 * every useful filter in the first few pixels. A power curve gives the low end more room.
 */
export function valueToPosition(value: number, max: number, curve: number): number {
  if (max <= 0) return 0;
  return Math.round(Math.pow(clamp01(value / max), 1 / curve) * RANGE_STEPS);
}

/** The ends are exact so that "no limit" stays distinguishable from a snapped value. */
export function positionToValue(position: number, max: number, curve: number, snap: (value: number) => number): number {
  if (position <= 0) return 0;
  if (position >= RANGE_STEPS) return max;
  const raw = max * Math.pow(position / RANGE_STEPS, curve);
  return Math.min(max, Math.max(0, snap(raw)));
}

/**
 * Two significant digits in the binary unit shown to the user, so the label matches the filter.
 * Whole bytes, because the store keeps whole bytes: a fractional result would never equal what was saved.
 */
export function snapBytes(bytes: number): number {
  if (bytes < 1024) return Math.round(bytes);
  const unit = 1024 ** Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  const scaled = bytes / unit;
  return Math.round((scaled < 10 ? Math.round(scaled * 10) / 10 : Math.round(scaled)) * unit);
}

/** Whole seconds for short clips, coarser steps as the duration grows. */
export function snapSeconds(seconds: number): number {
  const step = seconds < 60 ? 1 : seconds < 600 ? 5 : seconds < 3600 ? 15 : 60;
  return Math.round(seconds / step) * step;
}
