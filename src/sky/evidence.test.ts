import { describe, expect, it } from 'vitest';
import type { Camera } from '../projection';
import { SkyEvidence } from './evidence';
import { viewQuality } from './geometry';
import { ADE_NAMES, type RawMap } from './types';

// What's the grid's own and not the development code's (which parity.test.ts holds the rest to): a view zoomed far in
// takes back settled sky only if it has plenty of sky in its own frame.

const SIZE = 128;
const view = (hfov: number): Camera => ({ heading: 0, pitch: 40, hfov, width: 1032, height: 863 });

/** A look's map: sky down to `skyTo` of the way down the frame (0 to 1), and solid below. */
function map(skyTo: number): RawMap {
  const sky = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) sky.fill((y + 0.5) / SIZE < skyTo ? 0.97 : 0.02, y * SIZE, (y + 1) * SIZE);
  return { width: SIZE, height: SIZE, sky, labels: { classes: new Uint8Array(SIZE * SIZE), names: ADE_NAMES } };
}

/** A grid in which a wide view at rest has found sky all over its frame. */
function openSky(): SkyEvidence {
  const cells = new SkyEvidence();
  for (let i = 0; i < 3; i++) cells.add(map(1), view(90), viewQuality(view(90), SIZE, true));
  return cells;
}
const held = (cells: SkyEvidence) => cells.decided.reduce((n, d) => n + (d === 1 ? 1 : 0), 0);
const rest = (cells: SkyEvidence, hfov: number, skyTo: number) => {
  for (let i = 0; i < 2; i++) cells.add(map(skyTo), view(hfov), viewQuality(view(hfov), SIZE, true));
};

describe('a view zoomed far in', () => {
  it('takes back none of the sky a wider view settled, if it sees little sky itself', () => {
    const cells = openSky();
    const before = held(cells);
    // (It does see some, over the top fifth of its frame: this isn't the look that can see none.)
    rest(cells, 14, 0.2);
    expect(held(cells)).toBe(before);
  });

  it('puts a roofline right where it has plenty of sky in the frame', () => {
    const cells = openSky();
    const before = held(cells);
    rest(cells, 14, 0.6);
    expect(held(cells)).toBeLessThan(before - 150);
  });

  it('still adds sky where a wider view found none', () => {
    const cells = new SkyEvidence();
    for (let i = 0; i < 3; i++) cells.add(map(0), view(90), viewQuality(view(90), SIZE, true));
    expect(held(cells)).toBe(0);
    rest(cells, 14, 1);
    expect(held(cells)).toBeGreaterThan(400);
  });

  it('and a view only a little closer has the say as before, either way', () => {
    const cells = openSky();
    const before = held(cells);
    rest(cells, 60, 0.3);
    expect(held(cells)).toBeLessThan(before - 5000);
  });
});
