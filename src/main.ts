import './style.css';
// First, before Street View exists: see the file.
import { setSkyEnabled, skyEnabled, skyOffered } from './sky/preserve';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import tzlookup from 'tz-lookup';
import { BODIES, computeNight, interpolate, observableTonight, type BodyId, type NightData } from './astro';
import { axisFor, nightAxis, type TimeAxis } from './axis';
import { declination, lookDirection, northOffset, steadyForNorth, turnToward } from './compass';
import { formatCapture, isWinter, parseCaptures, parseImageDate, type Capture } from './imagery';
import { Overlay } from './overlay';
import { midnightMark, renderHourLabels, renderInfo, renderSunTimes, setTimelineNow, skyColorAt, skyState, sliderGradient, sliderTicks } from './panel';
import { streetViewHfov, type Camera } from './projection';
import { openSky, openSkyKey, type OpenSky } from './roofline';
import type { SkyMap } from './sky';
import type { ChartFrame, SkyChart } from './skychart';
import { duskShare } from './skycolor';
import type { Catalogue } from './stars';
import { flushState, readState, shownBodies, writeState, type Twilight } from './state';
import { formatReadoutDate, formatTime, isoDate, nightWindow, shiftDays, tzAbbrev, wallTime, zonedToDate } from './time';

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
  compass: $<HTMLButtonElement>('compass-btn'),
  date: $<HTMLInputElement>('date'),
  prevDay: $<HTMLButtonElement>('prev-day'),
  nextDay: $<HTMLButtonElement>('next-day'),
  now: $<HTMLButtonElement>('now'),
  play: $<HTMLButtonElement>('play'),
  slider: $<HTMLInputElement>('slider'),
  sliderTrack: $<HTMLDivElement>('slider-track'),
  sliderScale: $<HTMLDivElement>('slider-scale'),
  sunTimes: $<HTMLDivElement>('sun-times'),
  timeLabel: $<HTMLSpanElement>('time-label'),
  timeButton: $<HTMLButtonElement>('time-button'),
  skyState: $<HTMLSpanElement>('sky-state'),
  twilight: $<HTMLSelectElement>('twilight'),
  nakedEye: $<HTMLInputElement>('naked-eye'),
  skyChart: $<HTMLInputElement>('sky-chart'),
  skyGlow: $<HTMLInputElement>('sky-glow'),
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
/** The objects visible on that night (the chart's upper group), and those of them shown unless the visitor says otherwise. */
let visibleTonight: BodyId[] = [];
let onByDefault: BodyId[] = [];
/** The night the slider's track and its sunset and sunrise labels were last drawn for. */
let nightDrawn: NightData | null = null;
let nightKey = '';
let pano: google.maps.StreetViewPanorama | null = null;
/** Steps to an older (-1) or newer (+1) capture; set once Street View is up. */
let stepCapture: (dir: -1 | 1) => void = () => {};
/** Goes straight to a panorama by its ID, as a newly chosen place (for the sky map's development panel); false if it can't be opened. Set once Street View is up. */
let showPano: (id: string) => Promise<boolean> = async () => false;

// (A press on an object's name over the view turns to it; one on one of its times goes to that time, on that object.)
const overlay = new Overlay(els.overlay, lookAtBody, (t, id) => jumpTo(new Date(t), id));

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
    nightKey = '';
  } else {
    const win = nightWindow(state.time, tz);
    // ~100 m grid: walking between panoramas doesn't change anything visible.
    const key = `${state.lat.toFixed(3)},${state.lng.toFixed(3)},${win.start.getTime()},${state.twilight}`;
    if (key !== nightKey) {
      night = computeNight(state.lat, state.lng, win, BODIES.map((b) => b.id), state.twilight);
      nightKey = key;
    }
  }
  // What the slider shows of the night itself changes only with the night:
  // its sky shading and hour marks, and the sunset and sunrise above it.
  if (night !== nightDrawn) {
    nightDrawn = night;
    renderSunTimes(els.sunTimes, night, tz, jumpTo);
    renderHourLabels(els.sliderScale, night, tz);
    els.sliderTrack.style.background = night
      ? [midnightMark(night, tz), sliderTicks(night), sliderGradient(night)].filter(Boolean).join(', ')
      : '';
  }
  // Show what's visible on this night, except where the visitor chose otherwise.
  // Uranus and Neptune count as visible too, and are listed with the rest,
  // but are only switched on by default if the naked-eye setting is off.
  // The Sun heads that group too, like the Moon whatever the night: it's the
  // reference the rest are read against, though it's off unless switched on.
  visibleTonight = night ? ['Sun', ...observableTonight(night, false)] : [];
  onByDefault = night ? observableTonight(night, state.nakedEyeOnly) : [];
  state.bodies = shownBodies(onByDefault, state.overrides);
  syncTimeControls();
  refreshOpenSky(false);
  renderInfoPanel();
  requestRender();
}

/**
 * The object the view is locked onto: the one last turned to (its name
 * pressed, or its plot dragged). The view then follows it as the time
 * changes, until the visitor drags the view away themselves.
 */
let following: BodyId | null = null;

/**
 * Turns the view to the followed object, keeping it in view as the time
 * changes. It always faces the object's direction. It tilts up with the
 * object only so far as keeps the horizon in view, near the bottom: beyond
 * that the tilt holds and the object climbs up the view instead, until it
 * nears the top, when the tilt has to follow again. Below the horizon the
 * view stays level, already looking at where the object will come up.
 */
function follow(): void {
  const to = followTarget();
  // (While the app is turning to the object, that turn's own frames head for it: see turnToFollowed. And while it's
  // running to a moment of the object's, that run turns the view: see jumpTo.)
  if (!pano || !to || turn || glide?.view) return;
  pano.setPov(to);
}

