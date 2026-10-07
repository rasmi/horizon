// Looks at the sky map from inside the page, for checking by script what
// would otherwise be judged by eye: it turns the view as a hand would, and
// says what's on screen and what changed. Development builds only, with the
// night sky switched on; reached from the console as `await __skylineProbe()`.
//
//   const probe = await __skylineProbe();
//   await probe.place('seattle');            // one of the recorded places
//   await probe.pan(255, 55);                // turn to a heading and pitch
//   await probe.rest();                      // let the looks at rest come
//   await probe.table();                     // what's on screen, in shares of it
//   await probe.during(() => probe.pan(200, 55));   // what the sky map lost and gained on the way
//   await probe.settling(() => probe.pan(255, 55)); // how soon after stopping the sky map came to rest
//   await probe.turning(300, 20);                   // how much of the sky on screen it had while turning
//
// A place been to before has its sky as it was left (places.ts), which isn't
// what a check of how the sky map is made wants. For a place as if never
// seen: `__skyline.setRemember(false); __skyline.startAfresh()` once the
// page has loaded, or `probe.forgetPlaces()` to forget every place as well.
//
// The page has to be on screen. A tab that isn't doesn't redraw the viewer's
// canvas after the view is changed by script, and every look is then of a
// stale picture filed under the new view.
// Nor can it be trusted for the view it opened at: it's a different size,
// and as often as not the app has made no look at all 8 s after loading.

import { project, unproject, type Camera } from '../../projection';
import type { SkyEvidence } from '../evidence';
import type { SkyFill } from '../fill';
import { ALT_TOP, sampleMap } from '../geometry';
import type { Picture, RawMap } from '../types';
import { sampleView } from './area';

interface Pano {
  setPano(id: string): void;
  getPano(): string;
  setPov(pov: { heading: number; pitch: number }): void;
  getPov(): { heading: number; pitch: number };
  getLinks(): ({ pano?: string | null; heading?: number | null } | null)[] | null;
}
interface Skyline {
  grid: SkyEvidence | null;
  fill: SkyFill | null;
  counts: { analysed: number; skipped: number };
  snapshot(): Promise<{ frame: ImageData; map: RawMap; cam: Camera | null } | null>;
  setRecorder(to: ((map: RawMap, cam: Camera, still: boolean, taken: RawMap, picture?: Picture) => void) | null): void;
  busy(): boolean;
  places: { count: number; forget(): void };
  setRemember(on: boolean): boolean;
}

