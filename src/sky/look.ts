import { skyThroughDoubt } from './doubt';
import { KINDS, kindsOf, type Picture, type RawMap } from './types';

// What's made of a look before its raw map goes into the grid the sky map
// is made from: the model's doubt taken for sky where it looks like sky
// (doubt.ts), and then poles, lights and signs seen through where they
// stand against the sky.

/**
 * The kind poles, lights and signs are sorted into (see KINDS); and which of
 * a model's classes are of it, worked out once for each list of names: 1 for
 * one that is, and 2 for one that's a pole or a light, which stands in the
 * sky on a stem that may carry on under another name (see `skyPastClutter`).
 * A sign or a flag is as often on a building.
 */
const CLUTTER = KINDS.findIndex((kind) => kind.name === 'pole, light or sign');
const STEMS = ['pole', 'streetlight', 'traffic light', 'light', 'lamp'];
const clutterOf = new WeakMap<readonly string[], Uint8Array>();
function clutterClasses(names: readonly string[]): Uint8Array {
  let classes = clutterOf.get(names);
  if (!classes) clutterOf.set(names, (classes = kindsOf(names).map((kind, c) => (kind !== CLUTTER ? 0 : STEMS.includes(names[c]) ? 2 : 1))));
  return classes;
}

/**
 * A stretch that carries a pole on, where the model calls it something else
 * (see `skyPastClutter`), may be this many times as wide as the widest
 * stretch of the pole that the model did name, and a cell more: room for a
 * cross-arm or a coil of cable, and not for the building a mast stands on.
 */
const CARRIES_ON = 3;

/**
 * A raw map with what the model calls a pole, a light or a sign seen
 * through where it stands against the sky, and made no part of the sky
 * anywhere else. (The same map handed back where the model calls nothing
 * that.)
 *
 * It goes by shape, along each row of the map, with the model's name for a
 * thing only as what sets it off. A stretch of a row where something stands
 * (the model names it a pole, a light or a sign, or doesn't score it as
 * sky), with sky at both its ends, is seen through if at least half of it
 * is so named. And where that's a pole or a light, so is the stretch that
 * carries it on in the row above or below, whatever the model calls that,
 * so long as it has sky at both ends too and isn't much wider (see
 * CARRIES_ON); and the one beyond that. (The models name a pole in patches:
 * the middle of a wooden one comes out as "tree", the top of a steel one as
 * "building". Not from a sign or a flag: one of those on the tip of a spire
 * would take the spire with it.)
 *
 * A street light out on its arm, a signal over the road, a pole with wires
 * strung from it: the sky is behind them. A sign on a building's front is
 * part of a stretch of wall, and is no part of the sky, whatever the model's
 * score for sky there: which for such a thing says nothing (it's sky set
 * against buildings, trees and the ground, and a sign is none of those). A
 * thing so named that runs off the side of the frame is left as the model
 * scored it: what's beside it can't be seen.
 */
export function skyPastClutter(map: RawMap, as = 0.8, not = 0.1): RawMap {
  const { labels, width, height, sky } = map;
  const clutter = clutterClasses(labels.names);
  const named = (i: number) => clutter[labels.classes[i]] > 0;
  // Each row's stretches of things, a row at a time: where each starts and ends, how many of its cells are
  // named (and how many as a pole or a light), and, once it's seen through, the width of the named stretch
  // it was reached from.
  const rows: number[] = [];
  const first: number[] = [];
  const last: number[] = [];
  const count: number[] = [];
  const stems: number[] = [];
  const rowStarts = new Int32Array(height + 1);
  let any = false;
  for (let y = 0; y < height; y++) {
    rowStarts[y] = rows.length;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!named(i) && sky[i] >= 0.5) continue;
      let end = x;
      let names = 0;
      let poles = 0;
      for (; end < width && (named(y * width + end) || sky[y * width + end] < 0.5); end++) {
        const kind = clutter[labels.classes[y * width + end]];
        if (kind > 0) names++;
        if (kind > 1) poles++;
      }
      if (names) any = true;
      rows.push(y);
      first.push(x);
      last.push(end - 1);
      count.push(names);
      stems.push(poles);
      x = end - 1;
    }
  }
  rowStarts[height] = rows.length;
  if (!any) return map;
  const wide = (r: number) => last[r] - first[r] + 1;
  /** Sky at both its ends: it stops short of the frame's sides, and what stops it is sky. */
  const open = (r: number) => first[r] > 0 && last[r] < width - 1;
  const mostlyNamed = (r: number) => count[r] * 2 >= wide(r);
  const through = new Float32Array(rows.length);
  const queue: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    if (!open(r) || !mostlyNamed(r)) continue;
    through[r] = wide(r);
    // (Carried on from a pole or a light only.)
    if (stems[r] * 2 >= wide(r)) queue.push(r);
  }
  while (queue.length) {
    const r = queue.pop()!;
    for (const y of [rows[r] - 1, rows[r] + 1]) {
      if (y < 0 || y >= height) continue;
      for (let s = rowStarts[y]; s < rowStarts[y + 1]; s++) {
        // (One that touches it, corner to corner at the least.)
        if (through[s] || !open(s) || first[s] > last[r] + 1 || last[s] < first[r] - 1) continue;
        if (wide(s) > CARRIES_ON * through[r] + 1) continue;
        through[s] = through[r];
        queue.push(s);
      }
    }
  }
  const out = Float32Array.from(sky);
  for (let r = 0; r < rows.length; r++) {
    const start = rows[r] * width;
    if (through[r]) {
      for (let x = first[r]; x <= last[r]; x++) out[start + x] = Math.max(out[start + x], as);
      continue;
    }
    // (Off the side of the frame, and nothing but the thing itself in view: left as it is.)
    if (!open(r) && mostlyNamed(r)) continue;
    for (let x = first[r]; x <= last[r]; x++) if (named(start + x)) out[start + x] = Math.min(out[start + x], not);
  }
  return { ...map, sky: out };
}

/** A look's raw map as the grid takes it. `picture` is the frame the model was shown, as brightness. */
export function lookTaken(map: RawMap, picture: Picture): RawMap {
  return skyPastClutter(skyThroughDoubt(map, picture));
}
