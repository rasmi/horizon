import { describe, expect, it } from 'vitest';
import { declination, lookDirection, northOffset, steadyForNorth, turnToward } from './compass';

describe('lookDirection', () => {
  it('faces north, level, with the phone upright and unturned', () => {
    const d = lookDirection(0, 90, 0);
    expect(d.heading).toBeCloseTo(0, 5);
    expect(d.pitch).toBeCloseTo(0, 5);
  });

  it('turns west as alpha grows (alpha runs anticlockwise)', () => {
    expect(lookDirection(90, 90, 0).heading).toBeCloseTo(270, 5);
    expect(lookDirection(270, 90, 0).heading).toBeCloseTo(90, 5);
  });

  it('looks down with the phone flat, and up as it tips back past upright', () => {
    expect(lookDirection(0, 0, 0).pitch).toBeCloseTo(-90, 5);
    expect(lookDirection(0, 120, 0).pitch).toBeCloseTo(30, 5);
    expect(lookDirection(0, 60, 0).pitch).toBeCloseTo(-30, 5);
  });

  it('gives the same direction held sideways (landscape)', () => {
    // On its left edge, top pointing west: the back still faces north.
    const d = lookDirection(90, 0, -90);
    expect(d.heading).toBeCloseTo(0, 5);
    expect(d.pitch).toBeCloseTo(0, 5);
  });
});

describe('northOffset', () => {
  // A phone whose back faces east (true alpha 270), with Safari's alpha
  // reading 40 for it: the offset should bring 40 to 270.
  const facesEast = (beta: number, compassHeading: number) =>
    lookDirection(40 + northOffset(40, beta, compassHeading), beta, 0).heading;

  it('ties alpha to the compass while the phone leans forward of upright', () => {
    // Top edge points east too: compass heading 90.
    expect(facesEast(45, 90)).toBeCloseTo(90, 5);
  });

  it('allows for the top edge pointing behind once tipped past upright', () => {
    // Looking up at the sky to the east, the top edge points west: 270.
    expect(facesEast(135, 270)).toBeCloseTo(90, 5);
  });

  it('distrusts the compass near upright', () => {
    expect(steadyForNorth(45)).toBe(true);
    expect(steadyForNorth(85)).toBe(false);
    expect(steadyForNorth(100)).toBe(false);
    expect(steadyForNorth(130)).toBe(true);
  });
});

describe('declination', () => {
  const date = new Date('2026-10-04T00:00Z');

  it('is about 12° west in New York and 15° east in Seattle', () => {
    expect(declination(40.7774, -73.9793, date)).toBeCloseTo(-12.5, 0);
    expect(declination(47.6, -122.3, date)).toBeCloseTo(14.9, 0);
  });

  it('still answers for a date past the model', () => {
    expect(Number.isFinite(declination(40.7774, -73.9793, new Date('2032-01-01T00:00Z')))).toBe(true);
  });
});

describe('turnToward', () => {
  it('takes the short way round north', () => {
    expect(turnToward(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(turnToward(10, 350, 0.25)).toBeCloseTo(5, 5);
  });
});