function page(): { pano: Pano; sky: Skyline; grid: SkyEvidence; fill: SkyFill } {
  const { __pano: pano, __skyline: sky } = window as unknown as { __pano?: Pano; __skyline?: Skyline };
  if (!pano || !sky?.grid || !sky.fill) throw new Error('switch the night sky on first');
  if (document.visibilityState !== 'visible') throw new Error("the page isn't on screen: its picture won't be redrawn");
  return { pano, sky, grid: sky.grid, fill: sky.fill };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const frame = () => new Promise((done) => requestAnimationFrame(done));

/**
 * Forgets what's been kept of every place, and (unless `keeping`) keeps
 * nothing from here on, until the page is next loaded: so that a place gone
 * to, or the page loaded again, is seen as for the first time. A place been
 * to before otherwise has its sky as it was left, which is not what a check
 * of how the sky map is made wants. (Without this the page keeps the place
 * on screen as it's left, a reload included.)
 */
export function forgetPlaces(keeping = false): number {
  const { sky } = page();
  const had = sky.places.count;
  sky.places.forget();
  sky.setRemember(keeping);
  return had;
}

/** Leaves the view alone for a while: long enough, by default, for the three looks a view at rest gets. */
export async function rest(ms = 2500): Promise<void> {
  page();
  await sleep(ms);
}

/** Turns the view to a heading and pitch, so far each animation frame: slowly enough, by default, for the app to analyse it on the way. */
export async function pan(heading: number, pitch: number, degreesAFrame = 0.25): Promise<void> {
  const { pano } = page();
  const from = pano.getPov();
  const across = ((heading - from.heading + 540) % 360) - 180;
  const up = pitch - from.pitch;
  const steps = Math.max(1, Math.ceil(Math.hypot(across, up) / degreesAFrame));
  for (let i = 1; i <= steps; i++) {
    pano.setPov({ heading: (from.heading + (across * i) / steps + 360) % 360, pitch: from.pitch + (up * i) / steps });
    await frame();
  }
}

/** Waits for the place showing to have been looked at, at least once, since `looked` looks had been made. */
async function arrived(looked: number, within = 8000): Promise<void> {
  const { sky } = page();
  for (const started = performance.now(); sky.counts.analysed <= looked && performance.now() - started < within; ) await sleep(50);
}

/** Goes to one of the recorded places by the panel's list, and waits for it to be looked at. */
export async function place(name: string): Promise<void> {
  const { sky } = page();
  const list = [...document.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Recorded place');
  if (!list || ![...list.options].some((o) => o.value === name)) throw new Error(`no such place: ${name}`);
  const looked = sky.counts.analysed;
  list.value = name;
  list.dispatchEvent(new Event('change'));
  await arrived(looked);
}

/** Steps to the next panorama along the street, the one most nearly ahead, and waits for it to be looked at. False if there's nowhere to step to. */
export async function step(): Promise<boolean> {
  const { pano, sky } = page();
  const ahead = pano.getPov().heading;
  const off = (heading: number) => Math.abs(((heading - ahead + 540) % 360) - 180);
  const links = (pano.getLinks() ?? []).filter((link): link is { pano: string; heading?: number | null } => !!link?.pano);
  if (!links.length) return false;
  links.sort((a, b) => off(a.heading ?? 0) - off(b.heading ?? 0));
  const looked = sky.counts.analysed;
  pano.setPano(links[0].pano);
  await arrived(looked);
  return true;
}

interface Point {
  /** Where on screen, 0 to 1 across and down; and where in the sky. */
  u: number;
  v: number;
  alt: number;
  az: number;
  /** The grid's cell there. */
  cell: number;
  /** The model's score for the frame now showing, in one look at the whole of it. */
  score: number;
  /** Whether the sky map has it; what the grid holds the cell to be; whether a look at rest settled that. */
  inMap: boolean;
  held: number;
  settled: boolean;
}

/** What's on screen, at points so many pixels apart. */
export async function screen(apartPx = 8): Promise<{ cam: Camera; across: number; down: number; points: Point[] }> {
  const { sky, grid, fill } = page();
  const shot = await sky.snapshot();
  if (!shot?.cam) throw new Error('nothing to look at');
  const { map, cam } = shot;
  const across = Math.floor(cam.width / apartPx);
  const down = Math.floor(cam.height / apartPx);
  const points: Point[] = [];
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const x = (i + 0.5) * apartPx;
      const y = (j + 0.5) * apartPx;
      const { alt, az } = unproject(x, y, cam);
      const bin = ((Math.round(az / grid.step) % grid.bins) + grid.bins) % grid.bins;
      const row = Math.min(grid.rows - 1, Math.max(0, Math.round((ALT_TOP - alt) / grid.step)));
      const cell = bin * grid.rows + row;
      const u = x / cam.width;
      const v = y / cam.height;
      points.push({ u, v, alt, az, cell, score: sampleMap(map, u, v), inMap: fill.at(alt, az) > 0, held: grid.decided[cell], settled: !!grid.settled[cell] });
    }
  }
  return { cam, across, down, points };
}

/**
 * What's on screen, in shares of it (percent): the sky map; what one look at
 * the whole frame calls sky, and how much of that the sky map has and lacks;
 * what the sky map has that such a look doesn't call sky; and what a look at
 * rest has settled.
 */
