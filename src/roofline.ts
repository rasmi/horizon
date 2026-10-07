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

import { STEP_MINUTES, type NightSummary, type Sample } from './astro';

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

/** Something that changes exactly when what `openSky` gives does: for telling whether the chart needs drawing again. */
export function openSkyKey(all: Map<string, OpenSky> | null): string {
  if (!all) return '';
  let key = '';
  for (const [id, o] of all) key += `${id}:${o.open.join()}/${o.behind.join()}/${o.unseen.join()}/${o.clear.join()}/${o.partlyUnseen};`;
  return key;
}
