// The fixed sky: stars, the constellations' figures, and Messier's objects
// with the brightest of the rest, for the chart (skychart.ts) and for the
// names written over it (overlay.ts).
//
// The catalogue is a cut of three others (third_party/star-catalogues/,
// which says whose work it is). Each entry is a direction among the stars (J2000). Where that is
// in the sky, for a place and a time, is one rotation for the lot, which
// astronomy-engine gives; and then the air's bending of light near the
// horizon, as the app's planets have it.

import * as A from 'astronomy-engine';
import { project, type Camera } from './projection';

const RAD = Math.PI / 180;

export type ObjectKind = 'galaxy' | 'cluster' | 'globular' | 'nebula' | 'stars';

export interface Catalogue {
  /** How many stars, brightest first. */
  count: number;
  /** Each star's direction among the stars: x, y, z, a unit vector (J2000 equator). */
  vectors: Float32Array;
  /** Each star's magnitude, and its colour (B−V; 0.6, the Sun's, where it isn't known). */
  magnitudes: Float32Array;
  colours: Float32Array;
  /** The constellations' lines: each one's two ends, x, y, z and x, y, z. */
  lines: Float32Array;
  /** For each line, the magnitude of the brightest star of the constellation it's part of. */
  lineBrightest: Float32Array;
  /** What has a name to write: stars, constellations (at the middle of their figures) and objects. */
  named: Named[];
}

export interface Named {
  what: 'star' | 'constellation' | ObjectKind;
  text: string;
  /** Its direction among the stars. */
  x: number;
  y: number;
  z: number;
  /** Its magnitude (a constellation's is its brightest star's), and for an object how wide it is, in minutes of arc. */
  magnitude: number;
  size: number;
}

interface Data {
  stars: number[];
  names: [index: number, name: string][];
  constellations: [name: string, runs: number[][]][];
  objects: [label: string, name: string, kind: ObjectKind, ra: number, dec: number, magnitude: number, size: number][];
}

/** A direction among the stars from the catalogue's own numbers: right ascension and declination in 200ths of a degree. */
function direction(ra200: number, dec200: number): [number, number, number] {
  const ra = (ra200 / 200) * RAD;
  const dec = (dec200 / 200) * RAD;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

export function readCatalogue(data: Data): Catalogue {
  const count = data.stars.length / 4;
  const vectors = new Float32Array(count * 3);
  const magnitudes = new Float32Array(count);
  const colours = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    vectors.set(direction(data.stars[i * 4], data.stars[i * 4 + 1]), i * 3);
    magnitudes[i] = data.stars[i * 4 + 2] / 100;
    colours[i] = data.stars[i * 4 + 3] === 999 ? 0.6 : data.stars[i * 4 + 3] / 100;
  }
  const named: Named[] = data.names.map(([i, text]) => ({
    what: 'star',
    text,
    x: vectors[i * 3],
    y: vectors[i * 3 + 1],
    z: vectors[i * 3 + 2],
    magnitude: magnitudes[i],
    size: 0,
  }));
  const ends: number[] = [];
  const brightest: number[] = [];
  for (const [name, runs] of data.constellations) {
    // Its name goes at the middle of its figure's stars (each counted once).
    const mine = new Set(runs.flat());
    let x = 0;
    let y = 0;
    let z = 0;
    // (And its brightest star: a figure none of whose stars is showing isn't drawn, nor named.)
    let best = Infinity;
    for (const i of mine) {
      x += vectors[i * 3];
      y += vectors[i * 3 + 1];
      z += vectors[i * 3 + 2];
      best = Math.min(best, magnitudes[i]);
    }
    const length = Math.hypot(x, y, z) || 1;
    named.push({ what: 'constellation', text: name, x: x / length, y: y / length, z: z / length, magnitude: best, size: 0 });
    for (const run of runs) {
      for (let k = 0; k + 1 < run.length; k++) {
        if (run[k] === run[k + 1]) continue;
        for (const i of [run[k], run[k + 1]]) ends.push(vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]);
        brightest.push(best);
      }
    }
  }
  for (const [label, name, kind, ra, dec, magnitude, size] of data.objects) {
    const [x, y, z] = direction(ra, dec);
    // (Messier's number where it has one; otherwise its own name, if it has one, before its catalogue number.)
    const text = /^M\d/.test(label) ? label : name || label;
    named.push({ what: kind, text, x, y, z, magnitude: magnitude === 999 ? 99 : magnitude / 100, size });
  }
  return { count, vectors, magnitudes, colours, lines: new Float32Array(ends), lineBrightest: new Float32Array(brightest), named };
}