export async function table(): Promise<Record<string, number | string>> {
  const { sky } = page();
  const { cam, points } = await screen();
  const share = (test: (p: Point) => boolean) => Math.round((points.filter(test).length / points.length) * 1000) / 10;
  return {
    view: `${cam.heading.toFixed(1)}° / ${cam.pitch.toFixed(1)}°`,
    looks: sky.counts.analysed,
    'sky map': share((p) => p.inMap),
    'a whole look calls sky': share((p) => p.score >= 0.5),
    '... and the sky map has': share((p) => p.score >= 0.5 && p.inMap),
    '... and the sky map lacks': share((p) => p.score >= 0.5 && !p.inMap),
    'sky map beyond that': share((p) => p.score < 0.5 && p.inMap),
    'in doubt (0.2 to 0.5) and not in the sky map': share((p) => p.score >= 0.2 && p.score < 0.5 && !p.inMap),
    'settled at rest': share((p) => p.settled),
  };
}

interface Patch {
  /** Its share of the screen (percent), and where it is on screen and in the sky. */
  share: number;
  across: [number, number];
  down: [number, number];
  altitude: [number, number];
  /** The score a whole look gives it now (its middle value), and how the grid holds its points. */
  score: number;
  held: { sky: number; solid: number; unknown: number };
  settled: number;
}

/**
 * The patches on screen where the sky map and one look at the whole frame
 * differ, biggest first: `lacks` is what the look calls sky (or, with
 * `doubt`, scores 0.2 or more) and the sky map doesn't have; `beyond` is what
 * the sky map has and the look doesn't call sky.
 */
export async function patches(which: 'lacks' | 'beyond' = 'lacks', doubt = false, least = 12): Promise<Patch[]> {
  const { across, down, points } = await screen();
  const wanted = points.map((p) => (which === 'lacks' ? p.score >= (doubt ? 0.2 : 0.5) && !p.inMap : p.score < 0.5 && p.inMap));
  const seen = new Uint8Array(points.length);
  const found: Patch[] = [];
  const range = (values: number[]): [number, number] => [Math.round(Math.min(...values) * 100) / 100, Math.round(Math.max(...values) * 100) / 100];
  for (let start = 0; start < points.length; start++) {
    if (!wanted[start] || seen[start]) continue;
    const members = [start];
    seen[start] = 1;
    for (let next = 0; next < members.length; next++) {
      const i = members[next] % across;
      const j = (members[next] - i) / across;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= across || b >= down) continue;
        const other = b * across + a;
        if (!wanted[other] || seen[other]) continue;
        seen[other] = 1;
        members.push(other);
      }
    }
    if (members.length < least) continue;
    const of = members.map((m) => points[m]);
    const scores = of.map((p) => p.score).sort((a, b) => a - b);
    found.push({
      share: Math.round((members.length / points.length) * 10000) / 100,
      across: range(of.map((p) => p.u)),
      down: range(of.map((p) => p.v)),
      altitude: range(of.map((p) => p.alt)),
      score: Math.round(scores[scores.length >> 1] * 100) / 100,
      held: { sky: of.filter((p) => p.held === 1).length, solid: of.filter((p) => p.held === -1).length, unknown: of.filter((p) => !p.held).length },
      settled: of.filter((p) => p.settled).length,
    });
  }
  return found.sort((a, b) => b.share - a.share);
}

/**
 * Turns the view to a heading and pitch, and says how much of the sky on
 * screen the sky map had at the moment the turning ended, before any look
 * at rest: of what one look at the whole frame then calls sky, the share
 * (percent) the sky map already had, over the whole screen and by thirds of
 * it from the trailing side to the leading one. (The leading third is the
 * sky that has just come into view.) And `over`: what the sky map had then
 * that the look doesn't call sky, as a share of the screen: sky filled on
 * the move that shouldn't have been, or was put a little out of place. And
 * how many looks were made on the way, of how many animation frames.
 */
