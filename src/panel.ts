import {
  BODIES,
  BODY_COLOR,
  interpolate,
  magnitude,
  twilightLabel,
  type BodyId,
  type NightData,
  type Sample,
} from './astro';
import { axisFor } from './axis';
import { formatHour, formatTime } from './time';

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function compass(az: number): string {
  return COMPASS16[Math.round(az / 22.5) % 16];
}

export function renderChips(
  root: HTMLElement,
  selected: BodyId[],
  onToggle: (id: BodyId, on: boolean) => void,
): void {
  root.replaceChildren(
    ...BODIES.map((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.style.setProperty('--c', b.color);
      btn.setAttribute('aria-pressed', String(selected.includes(b.id)));
      btn.innerHTML = `<span class="dot"></span>${b.id}`;
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(on));
        onToggle(b.id, on);
      });
      return btn;
    }),
  );
}

/** Paints the slider track with sky darkness across the night. */
export function sliderGradient(data: NightData): string {
  const stops: string[] = [];
  const axis = axisFor(data);
  for (let i = 0; i < data.sun.length; i += 3) {
    const sun = data.sun[i];
    stops.push(`${skyColor(sun.alt)} ${(axis.toFraction(sun.t) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function skyColor(sunAlt: number): string {
  if (sunAlt > 0) return '#7fb3e6';
  if (sunAlt > -6) return '#4d6fa8';
  if (sunAlt > -12) return '#2b3f70';
  if (sunAlt > -18) return '#1a2448';
  return '#0b1024';
}

export function skyState(data: NightData, t: number): string {
  const sun = interpolate(data.sun, t);
  return sun ? twilightLabel(sun.alt) : '';
}

const icon = (path: string) => `<svg class="ev-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="${path}" /></svg>`;
/** Rise and set match the ↑ ↓ on the overlay; transit is the top of the arc. */
const ICON = {
  rise: icon('M6 10.5V2M2.5 5.5 6 2l3.5 3.5'),
  set: icon('M6 1.5V10M2.5 6.5 6 10l3.5-3.5'),
  transit: icon('M1.5 9.5C2.5 5 4 3 6 3s3.5 2 4.5 6.5M6 2.2v1.6'),
};

function fmtWindows(list: { start: Date; end: Date }[], tz: string): string {
  return list.map((w) => `${formatTime(w.start, tz)}–${formatTime(w.end, tz)}`).join(', ');
}

/** Rows whose details are open. Kept here so they stay open as the panel re-renders. */
const expanded = new Set<BodyId>();

/** Stretches of `samples` spent above the horizon, as [start, end] times. */
function upRuns(samples: Sample[]): [number, number][] {
  const runs: [number, number][] = [];
  let start: number | null = null;
  for (const s of samples) {
    if (s.alt > 0) start ??= s.t;
    else if (start !== null) {
      runs.push([start, s.t]);
      start = null;
    }
  }
  if (start !== null && samples.length) runs.push([start, samples[samples.length - 1].t]);
  return runs;
}

/** Size of each row's altitude plot in SVG units; it's stretched to the row. */
const PLOT_W = 1000;
const PLOT_H = 100;
/** The least room, in % of the axis, between a daytime label and its neighbours. */
const AXIS_LABEL_GAP = 7;
/** Unlabelled hour marks are left out where an hour is narrower than this, in % of the axis. */
const MIN_HOUR_WIDTH = 3.5;
/** Opacity of a plot's fill in daylight, and once the sky is dark enough to observe. */
const FILL_DAY = 0.3;
const FILL_DARK = 0.85;
/** The Sun's altitude at sunset and sunrise (its upper edge on the horizon). */
const SUN_DOWN = -0.833;

/**
 * The night as a timeline: one row per object on a shared noon-to-noon axis
 * (the slider's), each a small plot of the object's altitude: faint while
 * it's up, solid while it's observable, peaking at transit, with a line at
 * the chosen time. A row's plot opens its details: where the object is now
 * and its exact times.
 */
export function renderInfo(
  root: HTMLElement,
  data: NightData | null,
  selected: BodyId[],
  t: number,
  tz: string,
  onLook: (id: BodyId) => void,
): void {
  if (!data || !selected.length) {
    root.replaceChildren();
    return;
  }
  const date = new Date(t);
  const t0 = data.start.getTime();
  const span = data.end.getTime() - t0;
  const timeAxis = axisFor(data);
  const pct = (ms: number) => timeAxis.toFraction(ms) * 100;
  // Altitude plots, in the SVG's own units (stretched to fit the row).
  const px = (ms: number) => ((pct(ms) / 100) * PLOT_W).toFixed(1);
  const py = (alt: number) => (PLOT_H - (Math.max(0, Math.min(90, alt)) / 90) * PLOT_H).toFixed(1);
  /** The altitude curve from `from` to `to`, as "x,y" points joined for a path. */
  const curve = (samples: Sample[], from: number, to: number): string[] => {
    const pts: string[] = [];
    const first = interpolate(samples, from);
    if (first) pts.push(`${px(from)},${py(first.alt)}`);
    for (const p of samples) if (p.t > from && p.t < to) pts.push(`${px(p.t)},${py(p.alt)}`);
    const last = interpolate(samples, to);
    if (last) pts.push(`${px(to)},${py(last.alt)}`);
    return pts;
  };
  const line = (samples: Sample[], from: number, to: number) => {
    const pts = curve(samples, from, to);
    return pts.length > 1 ? `M${pts.join('L')}` : '';
  };
  /** The same curve closed down to the horizon. */
  const area = (samples: Sample[], from: number, to: number) => {
    const pts = curve(samples, from, to);
    return pts.length > 1 ? `M${px(from)},${PLOT_H}L${pts.join('L')}L${px(to)},${PLOT_H}Z` : '';
  };
  const sky = sliderGradient(data);
  const time = (d: Date | null) => (d ? formatTime(d, tz) : '—');

  // The axis labels, shortened ("9p", "12a") to fit. Daytime is squeezed (see
  // axis.ts), so the night's hours have room for a label every two hours;
  // daytime hours get one only where there's space beside those.
  const { sunset, sunrise } = data.sunEvents;
  const atNight = (ms: number) => !!sunset && !!sunrise && ms >= sunset.getTime() && ms <= sunrise.getTime();
  const hours = Array.from({ length: 23 }, (_, i) => i + 1);
  const labelled = hours.filter((h) => atNight(t0 + h * 3600000) && h % 2 === 0);
  // Daytime candidates, working outwards from the night.
  for (const h of hours.filter((h) => !atNight(t0 + h * 3600000) && h % 3 === 0).sort((a, b) => Math.abs(a - 12) - Math.abs(b - 12))) {
    const at = pct(t0 + h * 3600000);
    const clear = labelled.every((other) => Math.abs(pct(t0 + other * 3600000) - at) >= AXIS_LABEL_GAP);
    if (clear && at >= AXIS_LABEL_GAP / 2 && at <= 100 - AXIS_LABEL_GAP / 2) labelled.push(h);
  }
  const axis = document.createElement('li');
  axis.className = 'tl-row tl-axis';
  axis.setAttribute('aria-hidden', 'true');
  let labels = '';
  for (const h of labelled) {
    const at = t0 + h * 3600000;
    const text = formatHour(new Date(at), tz).replace(/\s?([AP])M/i, (_, half: string) => half.toLowerCase());
    labels += `<span style="left:${pct(at).toFixed(2)}%">${text}</span>`;
  }
  axis.innerHTML = `<span></span><span class="tl-scale">${labels}</span>`;
  // A faint mark on every plot each hour, stronger at the labelled ones.
  // Where daytime is squeezed the hours are too close to tell apart, so only
  // the labelled ones are marked there.
  let ticks = '';
  for (const h of hours) {
    const major = labelled.includes(h);
    const hourWidth = (pct(t0 + (h + 1) * 3600000) - pct(t0 + (h - 1) * 3600000)) / 2;
    if (!major && hourWidth < MIN_HOUR_WIDTH) continue;
    ticks += `<span class="tl-tick${major ? ' major' : ''}" style="left:${pct(t0 + h * 3600000).toFixed(2)}%"></span>`;
  }

  // How strongly each plot is filled across the night: faint while the Sun is
  // up, solid once it's below the chosen twilight level (when things count as
  // observable), and deepening steadily in between.
  // (Worked out from the Sun's altitude itself, so it holds where the Sun
  // never sets, or never rises.)
  let fadeStops = '';
  for (let i = 0; i < data.sun.length; i += 2) {
    const sunNow = data.sun[i];
    const dark = Math.max(0, Math.min(1, (sunNow.alt - SUN_DOWN) / (-data.twilight - SUN_DOWN)));
    const opacity = FILL_DAY + (FILL_DARK - FILL_DAY) * dark;
    fadeStops += `<stop offset="${(pct(sunNow.t) / 100).toFixed(4)}" stop-color="currentColor" stop-opacity="${opacity.toFixed(3)}" />`;
  }

  const rows = selected.map((id) => {
    const s = data.bodies.get(id);
    const li = document.createElement('li');
    li.className = 'tl-row';
    li.style.setProperty('--c', BODY_COLOR[id]);
    if (!s) return li;
    const pos = interpolate(s.samples, t);
    const up = !!pos && pos.alt > 0;
    const sun = id === 'Sun';

    // Altitude through the night, on a 0–90° scale shared by every row: the
    // area under the curve, faint in daylight and solid once the sky is dark
    // enough to observe, deepening through twilight between the two; and a
    // line along the top. (The Sun itself is solid whenever it's up.)
    const fade = `tl-fade-${id}`;
    const bars = `
      <svg class="tl-plot" viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${fade}" gradientUnits="userSpaceOnUse" x1="0" x2="${PLOT_W}">${fadeStops}</linearGradient></defs>
        <path d="${area(s.samples, t0, t0 + span)}" ${sun ? 'class="tl-obs"' : `fill="url(#${fade})"`} />
        <path class="tl-line" d="${upRuns(s.samples).map(([a, b]) => line(s.samples, a, b)).join('')}" />
      </svg>`;

    const open = expanded.has(id);
    li.innerHTML = `
      <button type="button" class="tl-name ${up ? 'up' : ''}"><span class="dot"></span>${id}</button>
      <button type="button" class="tl-track" aria-expanded="${open}">
        <span class="tl-sky" style="background:${sky}"></span>
        ${bars}
        ${ticks}
        <span class="tl-now"></span>
      </button>`;

    const summary = sun
      ? `sets ${time(data.sunEvents.sunset)}, rises ${time(data.sunEvents.sunrise)}`
      : s.observable.length
        ? `observable ${fmtWindows(s.observable, tz)}`
        : 'not observable in darkness tonight';
    const name = li.querySelector<HTMLButtonElement>('.tl-name')!;
    name.setAttribute('aria-label', `Turn view toward ${id}`);
    name.addEventListener('click', () => onLook(id));
    const track = li.querySelector<HTMLButtonElement>('.tl-track')!;
    track.setAttribute('aria-label', `${id}: ${summary}. ${open ? 'Hide' : 'Show'} details`);
    track.title = `${id}: ${summary}`;
    track.addEventListener('click', () => {
      if (!expanded.delete(id)) expanded.add(id);
      renderInfo(root, data, selected, t, tz, onLook);
    });
    if (!open) return li;

    const now = pos
      ? up
        ? `${pos.alt.toFixed(0)}° up, ${compass(pos.az)} (${pos.az.toFixed(0)}°)`
        : `Below horizon (${pos.alt.toFixed(0)}°)`
      : '';
    const cell = (label: string, value: string, icon = '') => `<div><dt>${icon}${label}</dt><dd>${value}</dd></div>`;
    let cells: string;
    let footer = '';
    if (sun) {
      const e = data.sunEvents;
      cells =
        cell('Set', time(e.sunset), ICON.set) +
        cell('Dark', time(e.darkStart)) +
        cell('Dark ends', time(e.darkEnd)) +
        cell('Rise', time(e.sunrise), ICON.rise);
    } else {
      cells =
        cell('Rise', time(s.rise), ICON.rise) +
        cell('Transit', time(s.transit), ICON.transit) +
        cell('Set', time(s.set), ICON.set) +
        cell('Peak', `${s.peakAlt.toFixed(0)}°`);
      footer = s.observable.length
        ? `<div class="obs good">Observable ${fmtWindows(s.observable, tz)}</div>`
        : `<div class="obs">Not observable in darkness tonight</div>`;
    }
    const detail = document.createElement('div');
    detail.className = 'tl-detail';
    detail.innerHTML = `
      <div class="info-now ${up ? 'up' : ''}">
        <span>${now}</span>
        <span class="mag" title="Apparent magnitude (lower is brighter)">mag ${magnitude(id, date).toFixed(1)}</span>
      </div>
      <dl class="info-times">${cells}</dl>
      ${footer}`;
    li.append(detail);
    return li;
  });
  root.replaceChildren(axis, ...rows);
  setTimelineNow(root, data, t);
}

/**
 * Moves the timeline's chosen-time line. Cheap enough to call every frame, so
 * the line glides during playback while the rows themselves are rebuilt less often.
 */
export function setTimelineNow(root: HTMLElement, data: NightData, t: number): void {
  root.style.setProperty('--now', `${(axisFor(data).toFraction(t) * 100).toFixed(3)}%`);
}
