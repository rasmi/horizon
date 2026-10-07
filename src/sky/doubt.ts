import { KINDS, kindsOf, type Picture, type RawMap } from './types';

// What a model is in doubt about, taken for sky where it looks like sky and
// joins sky.
//
// A model's score falls away over a cell or so at every edge between sky
// and something solid, so there's a thin rim of doubt round everything:
// scores under a half that aren't near nothing. That rim is the edge, and
// the line at a half is where the edge is. Taking it for sky would put sky
// on the edge of every building and tree. (Measured on the recorded frames:
// the line drawn at 0.3 for PP-MobileSeg gains 0.8 points of sky and covers
// 3 more points of buildings and trees. See score_line.ts.)
//
// A washed-out sky is another matter. Pale haze between two towers, low
// down where the sky is brightest, can be scored 0.3 over a broad area,
// look after look. To the eye it's plainly sky, and it joins sky the model
// is sure of. Leaves against the sky are in doubt over broad areas too, and
// aren't sky. The score can't tell the two apart; the picture can. Haze is
// as bright as the sky beside it or brighter, and as smooth. Leaves are
// darker and rough.
//
// So a point in doubt is taken for sky if it looks like the frame's own sky
// (no dimmer than it by much, and not much rougher), and joins sky the
// model has called, through other such points.
//
// "No dimmer than the frame's sky" is also met by being no dimmer than the
// sky a point joins on to: between towers the sky low down can be 30 levels
// dimmer than the sky overhead, and smooth all the way, so a sky that
// darkens smoothly is followed down.
//
// A strip of sky narrower than the model's cells (down an avenue, between
// towers) shows as a narrow ridge of doubt. No cell of it looks like sky all
// through, so it's followed along as a strip, and a cell of it taken where
// most of it looks like the sky the strip came from.
//
// And nothing of this takes what the model itself calls a building, a tree,
// the ground or water: a wall painted sky blue is as smooth and as bright
// as the sky beside it, and the picture can't tell them apart. The model
// had.

export interface DoubtOptions {
  /**
   * A point is in doubt from this score up to a half. (From 0.1 and not 0.2:
   * measured, that's 0.0 to 0.2 points more sky for 0.0 to 0.1 over solid
   * things. Lower still, a white building front beside a white sky starts
   * to pass for it.)
   */
  from: number;
  /**
   * With the frame's picture: a point in doubt has to be no rougher than
   * this many times the frame's sky (the picture's brightness changing from
   * pixel to pixel), or than `roughFloor` where the sky is smoother than
   * that allows for; and no more than `dimmer` levels of brightness (of
   * 255) darker than it. Infinity for either not to ask.
   */
  rough: number;
  roughFloor: number;
  dimmer: number;
  /**
   * Or, failing that last, no more than this many levels darker than the
   * point of sky it joins on to, cell to cell; 0 not to allow it. A sky's
   * brightness falls away across a frame by far more than `dimmer` (seen at
   * Seattle: 244 overhead, 213 low between the towers, and smooth all the
   * way), but never by much from one cell to the next. A roof or a wall
   * against it is a jump.
   */
  step: number;
  /**
   * A strip of sky narrower than the model's cells: a narrow ridge of doubt
   * that joins sky is followed along, and its top taken for sky whatever
   * the picture there looks like, where the top scores this much or more;
   * 0 not to. (See `ridgesOf`, and the top of this file.)
   */
  strip: number;
  /** A ridge is no more than this many of the model's cells across, from where the doubt starts to where it ends. */
  stripWide: number;
  /** What a point taken for sky is scored: sky, a little less surely than the model's own. */
  as: number;
}
export const DOUBT_DEFAULTS: DoubtOptions = {
  from: 0.1,
  rough: 2,
  roughFloor: 2.5,
  dimmer: 30,
  step: 8,
  strip: 0.2,
  stripWide: 5,
  as: 0.8,
};

/** The model is sure a point is sky at this score or over: what the frame's own sky is read from. */
const SURE_SKY = 0.9;

/**
 * The kinds of thing (see KINDS) that are never taken for sky by how they
 * look: what the model calls a building, a tree, the ground or water stays
 * that. And which of a model's classes are of those kinds, worked out once
 * for each list of names.
 */
const SOLID_KINDS = ['building', 'tree or plant', 'ground', 'water'];
const solidOf = new WeakMap<readonly string[], Uint8Array>();
function solidClasses(names: readonly string[]): Uint8Array {
  let classes = solidOf.get(names);
  if (!classes) solidOf.set(names, (classes = kindsOf(names).map((kind) => (SOLID_KINDS.includes(KINDS[kind].name) ? 1 : 0))));
  return classes;
}