export async function turning(
  heading: number,
  pitch: number,
  degreesAFrame = 0.25,
): Promise<{ frames: number; looks: number; sky: number; had: number; trailing: number; middle: number; leading: number; over: number }> {
  const { pano, sky, grid } = page();
  const from = pano.getPov();
  const across = ((heading - from.heading + 540) % 360) - 180;
  const looked = sky.counts.analysed;
  const frames = Math.max(1, Math.ceil(Math.hypot(across, pitch - from.pitch) / degreesAFrame));
  await pan(heading, pitch, degreesAFrame);
  // The sky map as it stands this instant: what's drawn until the next look lands.
  const reached = Uint8Array.from(page().fill.reached);
  const looks = sky.counts.analysed - looked;
  // (What a look calls sky here is asked once the view's own looks at rest are done.)
  await sleep(2500);
  const shot = await sky.snapshot();
  if (!shot?.cam) throw new Error('nothing to look at');
  const { map, cam } = shot;
  const apart = 8;
  const wanted = [0, 0, 0];
  const got = [0, 0, 0];
  let points = 0;
  let beyond = 0;
  for (let y = apart / 2; y < cam.height; y += apart) {
    for (let x = apart / 2; x < cam.width; x += apart) {
      points++;
      const { alt, az } = unproject(x, y, cam);
      const bin = ((Math.round(az / grid.step) % grid.bins) + grid.bins) % grid.bins;
      const row = Math.min(grid.rows - 1, Math.max(0, Math.round((ALT_TOP - alt) / grid.step)));
      const had = reached[bin * grid.rows + row];
      if (sampleMap(map, x / cam.width, y / cam.height) < 0.5) {
        beyond += had;
        continue;
      }
      // Thirds of the screen, counted from the side the view is turning away from.
      const third = Math.min(2, Math.floor(((across >= 0 ? x : cam.width - x) / cam.width) * 3));
      wanted[third]++;
      got[third] += had;
    }
  }
  const share = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : NaN);
  const all = wanted[0] + wanted[1] + wanted[2];
  return {
    frames,
    looks,
    sky: share(all, points),
    had: share(got[0] + got[1] + got[2], all),
    trailing: share(got[0], wanted[0]),
    middle: share(got[1], wanted[1]),
    leading: share(got[2], wanted[2]),
    over: share(beyond, points),
  };
}

/**
 * Turns the view to a heading and pitch, and says how far the sky map
 * trailed the screen's leading edge on the way: at each animation frame,
 * along the line `alt` degrees up (which should be open sky all the way),
 * how many degrees of direction lay between the furthest the sky map
 * reached and the edge of the screen. Its middle value over the turn, the
 * value nine frames in ten were under, and the most; and how many looks
 * were made, of how many frames. (`turning` says what was on screen at the
 * one moment the turn ended, which depends on when the last look landed.
 * This is the whole turn.)
 */
export async function keepingUp(
  heading: number,
  pitch: number,
  degreesAFrame = 0.5,
  alt = 50,
): Promise<{ frames: number; looks: number; behind: { middle: number; mostly: number; most: number } }> {
  const { pano, sky } = page();
  const shot = await sky.snapshot();
  if (!shot?.cam) throw new Error('nothing to look at');
  const from = pano.getPov();
  const across = ((heading - from.heading + 540) % 360) - 180;
  const way = across >= 0 ? 1 : -1;
  const up = pitch - from.pitch;
  const steps = Math.max(1, Math.ceil(Math.hypot(across, up) / degreesAFrame));
  const looked = sky.counts.analysed;
  const behind: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const at = { heading: (from.heading + (across * i) / steps + 360) % 360, pitch: from.pitch + (up * i) / steps };
    pano.setPov(at);
    await frame();
    // How far along that line the screen reaches on the leading side, and how far the sky map does.
    const cam = { ...shot.cam, ...at };
    const { fill } = page();
    let edge = 0;
    while (edge < 90 && project(alt, at.heading + way * (edge + 0.5), cam).visible) edge += 0.5;
    let reach = edge;
    while (reach > 0 && !(fill.at(alt, (at.heading + way * reach + 360) % 360) > 0)) reach -= 0.5;
    // (Not the first frames: the turn starts from a view that's all filled.)
    if (i > 12) behind.push(edge - reach);
  }
  const looks = sky.counts.analysed - looked;
  behind.sort((a, b) => a - b);
  const of = (share: number) => (behind.length ? behind[Math.min(behind.length - 1, Math.floor(behind.length * share))] : NaN);
  return { frames: steps, looks, behind: { middle: of(0.5), mostly: of(0.9), most: of(1) } };
}

