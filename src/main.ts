import './style.css';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import tzlookup from 'tz-lookup';
import { BODIES, computeNight, interpolate, observableTonight, type BodyId, type NightData } from './astro';
import { axisFor, nightAxis, type TimeAxis } from './axis';
import { formatCapture, isWinter, parseCaptures, parseImageDate, type Capture } from './imagery';
import { Overlay } from './overlay';
import { renderChips, renderInfo, setTimelineNow, skyState, sliderGradient } from './panel';
import { lookAt, streetViewHfov, type Camera } from './projection';
import { flushState, readState, writeState, type Twilight } from './state';
import { formatDate, formatTime, isoDate, nightWindow, shiftDays, tzAbbrev, wallTime, zonedToDate } from './time';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  pano: $<HTMLDivElement>('pano'),
  overlay: $<HTMLDivElement>('overlay'),
  map: $<HTMLDivElement>('map'),
  mapToggle: $<HTMLButtonElement>('map-toggle'),
  imagery: $<HTMLDivElement>('imagery'),
  capSelect: $<HTMLSelectElement>('cap-select'),
  capOlder: $<HTMLButtonElement>('cap-older'),
  capNewer: $<HTMLButtonElement>('cap-newer'),
  panel: $<HTMLElement>('panel'),
  handle: $<HTMLButtonElement>('sheet-handle'),
  panelToggle: $<HTMLButtonElement>('panel-toggle'),
  search: $<HTMLDivElement>('search'),
  locationLabel: $<HTMLParagraphElement>('location-label'),
  locate: $<HTMLButtonElement>('locate-btn'),
  date: $<HTMLInputElement>('date'),
  prevDay: $<HTMLButtonElement>('prev-day'),
  nextDay: $<HTMLButtonElement>('next-day'),
  now: $<HTMLButtonElement>('now'),
  play: $<HTMLButtonElement>('play'),
  slider: $<HTMLInputElement>('slider'),
  timeLabel: $<HTMLOutputElement>('time-label'),
  skyState: $<HTMLSpanElement>('sky-state'),
  twilight: $<HTMLSelectElement>('twilight'),
  chips: $<HTMLDivElement>('chips'),
  info: $<HTMLUListElement>('info'),
  share: $<HTMLButtonElement>('share-btn'),
  infoBtn: $<HTMLButtonElement>('info-btn'),
  infoDialog: $<HTMLDialogElement>('info-dialog'),
  infoClose: $<HTMLButtonElement>('info-close'),
  toast: $<HTMLDivElement>('toast'),
};

const state = readState();
let tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
let night: NightData | null = null;
let nightKey = '';
let pano: google.maps.StreetViewPanorama | null = null;
/** Steps to an older (-1) or newer (+1) capture; set once Street View is up. */
let stepCapture: (dir: -1 | 1) => void = () => {};

const overlay = new Overlay(els.overlay, lookAtBody);

// ---------- toast ----------

let toastTimer: number | undefined;
function toast(msg: string, ms = 4000): void {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), ms);
}

// ---------- astronomy ----------

function recompute(): void {
  if (state.lat === null || state.lng === null) {
    night = null;
  } else {
    const win = nightWindow(state.time, tz);
    // ~100 m grid: walking between panoramas doesn't change anything visible.
    const key = `${state.lat.toFixed(3)},${state.lng.toFixed(3)},${win.start.getTime()},${state.twilight}`;
    if (key !== nightKey) {
      night = computeNight(state.lat, state.lng, win, BODIES.map((b) => b.id), state.twilight);
      nightKey = key;
      // Until the visitor chooses for themselves, show what's observable tonight.
      if (state.bodiesAuto) {
        state.bodies = observableTonight(night);
        showChips();
      }
    }
  }
  syncTimeControls();
  renderInfoPanel();
  requestRender();
}

/** The noon-to-noon window holding the current time. */
function currentWindow(): { start: Date; end: Date } {
  return night ?? nightWindow(state.time, tz);
}

/** The slider's range (its `max` attribute): positions along the axis, not minutes. */
const SLIDER_MAX = 1440;
/** Times chosen with the slider snap to this. */
const SLIDER_STEP_MS = 5 * 60000;

/**
 * The slider's time axis, shared with the timeline: daytime squeezed, so most
 * of its travel is the night (see axis.ts). Linear until a night is computed.
 */