/** How bright the picture is over each of a map's cells, and how rough: its brightness's mean change from one pixel to the next, across and down. */
function looksOf(map: RawMap, picture: Picture): { bright: Float32Array; rough: Float32Array } {
  const { width, height } = map;
  const bright = new Float32Array(width * height);
  const rough = new Float32Array(width * height);
  const { brightness } = picture;
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * picture.height) / height);
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * picture.height) / height));
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * picture.width) / width);
      const right = Math.max(left + 1, Math.floor(((x + 1) * picture.width) / width));
      let sum = 0;
      let change = 0;
      let changes = 0;
      for (let py = top; py < bottom; py++) {
        for (let px = left; px < right; px++) {
          const v = brightness[py * picture.width + px];
          sum += v;
          if (px + 1 < right) {
            change += Math.abs(brightness[py * picture.width + px + 1] - v);
            changes++;
          }
          if (py + 1 < bottom) {
            change += Math.abs(brightness[(py + 1) * picture.width + px] - v);
            changes++;
          }
        }
      }
      bright[y * width + x] = sum / ((bottom - top) * (right - left));
      rough[y * width + x] = changes ? change / changes : 0;
    }
  }
  return { bright, rough };
}

const middle = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];

/** Tallies of levels of brightness (0 to 255), kept to count into: of a cell's pixels, and of the changes between them. */
const levels = new Uint16Array(256);
const steps = new Uint16Array(256);
/** The middle one of `count` values tallied by level (the upper of the two, for an even number: as `middle` has it). */
function middleLevel(tally: Uint16Array, count: number): number {
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += tally[level];
    if (seen > count >> 1) return level;
  }
  return 255;
}

/**
 * How most of one of a map's cells looks in the picture: the middle
 * brightness of its pixels, and the middle change from one pixel to the
 * next. (Counted by level, not sorted: this is done for every point in
 * doubt that sky reaches, at every look.)
 */
function mostOf(map: RawMap, picture: Picture, cell: number): [bright: number, rough: number] {
  const { width, height } = map;
  const x = cell % width;
  const y = (cell - x) / width;
  const top = Math.floor((y * picture.height) / height);
  const bottom = Math.max(top + 1, Math.floor(((y + 1) * picture.height) / height));
  const left = Math.floor((x * picture.width) / width);
  const right = Math.max(left + 1, Math.floor(((x + 1) * picture.width) / width));
  const { brightness } = picture;
  levels.fill(0);
  steps.fill(0);
  let pixels = 0;
  let changes = 0;
  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) {
      const v = Math.round(brightness[py * picture.width + px]);
      levels[v]++;
      pixels++;
      if (px + 1 < right) {
        steps[Math.abs(Math.round(brightness[py * picture.width + px + 1]) - v)]++;
        changes++;
      }
      if (py + 1 < bottom) {
        steps[Math.abs(Math.round(brightness[(py + 1) * picture.width + px]) - v)]++;
        changes++;
      }
    }
  }
  return [middleLevel(levels, pixels), changes ? middleLevel(steps, changes) : 0];
}

/**
 * The narrow ridges of doubt in a map: 1 for each point that's part of
 * one. A ridge is a run of points in doubt (`from` or more, under a half)
 * along a row or a column, no more than `wide` of them, with a point that
 * isn't in doubt at all (under `from`) at each end of it, and somewhere in
 * it a score of `least` or more.
 *
 * That's what a model makes of a strip of sky narrower than its cells: too
 * little of any one cell is sky for it to say so, and what it does say is
 * spread over a cell or two to either side. The rim of doubt along an
 * ordinary edge is no ridge (it has the sky at one end of it), and nor is a
 * broad stretch of doubt.
 */
export function ridgesOf(map: RawMap, least: number, from: number, wide: number): Uint8Array {
  const { width, height, sky } = map;
  const ridges = new Uint8Array(width * height);
  /** Marks the ridges along one line of the map: `n` points from `start`, `stride` apart. */
  const along = (start: number, stride: number, n: number) => {
    for (let a = 0; a < n; ) {
      const first = sky[start + a * stride];
      if (first < from || first >= 0.5) {
        a++;
        continue;
      }
      // A run of doubt, from point `a` up to point `b`; and its highest score.
      let b = a;
      let top = 0;
      for (; b < n; b++) {
        const score = sky[start + b * stride];
        if (score < from || score >= 0.5) break;
        if (score > top) top = score;
      }
      const ends = a > 0 && b < n && sky[start + (a - 1) * stride] < from && sky[start + b * stride] < from;
      if (ends && b - a <= wide && top >= least) for (let k = a; k < b; k++) ridges[start + k * stride] = 1;
      a = b;
    }
  };
  for (let y = 0; y < height; y++) along(y * width, 1, width);
  for (let x = 0; x < width; x++) along(x, width, height);
  return ridges;
}

/**
 * A raw map with the doubt in it that looks like sky and joins sky taken
 * for sky. (The same map handed back where there's none to take.)
 * `picture` is the frame the model was shown, as brightness.
 */
