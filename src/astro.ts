import * as A from 'astronomy-engine';

export type BodyId =
  | 'Sun'
  | 'Moon'
  | 'Mercury'
  | 'Venus'
  | 'Mars'
  | 'Jupiter'
  | 'Saturn'
  | 'Uranus'
  | 'Neptune';

export interface BodyInfo {
  id: BodyId;
  color: string;
}

export const BODIES: BodyInfo[] = [
  { id: 'Sun', color: '#ffc93c' },
  { id: 'Moon', color: '#dfe3ee' },
  { id: 'Mercury', color: '#c9a98c' },
  { id: 'Venus', color: '#fff3b0' },
  { id: 'Mars', color: '#ff6247' },
  { id: 'Jupiter', color: '#ffa24a' },
  { id: 'Saturn', color: '#d8d86a' },
  { id: 'Uranus', color: '#7fe3df' },
  { id: 'Neptune', color: '#7c94ff' },
];

export const BODY_COLOR = Object.fromEntries(BODIES.map((b) => [b.id, b.color])) as Record<BodyId, string>;

/** Sample spacing for paths and visibility windows. */
export const STEP_MINUTES = 5;

export interface AltAz {
  alt: number; // degrees, apparent (includes refraction)
  az: number; // degrees from true north, clockwise
}

export interface Sample extends AltAz {
  t: number; // ms since epoch
}

export interface Interval {
  start: Date;
  end: Date;
}

/** A point on a drawn path. */
export interface PathSample extends Sample {
  /** Up while the sky isn't in daylight, so drawn solid. (The Sun: whenever it's up.) */
  bold: boolean;
  /** The Sun's altitude at this moment. For the Sun's own path, a stand-in that always counts as "down". */
  sunAlt: number;
}

/** Marks one path sample: solid if the object is up and the Sun is down. */
function pathSample(s: Sample, sunAlt: number): PathSample {
  return { ...s, sunAlt, bold: s.alt > 0 && sunAlt < SUN_DOWN };
}

/**
 * The exact point between two samples where the path changes between solid
 * and dashed: where the object crosses the horizon, or the Sun crosses its
 * "down" altitude. Lines are split here, so the solid part starts and ends at
 * the right place rather than at the nearest 5-minute sample.
 */
export function boldBoundary(a: PathSample, b: PathSample): AltAz {
  const fractions: number[] = [];
  if (a.alt > 0 !== b.alt > 0) fractions.push(a.alt / (a.alt - b.alt));
  if (a.sunAlt < SUN_DOWN !== b.sunAlt < SUN_DOWN) fractions.push((a.sunAlt - SUN_DOWN) / (a.sunAlt - b.sunAlt));
  // Solid needs both conditions: it starts at the later change and ends at the earlier.
  const f = fractions.length ? (b.bold ? Math.max(...fractions) : Math.min(...fractions)) : 0.5;
  const daz = ((b.az - a.az + 540) % 360) - 180;
  return { alt: a.alt + f * (b.alt - a.alt), az: (a.az + f * daz + 360) % 360 };
}

export interface NightSummary {
  id: BodyId;
  /** Positions through the noon-to-noon window: where the object is at any slider time. */
  samples: Sample[];
  /**
   * The line to draw. For the Sun, the window itself (this evening's sunset
   * and tomorrow's sunrise). For everything else, one full cycle around
   * tonight's pass, from its lowest point under the horizon up through rise,
   * transit and set and back down. A fixed 24 h window leaves the Moon's path
   * with a ~13° break in the sky, as it comes round ~50 min later each day;
   * cut at the lowest point, the break falls where it's least seen.
   */
  path: PathSample[];
  /**
   * How many samples at each end of `path` run on past the cycle, into the
   * previous and next day's track (0 for the Sun). An object's track never
   * quite closes: each day's is offset by how far its declination moved, a
   * few degrees for the Moon and next to nothing for the planets. Drawn
   * fading out, the two ends pass alongside each other at that true offset
   * instead of stopping short of one another.
   */
  pathOverlap: number;
  /** Rise, transit and set of tonight's pass: the one peaking in darkness, if any. */
  rise: Date | null;
  transit: Date | null;
  set: Date | null;
  /** Altitude at transit, or the highest sampled altitude if it never transits. */
  peakAlt: number;
  /** Above the horizon while the sun is below the twilight threshold. */
  observable: Interval[];
}

export interface SunEvents {
  sunset: Date | null;
  /** When the sun drops below the twilight threshold, and comes back up. */
  darkStart: Date | null;
  darkEnd: Date | null;
  sunrise: Date | null;
}

export interface NightData {
  start: Date;
  end: Date;
  /** How far below the horizon the Sun must be for the sky to count as dark, in degrees. */
  twilight: number;
  sun: Sample[];
  sunEvents: SunEvents;
  bodies: Map<BodyId, NightSummary>;
}

