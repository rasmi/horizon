// Rectilinear (pinhole) projection from horizon coordinates to the
// Street View viewport. Street View headings are relative to true north and
// positive pitch looks up, matching astronomical azimuth/altitude.

const RAD = Math.PI / 180;

export interface Camera {
  heading: number; // degrees
  pitch: number; // degrees
  hfov: number; // horizontal field of view, degrees
  width: number; // px
  height: number; // px
}

export interface CamPoint {
  /** Camera-space coordinates; z > 0 is in front of the camera. */
  x: number;
  y: number;
  z: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Whether the point lies inside the viewport. */
  visible: boolean;
  /** Camera-space depth; <= 0 means behind the camera. */
  z: number;
}

/**
 * Horizontal field of view of the imagery Street View draws at `zoom` in a
 * `width` × `height` viewport.
 *
 * Measured, not documented: the focal length is (width / 2) * 2^(zoom - 1),
 * so each zoom level doubles magnification and zoom 1 is 90° across the
 * viewport width. The commonly quoted 180° / 2^zoom only agrees at zoom 1.
 * But the imagery never spans more than 90° vertically (focal length at least
 * height / 2): in wide viewports the zoom-out button keeps lowering the
 * reported zoom past that point while the imagery stays put. See
 * DEVELOPMENT.md, "Projection calibration".
 */
export function streetViewHfov(zoom: number, width: number, height: number): number {
  const focal = Math.max((width / 2) * Math.pow(2, zoom - 1), height / 2);
  return (2 * Math.atan(width / 2 / focal)) / RAD;
}

export function toCamera(alt: number, az: number, cam: Camera): CamPoint {
  const ca = Math.cos(alt * RAD);
  // World frame: x east, y north, z up.
  const dx = ca * Math.sin(az * RAD);
  const dy = ca * Math.cos(az * RAD);
  const dz = Math.sin(alt * RAD);
  const sh = Math.sin(cam.heading * RAD);
  const ch = Math.cos(cam.heading * RAD);
  const sp = Math.sin(cam.pitch * RAD);
  const cp = Math.cos(cam.pitch * RAD);
  // Camera basis: forward f, right r, up u.
  const f = [cp * sh, cp * ch, sp];
  const r = [ch, -sh, 0];
  const u = [-sp * sh, -sp * ch, cp];
  return {
    x: dx * r[0] + dy * r[1] + dz * r[2],
    y: dx * u[0] + dy * u[1] + dz * u[2],
    z: dx * f[0] + dy * f[1] + dz * f[2],
  };
}

export function focalLength(cam: Camera): number {
  return cam.width / 2 / Math.tan((cam.hfov / 2) * RAD);
}

export function project(alt: number, az: number, cam: Camera): ScreenPoint {
  const p = toCamera(alt, az, cam);
  const fl = focalLength(cam);
  if (p.z <= 1e-6) return { x: NaN, y: NaN, visible: false, z: p.z };
  const x = cam.width / 2 + (fl * p.x) / p.z;
  const y = cam.height / 2 - (fl * p.y) / p.z;
  const visible = x >= 0 && x <= cam.width && y >= 0 && y <= cam.height;
  return { x, y, visible, z: p.z };
}

/** The reverse of `project`: the direction a point of the viewport looks in. */
export function unproject(x: number, y: number, cam: Camera): { alt: number; az: number } {
  const fl = focalLength(cam);
  const cx = (x - cam.width / 2) / fl;
  const cy = (cam.height / 2 - y) / fl;
  const sh = Math.sin(cam.heading * RAD);
  const ch = Math.cos(cam.heading * RAD);
  const sp = Math.sin(cam.pitch * RAD);
  const cp = Math.cos(cam.pitch * RAD);
  // forward + cx·right + cy·up, in the world frame (x east, y north, z up).
  const dx = cp * sh + cx * ch - cy * sp * sh;
  const dy = cp * ch - cx * sh - cy * sp * ch;
  const dz = sp + cy * cp;
  return {
    alt: Math.atan2(dz, Math.hypot(dx, dy)) / RAD,
    az: ((Math.atan2(dx, dy) / RAD) % 360 + 360) % 360,
  };
}

/**
 * Where to place an off-screen indicator: the point on the viewport edge
 * (inset by `margin`) in the direction of the target, plus the angle.
 */
export function edgeIndicator(
  alt: number,
  az: number,
  cam: Camera,
  margin: number,
): { x: number; y: number; angle: number } {
  const p = toCamera(alt, az, cam);
  let dx = p.x;
  let dy = -p.y;
  if (Math.hypot(dx, dy) < 1e-9) dx = 1; // directly behind
  const cx = cam.width / 2;
  const cy = cam.height / 2;
  const hw = cx - margin;
  const hh = cy - margin;
  const s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: cx + dx * s, y: cy + dy * s, angle: Math.atan2(dy, dx) };
}

/** Camera heading/pitch that centres the given direction. */
export function lookAt(alt: number, az: number): { heading: number; pitch: number } {
  return { heading: az, pitch: Math.max(-89, Math.min(89, alt)) };
}

export interface LabelAnchor {
  x: number;
  y: number;
  /** Direction of the line there, in radians, turned so text reads left to right. */
  angle: number;
  /** How far right the visible path reaches, so text needn't run off its end. */
  maxX: number;
}

/** Turns a line direction (radians) so text written along it isn't upside down. */
export function readableAngle(a: number): number {
  return a > Math.PI / 2 ? a - Math.PI : a <= -Math.PI / 2 ? a + Math.PI : a;
}

/**
 * Where to write a name along a path drawn through `pts` (null = a break in
 * the line): the visible point of the path nearest the vertical guide at
 * `guideX`. Where the path crosses the guide that's the crossing, so the name
 * holds its place on screen and slides along the line as the view pans;
 * otherwise it's the nearest end of the visible path, or where the path
 * enters the view. Either way it moves smoothly, never in jumps. `inset`
 * keeps the label clear of the viewport edges; `maxY` can raise the bottom
 * limit further, to keep the name above something lower down.
 */
export function lineLabelAnchor(
  pts: ({ x: number; y: number } | null)[],
  guideX: number,
  width: number,
  height: number,
  inset = 24,
  maxY = height - inset,
): LabelAnchor | null {
  const lo = inset;
  const hiX = width - inset;
  const hiY = Math.min(maxY, height - inset);
  let best: { x: number; y: number; angle: number } | null = null;
  let bestDist = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;
    // Clip the segment to the inset viewport (Liang–Barsky): a + t·d, t0 ≤ t ≤ t1.
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    if (!(clip(-dx, a.x - lo) && clip(dx, hiX - a.x) && clip(-dy, a.y - lo) && clip(dy, hiY - a.y))) continue;
    const xStart = a.x + t0 * dx;
    const xEnd = a.x + t1 * dx;
    maxX = Math.max(maxX, xStart, xEnd);
    // The point of this visible piece nearest the guide.
    const crosses = dx !== 0 && (xStart - guideX) * (xEnd - guideX) <= 0;
    const t = crosses ? (guideX - a.x) / dx : Math.abs(xStart - guideX) <= Math.abs(xEnd - guideX) ? t0 : t1;
    const x = a.x + t * dx;
    const dist = Math.abs(x - guideX);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = { x, y: a.y + t * dy, angle: readableAngle(Math.atan2(dy, dx)) };
    }
  }
  return best ? { ...best, maxX } : null;
}