/** Where the view faces while it follows its object (see `follow`), at the chosen time or at another (ms) of the same night; null if it's following nothing. */
function followTarget(at = state.time.getTime()): { heading: number; pitch: number } | null {
  const pos = following && night && interpolate(night.bodies.get(following)?.samples ?? [], at);
  const cam = camera();
  if (!pos || !cam) return null;
  const vfov = (2 * Math.atan(Math.tan((cam.hfov * Math.PI) / 360) * (cam.height / cam.width)) * 180) / Math.PI;
  const horizonInView = vfov * (0.5 - FOLLOW_HORIZON_MARGIN);
  const objectInView = pos.alt - vfov * (0.5 - FOLLOW_TOP_MARGIN);
  const framed = Math.max(Math.min(pos.alt, horizonInView), objectInView, 0);
  // Zoomed well in, there's no keeping the horizon in view with the object: holding to it would put the object up at
  // the view's top edge, and turn away from an object that was in the middle. So a close view centres on the object
  // itself; between a view FOLLOW_CENTRE_FROM degrees tall and one FOLLOW_CENTRE_BY, part-way.
  const close = Math.max(0, Math.min(1, (FOLLOW_CENTRE_FROM - vfov) / (FOLLOW_CENTRE_FROM - FOLLOW_CENTRE_BY)));
  const centred = Math.max(pos.alt, 0);
  const pitch = framed + (centred - framed) * close * close * (3 - 2 * close);
  return { heading: pos.az, pitch: Math.min(89, pitch) };
}

/**
 * A turn the app is making to the followed object: where the view was when
 * it began, when that was, and how long it takes.
 *
 * The app makes the turn itself, a step every animation frame. (Asked for
 * the new direction in one call, Street View turns there over most of a
 * second while reporting from the start that it's there already: anything
 * drawn over the view meanwhile is drawn where the picture isn't yet, and
 * the sky map's looks are of a picture still on its way.) Stepped, the
 * direction the viewer reports is where the picture is, so the paths and
 * the chart stay on throughout.
 *
 * It eases out of the start and into the end. A drag takes over at once
 * (taking hold of the view lets go of the object); a second press turns
 * from wherever this one has got to; and as the time plays the turn heads
 * for wherever the object is by then.
 */
let turn: { heading: number; pitch: number; start: number; ms: number } | null = null;
let turnFrame = 0;
/** A turn takes this long for a small one, up to this long for half-way round. */
const TURN_MIN_MS = 250;
const TURN_MAX_MS = 700;

function turnToFollowed(): void {
  const to = followTarget();
  if (!pano || !to) return;
  const pov = pano.getPov();
  const across = ((to.heading - pov.heading + 540) % 360) - 180;
  const apart = Math.hypot(across * Math.cos((pov.pitch * Math.PI) / 180), to.pitch - pov.pitch);
  // (Next to no way to go, or a visitor who has asked for less motion: just go there.)
  if (apart < 0.5 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    turn = null;
    pano.setPov(to);
    return;
  }
  turn = { heading: pov.heading, pitch: pov.pitch, start: performance.now(), ms: turnMs(apart) };
  if (!turnFrame) turnFrame = requestAnimationFrame(stepTurn);
}

/** How long the app takes over a turn of so many degrees. */
function turnMs(degrees: number): number {
  return TURN_MIN_MS + (TURN_MAX_MS - TURN_MIN_MS) * Math.min(1, degrees / 180);
}

function stepTurn(now: number): void {
  turnFrame = 0;
  const to = followTarget();
  if (!turn || !pano || !to) {
    turn = null;
    return;
  }
  const t = Math.max(0, Math.min(1, (now - turn.start) / turn.ms));
  const eased = easeInOut(t);
  const across = ((to.heading - turn.heading + 540) % 360) - 180;
  pano.setPov({ heading: turn.heading + across * eased, pitch: turn.pitch + (to.pitch - turn.pitch) * eased });
  if (t >= 1) turn = null;
  else turnFrame = requestAnimationFrame(stepTurn);
}
/** While following: how far above the view's bottom edge the horizon is kept, and how far below its top the object, as fractions of the view's height. */
const FOLLOW_HORIZON_MARGIN = 0.15;
const FOLLOW_TOP_MARGIN = 0.12;
/** A view this many degrees tall or more is framed by the horizon; one this many or fewer is centred on the object (see followTarget). */
const FOLLOW_CENTRE_FROM = 55;
const FOLLOW_CENTRE_BY = 35;

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
  // The field shows the calendar date of the chosen time (matching the
  // readout), so it moves on at midnight, part-way along the slider.
  // Writing the value while someone types in the field resets the browser's
  // typing state, so a year could only be changed one digit at a time.
  if (document.activeElement !== els.date) els.date.value = isoDate(state.time, tz);
  const along = sliderAxis().toFraction(state.time.getTime());
  els.slider.value = String(Math.round(along * SLIDER_MAX));
  const date = formatReadoutDate(state.time, tz);
  const zone = tzAbbrev(state.time, tz);
  const label = `${date}, ${formatTime(state.time, tz)} ${zone}`;
  els.timeLabel.textContent = label;
  // The readout's width changes with its date and zone, not its clock digits
  // (they're even-width), so it only needs refitting when those change.
  if (`${date}|${zone}` !== fittedFor) {
    fittedFor = `${date}|${zone}`;
    fitTimeLabel();
  }
  els.slider.setAttribute('aria-valuetext', label);
  els.skyState.textContent = night ? skyState(night, state.time.getTime()) : '';
  // The thumb is filled with the sky's colour at the chosen time.
  els.slider.style.setProperty('--sky', night ? skyColorAt(night, state.time.getTime()) : '');
  if (night) setTimelineNow(els.info, night, state.time.getTime());
  // The tip above the thumb: centred on it, but kept inside the panel's
  // right-hand edge near the end. It only shows while the slider is being
  // moved, so only then is it worth measuring (this runs every frame of playback).
  if (sliderHeld || document.activeElement === els.slider) {
    const room = sliderWrap.clientWidth + TIP_OVERHANG - els.skyState.offsetWidth / 2;
    els.skyState.style.left = `${Math.min(along * sliderWrap.clientWidth, room).toFixed(1)}px`;
  }
}
/** The date and zone the readout was last fitted for. */
let fittedFor = '';
/**
 * Keeps the readout on one line at the largest size that fits. The
 * stylesheet sizes it for a typical readout; one that comes out wider than
 * its space (a longer month or zone name, or the form with the year) is
 * scaled down to fit, rather than cut off.
 */
