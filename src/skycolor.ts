// The sky's colour by how far down the Sun is: for the slider's track and
// thumb (panel.ts), in steps, and for the chart drawn over the view
// (skychart.ts), blended.

import { SUN_DOWN } from './astro';

/**
 * How far something has come in for the night, 0 to 1, with the Sun at
 * `sunAlt` degrees: nothing at the first altitude of `between`, all of it by
 * the second, eased at both ends. (The same at dawn, the other way: it goes
 * out as it came in.) What the chart's backdrop comes in by.
 */
export function duskShare(sunAlt: number, between: [from: number, full: number]): number {
  const [from, full] = between;
  if (from === full) return sunAlt <= full ? 1 : 0;
  const share = Math.max(0, Math.min(1, (sunAlt - from) / (full - from)));
  return share * share * (3 - 2 * share);
}

/** In five steps: daylight, the three twilights, and dark (the same steps as twilightLabel). */
export function skyColor(sunAlt: number): string {
  if (sunAlt > SUN_DOWN) return '#7fb3e6';
  if (sunAlt > -6) return '#4d6fa8';
  if (sunAlt > -12) return '#2b3f70';
  if (sunAlt > -18) return '#1a2448';
  return '#0b1024';
}

/** The steps' colours, each at the Sun's altitude it's the colour of (red, green and blue, 0–255), from day down to dark: what's blended between. */
export const SKY_STOPS: [alt: number, colour: [number, number, number]][] = [
  [0, [0x7f, 0xb3, 0xe6]],
  [-3.4, [0x4d, 0x6f, 0xa8]],
  [-9, [0x2b, 0x3f, 0x70]],
  [-15, [0x1a, 0x24, 0x48]],
  [-18, [0x0b, 0x10, 0x24]],
];

/**
 * The same colours with no steps between them: each of the steps above is
 * taken as the colour at the middle of its stretch of twilight, and blended
 * to the next, so that dusk doesn't jump as the slider moves. Red, green and
 * blue, each 0–1.
 */
export function skyColorSmooth(sunAlt: number): [number, number, number] {
  const stops = SKY_STOPS;
  let i = 0;
  while (i < stops.length - 2 && sunAlt < stops[i + 1][0]) i++;
  const [high, from] = stops[i];
  const [low, to] = stops[i + 1];
  const f = Math.max(0, Math.min(1, (high - sunAlt) / (high - low)));
  return [0, 1, 2].map((c) => (from[c] + (to[c] - from[c]) * f) / 255) as [number, number, number];
}
