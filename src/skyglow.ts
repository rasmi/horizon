// How bright the night sky is overhead at a place, from artificial light:
// what sets how faint a star shows there by default. A city's sky hides all
// but a few hundred stars; a dark site's shows them all.
//
// It's read from a small picture of the world (skyglow.webp, 129 KB: a cut
// of David Lorenz's Light Pollution Atlas, in
// third_party/light-pollution-atlas/, which says whose work it is). A tenth of a degree to the pixel, 75°N to 65°S, each pixel one of
// eleven levels. Broad, on purpose: it's for a sensible default, which the
// visitor can switch off, not a measurement. A small bright town in dark
// country reads as the country round it.

/** The faintest star the chart's catalogue has: what a dark site shows. */
export const DARK_SKY = 6.5;

/**
 * The faintest star seen by eye under each level's sky, as a magnitude.
 * Level 0 is the atlas's zones 0 to 2b (artificial light under a third of
 * the natural sky's: 21.7 magnitudes per square arcsecond or darker), where
 * the catalogue's faintest shows; then a level for each zone from 3a to 7b
 * (a city's centre: brighter than 17.8).
 *
 * Reckoned from the sky's brightness B at the middle of each zone (the
 * atlas's own key) as 7.93 − 5 log₁₀(10^(4.316 − B/5) + 1), the usual rule
 * of thumb for the naked-eye limit. Good to a few tenths, which is as good
 * as the levels are.
 */
const FAINTEST = [DARK_SKY, 6.43, 6.32, 6.16, 5.94, 5.66, 5.33, 4.94, 4.51, 4.04, 3.5];

/** The picture runs from this latitude down to this one, and right round. */
const NORTH = 75;
const SOUTH = -65;
/** A level is written in the picture as this many times itself, as a grey. */
const GREY_PER_LEVEL = 17;

export interface SkyGlow {
  width: number;
  height: number;
  /** A level for each cell, 0 (dark) to 10, a row at a time from the north, each row from 180°W eastwards. */
  levels: Uint8Array;
}

/** The level at a place; 0 (dark) beyond the picture's north and south. */
export function levelAt(glow: SkyGlow, lat: number, lng: number): number {
  if (!(lat < NORTH && lat > SOUTH)) return 0;
  const row = Math.min(glow.height - 1, Math.floor(((NORTH - lat) / (NORTH - SOUTH)) * glow.height));
  const across = (((lng + 180) % 360) + 360) % 360;
  const column = Math.min(glow.width - 1, Math.floor((across / 360) * glow.width));
  return Math.min(FAINTEST.length - 1, glow.levels[row * glow.width + column]);
}

/** The faintest star seen by eye from a place, as a magnitude: DARK_SKY where the sky is dark, or nothing is known. */
export function faintestFrom(glow: SkyGlow | null, lat: number, lng: number): number {
  return glow ? FAINTEST[levelAt(glow, lat, lng)] : DARK_SKY;
}

/** Fetches the picture and reads its levels: wanted only where the chart is on. */
export async function loadSkyGlow(): Promise<SkyGlow> {
  const response = await fetch(new URL('../third_party/light-pollution-atlas/skyglow.webp', import.meta.url).href);
  if (!response.ok) throw new Error(`The sky's brightness didn't load: ${response.status}`);
  // (Its greys as they're written, with nothing done to them for the screen.)
  const picture = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(picture, 0, 0);
  picture.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const levels = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < levels.length; i++) levels[i] = Math.round(pixels[i * 4] / GREY_PER_LEVEL);
  return { width: canvas.width, height: canvas.height, levels };
}
