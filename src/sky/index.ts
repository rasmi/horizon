// The sky map: where the sky is in the Street View panorama on screen, kept
// over the whole sky as the view is turned.
//
//   the viewer's canvas (frame.ts) → the model's raw map and labels
//   (detector.ts) → the look as taken (look.ts, doubt.ts) → the whole-sky
//   grid (evidence.ts) → the sky map (fill.ts)
//
// This file is the loop that decides when to look, and what the rest of the
// app is handed: a `SkyMap` to ask and to draw from. What the grid holds of
// each place is kept in this browser for coming back to it (places.ts).
// Nothing leaves the browser.

import type { Camera } from '../projection';
import { createDetector } from './detector';
import { SkyEvidence } from './evidence';
import { SkyFill } from './fill';
import { brightnessOf, captureFrame, glimpse, showsNothing } from './frame';
import { viewQuality } from './geometry';
import { lookTaken } from './look';
import { DEFAULT_MODEL, type ModelId } from './model';
import { Places } from './places';
import { preserving } from './preserve';
import type { Picture, RawMap, SkyDetector } from './types';
import { Arrival, Pace } from './watch';

/** What the sky map needs of the page. */
export interface SkyHost {
  /** The Street View pane, which holds the viewer's canvas. */
  pano: HTMLElement;
  /** The view as it is now; null while Street View isn't showing. */
  camera(): Camera | null;
  /** The panorama being shown. */
  panoId(): string;
  /** The panoramas one step along the street from the one being shown, by their IDs. */
  links(): string[];
}

/** The sky map, as the rest of the app sees it. */
export interface SkyMap {
  /** How far a point of the sky is part of the sky map: above nothing it is, below it isn't. */
  at(alt: number, az: number): number;
  /** Whether anything is known of that point: looked at, carried over from the place before, or kept from an earlier visit. */
  known(alt: number, az: number): boolean;
  /** What `at` blends, for every cell of the grid at once (see SkyFill.level): `bins` directions by `rows` altitudes, `step` degrees apart, a direction at a time, top row first. For drawing. */
  readonly level: Float64Array;
  /** How far inside the sky map each cell is, in degrees, laid out as `level` is (see SkyFill.depth). For drawing a soft edge. */
  depth(): Float32Array;
  readonly bins: number;
  readonly rows: number;
  readonly step: number;
  /** Counts every change, so that what's drawn from the sky map knows when to be drawn again. */
  readonly version: number;
  /**
   * Counts each time the sky map starts over: another place come to (not by
   * a step along the street, where the sky is carried), or everything
   * forgotten. What's drawn has then nothing to ease from: it's another sky.
   */
  readonly epoch: number;
  /** False from a place being arrived at until its picture is on screen: until then the sky map is ahead of what's showing. */
  readonly pictureHere: boolean;
  /** Calls `listener` after every change (a look taken in, a place arrived at, its picture arriving, everything forgotten); returns how to stop. */
  onChange(listener: () => void): () => void;
}

/** One look, as it was made: for whatever wants to show or record what goes into the sky map. */
export interface Look {
  /** The model's own raw map, and the map as the grid took it. */
  map: RawMap;
  taken: RawMap;
  /** The view it was of, and whether that was at rest. */
  cam: Camera;
  still: boolean;
  /** The frame's brightness. */
  picture: Picture;
  /** How long the model took, and everything made of its answer after. */
  modelMs: number;
  mapMs: number;
}

/** The sky map with its workings, for the development panel and for checking it by script. */
export interface Sky extends SkyMap {
  readonly model: ModelId;
  /** 'loading' until the model is ready; then how it's running; or why it isn't. */
  readonly status: string;
  /** Settles once the model is ready to look, and fails if it can't be: its file not to be had, the graphics card not taking it, the view not readable. Nothing is found until then. */
  readonly ready: Promise<void>;
  readonly cells: SkyEvidence;
  readonly fill: SkyFill;
  /** How many views have been looked at, and how many passed over as having nothing to add. */
  readonly counts: { analysed: number; skipped: number };
  /** Whether each place's sky is kept for coming back to. */
  remember: boolean;
  /** Has a view on the move looked at even when it has nothing to add: for showing what the model makes of each frame. */
  lookAlways: boolean;
  readonly places: Places;
  /** Whether a look is being made. */
  busy(): boolean;
  /** Handed every look as it's made; null to stop. */
  onLook(listener: ((look: Look) => void) | null): void;
  /** One look at the frame on screen, made on the side: nothing is added to the sky map. */
  snapshot(): Promise<{ frame: ImageData; map: RawMap; cam: Camera | null } | null>;
  /** Forgets what's known of the place on screen, as if it had just been arrived at for the first time. */
  startAfresh(): void;
}