export function skyThroughDoubt(map: RawMap, picture: Picture, options: Partial<DoubtOptions> = {}): RawMap {
  const { from, rough, roughFloor, dimmer, step, strip, stripWide, as } = { ...DOUBT_DEFAULTS, ...options };
  const { width, height, sky } = map;
  const count = width * height;
  // How the frame's own sky looks, and so which points look like it.
  const looks = looksOf(map, picture);
  const brights: number[] = [];
  const roughs: number[] = [];
  for (let i = 0; i < count; i++) {
    if (sky[i] < SURE_SKY) continue;
    brights.push(looks.bright[i]);
    roughs.push(looks.rough[i]);
  }
  if (!brights.length) return map;
  const roughest = Math.max(roughFloor, rough * middle(roughs));
  const dimmest = middle(brights) - dimmer;
  // What the model calls each point, and which of those are solid things (see SOLID_KINDS).
  const called = map.labels.classes;
  const solid = solidClasses(map.labels.names);
  // From the sky the model has called, out through the doubt that passes.
  const taken = new Uint8Array(count);
  // (A point waits once when it's taken, and at most once more before that as part of a ridge: see `along`.)
  const waiting = new Int32Array(count * 2);
  let found = 0;
  let took = 0;
  // The narrow ridges of doubt, which are strips of sky too thin for the model to call (see `strip`).
  const ridges = strip > 0 ? ridgesOf(map, strip, from, stripWide) : null;
  /** The points of a ridge that sky has been followed to: 1. And those the sky goes on from only along the ridge (the rest of it, and what was taken of it by how most of it looks): 1. */
  const along = new Uint8Array(count);
  const ridgeOnly = new Uint8Array(count);
  // (How most of each point looks, for those of a ridge that have been asked it.)
  const most = { asked: new Uint8Array(count), bright: new Float32Array(count), rough: new Float32Array(count) };
  /**
   * How bright the sky is that each point waiting was reached by, for the
   * next point to be as bright as, near enough (see `step`). A point of sky
   * that's smooth has its own; a cell with a roof's edge in it has none to
   * go by; and along a ridge it's the brightness of the last sky that was
   * clear, carried over what crosses the strip.
   */
  const skyBright = new Float32Array(count).fill(NaN);
  for (let i = 0; i < count; i++) {
    if (sky[i] < 0.5) continue;
    if (looks.rough[i] <= roughest) skyBright[i] = looks.bright[i];
    waiting[found++] = i;
  }
  /** Whether a brightness and roughness are the sky's, reached from the point `by`: smooth enough; and as bright as the frame's sky, near enough, or as the sky `by` was reached by. */
  const like = (bright: number, roughness: number, by: number) => roughness <= roughest && (bright >= dimmest || (step > 0 && bright >= skyBright[by] - step));
  /** How most of a point looks (see `mostOf`), worked out once. */
  const mostly = (i: number) => {
    if (!most.asked[i]) {
      most.asked[i] = 1;
      [most.bright[i], most.rough[i]] = mostOf(map, picture, i);
    }
  };
  /**
   * Takes a point in doubt for sky if it passes, reached from the point
   * `by` beside it. `by` is sky; or, with `onRidge`, a point of a narrow
   * ridge that sky has been followed to, from which only more of the ridge
   * is reached.
   */
  const reach = (i: number, by: number, onRidge: boolean) => {
    if (taken[i] || sky[i] >= 0.5 || sky[i] < from) return;
    // (What the model itself calls a building, a tree, the ground or water isn't taken for sky, whatever it looks like.)
    if (solid[called[i]]) return;
    const ridge = ridges !== null && ridges[i] === 1;
    if (onRidge && !ridge) return;
    if (like(looks.bright[i], looks.rough[i], by)) {
      // Sky all through.
      taken[i] = 1;
      took++;
      ridgeOnly[i] = 0;
      skyBright[i] = looks.bright[i];
      waiting[found++] = i;
      return;
    }
    if (ridge) {
      // A narrow ridge of doubt that joins sky is a strip of sky too thin for the model to call. No cell of it
      // is sky all through: each has the roofs to either side in it, and the wires across. So a cell of it is
      // taken if most of it looks like the sky the strip came from; and, taken or not, the strip is followed
      // on along the ridge, past whatever crosses it.
      mostly(i);
      if (like(most.bright[i], most.rough[i], by)) {
        taken[i] = 1;
        took++;
        skyBright[i] = most.bright[i];
      } else if (along[i]) return;
      else skyBright[i] = skyBright[by];
      along[i] = 1;
      ridgeOnly[i] = 1;
      waiting[found++] = i;
    }
    // (Anything else in doubt that isn't sky all through is left: the edge of whatever the sky ends at.)
  };
  for (let next = 0; next < found; next++) {
    const i = waiting[next];
    const x = i % width;
    const onRidge = ridgeOnly[i] === 1;
    if (x > 0) reach(i - 1, i, onRidge);
    if (x < width - 1) reach(i + 1, i, onRidge);
    if (i >= width) reach(i - width, i, onRidge);
    if (i < count - width) reach(i + width, i, onRidge);
  }
  if (!took) return map;
  const out = Float32Array.from(sky);
  for (let i = 0; i < count; i++) if (taken[i]) out[i] = as;
  return { ...map, sky: out };
}
