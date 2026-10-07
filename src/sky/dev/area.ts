import { focalLength, type Camera } from '../../projection';

// Drawing the sky map as an area over a view, for the development panel and
// the probe: what counts as sky is known by direction, and has to be laid
// over the screen. It's sampled on a lattice of points a few pixels apart,
// which is then shaded and outlined.

const RAD = Math.PI / 180;

/** A value at every point of a lattice laid over a view: `cols` by `rows` points, `step` pixels apart, the first at the view's top left corner. */
export interface ViewField {
  cols: number;
  rows: number;
  step: number;
  values: Float32Array;
}

/** Something known by direction, sampled over a view: `at(alt, az)` at every point of a lattice `step` pixels apart. */
export function sampleView(cam: Camera, step: number, at: (alt: number, az: number) => number): ViewField {
  const cols = Math.ceil(cam.width / step) + 1;
  const rows = Math.ceil(cam.height / step) + 1;
  const values = new Float32Array(cols * rows);
  // (projection.ts's unproject, with the view's own trigonometry worked out once for all the points.)
  const focal = focalLength(cam);
  const sh = Math.sin(cam.heading * RAD);
  const ch = Math.cos(cam.heading * RAD);
  const sp = Math.sin(cam.pitch * RAD);
  const cp = Math.cos(cam.pitch * RAD);
  for (let row = 0; row < rows; row++) {
    const cy = (cam.height / 2 - row * step) / focal;
    for (let col = 0; col < cols; col++) {
      const cx = (col * step - cam.width / 2) / focal;
      const dx = cp * sh + cx * ch - cy * sp * sh;
      const dy = cp * ch - cx * sh - cy * sp * ch;
      const dz = sp + cy * cp;
      const az = Math.atan2(dx, dy) / RAD;
      values[row * cols + col] = at(Math.atan2(dz, Math.hypot(dx, dy)) / RAD, az < 0 ? az + 360 : az);
    }
  }
  return { cols, rows, step, values };
}

// Which sides of a square of the lattice the outline crosses, by which of
// its corners are inside (top left 8, top right 4, bottom right 2, bottom
// left 1): pairs of sides to join, the sides being top 0, right 1, bottom 2,
// left 3. (Two opposite corners inside can be cut either way: see below.)
const CROSSINGS: number[][] = [[], [3, 2], [2, 1], [3, 1], [0, 1], [], [0, 2], [0, 3], [0, 3], [0, 2], [], [0, 1], [3, 1], [2, 1], [3, 2], []];
const ACROSS_TOP_LEFT_AND_BOTTOM_RIGHT = [0, 3, 2, 1];
const ACROSS_TOP_RIGHT_AND_BOTTOM_LEFT = [0, 1, 3, 2];

/**
 * The outline of where a field is above `level`: line segments, as x1, y1,
 * x2, y2 in pixels of the view, one after another. (Marching squares: each
 * end is placed along its side of the square by where the field passes the
 * level.)
 */
export function outlineOf(field: ViewField, level: number): number[] {
  const { cols, rows, step, values } = field;
  const out: number[] = [];
  for (let row = 0; row + 1 < rows; row++) {
    for (let col = 0; col + 1 < cols; col++) {
      const a = values[row * cols + col];
      const b = values[row * cols + col + 1];
      const c = values[(row + 1) * cols + col + 1];
      const d = values[(row + 1) * cols + col];
      const inside = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (inside === 0 || inside === 15) continue;
      let sides = CROSSINGS[inside];
      if (inside === 5 || inside === 10) {
        // Opposite corners inside: joined through the middle if the middle is inside too (the outline
        // then cuts off the other two corners), and apart if not (it cuts off these two).
        const joined = (a + b + c + d) / 4 > level;
        sides = (inside === 5) === joined ? ACROSS_TOP_LEFT_AND_BOTTOM_RIGHT : ACROSS_TOP_RIGHT_AND_BOTTOM_LEFT;
      }
      // How far along a side the field passes the level, from its first corner to its second.
      const along = (from: number, to: number) => (level - from) / (to - from);
      for (const side of sides) {
        if (side === 0) out.push((col + along(a, b)) * step, row * step);
        else if (side === 1) out.push((col + 1) * step, (row + along(b, c)) * step);
        else if (side === 2) out.push((col + along(d, c)) * step, (row + 1) * step);
        else out.push(col * step, (row + along(a, d)) * step);
      }
    }
  }
  return out;
}