/**
 * A place come back to has its sky as it was left (places.ts). If a look at
 * rest had settled this much of what the view takes in, the first looks of
 * a rest aren't made there: they've nothing to add, and a picture that's
 * still arriving and sharpening is what they'd get wrong. Only the last is.
 */
const RECALLED_COVERS = 0.9;

/** Starts finding the sky. (The sky map has to be switched on before the page loads: see preserve.ts.) */
export function startSky(host: SkyHost): Sky {
  const model = DEFAULT_MODEL;
  const cells = new SkyEvidence();
  const fill = new SkyFill(cells);
  fill.update();
  let version = 0;
  let epoch = 0;
  const listeners = new Set<() => void>();
  /** The grid has changed: the sky map is made again from it, and whoever draws from it told. */
  const changed = () => {
    fill.update();
    version++;
    for (const listener of listeners) listener();
  };

  let detector: SkyDetector | null = null;
  let status = preserving ? 'loading' : "couldn't make the view readable";
  let busy = false;
  let shownPano = '';
  const counts = { analysed: 0, skipped: 0 };
  let onLook: ((look: Look) => void) | null = null;
  let remember = true;
  let lookAlways = false;
  /** How wide the model's grid is, learnt from its first answer; and how long its last look took. */
  let gridWidth: number | undefined;
  let lookMs = 0;

  // What's been made of each place's sky, kept for coming back to it.
  const places = new Places(
    (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
  );
  /** Whether anything has been made of the place on screen (a look at it, or what was kept of it): whether there's anything to keep. */
  let knownHere = false;
  /** Whether the place on screen has just been taken back as it was kept, and the view of it not yet weighed for the looks it needs (see RECALLED_COVERS). */
  let recalled = false;
  function keepPlace(): void {
    if (!remember || !shownPano || !knownHere) return;
    places.keep(Places.key(shownPano, model), cells.keep());
  }
  /** Takes back what was kept of the place on screen, if anything was. (`over`: laid over what the grid holds, where what was kept knows nothing.) */
  function recallPlace(over = false): void {
    const kept = remember && shownPano ? places.recall(Places.key(shownPano, model)) : null;
    recalled = !!kept && cells.recall(kept, over);
    knownHere = recalled;
  }
  // (A reload, or the tab's closing: what's known of the place on screen is kept too.)
  window.addEventListener('pagehide', keepPlace);

  // The view is watched every animation frame, and looked at when the pace
  // says (watch.ts): every frame the model keeps up with while it turns,
  // and again once it has stopped, almost at once and as Street View's
  // sharper imagery arrives.
  const pace = new Pace();
  /** The panoramas a step from the one showing (as last reported). */
  let neighbours = new Set<string>();
  let neighboursOf = '';
  /** A place just arrived at, until its picture is there. */
  let arriving: Arrival | null = null;

  /**
   * Looks at the view. `still` is whether it's at rest. `again` is for a
   * view at rest being looked at again, which is done whatever is known of
   * it already. `fast` is for a view turning fast, whose look only adds sky.
   */
  async function analyse(cam: Camera, still: boolean, again = false, fast = false): Promise<void> {
    if (!detector || busy) return;
    // Nothing to gain: everything in view has been looked at enough, from a view as good.
    if (cells.covers(cam, gridWidth) && !again && !lookAlways) {
      counts.skipped++;
      return;
    }
    // (A little wider than the model takes it, so its own shrinking has something to average.)
    const frame = captureFrame(host.pano, Math.round(detector.inputSize * 1.25));
    if (!frame) return;
    if (showsNothing(frame)) {
      // Nothing's been drawn yet: try again at the next frame.
      pace.retry();
      return;
    }
    counts.analysed++;
    busy = true;
    try {
      const started = performance.now();
      const map = await detector.detect(frame);
      const detected = performance.now();
      lookMs = detected - started;
      // (Still worth having if the view has moved on meanwhile: the sky map is kept by direction, not by where
      // it was on screen. Not if the place has.)
      if (host.panoId() !== shownPano) return;
      gridWidth = map.width;
      const picture = brightnessOf(frame);
      const taken = lookTaken(map, picture);
      cells.add(taken, cam, viewQuality(cam, map.width, still), fast);
      knownHere = true;
      changed();
      status = detector.description;
      onLook?.({ map, taken, cam, still, picture, modelMs: lookMs, mapMs: performance.now() - detected });
      // (A look at a view at rest is the best there is of it: what's known of the place is kept after each.)
      if (still && again) keepPlace();
    } catch (err) {
      console.error(err);
      status = `failed: ${String((err as Error).message ?? err).split('\n')[0].slice(0, 110)}`;
    } finally {
      busy = false;
    }
  }

  function watch(now: number): void {
    const cam = host.camera();
    if (!cam) return;
    if (host.panoId() !== shownPano) {
      // What's known of the place being left is kept for coming back to it.
      keepPlace();
      // One step along the street, the sky is much as it was: what's held
      // of it carries over as a first guess, which the first looks here
      // put right. Anywhere else starts from nothing. And a place that's
      // been to before has its sky as it was left, laid over that.
      const stepped = neighbours.has(host.panoId());
      shownPano = host.panoId();
      if (stepped) cells.carryOver();
      else {
        cells.clear();
        epoch++;
      }
      recallPlace(stepped);
      changed();
      pace.retry();
      arriving = new Arrival(now, glimpse(host.pano));
    }
    const links = host.links();
    if (links.join() !== neighboursOf) {
      neighboursOf = links.join();
      neighbours = new Set(links);
    }
    pace.see(now, shownPano, cam);
    if (arriving) {
      // Nothing of the place is looked at until its picture is there. Then the view counts as having just come to rest.
      if (!arriving.here(now, glimpse(host.pano))) return;
      arriving = null;
      pace.rested(now);
      // (Whoever draws the sky map has been holding it back for this.)
      for (const listener of listeners) listener();
    }
    if (recalled) {
      // The place's sky is as it was left. Where that covers this view, only the last look of a rest is made:
      // it changes whatever it's sure is otherwise.
      recalled = false;
      if (cells.settledShare(cam) >= RECALLED_COVERS) pace.onlyTheLast(lookMs);
    }
    if (!detector || busy) return;
    const look = pace.next(now, lookMs);
    if (look) void analyse(cam, look.still, look.again, look.fast);
  }

  const loop = (now: number) => {
    watch(now);
    requestAnimationFrame(loop);
  };
  if (preserving) requestAnimationFrame(loop);
  // (Only on the graphics card: on the processor each look would hold the page up.)
  const ready: Promise<void> = preserving
    ? createDetector(model, true).then(
        (made) => {
          detector = made;
          status = made.description;
          // The place on screen starts from what was kept of it, if anything was, and the view counts as newly
          // come to rest: it gets a view at rest's looks, or only the last of them where what was kept covers it.
          cells.clear();
          recallPlace();
          changed();
          pace.restart();
        },
        (err) => {
          status = `failed to load: ${String((err as Error).message ?? err).split('\n')[0].slice(0, 110)}`;
          throw err;
        },
      )
    : Promise.reject(new Error(status));
  // (Whoever waits on it hears of a failure; nobody waiting isn't one more.)
  ready.catch(() => {});

  return {
    ready,
    at: (alt, az) => fill.at(alt, az),
    known: (alt, az) => fill.known(alt, az),
    level: fill.level,
    depth: () => fill.depth(),
    bins: cells.bins,
    rows: cells.rows,
    step: cells.step,
    get version() {
      return version;
    },
    get epoch() {
      return epoch;
    },
    get pictureHere() {
      return !arriving;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    model,
    get status() {
      return status;
    },
    cells,
    fill,
    counts,
    get remember() {
      return remember;
    },
    set remember(on: boolean) {
      remember = on;
    },
    get lookAlways() {
      return lookAlways;
    },
    set lookAlways(on: boolean) {
      lookAlways = on;
      // (The view is looked at again, as one newly come to rest.)
      pace.restart();
    },
    places,
    busy: () => busy,
    onLook(listener) {
      onLook = listener;
    },
    async snapshot() {
      while (busy || !detector) await new Promise((done) => setTimeout(done, 20));
      const frame = captureFrame(host.pano, Math.round(detector.inputSize * 1.25));
      if (!frame) return null;
      // (The model is asked for one frame at a time: the view isn't looked at meanwhile.)
      busy = true;
      try {
        return { frame, map: await detector.detect(frame), cam: host.camera() };
      } finally {
        busy = false;
      }
    },
    startAfresh() {
      cells.clear();
      knownHere = recalled = false;
      counts.analysed = counts.skipped = 0;
      epoch++;
      changed();
      pace.restart();
    },
  };
}