function sliderAxis(): TimeAxis {
  if (night) return axisFor(night);
  const win = currentWindow();
  return nightAxis(win.start.getTime(), win.end.getTime(), null, null);
}

function syncTimeControls(): void {
  const win = currentWindow();
  // Writing the value while someone types in the field resets the browser's
  // typing state, so a year could only be changed one digit at a time.
  if (document.activeElement !== els.date) els.date.value = isoDate(win.start, tz);
  els.slider.value = String(Math.round(sliderAxis().toFraction(state.time.getTime()) * SLIDER_MAX));
  const label = `${formatDate(state.time, tz)}, ${formatTime(state.time, tz)} ${tzAbbrev(state.time, tz)}`;
  els.timeLabel.textContent = label;
  els.slider.setAttribute('aria-valuetext', label);
  if (night) {
    els.slider.style.setProperty('--track', sliderGradient(night));
    els.skyState.textContent = skyState(night, state.time.getTime());
    setTimelineNow(els.info, night, state.time.getTime());
  } else {
    els.skyState.textContent = '';
  }
}

function renderInfoPanel(): void {
  renderInfo(els.info, night, state.bodies, state.time.getTime(), tz, lookAtBody);
}

function setTime(t: Date): void {
  state.time = t;
  recompute();
  writeState(state);
}

// ---------- rendering ----------