/** Fetches the catalogue: its own piece of the app, wanted only where the chart is on. */
export async function loadCatalogue(): Promise<Catalogue> {
  const data = (await import('../third_party/star-catalogues/stars-data.json')).default as unknown as Data;
  return readCatalogue(data);
}

/**
 * The rotation that takes a direction among the stars (J2000) to where it is
 * in the sky at a place and a time, in the frame the view is worked out in
 * (projection.ts: x east, y north, z up): nine numbers, a column at a time,
 * as a shader takes them. Before the air's bending: see `lifted`.
 */
export function skyRotation(time: Date, lat: number, lng: number): Float32Array {
  const rotation = A.Rotation_EQJ_HOR(time, new A.Observer(lat, lng, 0));
  const when = A.MakeTime(time);
  const out = new Float32Array(9);
  for (let column = 0; column < 3; column++) {
    // (astronomy-engine's horizontal frame is x north, y west, z up.)
    const turned = A.RotateVector(rotation, new A.Vector(column === 0 ? 1 : 0, column === 1 ? 1 : 0, column === 2 ? 1 : 0, when));
    out[column * 3] = -turned.y;
    out[column * 3 + 1] = turned.x;
    out[column * 3 + 2] = turned.z;
  }
  return out;
}

/**
 * How much higher the air's bending of light makes something at this
 * altitude look, in degrees: half a degree at the horizon, next to nothing
 * from 10° up. (astronomy-engine's "normal" refraction, which the planets'
 * positions have: the chart's shader does the same sum.)
 */
export function lifted(altitude: number): number {
  const from = Math.max(altitude, -1);
  const lift = 1.02 / Math.tan((from + 10.3 / (from + 5.11)) * RAD) / 60;
  return altitude < -1 ? (lift * (altitude + 90)) / 89 : lift;
}

/** Where a direction among the stars is in the sky, as it's seen: altitude and azimuth in degrees. */
export function inSky(x: number, y: number, z: number, rotation: Float32Array): { alt: number; az: number } {
  const east = rotation[0] * x + rotation[3] * y + rotation[6] * z;
  const north = rotation[1] * x + rotation[4] * y + rotation[7] * z;
  const up = rotation[2] * x + rotation[5] * y + rotation[8] * z;
  const alt = Math.asin(Math.max(-1, Math.min(1, up))) / RAD;
  return { alt: alt + lifted(alt), az: ((Math.atan2(east, north) / RAD) % 360 + 360) % 360 };
}

/** A name to write over the view: where, and what's known of the thing for choosing and styling it. */
export interface Label extends Named {
  px: number;
  py: number;
  alt: number;
  az: number;
}

/** Everything with a name that's in view, with where on screen it is. */
export function labelsInView(catalogue: Catalogue, rotation: Float32Array, cam: Camera): Label[] {
  const out: Label[] = [];
  for (const named of catalogue.named) {
    const { alt, az } = inSky(named.x, named.y, named.z, rotation);
    const p = project(alt, az, cam);
    if (p.z > 0.05 && p.visible) out.push({ ...named, px: p.x, py: p.y, alt, az });
  }
  return out;
}

/**
 * The faintest star to show: by how dark the sky is and how close the view.
 * At sunset only the very brightest, then more as the Sun goes down, one by
 * one; and more again as the view closes in, up to the catalogue's limit.
 */
export function faintestShown(sunAlt: number, hfov: number, site = CATALOGUE_FAINTEST): number {
  return Math.min(faintestByDark(sunAlt), faintestInView(hfov, site));
}

/** The faintest star the catalogue has. */
const CATALOGUE_FAINTEST = 6.5;
/** The faintest star shown in a view at its widest, under a dark sky. */
const WIDEST_FAINTEST = 5;

/** How many magnitudes fainter a star can be and still show, for each degree further down the Sun is. */
export const FAINTER_PER_DEG = 0.62;

/** The faintest star the sky's own darkness lets show, with the Sun at this altitude. */
export function faintestByDark(sunAlt: number): number {
  return -1.6 + (-sunAlt - 0.5) * FAINTER_PER_DEG;
}

/**
 * The faintest star shown however dark it is: more as the view closes in, up
 * to the catalogue's limit. `site` is the faintest star seen by eye from the
 * place, by how bright its sky is (skyglow.ts): under a city's sky the view
 * at its widest starts from that, and closing in still brings fainter stars
 * out, as looking closer does.
 */
export function faintestInView(hfov: number, site = CATALOGUE_FAINTEST): number {
  return Math.min(Math.min(WIDEST_FAINTEST, site) + 0.8 * Math.max(0, Math.log2(90 / hfov)), CATALOGUE_FAINTEST);
}
