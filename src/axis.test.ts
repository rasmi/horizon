import { describe, expect, it } from 'vitest';
import { nightAxis } from './axis';

const HOUR = 3600000;

describe('nightAxis', () => {
  // Noon to noon, sunset at 6 PM, sunrise at 6 AM: 6 h day, 12 h night, 6 h day.
  const axis = nightAxis(0, 24 * HOUR, 6 * HOUR, 18 * HOUR, 1 / 3);

  it('gives the night most of the width', () => {
    // Day hours count a third: about 2 + 12 + 2 = 16 units (the easing around
    // sunset and sunrise shifts the split a little).
    expect(axis.toFraction(0)).toBe(0);
    expect(axis.toFraction(6 * HOUR)).toBeGreaterThan(0.11);
    expect(axis.toFraction(6 * HOUR)).toBeLessThan(0.16);
    expect(axis.toFraction(12 * HOUR)).toBeCloseTo(0.5);
    expect(axis.toFraction(18 * HOUR)).toBeCloseTo(1 - axis.toFraction(6 * HOUR));
    expect(axis.toFraction(24 * HOUR)).toBeCloseTo(1);
  });

  it('changes scale gradually, without a corner at sunset', () => {
    // Width of successive 5-minute steps across sunset: each close to the last.
    const width = (m: number) => axis.toFraction((6 * 60 + m + 5) * 60000) - axis.toFraction((6 * 60 + m) * 60000);
    for (let m = -70; m < 70; m += 5) {
      expect(width(m + 5) / width(m)).toBeLessThan(1.15);
      expect(width(m + 5)).toBeGreaterThanOrEqual(width(m) - 1e-12);
    }
    // Well inside the night an hour is three times as wide as well inside the day.
    const hour = (h: number) => axis.toFraction((h + 1) * HOUR) - axis.toFraction(h * HOUR);
    expect(hour(11) / hour(1)).toBeCloseTo(3);
  });

  it('maps positions back to the same times', () => {
    for (const h of [0, 1.5, 6, 9.25, 12, 17.9, 18, 21, 24]) {
      expect(axis.toTime(axis.toFraction(h * HOUR))).toBeCloseTo(h * HOUR, 3);
    }
  });

  it('clamps outside the window', () => {
    expect(axis.toFraction(-HOUR)).toBe(0);
    expect(axis.toFraction(30 * HOUR)).toBeCloseTo(1);
    expect(axis.toTime(2)).toBeCloseTo(24 * HOUR);
  });

  it('is linear without a sunset and sunrise in the window', () => {
    const linear = nightAxis(0, 24 * HOUR, null, null);
    expect(linear.toFraction(6 * HOUR)).toBeCloseTo(0.25);
    expect(linear.toTime(0.75)).toBeCloseTo(18 * HOUR);
    // A sunrise before the sunset (not a night inside the window) is ignored too.
    expect(nightAxis(0, 24 * HOUR, 18 * HOUR, 6 * HOUR).toFraction(6 * HOUR)).toBeCloseTo(0.25);
  });
});
