import { describe, expect, it } from 'vitest';
import { unproject, type Camera } from '../../projection';
import { outlineOf, sampleView, type ViewField } from './area';

const cam: Camera = { heading: 300, pitch: 25, hfov: 90, width: 400, height: 300 };

describe('sampleView', () => {
  it('asks about the direction each point of the view looks in', () => {
    const step = 50;
    const alts = sampleView(cam, step, (alt) => alt);
    const azs = sampleView(cam, step, (_, az) => az);
    expect(alts.cols).toBe(9);
    expect(alts.rows).toBe(7);
    for (const [col, row] of [[0, 0], [4, 3], [8, 6], [2, 5]]) {
      const { alt, az } = unproject(col * step, row * step, cam);
      expect(alts.values[row * alts.cols + col]).toBeCloseTo(alt, 4);
      expect(azs.values[row * azs.cols + col]).toBeCloseTo(az, 4);
    }
  });
});

describe('outlineOf', () => {
  /** A field over a lattice 10 pixels apart, from its rows of values. */
  const field = (rows: number[][]): ViewField => ({ cols: rows[0].length, rows: rows.length, step: 10, values: Float32Array.from(rows.flat()) });

  it('draws nothing where the field is all one side of the level', () => {
    expect(outlineOf(field([[1, 1], [1, 1]]), 0)).toEqual([]);
    expect(outlineOf(field([[-1, -1], [-1, -1]]), 0)).toEqual([]);
  });

  it('runs between what is inside and what is not, where the field passes the level', () => {
    // Inside above, outside below: the field passes 0 a quarter of the way down the left side and halfway down the right.
    const ends = outlineOf(field([[1, 1], [-3, -1]]), 0);
    expect(ends).toHaveLength(4);
    const [x1, y1, x2, y2] = ends;
    expect([x1, x2].sort()).toEqual([0, 10]);
    expect(x1 === 0 ? y1 : y2).toBeCloseTo(2.5);
    expect(x1 === 0 ? y2 : y1).toBeCloseTo(5);
  });

  it('goes all the way round one point inside', () => {
    const ends = outlineOf(field([[0, 0, 0], [0, 1, 0], [0, 0, 0]]), 0.5);
    // A diamond round the middle point: four segments, each end halfway to a neighbour.
    expect(ends).toHaveLength(16);
    for (let i = 0; i < ends.length; i += 2) expect(Math.abs(ends[i] - 10) + Math.abs(ends[i + 1] - 10)).toBeCloseTo(5);
  });
});
