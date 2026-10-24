// "Clears the roofline at…": for an object, on the night being shown, the
// stretches of time it spends in open sky from this place, by the sky map;
// those it spends behind a building or a tree; and those when it's somewhere
// the sky hasn't been looked at yet, of which nothing can be said until the
// view has been turned there.
//
// Worked out at the night's own five-minute samples, and said no finer: the
// sky map sits on the picture, but where an object is drawn on the picture
// can be up to a degree out in height for some captures (DEVELOPMENT.md,
// "Accuracy against the real sky"), which is five to eight minutes for a
// planet low in the sky.

import { STEP_MINUTES, type AltAz, type NightSummary, type Sample } from './astro';

/** What's asked of the sky map (SkyMap in sky/index.ts). */
export interface SkyAsked {
  at(alt: number, az: number): number;
  known(alt: number, az: number): boolean;
}

/** A stretch of time, as [start, end] in ms. */
export type Stretch = [start: number, end: number];

export interface OpenSky {
  /** While it's up: in open sky; behind something; and where the sky hasn't been looked at. Each stretch runs half a sample past its first and last, so that neighbours meet. */
  open: Stretch[];
  behind: Stretch[];
  unseen: Stretch[];
  /** In open sky while it's observable (up, and the sky dark enough): from its first sample so to its last. */
  clear: Stretch[];
  /** Whether any of its observable time is spent where the sky hasn't been looked at. */
  partlyUnseen: boolean;
}

export function openSky(summary: NightSummary, sun: Sample[], twilightDeg: number, sky: SkyAsked): OpenSky {
  const half = (STEP_MINUTES * 60000) / 2;
  const out: OpenSky = { open: [], behind: [], unseen: [], clear: [], partlyUnseen: false };
  const { samples } = summary;
  type State = 'open' | 'behind' | 'unseen' | null;
  const state = (s: Sample): State => (s.alt <= 0 ? null : sky.at(s.alt, s.az) > 0 ? 'open' : sky.known(s.alt, s.az) ? 'behind' : 'unseen');
  let run: { state: State; from: number } | null = null;
  let clearFrom: number | null = null;
  samples.forEach((s, i) => {
    const now = state(s);
    if (run && run.state !== now) {
      if (run.state) out[run.state].push([run.from - half, samples[i - 1].t + half]);
      run = null;
    }
    if (now && !run) run = { state: now, from: s.t };
    const dark = (sun[i]?.alt ?? 0) < -twilightDeg;
    const clear = now === 'open' && dark;
    if (clear && clearFrom === null) clearFrom = s.t;
    if (!clear && clearFrom !== null) {
      out.clear.push([clearFrom, samples[i - 1].t]);
      clearFrom = null;
    }
    if (now === 'unseen' && dark) out.partlyUnseen = true;
  });
  const last = samples[samples.length - 1];
  if (run && last) {
    const open: { state: State; from: number } = run;
    if (open.state) out[open.state].push([open.from - half, last.t + half]);
  }
  if (clearFrom !== null && last) out.clear.push([clearFrom, last.t]);
  return out;
}

/** When an object comes out from behind the skyline (`opens`) or goes behind it (`closes`). */
export type SkylineKind = 'opens' | 'closes';

/** A stretch in open sky, or behind something, shorter than this doesn't count as coming out or going behind: leaves, a pole. */
export const SKYLINE_MIN_MS = 15 * 60000;
/** How far along the skyline a night's crossing may be from the last night's and still be the same one, in degrees. */
const SKYLINE_MATCH_DEG = 15;
/** The step the track is asked at, and how near the crossing is then found between two steps. */
const CROSSING_STEP_MS = 2 * 60000;
const CROSSING_TO_MS = 5000;

/**
 * When an object next comes out from behind the skyline (`opens`) or goes
 * behind it, by the sky map, after `t` (dir 1) or before it (dir -1), within
 * a day and a half: the crossing of that kind nearest to `near` in the sky,
 * if one is within SKYLINE_MATCH_DEG of it. That's the same patch of
 * skyline a night on (or back), as the object's track shifts little from one
 * night to the next. Null where there's none: the track has moved off it, or
 * goes through sky that hasn't been looked at.
 */
export function skylineCrossingFrom(position: (t: number) => AltAz, sky: SkyAsked, opens: boolean, t: number, dir: 1 | -1, near: AltAz): number | null {
  type State = 'open' | 'behind' | 'unseen' | null;
  const state = (p: AltAz): State => (p.alt <= 0 ? null : sky.at(p.alt, p.az) > 0 ? 'open' : sky.known(p.alt, p.az) ? 'behind' : 'unseen');
  const span = 1.5 * 86400000;
  const [lo, hi] = dir > 0 ? [t, t + span] : [t - span, t];
  // The track in runs of one state each, from first time to last.
  const runs: { state: State; from: number; to: number }[] = [];
  for (let x = lo; x <= hi; x += CROSSING_STEP_MS) {
    const now = state(position(x));
    const run = runs[runs.length - 1];
    if (run && run.state === now) run.to = x;
    else runs.push({ state: now, from: x, to: x });
  }
  const [before, after]: State[] = opens ? ['behind', 'open'] : ['open', 'behind'];
  const long = (run: { from: number; to: number }) => run.to - run.from + CROSSING_STEP_MS >= SKYLINE_MIN_MS;
  const RAD = Math.PI / 180;
  let best: { t: number; apart: number } | null = null;
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1];
    const b = runs[i];
    if (a.state !== before || b.state !== after || !long(a) || !long(b)) continue;
    // Between the two steps, to within a few seconds.
    let x0 = a.to;
    let x1 = b.from;
    while (x1 - x0 > CROSSING_TO_MS) {
      const mid = (x0 + x1) / 2;
      if (state(position(mid)) === before) x0 = mid;
      else x1 = mid;
    }
    const p = position(x1);
    const cos = Math.sin(p.alt * RAD) * Math.sin(near.alt * RAD) + Math.cos(p.alt * RAD) * Math.cos(near.alt * RAD) * Math.cos((p.az - near.az) * RAD);
    const apart = Math.acos(Math.min(1, cos)) / RAD;
    if (apart <= SKYLINE_MATCH_DEG && (!best || apart < best.apart)) best = { t: Math.round(x1), apart };
  }
  return best?.t ?? null;
}

/** Something that changes exactly when what `openSky` gives does: for telling whether the chart needs drawing again. */
export function openSkyKey(all: Map<string, OpenSky> | null): string {
  if (!all) return '';
  let key = '';
  for (const [id, o] of all) key += `${id}:${o.open.join()}/${o.behind.join()}/${o.unseen.join()}/${o.clear.join()}/${o.partlyUnseen};`;
  return key;
}
