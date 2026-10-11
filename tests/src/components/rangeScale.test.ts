import { describe, expect, test } from 'vitest';
import { RANGE_STEPS, positionToValue, snapBytes, snapSeconds, valueToPosition } from '../../../src/components/rangeScale';

const GB = 1024 ** 3;

describe('range scale', () => {
  test('the track ends are exact', () => {
    expect(positionToValue(0, 9 * GB, 2.5, snapBytes)).toBe(0);
    expect(positionToValue(RANGE_STEPS, 9 * GB, 2.5, snapBytes)).toBe(9 * GB);
  });

  test('a skewed curve gives small values more of the track', () => {
    const halfway = positionToValue(RANGE_STEPS / 2, 9 * GB, 2.5, snapBytes);
    expect(halfway).toBeLessThan(2 * GB);
    expect(halfway).toBeGreaterThan(1 * GB);
  });

  test('a value maps to a position that maps back to about the same value', () => {
    const position = valueToPosition(500 * 1024 ** 2, 9 * GB, 2.5);
    const back = positionToValue(position, 9 * GB, 2.5, snapBytes);
    expect(Math.abs(back - 500 * 1024 ** 2) / (500 * 1024 ** 2)).toBeLessThan(0.05);
  });

  test('positions never leave the track', () => {
    expect(valueToPosition(-5, 100, 2)).toBe(0);
    expect(valueToPosition(500, 100, 2)).toBe(RANGE_STEPS);
    expect(valueToPosition(10, 0, 2)).toBe(0);
  });

  test('snapping matches what the label shows', () => {
    expect(snapBytes(1.234 * GB)).toBeCloseTo(1.2 * GB, -3);
    expect(snapBytes(23.6 * GB)).toBe(24 * GB);
    expect(snapBytes(700)).toBe(700);
    expect(snapSeconds(43.4)).toBe(43);
    expect(snapSeconds(333)).toBe(335);
    expect(snapSeconds(7290)).toBe(7320);
  });
});