function fitTimeLabel(): void {
  const label = els.timeLabel;
  label.style.fontSize = '';
  // (Widths are reported in whole pixels, so one pass can land a pixel over.)
  for (let pass = 0; pass < 3 && label.scrollWidth > label.clientWidth; pass++) {
    const size = parseFloat(getComputedStyle(label).fontSize);
    label.style.fontSize = `${size * (label.clientWidth / label.scrollWidth) * 0.99}px`;
  }
}
// Its space changes with the panel's width (a phone turned, the window resized).
new ResizeObserver(fitTimeLabel).observe(els.timeButton.parentElement!);

const sliderWrap = els.slider.parentElement!;
/** True from a press on the slider until the pointer is let go. */
let sliderHeld = false;
/** How far the tip may reach past the slider's right-hand end (into the panel's padding). */
const TIP_OVERHANG = 12;

function renderInfoPanel(): void {
  renderInfo(els.info, night, { shown: state.bodies, visible: visibleTonight }, state.time.getTime(), tz, {
    onToggle: toggleBody,
    // Pressing a name turns to the object, switching it on first if need be.
    onLook: (id) => {
      if (!state.bodies.includes(id)) toggleBody(id);
      lookAtBody(id);
    },
    onDetails: renderInfoPanel,
    // Dragging along an object's own plot locks the view onto that object.
    onScrub: (fraction, id) => {
      pauseForScrub();
      setCompass(false);
      following = id;
      dragTo(fraction);
    },
    onScrubEnd: stopEdgeRun,
    onJump: jumpTo,
  }, openTimes);
}

/**
 * When tonight each object is in open sky from here, by the sky map
 * (roofline.ts): null where the sky map isn't on. Worked out again when the
 * night changes, and a little after the sky map does (it changes at every
 * look, and the chart's rows are rebuilt only if what it says of the
 * objects has changed).
 */
let openTimes: Map<BodyId, OpenSky> | null = null;
let openKey = '';
let openTimer = 0;
/** How long after the sky map changes the objects' times are worked out again. */
const OPEN_SKY_SETTLE_MS = 700;

function refreshOpenSky(redraw: boolean): void {
  const sky = skyMap;
  const data = night;
  openTimes = sky && data ? new Map([...data.bodies].map(([id, summary]) => [id, openSky(summary, data.sun, data.twilight, sky)])) : null;
  const key = openSkyKey(openTimes);
  if (key === openKey) return;
  openKey = key;
  if (redraw) renderInfoPanel();
}

function skyMapChanged(): void {
  requestRender();
  if (!openTimer) {
    openTimer = window.setTimeout(() => {
      openTimer = 0;
      refreshOpenSky(true);
    }, OPEN_SKY_SETTLE_MS);
  }
}

// The chart lays its labels out by its width, so it's redrawn when that
// changes: the window resized, a phone turned, the panel reopened. (A change
// of height alone, such as a row opening, leaves it as it is.)
new ResizeObserver(renderInfoPanel).observe(els.info);

/**
 * Switches an object on or off. A choice that differs from what the night
 * would show anyway is kept as the visitor's own (and goes in the link);
 * switching back to what the night shows hands the object back to it.
 */
function toggleBody(id: BodyId): void {
  const on = !state.bodies.includes(id);
  if (on === onByDefault.includes(id)) delete state.overrides[id];
  else state.overrides[id] = on;
  state.bodies = shownBodies(onByDefault, state.overrides);
  if (!on && following === id) following = null;
  renderInfoPanel();
  requestRender();
  writeState(state);
}

/**
 * Goes to a moment: a sunset, a rise, a transit, a time at the skyline
 * (pressed on the slider or the chart), or now; `id` is the object whose
 * moment it is, if it's one's. If it's within a day or so,
 * the time runs there quickly, so the sky is seen to turn to it and not to
 * blink from one place to another; further off, or for a visitor who has
 * asked for less motion, it goes straight there.
 */
function jumpTo(t: Date, id?: BodyId): void {
  pauseForScrub();
  // A moment of an object's own (its rise, its transit, a time at the skyline): the view goes to the object and stays on
  // it, as when its name is pressed or its plot dragged.
  if (id) {
    setCompass(false);
    following = id;
  }
  const from = state.time.getTime();
  const to = t.getTime();
  const apart = Math.abs(to - from);
  const win = currentWindow();
  const sameNight = to >= win.start.getTime() && to < win.end.getTime();
  // Where the view will face once it's there: on the object as it is at that moment. (Known only within the night
  // that's worked out.)
  const facing = id && sameNight ? followTarget(to) : null;
  if (apart < 60000 || apart > GLIDE_WITHIN_MS || (id && !facing) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Straight to the time; and to the object by the app's ordinary turn, which has only the one thing to do then.
    if (id) turnToFollowed();
    setTime(t);
    return;
  }
  // One motion for the two: the time runs and the view turns by the same clock, each a share of its own way, and they
  // arrive together. The view goes straight from where it is to where the object will be; it doesn't chase the object
  // across the sky as the time runs (that, and a turn with a clock of its own, pulled against each other).
  let ms = GLIDE_MIN_MS + (GLIDE_MAX_MS - GLIDE_MIN_MS) * Math.min(1, apart / (12 * 3600000));
  let view: NonNullable<typeof glide>['view'] = null;
  if (facing && id && pano) {
    const pov = pano.getPov();
    const across = ((facing.heading - pov.heading + 540) % 360) - 180;
    const turned = Math.hypot(across * Math.cos((pov.pitch * Math.PI) / 180), facing.pitch - pov.pitch);
    ms = Math.max(ms, turnMs(turned));
    view = { id, heading: pov.heading, pitch: pov.pitch, across, up: facing.pitch - pov.pitch };
    // (Any turn of the app's own that was under way is this one's now.)
    turn = null;
  }
  // (Pressed again part-way: it heads for the new moment from wherever it has got to.)
  glide = { from, to, start: performance.now(), ms, view };
  if (!glideFrame) glideFrame = requestAnimationFrame(stepGlide);
}

