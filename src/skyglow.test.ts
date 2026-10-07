import { describe, expect, it } from 'vitest';
import { DARK_SKY, faintestFrom, levelAt, type SkyGlow } from './skyglow';
import { faintestInView, faintestShown } from './stars';

/** A made-up world a degree to the cell, 75°N to 65°S: dark, but for a city's level-10 cell at 40°N 74°W and a suburb's level-5 cell east of it. */
function world(): SkyGlow {
  const glow = { width: 360, height: 140, levels: new Uint8Array(360 * 140) };
  glow.levels[(75 - 41) * 360 + (180 - 74)] = 10;
  glow.levels[(75 - 41) * 360 + (180 - 73)] = 5;
  return glow;
}

describe('the sky’s brightness at a place', () => {
  it('reads the cell a place is in: rows from the north, columns east from 180°W', () => {
    const glow = world();
    expect(levelAt(glow, 40.76, -73.98)).toBe(10);
    expect(levelAt(glow, 40.76, -72.5)).toBe(5);
    expect(levelAt(glow, 41.5, -73.98)).toBe(0);
    expect(levelAt(glow, 40.76, 286.02)).toBe(10);
  });

  it('is dark beyond the picture’s north and south, and where there’s no picture', () => {
    const glow = world();
    glow.levels.fill(7);
    expect(levelAt(glow, 80, 10)).toBe(0);
    expect(levelAt(glow, -70, 10)).toBe(0);
    expect(faintestFrom(null, 40.76, -73.98)).toBe(DARK_SKY);
  });

  it('gives a city few stars, a suburb more, and a dark site the catalogue’s faintest', () => {
    const glow = world();
    expect(faintestFrom(glow, 40.76, -73.98)).toBe(3.5);
    expect(faintestFrom(glow, 40.76, -72.5)).toBeCloseTo(5.66, 5);
    expect(faintestFrom(glow, 10, 10)).toBe(DARK_SKY);
  });
});

describe('how faint a star shows, by the place', () => {
  it('starts from the place’s own limit in a view at its widest, where that’s brighter than the chart’s', () => {
    expect(faintestInView(90)).toBe(5);
    expect(faintestInView(90, 6.5)).toBe(5);
    expect(faintestInView(90, 5.66)).toBe(5);
    expect(faintestInView(90, 3.5)).toBe(3.5);
  });

  it('still brings fainter stars out as the view closes in, up to the catalogue’s limit', () => {
    expect(faintestInView(45, 3.5)).toBeCloseTo(4.3, 5);
    expect(faintestInView(11.25, 3.5)).toBeCloseTo(5.9, 5);
    expect(faintestInView(2, 3.5)).toBe(6.5);
  });

  it('and the Sun still has its say', () => {
    expect(faintestShown(-18, 90, 3.5)).toBe(3.5);
    expect(faintestShown(-3, 90, 3.5)).toBeLessThan(0);
  });
});