export function observer(lat: number, lng: number): A.Observer {
  return new A.Observer(lat, lng, 0);
}

export function horizontal(id: BodyId, date: Date, obs: A.Observer): AltAz {
  const body = A.Body[id];
  const eq = A.Equator(body, date, obs, true, true);
  const hor = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
  return { alt: hor.altitude, az: hor.azimuth };
}

const magCache = new Map<string, number>();

/** Apparent magnitude. It changes slowly, so it's cached per body per UTC day. */
export function magnitude(id: BodyId, date: Date): number {
  const key = `${id}:${Math.floor(date.getTime() / 86400000)}`;
  let mag = magCache.get(key);
  if (mag === undefined) {
    if (magCache.size > 500) magCache.clear();
    mag = A.Illumination(A.Body[id], date).mag;
    magCache.set(key, mag);
  }
  return mag;
}

function sampleBody(id: BodyId, obs: A.Observer, start: Date, end: Date): Sample[] {
  const out: Sample[] = [];
  const step = STEP_MINUTES * 60000;
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    out.push({ t, ...horizontal(id, new Date(t), obs) });
  }
  return out;
}

const DAY = 86400000;

function dateOf(t: A.AstroTime | null): Date | null {
  return t ? t.date : null;
}

function observableIntervals(samples: Sample[], sun: Sample[], twilightDeg: number): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  samples.forEach((s, i) => {
    const ok = s.alt > 0 && sun[i].alt < -twilightDeg;
    if (ok && open === null) open = s.t;
    if (!ok && open !== null) {
      out.push({ start: new Date(open), end: new Date(samples[i - 1].t) });
      open = null;
    }
  });
  if (open !== null) out.push({ start: new Date(open), end: new Date(samples[samples.length - 1].t) });
  return out;
}

/**
 * Rise, transit and set of one pass, chosen around the body's highest point
 * while the sun is down (or its highest point overall if it's never up in
 * darkness). Picking each event independently from the window start would mix
 * passes, e.g. a moonrise tonight with yesterday's moonset.
 */
function passEvents(id: BodyId, obs: A.Observer, samples: Sample[], sun: Sample[]) {
  const body = A.Body[id];
  let ref = samples[0];
  let refDark = false;
  samples.forEach((s, i) => {
    const dark = s.alt > 0 && sun[i].alt < SUN_DOWN;
    if ((dark && !refDark) || (dark === refDark && s.alt > ref.alt)) {
      ref = s;
      refDark = dark;
    }
  });
  // If it's up at the reference point, take the rise before it; if it never
  // gets up, take the next pass instead.
  const refDate = new Date(ref.t);
  const rise = dateOf(A.SearchRiseSet(body, obs, +1, refDate, ref.alt > 0 ? -1 : 1));
  const set = dateOf(A.SearchRiseSet(body, obs, -1, rise ?? refDate, 1));
  // First upper transit after the rise (or half a day back for bodies that never set).
  const transit = A.SearchHourAngle(body, obs, 0, rise ?? new Date(ref.t - DAY / 2));
  const transitOk = !set || transit.time.date <= set;
  return {
    rise,
    set,
    transit: transitOk ? transit.time.date : null,
    peakAlt: transitOk ? transit.hor.altitude : ref.alt,
    /** The middle of the pass: its transit, or failing that its highest sampled point. */
    centre: transitOk ? transit.time.date : refDate,
  };
}

/** Daylight ends, for drawing purposes, once the Sun's upper edge is down: its altitude at sunset and sunrise. */
export const SUN_DOWN = -0.833;

/** How far each end of a cycle path runs on past the cycle: an hour, about 15° of sky. */
const PATH_OVERLAP_STEPS = 60 / STEP_MINUTES;

/**
 * One full cycle of `id` around `centre`: from the lower culmination before
 * it to the one after, plus PATH_OVERLAP_STEPS beyond each, sampled on the
 * same time grid as the window so hour ticks land on whole hours.
 */
function cyclePath(
  id: BodyId,
  obs: A.Observer,
  centre: Date,
  gridStart: number,
  at: (t: number) => AltAz,
  sunAlt: (t: number) => number,
): PathSample[] {
  const body = A.Body[id];
  const step = STEP_MINUTES * 60000;
  const from = A.SearchHourAngle(body, obs, 12, centre, -1).time.date.getTime();
  const to = A.SearchHourAngle(body, obs, 12, centre, +1).time.date.getTime();
  const first = gridStart + Math.ceil((from - gridStart) / step) * step - PATH_OVERLAP_STEPS * step;
  const last = to + PATH_OVERLAP_STEPS * step;
  const out: PathSample[] = [];
  for (let t = first; t <= last; t += step) {
    out.push(pathSample({ t, ...at(t) }, sunAlt(t)));
  }
  return out;
}