/**
 * A run to a moment that was pressed (see jumpTo): the time, from when to
 * when, and how long it takes; and with it, for a moment of an object's own,
 * the view: where it started, and how far round and up it has to go to face
 * the object as it will be then.
 */
let glide: { from: number; to: number; start: number; ms: number; view: { id: BodyId; heading: number; pitch: number; across: number; up: number } | null } | null = null;
let glideFrame = 0;
/** A moment further off than this is gone to at once. */
const GLIDE_WITHIN_MS = 36 * 3600000;
/** The run takes this long for a moment close by, up to this long for one half a day off or more. */
const GLIDE_MIN_MS = 250;
const GLIDE_MAX_MS = 600;

function stepGlide(now: number): void {
  glideFrame = 0;
  if (!glide) return;
  const k = Math.max(0, Math.min(1, (now - glide.start) / glide.ms));
  if (k >= 1) {
    const to = glide.to;
    glide = null;
    setTime(new Date(to));
    return;
  }
  // (Eased like the view's own turns, and each frame of it is a frame of the time running, as in playback.)
  const eased = easeInOut(k);
  // (Taking hold of the view, or following something else, lets go of the turn; the time runs on.)
  if (glide.view && following !== glide.view.id) glide.view = null;
  tickTime(glide.from + (glide.to - glide.from) * eased, now);
  if (glide?.view && pano) pano.setPov({ heading: glide.view.heading + glide.view.across * eased, pitch: glide.view.pitch + glide.view.up * eased });
  glideFrame = requestAnimationFrame(stepGlide);
}

/** Out of the start and into the end, for a share 0 to 1 of the way: what the app's own motions are eased by. */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * One frame of the time being run, to `t` (ms): by playback, by the slider
 * held against an end, or by a run to a pressed moment. The slider, the
 * chart's time line, the sky and the view (if it's following an object) go
 * with it; the chart's rows are brought up to date only a few times a
 * second (every frame is wasteful); and a night run into is worked out.
 */
function tickTime(t: number, now: number): void {
  state.time = new Date(t);
  const win = currentWindow();
  if (t < win.start.getTime() || t >= win.end.getTime()) {
    recompute(); // a new night
  } else {
    syncTimeControls();
    if (now - tickInfoAt > 250) {
      renderInfoPanel();
      tickInfoAt = now;
    }
    requestRender();
  }
  follow();
}
let tickInfoAt = 0;

function setTime(t: Date): void {
  // (Any other change of the time takes over from a run that's under way.)
  if (glide) {
    glide = null;
    cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  }
  state.time = t;
  recompute();
  follow();
  writeState(state);
}

// ---------- rendering ----------

let frame = 0;
function requestRender(): void {
  if (frame) return;
  frame = requestAnimationFrame((now) => {
    frame = 0;
    render(now);
  });
}

// The chart of the sky drawn over the view, and what it's drawn from: all of
// it is fetched only where the chart is switched on (see the end of this file).
/** The sky map: where the sky is in the panorama on screen (sky/index.ts). */
let skyMap: SkyMap | null = null;
/** The chart's layer (skychart.ts), and how it looks. */
let chart: SkyChart | null = null;
/** The stars (stars.ts): the code that places them, and the catalogue itself. */
let stars: typeof import('./stars') | null = null;
let catalogue: Catalogue | null = null;
let chartLook: typeof import('./skychart').CHART_LOOK | null = null;/** The last frame the chart was drawn for (for checking it by script). */
let chartFrame: ChartFrame | null = null;
/** Where the stars are, as last worked out: for which time and place. */
let starsAt: { key: string; rotation: Float32Array } | null = null;

/** The rotation from among the stars to the sky, for the chosen time at the place shown (stars.ts). */
function starsRotation(): Float32Array | null {
  if (!stars || !catalogue || state.lat === null || state.lng === null) return null;
  const key = `${state.time.getTime()},${state.lat},${state.lng}`;
  if (starsAt?.key !== key) starsAt = { key, rotation: stars.skyRotation(state.time, state.lat, state.lng) };
  return starsAt.rotation;
}

/**
 * How bright the sky is at the place shown, from artificial light
 * (skyglow.ts): it sets how faint a star shows there, unless the visitor has
 * switched that off in the settings (kept in this browser).
 */
let skyGlow: typeof import('./skyglow') | null = null;
let skyGlowMap: import('./skyglow').SkyGlow | null = null;
const SKY_GLOW_KEY = 'horizon.skyglow';
let skyGlowOn = true;
try {
  skyGlowOn = localStorage.getItem(SKY_GLOW_KEY) !== '0';
} catch {
  // Storage unavailable: it's on.
}
let siteAt: { key: string; faintest: number } | null = null;

