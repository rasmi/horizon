import { BODIES, type BodyId } from './astro';

export type Twilight = 6 | 12 | 18;

export interface AppState {
  lat: number | null;
  lng: number | null;
  pano: string | null;
  heading: number;
  pitch: number;
  zoom: number;
  time: Date;
  bodies: BodyId[];
  /**
   * True until the visitor toggles an object (or opens a link that lists
   * them): `bodies` then follows what's observable on the night being viewed.
   */
  bodiesAuto: boolean;
  twilight: Twilight;
}

/** Shown before a place is chosen; after that the default follows the night (see observableTonight). */
const DEFAULT_BODIES: BodyId[] = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const BODY_IDS = new Set<string>(BODIES.map((b) => b.id));

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readState(search = location.search): AppState {
  const q = new URLSearchParams(search);
  const lat = num(q.get('lat'));
  const lng = num(q.get('lng'));
  const t = q.get('t');
  const time = t && !Number.isNaN(Date.parse(t)) ? new Date(t) : new Date();
  const b = q.get('b');
  const bodies = b === null ? DEFAULT_BODIES : (b.split(',').filter((x) => BODY_IDS.has(x)) as BodyId[]);
  const tw = num(q.get('tw'));
  const valid = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    lat: valid ? lat : null,
    lng: valid ? lng : null,
    pano: q.get('pano'),
    heading: num(q.get('h')) ?? 180,
    pitch: num(q.get('p')) ?? 10,
    zoom: num(q.get('z')) ?? 1,
    time,
    bodies,
    bodiesAuto: b === null,
    twilight: tw === 6 || tw === 12 || tw === 18 ? tw : 12,
  };
}

export function stateToSearch(s: AppState): string {
  const q = new URLSearchParams();
  if (s.lat !== null && s.lng !== null) {
    q.set('lat', s.lat.toFixed(6));
    q.set('lng', s.lng.toFixed(6));
  }
  if (s.pano) q.set('pano', s.pano);
  q.set('h', s.heading.toFixed(1));
  q.set('p', s.pitch.toFixed(1));
  q.set('z', s.zoom.toFixed(2));
  q.set('t', new Date(Math.round(s.time.getTime() / 60000) * 60000).toISOString().replace(':00.000Z', 'Z'));
  // Left out while automatic, so the link stays "smart" for whoever opens it.
  if (!s.bodiesAuto) q.set('b', s.bodies.join(','));
  q.set('tw', String(s.twilight));
  return '?' + q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}

let pending: number | undefined;

function replaceUrl(s: AppState): void {
  history.replaceState(null, '', location.pathname + stateToSearch(s));
}

/** Debounced replaceState so dragging the view doesn't flood history. */
export function writeState(s: AppState): void {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => replaceUrl(s), 250);
}

/** Writes any pending state to the URL now. */
export function flushState(s: AppState): void {
  window.clearTimeout(pending);
  replaceUrl(s);
}