function sunEvents(obs: A.Observer, start: Date, twilightDeg: number): SunEvents {
  const sun = A.Body.Sun;
  const sunset = dateOf(A.SearchRiseSet(sun, obs, -1, start, 1));
  const darkStart = dateOf(A.SearchAltitude(sun, obs, -1, start, 1, -twilightDeg));
  const darkEnd = dateOf(A.SearchAltitude(sun, obs, +1, darkStart ?? start, 1, -twilightDeg));
  const sunrise = dateOf(A.SearchRiseSet(sun, obs, +1, sunset ?? start, 1));
  return { sunset, darkStart, darkEnd, sunrise };
}

export function computeNight(
  lat: number,
  lng: number,
  window: { start: Date; end: Date },
  ids: BodyId[],
  twilightDeg: number,
): NightData {
  const obs = observer(lat, lng);
  const { start, end } = window;
  const sun = sampleBody('Sun', obs, start, end);
  // Paths reach beyond the window, so look positions up by time, reusing the
  // window's samples where they overlap.
  const lookup = (id: BodyId, known: Sample[]) => {
    const cache = new Map<number, AltAz>(known.map((s) => [s.t, s]));
    return (t: number): AltAz => {
      let p = cache.get(t);
      if (!p) cache.set(t, (p = horizontal(id, new Date(t), obs)));
      return p;
    };
  };
  const sunAt = lookup('Sun', sun);
  const sunAlt = (t: number) => sunAt(t).alt;

  const bodies = new Map<BodyId, NightSummary>();
  for (const id of ids) {
    const samples = id === 'Sun' ? sun : sampleBody(id, obs, start, end);
    const { centre, ...events } = passEvents(id, obs, samples, sun);
    // The Sun's own path is solid whenever it's up: -90 always counts as "Sun down".
    const windowPath = () => samples.map((s) => pathSample(s, id === 'Sun' ? -90 : sunAlt(s.t)));
    let path: PathSample[];
    let pathOverlap = 0;
    if (id === 'Sun') {
      path = windowPath();
    } else {
      try {
        path = cyclePath(id, obs, centre, start.getTime(), lookup(id, samples), sunAlt);
        pathOverlap = PATH_OVERLAP_STEPS;
      } catch {
        path = windowPath(); // a culmination search failed; the window is always available
      }
    }
    bodies.set(id, {
      id,
      samples,
      path,
      pathOverlap,
      ...events,
      observable: id === 'Sun' ? [] : observableIntervals(samples, sun, twilightDeg),
    });
  }
  return { start, end, twilight: twilightDeg, sun, sunEvents: sunEvents(obs, start, twilightDeg), bodies };
}

/** Bright enough to see without a telescope; the Sun is left out as it's never up in darkness. */
const NAKED_EYE: BodyId[] = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
/** Shorter than this and an object isn't worth showing by default. */
const MIN_OBSERVABLE_MS = 20 * 60000;

/** Observable too, but only through binoculars or a telescope. */
const TELESCOPIC: BodyId[] = ['Uranus', 'Neptune'];

/**
 * The default selection: the Moon, plus the planets observable on this
 * night; just the naked-eye ones, unless `nakedEyeOnly` is off. The Moon is
 * always included: it's visible in twilight and daylight too (a thin evening
 * crescent sets before it's fully dark), and it governs how bright the sky is.
 */
export function observableTonight(night: NightData, nakedEyeOnly = true): BodyId[] {
  return (nakedEyeOnly ? NAKED_EYE : [...NAKED_EYE, ...TELESCOPIC]).filter((id) => {
    if (id === 'Moon') return true;
    const windows = night.bodies.get(id)?.observable ?? [];
    const total = windows.reduce((ms, w) => ms + (w.end.getTime() - w.start.getTime()), 0);
    return total >= MIN_OBSERVABLE_MS;
  });
}

/** Linear interpolation of a body's position at `t` from its samples. */
export function interpolate(samples: Sample[], t: number): AltAz | null {
  if (!samples.length || t < samples[0].t || t > samples[samples.length - 1].t) return null;
  const step = STEP_MINUTES * 60000;
  const i = Math.min(Math.floor((t - samples[0].t) / step), samples.length - 2);
  const a = samples[i];
  const b = samples[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  let daz = b.az - a.az;
  if (daz > 180) daz -= 360;
  if (daz < -180) daz += 360;
  return { alt: a.alt + (b.alt - a.alt) * f, az: (a.az + daz * f + 360) % 360 };
}

export function twilightLabel(sunAlt: number): string {
  if (sunAlt > -0.833) return 'Daylight';
  if (sunAlt > -6) return 'Civil twilight';
  if (sunAlt > -12) return 'Nautical twilight';
  if (sunAlt > -18) return 'Astronomical twilight';
  return 'Dark';
}
