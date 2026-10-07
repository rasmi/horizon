import { project, unproject, type Camera } from '../projection';
import type { RawMap } from './types';

// Where a view falls on the sky, and reading a model's raw map of it.

/** The sky is kept from just under the point overhead down to a little below the horizon (degrees of altitude). */
export const ALT_TOP = 89.75;
export const ALT_BOTTOM = -10;

/** A view on the move is worth this much of the same view at rest (its picture is less sharp, its direction less sure). */
const MOVING_WORTH = 0.6;

/**
 * How good a view is to read the sky from: how finely the model's grid
 * divides it (cells per degree, so zooming in is better), marked down while
 * the view is moving.
 */
export function viewQuality(cam: Camera, gridWidth: number, still: boolean): number {
  return (gridWidth / cam.hfov) * (still ? 1 : MOVING_WORTH);
}

/** How sky-like the frame is at a point of the viewport, 0 to 1 across and down (blended between the four cells round it). */
export function sampleMap(map: RawMap, u: number, v: number): number {
  const x = Math.min(map.width - 1, Math.max(0, u * map.width - 0.5));
  const y = Math.min(map.height - 1, Math.max(0, v * map.height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx: number, yy: number) => map.sky[yy * map.width + xx];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/**
 * The directions a view takes in, `step` degrees apart, as a first one
 * (which may be negative or past the last: wrap it) and how many. A view
 * that takes in the point overhead (or underfoot) sees every direction.
 */
export function binsInView(cam: Camera, step: number): [first: number, count: number] {
  const bins = Math.round(360 / step);
  if (project(90, 0, cam).visible || project(-90, 0, cam).visible) return [0, bins];
  // The directions furthest left and right of centre lie on the view's edge.
  let left = 0;
  let right = 0;
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const [x, y] of [[t * cam.width, 0], [t * cam.width, cam.height], [0, t * cam.height], [cam.width, t * cam.height]]) {
      const off = ((unproject(x, y, cam).az - cam.heading + 540) % 360) - 180;
      left = Math.min(left, off);
      right = Math.max(right, off);
    }
  }
  const margin = 1;
  const first = Math.floor((cam.heading + left - margin) / step);
  const last = Math.ceil((cam.heading + right + margin) / step);
  return [first, Math.min(bins, last - first + 1)];
}

/**
 * One direction as a view shows it, from the view's top edge down to its
 * bottom: the altitudes it's read at (and the first one's row in the grid),
 * and where each falls on the frame (0–1 across and down).
 */
export interface ViewColumn {
  bin: number;
  az: number;
  firstRow: number;
  alts: number[];
  xs: number[];
  ys: number[];
}

/**
 * Where every direction and altitude a view takes in falls on its frame, on
 * a grid `step` degrees each way. This is the costly part of reading a frame
 * (a projection for every point), and depends only on the view.
 */
export function viewGeometry(cam: Camera, step: number): ViewColumn[] {
  const columns: ViewColumn[] = [];
  const bins = Math.round(360 / step);
  const rows = Math.round((ALT_TOP - ALT_BOTTOM) / step) + 1;
  const [first, count] = binsInView(cam, step);
  for (let k = 0; k < count; k++) {
    const bin = (((first + k) % bins) + bins) % bins;
    const az = bin * step;
    const alts: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    let firstRow = 0;
    for (let row = 0; row < rows; row++) {
      const alt = ALT_TOP - row * step;
      const p = project(alt, az, cam);
      if (!p.visible) {
        if (alts.length) break; // left the view at the bottom
        continue;
      }
      if (!alts.length) firstRow = row;
      alts.push(alt);
      xs.push(p.x / cam.width);
      ys.push(p.y / cam.height);
    }
    columns.push({ bin, az, firstRow, alts, xs, ys });
  }
  return columns;
}

/** How sky-like a frame is at each point of a column. */
export function sampleColumn(map: RawMap, column: ViewColumn): number[] {
  const sky = new Array<number>(column.alts.length);
  for (let i = 0; i < sky.length; i++) sky[i] = sampleMap(map, column.xs[i], column.ys[i]);
  return sky;
}