/** The faintest star seen by eye from the place shown, as a magnitude; the catalogue's faintest where that isn't known, or isn't wanted. */
function siteFaintest(): number {
  if (!skyGlow) return 6.5;
  if (!skyGlowOn || !skyGlowMap || state.lat === null || state.lng === null) return skyGlow.DARK_SKY;
  // (The picture it's read from is a tenth of a degree to the cell.)
  const key = `${state.lat.toFixed(2)},${state.lng.toFixed(2)}`;
  if (siteAt?.key !== key) siteAt = { key, faintest: skyGlow.faintestFrom(skyGlowMap, state.lat, state.lng) };
  return siteAt.faintest;
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

function render(now = performance.now()): void {
  const cam = camera();
  els.overlay.hidden = !cam;
  if (!cam) return;
  const time = state.time.getTime();
  let names = null;
  if (chart && chartLook) {
    // The chart goes by how far down the Sun is at the chosen time: its colour, how solid it is, and how faint a star shows.
    const sun = night && interpolate(night.sun, time);
    const sunAlt = sun ? sun.alt : 90;
    const rotation = starsRotation();
    chartFrame = {
      cam,
      now,
      sunAlt,
      sunAz: sun ? sun.az : 0,
      faintestDark: stars ? stars.faintestByDark(sunAlt) : -9,
      faintestMost: stars ? stars.faintestInView(cam.hfov, siteFaintest()) : -9,
      rotation,
    };
    // (It asks for another frame while anything of it is still easing, and otherwise the page is idle.)
    if (chart.draw(chartFrame)) requestRender();
    // (The names come in with the open sky's backdrop.)
    const skyIn = duskShare(sunAlt, chartLook.duskSky);
    if (stars && catalogue && rotation && skyIn > 0 && !chartLook.off && !chartLook.flat) {
      names = { labels: stars.labelsInView(catalogue, rotation, cam), faintest: stars.faintestShown(sunAlt, cam.hfov, siteFaintest()), night: skyIn, strength: chart.starStrengths, lookedBelow: chart.lookingBelow };
    }
  }
  overlay.render({ cam, data: night, time, bodies: state.bodies, tz, sky: skyMap, names });
}

function lookAtBody(id: BodyId): void {
  const pos = night && interpolate(night.bodies.get(id)?.samples ?? [], state.time.getTime());
  if (!pano || !pos) return;
  setSheetOpen(false);
  // Turn to it, framed as it will be while followed, and stay locked onto it.
  setCompass(false);
  following = id;
  turnToFollowed();
}

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
    // Street View's own tilt control ignores the compass (it starts from
    // wherever the view was facing); compass mode, below, takes its place.
    motionTracking: false,
    motionTrackingControl: false,
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
    // The name isn't used, but asking for it is what makes the search cheaper:
    // Google then bills the lookup alone (2.5c), where a location-only lookup
    // is billed per keystroke as well (up to 12 x 0.28c, plus 0.5c).
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

  showPano = async (id) => {
    const ok = await goTo({ pano: id });
    if (ok) {
      ac.value = '';
      resetLookingAround();
      setLocated(false);
    }
    return ok;
  };

  els.locate.addEventListener('click', () => locate(true));
  // The same, offered in the landing hint for anyone who dismissed the first prompt.
  document.getElementById('hint-locate')?.addEventListener('click', () => locate(true));

  // Initial location from the URL
  if (hasLoc) {
    // Loading a panorama fires POV/zoom events that overwrite state, so keep
    // the linked view to re-apply afterwards.
    const { heading, pitch, zoom } = state;
    const ok = (state.pano && (await goTo({ pano: state.pano }))) || (await goToLatLng({ lat: state.lat!, lng: state.lng! }, 100));
    if (ok) {
      pano.setPov({ heading, pitch });
      pano.setZoom(zoom);
    }
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
}

// ---------- controls ----------

els.nakedEye.checked = state.nakedEyeOnly;
els.nakedEye.addEventListener('change', () => {
  state.nakedEyeOnly = els.nakedEye.checked;
  recompute();
  writeState(state);
});

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
const edge = { dir: 0 as -1 | 0 | 1, timer: 0, frame: 0, last: 0 };

function edgeTick(now: number): void {
  const t = state.time.getTime() + edge.dir * (now - edge.last) * EDGE_SPEED;
  edge.last = now;
  tickTime(t, now);
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

/** Marks the slider as held, which also shows the tip above its thumb. */
function setSliderHeld(held: boolean): void {
  sliderHeld = held;
  sliderWrap.classList.toggle('held', held);
  if (held) syncTimeControls(); // puts the tip over the thumb
}
// The tip shows for keyboard focus too.
els.slider.addEventListener('focus', syncTimeControls);
els.slider.addEventListener('pointerdown', () => {
  setSliderHeld(true);
  pauseForScrub();
});
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, () => {
    setSliderHeld(false);
    stopEdgeRun();
  }, true);
}

els.slider.addEventListener('input', () => {
  pauseForScrub();
  const fraction = Number(els.slider.value) / SLIDER_MAX;
  if (sliderHeld) {
    dragTo(fraction);
  } else {
    // From the keyboard (Home, End): just go there.
    stopEdgeRun();
    scrubTo(fraction);
  }
});

/**
 * Follows a drag to a position along the axis: the slider's thumb, or a
 * pointer on an open plot (which can be past either end, below 0 or above 1).
 * Inside the axis that's simply the time there. At or past an end, the time
 * goes to that end of the night and, held there, starts running on.
 */
