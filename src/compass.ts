/**
 * Compass mode: the view turns with the phone, facing whatever the back of
 * the phone is pointed at. This is only how the view is panned; the overlay
 * is still drawn from the view's own direction, exactly as when dragging.
 */

import { model } from 'geomagnetism';

const RAD = Math.PI / 180;

/**
 * How far east of true north a compass points at a place (negative: west),
 * in degrees, from the World Magnetic Model. Phones report directions from
 * magnetic north; adding this to a heading gives it from true north.
 * Past the model's years it carries on from the model's trend (the package
 * notes so in the console), which stays far closer than no correction.
 */
export function declination(lat: number, lng: number, date: Date): number {
  return model(date, { allowOutOfBoundsModel: true }).point([lat, lng]).decl;
}

/** An angle brought into 0–360. */
const wrap = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * Where the back of the phone points, from a device-orientation reading
 * (degrees, as the browser reports them, with `alpha` measured from north).
 * Roll about that direction is left out: Street View's view can't roll.
 */
export function lookDirection(alpha: number, beta: number, gamma: number): { heading: number; pitch: number } {
  const [sA, cA] = [Math.sin(alpha * RAD), Math.cos(alpha * RAD)];
  const [sB, cB] = [Math.sin(beta * RAD), Math.cos(beta * RAD)];
  const [sG, cG] = [Math.sin(gamma * RAD), Math.cos(gamma * RAD)];
  // The screen's outward normal in east, north, up; the back faces the other way.
  const east = -(cG * sA * sB + cA * sG);
  const north = -(sA * sG - cA * cG * sB);
  const up = -(cB * cG);
  return {
    heading: wrap(Math.atan2(east, north) / RAD),
    pitch: Math.asin(Math.max(-1, Math.min(1, up))) / RAD,
  };
}

/**
 * Safari's readings: `alpha` there starts from wherever the phone happened to
 * face, and north comes separately, as a compass heading: the same turn as
 * `alpha`, the other way round. It's taken as it comes however the phone is
 * tilted: an iPhone doesn't turn it half-way round once the phone is tipped
 * back past upright, though its top edge then points behind. Near upright
 * the heading is still the least sure: see `steadyForNorth`.
 *
 * Returns what to add to `alpha` to measure it from north.
 */
export function northOffset(alpha: number, compassHeading: number): number {
  return wrap(360 - compassHeading - alpha);
}

/** Whether the phone is far enough from upright for its compass heading to mean something. */
export function steadyForNorth(beta: number): boolean {
  return Math.abs(Math.cos(beta * RAD)) > 0.35; // more than about 20° from upright
}

/** Moves `share` of the way from one direction to another, the short way round. */
export function turnToward(from: number, to: number, share: number): number {
  return wrap(from + (((to - from + 540) % 360) - 180) * share);
}
