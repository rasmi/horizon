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
  /**
   * The objects being shown. Worked out, not stored: what's visible on the
   * night being viewed (see observableTonight), adjusted by `overrides`.
   */
  bodies: BodyId[];
  /**
   * Objects the visitor has switched on or off on purpose. These hold as the
   * night and place change; everything else follows what's visible.
   */
  overrides: Partial<Record<BodyId, boolean>>;
  twilight: Twilight;
  /** Count only naked-eye objects as visible, leaving Uranus and Neptune off unless switched on. */
  nakedEyeOnly: boolean;
}

const BODY_IDS = new Set<string>(BODIES.map((b) => b.id));

/** The objects to show: `visible` ones, except where the visitor chose otherwise. */
export function shownBodies(visible: BodyId[], overrides: AppState['overrides']): BodyId[] {
  return BODIES.map((b) => b.id).filter((id) => overrides[id] ?? visible.includes(id));
}

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
  // "b" lists the visitor's own choices: a name is switched on, "-name" off.
  const overrides: AppState['overrides'] = {};
  for (const token of (q.get('b') ?? '').split(',')) {
    const off = token.startsWith('-');
    const id = off ? token.slice(1) : token;
    if (BODY_IDS.has(id)) overrides[id as BodyId] = !off;
  }
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
    bodies: shownBodies([], overrides),
    overrides,
    twilight: tw === 6 || tw === 12 || tw === 18 ? tw : 12,
    nakedEyeOnly: q.get('eye') !== '0',
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
  // Only the visitor's own choices go in the link; everything else stays
  // "smart" for whoever opens it.
  const chosen = BODIES.filter((b) => s.overrides[b.id] !== undefined).map((b) => (s.overrides[b.id] ? b.id : `-${b.id}`));
  if (chosen.length) q.set('b', chosen.join(','));
  q.set('tw', String(s.twilight));
  if (!s.nakedEyeOnly) q.set('eye', '0');
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