function dragTo(fraction: number): void {
  const dir = fraction >= 1 ? 1 : fraction <= 0 ? -1 : 0;
  if (dir === 0) {
    stopEdgeRun();
    scrubTo(fraction);
    return;
  }
  // Still against the same end: the pointer reports the end again each time
  // it moves, while the thumb belongs wherever the running time has got to.
  if (edge.dir === dir) {
    syncTimeControls();
    return;
  }
  // Just arrived: the last time of this night, then run on after a moment.
  stopEdgeRun();
  const win = currentWindow();
  setTime(new Date(dir > 0 ? win.end.getTime() - SLIDER_STEP_MS : win.start.getTime()));
  edge.dir = dir;
  edge.timer = window.setTimeout(() => {
    edge.last = performance.now();
    edge.frame = requestAnimationFrame(edgeTick);
  }, EDGE_DWELL_MS);
}

/**
 * Sets the time to a position (0–1) along the slider's axis, on the
 * 5-minute grid: for the slider, and for dragging along an open plot.
 */
function scrubTo(fraction: number): void {
  const win = currentWindow();
  const start = win.start.getTime();
  const t = sliderAxis().toTime(fraction);
  const last = win.end.getTime() - SLIDER_STEP_MS; // the window's end is the next night's start
  setTime(new Date(Math.min(start + Math.round((t - start) / SLIDER_STEP_MS) * SLIDER_STEP_MS, last)));
}
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
  // The same clock time, on the chosen date.
  const { hour, minute } = wallTime(state.time, tz);
  setTime(zonedToDate({ year, month, day, hour, minute }, tz));
});

// Show the applied date again once typing is done (it may have been left partial).
els.date.addEventListener('blur', syncTimeControls);

// The date and time readout doubles as the date picker. A press opens the
// calendar of the date field hidden beneath it; a double-click swaps the
// readout for the field itself, to type a date into.
const timeReadout = els.timeButton.parentElement!;
function editDate(editing: boolean): void {
  timeReadout.classList.toggle('editing', editing);
  if (editing) els.date.focus();
}
/**
 * Whether the calendar is (as far as can be told) showing. The browser
 * closes it on any press outside it, including one on the readout, and
 * doesn't say so: so a press on the readout while this is set means "close",
 * and mustn't open it again.
 */
let calendarOpen = false;
let calendarOpenedAt = 0;
function openCalendar(): void {
  try {
    els.date.showPicker();
    calendarOpen = true;
    calendarOpenedAt = performance.now();
  } catch {
    // No showPicker (older browsers): typing is the next best thing.
    editDate(true);
  }
}
// A press opens the calendar at once, with no wait to see whether a second
// press is coming. A press while it's open closes it (the browser does that
// for any press outside the calendar). If that second press comes straight
// after the first, it's a double-click: the field then takes over, a moment
// later, once the calendar has gone.
const DOUBLE_CLICK_MS = 200;
const CALENDAR_CLOSE_MS = 60;
els.timeButton.addEventListener('click', () => {
  if (!calendarOpen) {
    openCalendar();
    return;
  }
  calendarOpen = false;
  if (performance.now() - calendarOpenedAt < DOUBLE_CLICK_MS) {
    window.setTimeout(() => editDate(true), CALENDAR_CLOSE_MS);
  }
});
// The other ways the calendar closes: a date is picked, something else is
// pressed, or Escape.
els.date.addEventListener('change', () => (calendarOpen = false));
window.addEventListener('pointerdown', (e) => {
  if (!els.timeButton.contains(e.target as Node)) calendarOpen = false;
}, true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') calendarOpen = false;
}, true);
// Typing ends when the field is left, or on Enter or Escape.
els.date.addEventListener('blur', () => editDate(false));
els.date.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') els.date.blur();
});

els.now.addEventListener('click', () => jumpTo(new Date()));

const shiftDay = (days: number) => setTime(shiftDays(state.time, days, tz));

/**
 * Runs `action` on a press, then again and again while the button is held:
 * after a pause, slowly at first, then faster.
 */
function repeatWhileHeld(button: HTMLButtonElement, action: () => void): void {
  let timer = 0;
  const stop = () => window.clearTimeout(timer);
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stop();
    action();
    let delay = HOLD_REPEAT_START_MS;
    const again = () => {
      action();
      delay = Math.max(HOLD_REPEAT_MIN_MS, delay * HOLD_REPEAT_SPEEDUP);
      timer = window.setTimeout(again, delay);
    };
    timer = window.setTimeout(again, HOLD_PAUSE_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) button.addEventListener(type, stop);
  // The press itself was handled above; this is for the keyboard (Enter or
  // Space), whose clicks carry no press count.
  button.addEventListener('click', (e) => {
    if (e.detail === 0) action();
  });
  // A long press on a touch screen would otherwise open the context menu.
  button.addEventListener('contextmenu', (e) => e.preventDefault());
}
/** How long a button is held before it starts repeating. */
const HOLD_PAUSE_MS = 400;
/** The gap between repeats: where it starts, what it's multiplied by each time, and where it stops shrinking. */
const HOLD_REPEAT_START_MS = 220;
const HOLD_REPEAT_SPEEDUP = 0.9;
const HOLD_REPEAT_MIN_MS = 45;