/**
 * Does something that ends with the view at rest (a pan, a step, going to a
 * place), then leaves it alone, and says how the sky map on screen came to
 * rest: for each look made from when the action ended, how many
 * milliseconds after that it was added, how wide the model's map (a closer
 * look's is wider), whether it counted as a look at rest, and the sky map's
 * share of the screen (percent) once it was in.
 */
export async function settling(action: () => Promise<unknown>, watchMs = 2500): Promise<{ after: number; map: number; still: boolean; skyMap: number }[]> {
  const { sky } = page();
  const looks: { after: number; map: number; still: boolean; skyMap: number }[] = [];
  let ended = Infinity;
  sky.setRecorder((map, cam, still) => {
    const now = performance.now();
    if (now < ended) return;
    const { fill } = page();
    const { values } = sampleView(cam, 16, (alt, az) => fill.at(alt, az));
    let has = 0;
    for (const value of values) if (value > 0) has++;
    looks.push({ after: Math.round(now - ended), map: map.width, still, skyMap: Math.round((has / values.length) * 1000) / 10 });
  });
  try {
    await action();
    ended = performance.now();
    await sleep(watchMs);
    while (sky.busy()) await sleep(20);
  } finally {
    sky.setRecorder(null);
  }
  return looks;
}

/**
 * Does something (a pan, a rest, a step), and says what the sky map lost
 * and gained on the way: how many of the grid's cells it had at the start
 * and has at the end, the most it was missing of those it started with at
 * any look, and each look at which it lost more than `worth` of them (which
 * look it was, whether the view was at rest, and how wide the model's map).
 * And `takenBack`: how many times in all a cell held as sky stopped being at
 * a look, new sky found on the way included, which is what shows as sky
 * coming and going while the view turns.
 * Only cells the grid held as sky are counted at the start: what's taken
 * for sky because it lies above everything seen is a guess, and losing it
 * as the view rises is the guess being put right.
 */
export async function during(
  action: () => Promise<unknown>,
  worth = 40,
): Promise<{ looks: number; atStart: number; atEnd: number; mostMissing: number; missingAtEnd: number; takenBack: number; losses: { look: number; still: boolean; map: number; lost: number }[] }> {
  const { sky, grid, fill } = page();
  /** The cells held as sky and in the sky map, as things stand. */
  const heldNow = () => {
    const now = page();
    return Uint8Array.from(now.fill.reached, (reached, cell) => (reached && now.grid.decided[cell] === 1 ? 1 : 0));
  };
  const had = Uint8Array.from(fill.reached, (reached, cell) => (reached && grid.decided[cell] === 1 ? 1 : 0));
  const atStart = had.reduce((n, v) => n + v, 0);
  let looks = 0;
  let mostMissing = 0;
  let missingBefore = 0;
  /** How many times a cell held as sky stopped being, at any look: whether or not it was at the start, or came back. */
  let takenBack = 0;
  let before = had;
  const losses: { look: number; still: boolean; map: number; lost: number }[] = [];
  sky.setRecorder((map, _cam, still) => {
    looks++;
    const now = page().fill.reached;
    const held = heldNow();
    let missing = 0;
    for (let i = 0; i < now.length; i++) {
      if (had[i] && !now[i]) missing++;
      if (before[i] && !held[i]) takenBack++;
    }
    before = held;
    if (missing - missingBefore > worth) losses.push({ look: looks, still, map: map.width, lost: missing - missingBefore });
    mostMissing = Math.max(mostMissing, missing);
    missingBefore = missing;
  });
  try {
    await action();
    while (sky.busy()) await sleep(20);
  } finally {
    sky.setRecorder(null);
  }
  const now = page().fill.reached;
  let atEnd = 0;
  let missingAtEnd = 0;
  for (let i = 0; i < now.length; i++) {
    atEnd += now[i];
    if (had[i] && !now[i]) missingAtEnd++;
  }
  return { looks, atStart, atEnd, mostMissing, missingAtEnd, takenBack, losses };
}