let frame = 0;
function requestRender(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

function camera(): Camera | null {
  if (!pano || !pano.getVisible()) return null;
  const pov = pano.getPov();
  const width = els.overlay.clientWidth;
  const height = els.overlay.clientHeight;
  return {
    heading: pov.heading,
    pitch: pov.pitch,
    hfov: streetViewHfov(pano.getZoom() ?? 1, width, height),
    width,
    height,
  };
}

function render(): void {
  const cam = camera();
  els.overlay.hidden = !cam;
  if (!cam) return;
  overlay.render({ cam, data: night, time: state.time.getTime(), bodies: state.bodies, tz });
}

function lookAtBody(id: BodyId): void {
  const pos = night && interpolate(night.bodies.get(id)?.samples ?? [], state.time.getTime());
  if (!pano || !pos) return;
  setSheetOpen(false);
  els.overlay.classList.add('turning');
  pano.setPov(lookAt(pos.alt, pos.az));
  window.clearTimeout(turnTimer);
  turnTimer = window.setTimeout(() => els.overlay.classList.remove('turning'), 700);
}
let turnTimer: number | undefined;

// ---------- location ----------

function setLatLng(lat: number, lng: number, keepWallTime = true): void {
  state.lat = lat;
  state.lng = lng;
  const newTz = tzlookup(lat, lng);
  if (newTz !== tz && keepWallTime) {
    // Keep the same local wall-clock time when jumping time zones.
    const w = wallTime(state.time, tz);
    state.time = zonedToDate(w, newTz);
  }
  tz = newTz;
  els.locationLabel.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)} · ${tz}`;
}

// ---------- Google Maps ----------

async function initMaps(key: string | undefined): Promise<void> {
  setOptions(key ? { key, v: 'weekly' } : { v: 'weekly' });
  const [{ Map: GoogleMap }, { StreetViewPanorama, StreetViewService, StreetViewCoverageLayer }, places] = await Promise.all([
    importLibrary('maps'),
    importLibrary('streetView'),
    importLibrary('places'),
  ]);

  const hasLoc = state.lat !== null && state.lng !== null;
  const map = new GoogleMap(els.map, {
    center: hasLoc ? { lat: state.lat!, lng: state.lng! } : { lat: 30, lng: 0 },
    zoom: hasLoc ? 16 : 2,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });
  new StreetViewCoverageLayer().setMap(map);

  pano = new StreetViewPanorama(els.pano, {
    visible: false,
    pov: { heading: state.heading, pitch: state.pitch },
    zoom: state.zoom,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: true,
    addressControl: false,
    showRoadLabels: false,
    enableCloseButton: false,
  });
  map.setStreetView(pano);
  if (import.meta.env.DEV) Object.assign(window, { __pano: pano });
  const sv = new StreetViewService();

  /** Where the last panorama opened by a lookup is, and (if set) the spot the visitor's location gave. */
  let lastOpened: google.maps.LatLng | null = null;
  let locatedAt: google.maps.LatLng | null = null;
  /** The panorama the imagery date bar last switched to (a change of date, not a move to a new spot). */
  let captureTarget = '';
  const metresBetween = (a: google.maps.LatLng, b: google.maps.LatLng) =>
    Math.hypot((a.lat() - b.lat()) * 111320, (a.lng() - b.lng()) * 111320 * Math.cos((a.lat() * Math.PI) / 180));

  pano.addListener('pov_changed', () => {
    const pov = pano!.getPov();
    state.heading = pov.heading;
    state.pitch = pov.pitch;
    requestRender();
    writeState(state);
    noteViewTurned();
  });
  pano.addListener('zoom_changed', () => {
    state.zoom = pano!.getZoom() ?? 1;
    requestRender();
    writeState(state);
  });
  pano.addListener('pano_changed', () => {
    state.pano = pano!.getPano();
    writeState(state);
    void syncCaptures(state.pano);
  });
  pano.addListener('position_changed', () => {
    const p = pano!.getPosition();
    if (!p) return;
    setLatLng(p.lat(), p.lng());
    recompute();
    writeState(state);
    // Walked away from the spot the visitor's location gave. Another imagery
    // date of that spot is still that spot, though its capture may have been
    // taken some metres off.
    if (pano!.getPano() === captureTarget) {
      if (locatedAt) locatedAt = p;
    } else if (locatedAt && metresBetween(p, locatedAt) > 1) {
      setLocated(false);
    }
  });
  pano.addListener('visible_changed', () => {
    document.body.classList.toggle('landing', !pano!.getVisible());
    requestRender();
  });
  new ResizeObserver(requestRender).observe(els.overlay);

  // ----- imagery dates (see imagery.ts) -----

  /** Lookup results by panorama ID, so goTo's lookup isn't repeated. */
  const panoData = new Map<string, google.maps.StreetViewPanoramaData>();
  let captures: Capture[] = [];
  let captureLookup = 0;

  async function lookup(id: string): Promise<google.maps.StreetViewPanoramaData | null> {
    let data = panoData.get(id);
    if (!data) {
      try {
        data = (await sv.getPanorama({ pano: id })).data;
        panoData.set(id, data);
      } catch {
        return null;
      }
    }
    return data;
  }

  /** Brings the date bar up to date for the panorama now showing. */
  async function syncCaptures(id: string): Promise<void> {
    // Switching year within the list needs no lookup; walking to a new spot does.
    if (!captures.some((c) => c.pano === id)) {
      const ticket = ++captureLookup;
      const data = await lookup(id);
      if (ticket !== captureLookup) return; // a newer panorama took over
      captures = parseCaptures(data);
      // No list (or it doesn't include this panorama): show just its documented date.
      if (!captures.some((c) => c.pano === id)) {
        captures = data ? [{ pano: id, date: parseImageDate(data.imageDate) }] : [];
      }
    }
    renderCaptures(id);
  }

  function renderCaptures(current: string): void {
    const lat = state.lat ?? 0;
    els.capSelect.replaceChildren(
      ...[...captures].reverse().map((c) => {
        const o = document.createElement('option');
        o.value = c.pano;
        o.textContent = formatCapture(c.date) + (isWinter(c.date, lat) ? ' ❄' : '');
        o.selected = c.pano === current;
        return o;
      }),
    );
    const i = captures.findIndex((c) => c.pano === current);
    els.capOlder.disabled = i <= 0;
    els.capNewer.disabled = i < 0 || i >= captures.length - 1;
    els.capSelect.disabled = captures.length < 2;
    els.imagery.hidden = captures.length === 0;
    document.body.classList.toggle('has-imagery', captures.length > 0);
  }

  function showCapture(id: string): void {
    if (!pano || id === pano.getPano()) return;
    // Street View keeps heading and pitch across setPano but resets the zoom.
    const zoom = pano.getZoom();
    const once = pano.addListener('status_changed', () => {
      once.remove();
      if (zoom !== undefined) pano!.setZoom(zoom);
    });
    captureTarget = id;
    pano.setPano(id);
  }

  stepCapture = (dir) => {
    const i = captures.findIndex((c) => c.pano === pano?.getPano());
    const next = captures[i + dir];
    if (i >= 0 && next) showCapture(next.pano);
  };
  els.capSelect.addEventListener('change', () => showCapture(els.capSelect.value));
  els.capOlder.addEventListener('click', () => stepCapture(-1));
  els.capNewer.addEventListener('click', () => stepCapture(1));

  /** Search radii (m) tried in turn when only Google's own imagery will do. */
  const OFFICIAL_ONLY_RADII = [500, 2000];

  type PanoRequest = google.maps.StreetViewLocationRequest | google.maps.StreetViewPanoRequest;

  async function find(req: PanoRequest): Promise<google.maps.StreetViewPanoramaData | null> {
    try {
      const { data } = await sv.getPanorama(req);
      return data.location?.pano ? data : null;
    } catch {
      return null;
    }
  }

  function open(data: google.maps.StreetViewPanoramaData | null): boolean {
    if (!data) return false;
    panoData.set(data.location!.pano, data);
    pano!.setPano(data.location!.pano);
    pano!.setVisible(true);
    lastOpened = data.location!.latLng!;
    map.setCenter(data.location!.latLng!);
    if ((map.getZoom() ?? 0) < 15) map.setZoom(16);
    return true;
  }

  const goTo = async (req: PanoRequest): Promise<boolean> => open(await find(req));

  /**
   * Whether a panorama is part of the street network. Google's own imagery
   * also includes isolated one-off captures (old interior shots and the like,
   * described just as "Google"), which a "google" search returns like any
   * other but which have no links to neighbours.
   */
  const onStreet = (data: google.maps.StreetViewPanoramaData) => (data.links?.length ?? 0) > 0;

  /**
   * Google's own imagery nearest `ll`, preferring the street network. The API
   * only ever returns the single nearest panorama, so when that's an isolated
   * capture, probe a few rings of points around it for street imagery.
   * `street` says which kind came back.
   */
  async function findOfficial(
    ll: google.maps.LatLngLiteral,
    radius: number,
  ): Promise<{ data: google.maps.StreetViewPanoramaData; street: boolean } | null> {
    const base = {
      preference: 'nearest' as google.maps.StreetViewPreferenceString,
      sources: ['google' as google.maps.StreetViewSourceString],
    };
    const nearest = await find({ ...base, location: ll, radius });
    if (!nearest) return null;
    if (onStreet(nearest)) return { data: nearest, street: true };

    const probes: google.maps.LatLngLiteral[] = [];
    const perDegLng = 111320 * Math.cos((ll.lat * Math.PI) / 180);
    for (const ring of [0.3, 0.6, 1]) {
      for (let bearing = 0; bearing < 360; bearing += 45) {
        const b = (bearing * Math.PI) / 180;
        probes.push({
          lat: ll.lat + (ring * radius * Math.cos(b)) / 111320,
          lng: ll.lng + (ring * radius * Math.sin(b)) / perDegLng,
        });
      }
    }
    const found = await Promise.all(probes.map((location) => find({ ...base, location, radius: 0.3 * radius })));
    const metres = (d: google.maps.StreetViewPanoramaData) => {
      const p = d.location!.latLng!;
      return Math.hypot((p.lat() - ll.lat) * 111320, (p.lng() - ll.lng) * perDegLng);
    };
    let best: google.maps.StreetViewPanoramaData | null = null;
    for (const d of found) if (d && onStreet(d) && (!best || metres(d) < metres(best))) best = d;
    return best ? { data: best, street: true } : { data: nearest, street: false };
  }

  /**
   * Opens the nearest panorama to `ll`, preferring Google's street imagery.
   * With `officialOnly`, nothing else is ever opened (no user photo sphere,
   * no isolated capture): the search widens instead, and failing that the
   * map is left for the visitor to pick from.
   */
  async function goToLatLng(ll: google.maps.LatLngLiteral, radius: number, officialOnly = false): Promise<boolean> {
    // Prefer Google's own imagery: user photospheres often have unreliable
    // north alignment, which would misplace the whole overlay.
    let hit = await findOfficial(ll, radius);
    let ok = false;
    if (officialOnly) {
      for (const wider of OFFICIAL_ONLY_RADII) {
        if (hit?.street || wider <= radius) continue;
        radius = wider;
        hit = await findOfficial(ll, radius);
      }
      ok = !!hit?.street && open(hit.data);
    } else if (hit) {
      ok = open(hit.data);
    } else if ((ok = await goTo({ location: ll, radius, preference: 'nearest' as google.maps.StreetViewPreferenceString }))) {
      toast('Only a user-contributed photo sphere here. Its compass alignment may be off.', 6000);
    }
    if (!ok) {
      map.panTo(ll);
      map.setZoom(Math.max(map.getZoom() ?? 0, 15));
      toast(`No Street View within ${radius} m. Click on a blue line on the map.`);
    }
    if (ok) {
      resetLookingAround();
      // A new place, however it was chosen; locate() marks its own afterwards.
      setLocated(false);
    }
    return ok;
  }

  /**
   * Fills the locate button's centre dot while the view is at the spot the
   * visitor's own location gave. The location is read once, when asked for;
   * nothing follows the visitor afterwards, so moving anywhere else empties it.
   */
  function setLocated(on: boolean): void {
    locatedAt = on ? lastOpened : null;
    els.locate.classList.toggle('located', on);
    const label = on ? 'Showing your location' : 'Use my location';
    els.locate.title = label;
    els.locate.setAttribute('aria-label', label);
  }

  // Place search
  const ac = new places.PlaceAutocompleteElement({});
  ac.setAttribute('placeholder', 'Search for a place');
  els.search.append(ac);
  ac.addEventListener('gmp-select', async (ev) => {
    const place = (ev as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
    await place.fetchFields({ fields: ['location', 'displayName'] });
    if (!place.location) return;
    setSheetOpen(false);
    await goToLatLng(place.location.toJSON(), 150);
  });

  map.addListener('click', (e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    ac.value = ''; // the previous search no longer describes where we are
    void goToLatLng(e.latLng.toJSON(), 60);
  });

  // Initial location from the URL
  if (hasLoc) {
    // Loading a panorama fires POV/zoom events that overwrite state, so keep
    // the linked view to re-apply afterwards.
    const { heading, pitch, zoom } = state;
    const ok = (state.pano && (await goTo({ pano: state.pano }))) || (await goToLatLng({ lat: state.lat!, lng: state.lng! }, 100));
    if (!ok) return;
    pano.setPov({ heading, pitch });
    pano.setZoom(zoom);
  } else {
    // No location in the link: start where the visitor is, like Stellarium Web.
    locate(false);
  }

  /**
   * Opens Street View at the browser's position. The browser asks for
   * permission; if it's refused or unavailable, the landing map just stays up
   * (with a message only when the visitor pressed the button).
   */
  function locate(askedByUser: boolean): void {
    if (!navigator.geolocation) {
      if (askedByUser) toast("This browser can't share your location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Don't yank the view away if a place was picked while waiting.
        if (!askedByUser && state.lat !== null) return;
        ac.value = '';
        setSheetOpen(false);
        // The visitor didn't choose this spot, so never land them in a user
        // photo sphere: Google's own imagery, or the map.
        void goToLatLng({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 150, true).then(setLocated);
      },
      (err) => {
        if (!askedByUser) return;
        toast(
          err.code === err.PERMISSION_DENIED
            ? "Location access is blocked. Allow it in the browser's site settings."
            : "Couldn't get your location. Search for a place instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }
  els.locate.addEventListener('click', () => locate(true));
  // The same, offered in the landing hint for anyone who dismissed the first prompt.
  document.getElementById('hint-locate')?.addEventListener('click', () => locate(true));
}

// ---------- controls ----------

function showChips(): void {
  renderChips(els.chips, state.bodies, (id, on) => {
    // A manual choice is kept from here on, and goes into the link.
    state.bodiesAuto = false;
    state.bodies = on
      ? BODIES.map((b) => b.id).filter((b) => b === id || state.bodies.includes(b))
      : state.bodies.filter((b) => b !== id);
    renderInfoPanel();
    requestRender();
    writeState(state);
  });
}
showChips();

els.twilight.value = String(state.twilight);
els.twilight.addEventListener('change', () => {
  state.twilight = Number(els.twilight.value) as Twilight;
  recompute();
  writeState(state);
});

// Grabbing or nudging the slider takes over from playback. (Playback moves
// the slider from code, which doesn't fire these events.)
function pauseForScrub(): void {
  if (els.play.getAttribute('aria-pressed') !== 'true') return;
  setPlaying(false);
  renderInfoPanel();
  writeState(state);
}

// Holding the slider against either end keeps time running in that direction,
// into the next (or previous) night and beyond, the way holding a drag at the
// edge of a list keeps it scrolling. The thumb follows the time, so it wraps
// to the other end and carries on. Pulling the pointer back into the track
// goes straight to that time on whichever night it has reached.
/** Sky time per unit of real time while held at an end (playback is 3600). */
const EDGE_SPEED = 6 * 3600;
/** How long the slider must sit at an end before time starts running. */
const EDGE_DWELL_MS = 350;
const edge = { dir: 0 as -1 | 0 | 1, timer: 0, frame: 0, last: 0, lastInfo: 0 };
let sliderHeld = false;

function edgeTick(now: number): void {
  const t = state.time.getTime() + edge.dir * (now - edge.last) * EDGE_SPEED;
  edge.last = now;
  state.time = new Date(t);
  const win = currentWindow();
  if (t < win.start.getTime() || t >= win.end.getTime()) {
    recompute(); // a new night
  } else {
    syncTimeControls();
    // As in playback: rebuilding the info panel every frame is wasteful.
    if (now - edge.lastInfo > 250) {
      renderInfoPanel();
      edge.lastInfo = now;
    }
    requestRender();
  }
  edge.frame = requestAnimationFrame(edgeTick);
}

function stopEdgeRun(): void {
  window.clearTimeout(edge.timer);
  cancelAnimationFrame(edge.frame);
  const ran = edge.frame !== 0;
  edge.dir = 0;
  edge.frame = 0;
  if (ran) {
    recompute();
    writeState(state);
  }
}

els.slider.addEventListener('pointerdown', () => {
  sliderHeld = true;
  pauseForScrub();
});
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, () => {
    sliderHeld = false;
    stopEdgeRun();
  }, true);
}

els.slider.addEventListener('input', () => {
  pauseForScrub();
  const win = currentWindow();
  const value = Number(els.slider.value);
  const dir = value >= Number(els.slider.max) ? 1 : value <= 0 ? -1 : 0;

  if (sliderHeld && dir !== 0) {
    // Still against the same end: the pointer reports the end again each time
    // it moves, while the thumb belongs wherever the running time has got to.
    if (edge.dir === dir) {
      syncTimeControls();
      return;
    }
    // Just arrived: the last time of this night, then run on after a moment.
    stopEdgeRun();
    setTime(new Date(dir > 0 ? win.end.getTime() - SLIDER_STEP_MS : win.start.getTime()));
    edge.dir = dir;
    edge.timer = window.setTimeout(() => {
      edge.last = edge.lastInfo = performance.now();
      edge.frame = requestAnimationFrame(edgeTick);
    }, EDGE_DWELL_MS);
    return;
  }

  stopEdgeRun();
  // The position along the axis, as a time on the 5-minute grid.
  const start = win.start.getTime();
  const t = sliderAxis().toTime(value / SLIDER_MAX);
  const last = win.end.getTime() - SLIDER_STEP_MS; // the window's end is the next night's start
  setTime(new Date(Math.min(start + Math.round((t - start) / SLIDER_STEP_MS) * SLIDER_STEP_MS, last)));
});
// The slider's positions aren't even steps of time, so arrow keys on it step
// the time itself: five minutes, or an hour with Page Up/Down. A step past
// the end is the start of the next night, and the slider jumps back to the left.
els.slider.addEventListener('keydown', (e) => {
  const steps: Record<string, number> = {
    ArrowRight: SLIDER_STEP_MS,
    ArrowUp: SLIDER_STEP_MS,
    ArrowLeft: -SLIDER_STEP_MS,
    ArrowDown: -SLIDER_STEP_MS,
    PageUp: 3600000,
    PageDown: -3600000,
  };
  const step = steps[e.key];
  if (!step || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  pauseForScrub();
  setTime(new Date(state.time.getTime() + step));
});
// "change" fires when a drag is released: leave the thumb where the time is.
els.slider.addEventListener('change', () => {
  stopEdgeRun();
  syncTimeControls();
});

els.date.addEventListener('change', () => {
  if (!els.date.value) return;
  const [year, month, day] = els.date.value.split('-').map(Number);
  // Typing a year fires a change per digit (0002, 0020, 0202, 2027): wait for all four.
  if (year < 1000) return;
  // Same offset into the night, on the chosen evening.
  const offset = state.time.getTime() - currentWindow().start.getTime();
  const start = zonedToDate({ year, month, day, hour: 12, minute: 0 }, tz);
  setTime(new Date(start.getTime() + offset));
});

// Show the applied date again once typing is done (it may have been left partial).
els.date.addEventListener('blur', syncTimeControls);

els.now.addEventListener('click', () => setTime(new Date()));

const shiftDay = (days: number) => setTime(shiftDays(state.time, days, tz));
els.prevDay.addEventListener('click', () => shiftDay(-1));
els.nextDay.addEventListener('click', () => shiftDay(1));

/** Elements where arrow keys already mean something (text, date, slider, select, search). */
function handlesArrows(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.matches('input, textarea, select, gmp-place-autocomplete');
}

// ←/→ shift a day, ↑/↓ an hour, like Stellarium; [ / ] step to an older or
// newer Street View capture. Registered in the capture
// phase so it runs before Street View and the map, which would otherwise pan
// on arrow keys once clicked into (Street View has no option to turn that off).
window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (handlesArrows(e.target) || els.infoDialog.open) return;
  const HOUR = 3600000;
  switch (e.key) {
    case 'ArrowLeft':
      shiftDay(-1);
      break;
    case 'ArrowRight':
      shiftDay(1);
      break;
    case 'ArrowUp':
      setTime(new Date(state.time.getTime() + HOUR));
      break;
    case 'ArrowDown':
      setTime(new Date(state.time.getTime() - HOUR));
      break;
    case '[':
      stepCapture(-1);
      break;
    case ']':
      stepCapture(1);
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}, true);

let playing = 0;
function setPlaying(on: boolean): void {
  els.play.setAttribute('aria-pressed', String(on));
  els.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
  cancelAnimationFrame(playing);
  playing = 0;
  if (!on) return;
  let last = performance.now();
  let lastInfo = 0;
  const tick = (now: number) => {
    // One hour of sky per second of playback.
    const dt = (now - last) * 3600;
    last = now;
    const win = currentWindow();
    let t = state.time.getTime() + dt;
    if (t > win.end.getTime() - 60000) t = win.start.getTime();
    state.time = new Date(t);
    syncTimeControls();
    // Rebuilding the cards every frame is wasteful and makes them unclickable.
    if (now - lastInfo > 250) {
      renderInfoPanel();
      lastInfo = now;
    }
    requestRender();
    playing = requestAnimationFrame(tick);
  };
  playing = requestAnimationFrame(tick);
}
els.play.addEventListener('click', () => {
  const on = els.play.getAttribute('aria-pressed') !== 'true';
  setPlaying(on);
  if (!on) {
    renderInfoPanel();
    writeState(state);
  }
});

els.share.addEventListener('click', async () => {
  flushState(state);
  // The system share sheet suits touch devices; on desktop, copying is more useful.
  if (navigator.share && matchMedia('(hover: none)').matches) {
    try {
      await navigator.share({ title: document.title, url: location.href });
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return; // dismissed
    }
  }
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied');
  } catch {
    toast('Copy failed. Copy the address bar instead.');
  }
});

els.infoBtn.addEventListener('click', () => els.infoDialog.showModal());
els.infoClose.addEventListener('click', () => els.infoDialog.close());
// Clicks on the backdrop land on the dialog element itself.
els.infoDialog.addEventListener('click', (e) => {
  if (e.target === els.infoDialog) els.infoDialog.close();
});

// Track the collapsed sheet height for the mobile layout.
new ResizeObserver(() => {
  if (!els.panel.classList.contains('open') && getComputedStyle(els.panel).position === 'fixed') {
    document.documentElement.style.setProperty('--sheet-h', `${els.panel.offsetHeight}px`);
  }
}).observe(els.panel);

function setSheetOpen(open: boolean): void {
  els.panel.classList.toggle('open', open);
  els.handle.setAttribute('aria-expanded', String(open));
  els.handle.setAttribute('aria-label', open ? 'Collapse panel' : 'Expand panel');
}
els.handle.addEventListener('click', () => setSheetOpen(!els.panel.classList.contains('open')));

// On phones the search sits low in the sheet and Google's suggestion list
// opens downward, off-screen. Expand the sheet and lift the search to its top.
els.search.addEventListener('focusin', () => {
  if (getComputedStyle(els.panel).position !== 'fixed') return;
  setSheetOpen(true);
  requestAnimationFrame(() => {
    els.panel.scrollTop += els.search.getBoundingClientRect().top - els.panel.getBoundingClientRect().top - 8;
  });
});

function setMapHidden(hidden: boolean): void {
  document.body.classList.toggle('map-hidden', hidden);
  els.mapToggle.setAttribute('aria-expanded', String(!hidden));
  els.mapToggle.setAttribute('aria-label', hidden ? 'Show map' : 'Hide map');
}
els.mapToggle.addEventListener('click', () => {
  const hidden = !document.body.classList.contains('map-hidden');
  setMapHidden(hidden);
  // Reopened on purpose: it tucks away again only after a fresh look around.
  if (!hidden) resetLookingAround();
});

// The map is for choosing a spot. Once the visitor has dragged the view
// around a little, they're looking at the sky, so tuck it away: after either
// a moment of dragging (a slow, careful pan) or a fair turn (a quick flick).
// Only real drags count: the view also turns on its own (clicking an object,
// opening a link), which fires the same POV events.
const LOOKING_AROUND_MS = 400;
const LOOKING_AROUND_DEG = 25;
/** POV changes this close together belong to one continuous movement. */
const SAME_MOVE_MS = 300;
const lookingAround = { dragging: false, ms: 0, deg: 0, last: 0, heading: 0, pitch: 0 };
els.pano.addEventListener('pointerdown', () => ((lookingAround.dragging = true), (lookingAround.last = 0)), true);
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, () => (lookingAround.dragging = false), true);
}

/** Called on every POV change; collapses the map after enough dragging. */
function noteViewTurned(): void {
  const s = lookingAround;
  const now = performance.now();
  // Part of a drag: the pointer is down, or the view is still gliding after
  // a drag that just ended.
  const moving = s.last > 0 && now - s.last < SAME_MOVE_MS;
  if (!s.dragging && !moving) return;
  if (moving) {
    s.ms += now - s.last;
    const turn = Math.abs(((state.heading - s.heading + 540) % 360) - 180);
    s.deg += Math.hypot(turn * Math.cos((state.pitch * Math.PI) / 180), state.pitch - s.pitch);
  }
  s.last = now;
  s.heading = state.heading;
  s.pitch = state.pitch;
  if (s.ms >= LOOKING_AROUND_MS || s.deg >= LOOKING_AROUND_DEG) setMapHidden(true);
}

/** A new place, or the map reopened: start counting afresh. */
function resetLookingAround(): void {
  lookingAround.ms = 0;
  lookingAround.deg = 0;
  lookingAround.last = 0;
}

// Desktop: the panel tucks away to give Street View the whole window. The
// choice is remembered in this browser (not in the link: it's about the
// visitor's screen, not the view being shared).
const PANEL_KEY = 'horizon.panelCollapsed';
function setPanelCollapsed(collapsed: boolean): void {
  document.body.classList.toggle('panel-collapsed', collapsed);
  const label = collapsed ? 'Show panel' : 'Hide panel';
  els.panelToggle.setAttribute('aria-expanded', String(!collapsed));
  els.panelToggle.setAttribute('aria-label', label);
  els.panelToggle.title = label;
  try {
    localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage unavailable (private mode): the choice just isn't remembered.
  }
}
els.panelToggle.addEventListener('click', () =>
  setPanelCollapsed(!document.body.classList.contains('panel-collapsed')),
);
try {
  if (localStorage.getItem(PANEL_KEY) === '1') setPanelCollapsed(true);
} catch {
  // As above.
}

// ---------- start ----------

// The URL time is absolute, so don't shift it to keep the browser's wall time.
if (state.lat !== null && state.lng !== null) setLatLng(state.lat, state.lng, false);
recompute();

const key = import.meta.env.GOOGLE_MAPS_API_KEY;
if (!key && !import.meta.env.DEV) {
  $<HTMLDivElement>('landing-hint').innerHTML =
    '<strong>Not configured.</strong> This build has no Google Maps API key.';
} else {
  // Without a key, dev builds fall back to Google's keyless development mode:
  // watermarked, and search won't work, but enough to test the overlay.
  if (!key) toast('No API key: running in Google development mode. See .env.example.', 8000);
  // Google calls this global when it rejects the key (bad referrer, API not
  // enabled, billing off); the console has the specific error code.
  Object.assign(window, {
    gm_authFailure: () =>
      toast(`Google rejected the Maps API key for ${location.origin}. Check its restrictions; the console has details.`, 15000),
  });
  initMaps(key).catch((err) => {
    console.error(err);
    toast('Google Maps failed to load. Check the API key and its restrictions.', 10000);
  });
}