repeatWhileHeld(els.prevDay, () => shiftDay(-1));
repeatWhileHeld(els.nextDay, () => shiftDay(1));

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
  // (Playing takes over from a run to a pressed moment, from wherever it has got to.)
  glide = null;
  let last = performance.now();
  const tick = (now: number) => {
    // One hour of sky per second of playback.
    const dt = (now - last) * 3600;
    last = now;
    const win = currentWindow();
    let t = state.time.getTime() + dt;
    if (t > win.end.getTime() - 60000) t = win.start.getTime();
    tickTime(t, now);
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
function measureSheet(): void {
  if (!els.panel.classList.contains('open') && getComputedStyle(els.panel).position === 'fixed') {
    document.documentElement.style.setProperty('--sheet-h', `${els.panel.offsetHeight}px`);
  }
}
new ResizeObserver(measureSheet).observe(els.panel);

/**
 * Puts the page back where it belongs once the on-screen keyboard has gone.
 * To show a focused field, a phone's browser scrolls the page under the
 * sheet, and can leave it there afterwards: Street View and the map button
 * then sit out of place against the sheet until something lays the page out
 * again. So scroll it back, and re-measure the sheet.
 */
function settleSheet(): void {
  // (Not while the sheet is open: that may be the search being typed in.)
  if (els.panel.classList.contains('open') || getComputedStyle(els.panel).position !== 'fixed') return;
  window.scrollTo(0, 0);
  measureSheet();
}
window.visualViewport?.addEventListener('resize', settleSheet);

function setSheetOpen(open: boolean): void {
  els.panel.classList.toggle('open', open);
  els.handle.setAttribute('aria-expanded', String(open));
  els.handle.setAttribute('aria-label', open ? 'Collapse panel' : 'Expand panel');
  // Closing it from a search leaves the keyboard on its way out.
  if (!open) for (const ms of [0, 350]) window.setTimeout(settleSheet, ms);
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
const lookingAround = { dragging: false, ms: 0, deg: 0, last: 0, heading: 0, pitch: 0, x: 0, y: 0 };
els.pano.addEventListener('pointerdown', (e) => {
  lookingAround.dragging = true;
  lookingAround.last = 0;
  // Taking hold of the view lets go of any object it was locked onto.
  following = null;
  lookingAround.x = e.clientX;
  lookingAround.y = e.clientY;
}, true);
// Dragging the view takes it back from the compass too. (A tap doesn't:
// that's a step along the street.)
els.pano.addEventListener('pointermove', (e) => {
  const s = lookingAround;
  if (compass.on && s.dragging && Math.hypot(e.clientX - s.x, e.clientY - s.y) > COMPASS_DRAG_PX) setCompass(false);
}, true);

// ---------- compass mode (see compass.ts) ----------

/** How far a touch must move across the view to count as a drag. */
const COMPASS_DRAG_PX = 10;
/** How much of the way the view moves to each new reading: steadies the compass's jitter. */
const COMPASS_SMOOTHING = 0.3;
/** The same, for the slower correction that ties an iPhone's motion to its compass. */
const COMPASS_NORTH_SMOOTHING = 0.05;
/** How long to wait for a first reading before deciding there's no compass. */
const COMPASS_WAIT_MS = 2500;

const compass = {
  on: false,
  /** Whether a usable reading has arrived since it was switched on. */
  seen: false,
  timer: 0,
  /** The view, as last set from a reading. */
  heading: 0,
  pitch: 0,
  /** iPhones: what to add to their `alpha` (which starts anywhere) to measure it from north. */
  north: null as number | null,
  /** Whether that was learnt with the phone tilted enough to trust its compass. */
  northSteady: false,
};

/**
 * The compass's error at the place being shown, today (it's the real compass
 * being corrected, not the sky's chosen time). Taken at the place on screen,
 * which is where the phone is whenever lining up with the real sky matters.
 */
function magneticDeclination(): number {
  if (state.lat === null || state.lng === null) return 0;
  // It changes by well under a tenth of a degree across a ~10 km square.
  const key = `${state.lat.toFixed(1)},${state.lng.toFixed(1)}`;
  if (key !== declinationFor.key) {
    let value = 0;
    try {
      value = declination(state.lat, state.lng, new Date());
    } catch {
      // No model for the date: leave the compass uncorrected.
    }
    declinationFor = { key, value };
  }
  return declinationFor.value;
}
let declinationFor = { key: '', value: 0 };

type CompassReading =DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

function onOrientation(e: CompassReading): void {
  if (!compass.on || !pano || e.alpha === null || e.beta === null || e.gamma === null) return;
  let alpha = e.alpha;
  if (e.webkitCompassHeading !== undefined) {
    // Safari: motion that isn't tied to north, with a compass heading beside
    // it. Ease the motion's zero toward the compass, so the view moves as
    // smoothly as the motion while keeping the compass's sense of north.
    // The compass says nothing useful while the phone is near upright
    // (see compass.ts), so north is only learnt while it's tilted. A first
    // reading taken upright is better than nothing, and is replaced outright
    // by the first good one.
    const steady = steadyForNorth(e.beta);
    if ((e.webkitCompassAccuracy ?? 0) >= 0 && (steady || compass.north === null)) {
      const north = northOffset(alpha, e.beta, e.webkitCompassHeading);
      compass.north =
        compass.north === null || !compass.northSteady ? north : turnToward(compass.north, north, COMPASS_NORTH_SMOOTHING);
      compass.northSteady = steady;
    }
    if (compass.north === null) return;
    alpha += compass.north;
  } else if (!e.absolute) {
    return; // motion alone, with nothing to say where north is
  }
  const to = lookDirection(alpha, e.beta, e.gamma);
  to.heading += magneticDeclination(); // the phone's north is magnetic north
  const share = compass.seen ? COMPASS_SMOOTHING : 1;
  compass.seen = true;
  compass.heading = turnToward(compass.heading, to.heading, share);
  compass.pitch += (to.pitch - compass.pitch) * share;
  pano.setPov({ heading: compass.heading, pitch: Math.max(-89, Math.min(89, compass.pitch)) });
}

function setCompass(on: boolean): void {
  if (on === compass.on) return;
  compass.on = on;
  compass.seen = false;
  compass.north = null;
  compass.northSteady = false;
  els.compass.setAttribute('aria-pressed', String(on));
  window.clearTimeout(compass.timer);
  // Android reports north-based readings as their own event; Safari as
  // extras on the ordinary one.
  for (const type of ['deviceorientationabsolute', 'deviceorientation']) {
    if (on) window.addEventListener(type, onOrientation as EventListener);
    else window.removeEventListener(type, onOrientation as EventListener);
  }
  if (!on) return;
  following = null;
  setMapHidden(true);
  compass.timer = window.setTimeout(() => {
    if (compass.seen) return;
    setCompass(false);
    toast("Couldn't read this device's compass.");
  }, COMPASS_WAIT_MS);
}

els.compass.addEventListener('click', async () => {
  if (compass.on) {
    setCompass(false);
    return;
  }
  // Safari asks the visitor first, and only from a press like this one.
  const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
  if (ask) {
    try {
      if ((await ask.call(DeviceOrientationEvent)) !== 'granted') {
        toast('Motion access is blocked, so the view can’t follow the phone.');
        return;
      }
    } catch {
      return;
    }
  }
  setCompass(true);
});
// Offered on phones and tablets only: a laptop has no compass to read.
els.compass.hidden = !('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches);
for (const type of ['pointerup', 'pointercancel']) {
  window.addEventListener(type, () => (lookingAround.dragging = false), true);
}

/** Called on every POV change; collapses the map after enough dragging. */
function noteViewTurned(): void {
  if (document.body.classList.contains('map-hidden')) return; // already tucked away
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

// The night sky over the view: a chart of the whole sky (skychart.ts), drawn
// at full strength where the sky map (sky/index.ts) finds open sky in the
// panorama, and fainter over buildings and trees; with the stars (stars.ts).
// It's on wherever the browser can run the sky map's model on the graphics
// card (on the processor the model holds the page up at every look), unless
// switched off in the settings; the switch is kept in this browser, not in
// the link: it's about what the visitor's device can do. Nothing of it
// shows until the model is ready, and nothing ever does if it can't be made
// ready (its file not downloaded, the graphics card not taking it): the app
// is then as it is without it, and says nothing of it.
{
  const row = els.skyChart.closest<HTMLElement>('.sky-chart-setting');
  if (row) row.hidden = !skyOffered;
  els.skyChart.checked = skyEnabled();
  els.skyChart.addEventListener('change', () => {
    // The viewer's canvas has to be made with the sky map already on (sky/preserve.ts): so the page loads again, as it was.
    setSkyEnabled(els.skyChart.checked);
    flushState(state);
    location.reload();
  });

  const host = {
    pano: els.pano,
    view: els.pano.parentElement!,
    camera,
    panoId: () => pano?.getPano() ?? '',
    showPano: (id: string) => showPano(id),
    links: () => (pano?.getLinks() ?? []).flatMap((link) => (link?.pano ? [link.pano] : [])),
  };
  // The sky map, once its model is ready; null where it's off, or the model can't be made ready.
  const sky = skyEnabled()
    ? import('./sky')
        .then(async ({ startSky }) => {
          const map = startSky(host);
          await map.ready;
          return map;
        })
        .catch((err) => {
          // TODO: degrade, don't give up. Without the model (this, or a browser with no WebGPU, where it isn't
          // tried at all) the chart could still be drawn, at one strength everywhere: only what needs the sky
          // map would go (open sky at full strength and buildings darkened, paths dimmed behind things, the
          // times at the skyline). See "The night sky without the model" in FEATURES.md.
          console.warn('[sky] the night sky is left off:', err);
          return null;
        })
    : Promise.resolve(null);
  // The chart and its stars are fetched meanwhile, and put on screen only once the sky map is there.
  if (skyEnabled()) {
    const charting = import('./skychart');
    const starred = import('./stars').then(async (module) => ({ module, loaded: await module.loadCatalogue() }));
    // (The stars are drawn without it until it's there, and if it never is: as under a dark sky.)
    const glowing = import('./skyglow').then(async (module) => ({ module, map: await module.loadSkyGlow() }));
    for (const fetched of [charting, starred, glowing]) fetched.catch(() => {});
    void sky.then(async (map) => {
      if (!map) return;
      const module = await charting;
      chartLook = module.CHART_LOOK;
      chart = module.SkyChart.create(els.overlay, els.pano);
      skyMap = map;
      chart?.setSky(map);
      map.onChange(skyMapChanged);
      skyMapChanged();
      requestRender();
      void starred.then(({ module: starsModule, loaded }) => {
        stars = starsModule;
        catalogue = loaded;
        chart?.setCatalogue(loaded);
        requestRender();
      });
      void glowing.then(({ module: glowModule, map: glowMap }) => {
        skyGlow = glowModule;
        skyGlowMap = glowMap;
        requestRender();
      });
    }).catch((err) => console.error(err));
  }
  els.skyGlow.checked = skyGlowOn;
  els.skyGlow.addEventListener('change', () => {
    skyGlowOn = els.skyGlow.checked;
    try {
      localStorage.setItem(SKY_GLOW_KEY, skyGlowOn ? '1' : '0');
    } catch {
      // Storage unavailable: the choice just isn't remembered.
    }
    requestRender();
  });
  if (import.meta.env.DEV) {
    // For the console: the faintest star seen by eye from the place shown, and the level it's read from.
    Object.assign(window, {
      __skyglow: () => ({ on: skyGlowOn, faintest: siteFaintest(), level: skyGlow && skyGlowMap && state.lat !== null && state.lng !== null ? skyGlow.levelAt(skyGlowMap, state.lat, state.lng) : null }),
    });
  }
  if (import.meta.env.DEV) {
    void Promise.all([sky, import('./sky/dev/panel')]).then(([map, { startSkyPanel }]) =>
      startSkyPanel(host, map, {
        look: () => chartLook,
        redraw: requestRender,
        readWeight: () => (chart && chartFrame ? { ...chart.readWeight({ ...chartFrame, now: performance.now() }), cam: chartFrame.cam } : null),
      }),
    );
  }
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
