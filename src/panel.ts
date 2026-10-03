import {
  BODIES,
  BODY_COLOR,
  SUN_DOWN,
  interpolate,
  magnitude,
  twilightLabel,
  type BodyId,
  type NightData,
  type Sample,
} from './astro';
import { axisFor } from './axis';
import { formatClock, formatDate, formatHour, formatTime, wallTime } from './time';

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function compass(az: number): string {
  return COMPASS16[Math.round(az / 22.5) % 16];
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

/** An hour mark on the shared time axis. */
interface HourMark {
  /** The hour's time, and its position along the axis in %. */
  t: number;
  at: number;
  /** Labelled on the timeline's axis, and marked more strongly. */
  major: boolean;
}

/**
 * The hour marks for the slider and the timeline. Daytime is squeezed (see
 * axis.ts), so the night's hours have room for a label every two hours;
 * daytime hours get one only where there's space beside those. Unlabelled
 * hours are left out where the squeeze puts them too close to tell apart.
 */
function hourMarks(data: NightData): HourMark[] {
  const t0 = data.start.getTime();
  const axis = axisFor(data);
  const at = (h: number) => axis.toFraction(t0 + h * 3600000) * 100;
  const { sunset, sunrise } = data.sunEvents;
  const atNight = (h: number) => {
    const ms = t0 + h * 3600000;
    return !!sunset && !!sunrise && ms >= sunset.getTime() && ms <= sunrise.getTime();
  };
  const hours = Array.from({ length: 23 }, (_, i) => i + 1);
  const labelled = hours.filter((h) => atNight(h) && h % 2 === 0);
  // Daytime candidates, working outwards from the night.
  for (const h of hours.filter((h) => !atNight(h) && h % 3 === 0).sort((a, b) => Math.abs(a - 12) - Math.abs(b - 12))) {
    const clear = labelled.every((other) => Math.abs(at(other) - at(h)) >= AXIS_LABEL_GAP);
    if (clear && at(h) >= AXIS_LABEL_GAP / 2 && at(h) <= 100 - AXIS_LABEL_GAP / 2) labelled.push(h);
  }
  return hours
    .map((h) => ({ h, major: labelled.includes(h), width: (at(h + 1) - at(h - 1)) / 2 }))
    .filter((m) => m.major || m.width >= MIN_HOUR_WIDTH)
    .map((m) => ({ t: t0 + m.h * 3600000, at: at(m.h), major: m.major }));
}

/** A vertical hairline `width` px wide at `at` % along a track, as a background layer. */
function hairline(at: number, width: number, color: string): string {
  const x = `${at.toFixed(2)}%`;
  const half = `${width / 2}px`;
  return `linear-gradient(to right, transparent calc(${x} - ${half}), ${color} calc(${x} - ${half}), ${color} calc(${x} + ${half}), transparent calc(${x} + ${half}))`;
}

/**
 * The timeline's hour marks, for the slider track: background layers to go on
 * top of sliderGradient, leaving the sky shading itself untouched.
 */
export function sliderTicks(data: NightData): string {
  return hourMarks(data)
    .map((m) => hairline(m.at, 1, `rgba(255, 255, 255, ${m.major ? 0.34 : 0.16})`))
    .join(', ');
}

/**
 * The hour labels under the slider, shortened ("9p", "12a") to fit: the axis
 * for the slider and for the chart below it. They belong to the slider so
 * that they're there even when the chart isn't (the collapsed sheet on phones).
 */
export function renderHourLabels(root: HTMLElement, data: NightData | null, tz: string): void {
  root.innerHTML = data
    ? hourMarks(data)
        .filter((mark) => mark.major)
        .map((mark) => `<span style="left:${mark.at.toFixed(2)}%">${shortTime(formatHour(new Date(mark.t), tz))}</span>`)
        .join('')
    : '';
}

/**
 * A thin light line across the slider track at midnight, where the date
 * changes: another layer for the top of the track's background.
 */
export function midnightMark(data: NightData, tz: string): string {
  // The window starts at local noon, so midnight is 12 hours in, give or
  // take an hour on the two nights a year the clocks change.
  const guess = data.start.getTime() + 12 * 3600000;
  const { hour, minute } = wallTime(new Date(guess), tz);
  const past = hour * 60 + minute;
  const midnight = guess - (past > 720 ? past - 1440 : past) * 60000;
  return hairline(axisFor(data).toFraction(midnight) * 100, 1.5, 'rgba(255, 255, 255, 0.75)');
}

function skyColor(sunAlt: number): string {
  if (sunAlt > SUN_DOWN) return '#7fb3e6'; // the same steps as twilightLabel
  if (sunAlt > -6) return '#4d6fa8';
  if (sunAlt > -12) return '#2b3f70';
  if (sunAlt > -18) return '#1a2448';
  return '#0b1024';
}

/** The sky's colour at time `t`, as on the slider's track: for the slider's thumb. */
export function skyColorAt(data: NightData, t: number): string {
  const sun = interpolate(data.sun, t);
  return sun ? skyColor(sun.alt) : '';
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

/** A half Sun on the horizon with an arrow above it: going down, or coming up. */
const sunIcon = (arrow: string) =>
  `<svg class="sun-icon" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 10.5h12M4 10.5a3 3 0 0 1 6 0${arrow}" /></svg>`;
const SUNSET_ICON = sunIcon('M7 1v4M5.3 3.3 7 5l1.7-1.7');
const SUNRISE_ICON = sunIcon('M7 5V1M5.3 2.7 7 1l1.7 1.7');

/** Closer together than this (as a fraction of the slider), the two sun labels turn away from each other. */
const SUN_LABELS_CLOSE = 0.3;

/**
 * Sunset and sunrise, written above the slider at their own places along it
 * ("6:36p" over the evening end of the night, "6:54a" over the morning end),
 * so it's plain which evening and which morning they are. The full date and
 * time is each one's tooltip.
 */
export function renderSunTimes(
  root: HTMLElement,
  data: NightData | null,
  tz: string,
  /** Called with the moment when a label is pressed, to jump there. */
  onPick: (time: Date) => void,
): void {
  root.replaceChildren();
  if (!data) return;
  const axis = axisFor(data);
  const { sunset, sunrise } = data.sunEvents;
  const inWindow = (d: Date | null): d is Date => !!d && d >= data.start && d <= data.end;
  // Centred on their moments, unless the night is so short that they'd
  // collide: then the sunset ends at its moment and the sunrise starts at its.
  const close =
    inWindow(sunset) &&
    inWindow(sunrise) &&
    axis.toFraction(sunrise.getTime()) - axis.toFraction(sunset.getTime()) < SUN_LABELS_CLOSE;
  const label = (d: Date | null, name: string, icon: string, side: string) => {
    if (!inWindow(d)) return;
    const el = document.createElement('button');
    el.type = 'button';
    if (close) el.className = side;
    el.addEventListener('click', () => onPick(d));
    // (Centred labels stop short of the slider's right-hand end, to stay inside the panel.)
    const at = `${(axis.toFraction(d.getTime()) * 100).toFixed(2)}%`;
    el.style.left = close ? at : `min(${at}, calc(100% - 10px))`;
    el.innerHTML = icon + shortTime(formatClock(d, tz));
    el.title = `${name} ${formatDate(d, tz)}, ${formatClock(d, tz)}. Jump to it`;
    root.append(el);
  };
  label(sunset, 'Sunset', SUNSET_ICON, 'before');
  label(sunrise, 'Sunrise', SUNRISE_ICON, 'after');
}

function fmtWindows(list: { start: Date; end: Date }[], tz: string): string {
  return list.map((w) => `${formatTime(w.start, tz)}–${formatTime(w.end, tz)}`).join(', ');
}

/** Rows whose details are open. Kept here so they stay open as the panel re-renders. */
const expanded = new Set<BodyId>();

/** What the chart's rows were last built from (see renderInfo). */
let built: { root: HTMLElement; data: NightData; tz: string; key: string } | null = null;

/** The height of an open row's plot, in px (--plot-h on .tl-row.open in the stylesheet). */
const OPEN_PLOT_PX = 54;
/** Width allowed per character of the 11 px labels drawn on a plot (on the generous side: W is wide). */
const PLOT_CHAR_PX = 7.2;
/** How far a plot label sits from its dot. */
const PLOT_LABEL_GAP_PX = 11;

/**
 * Marks where `id` is at time `t` on an open row's plot: a dot on the curve
 * where the time line crosses it, with its altitude and direction beside it
 * ("30° ENE"); below the horizon, just the altitude, on the horizon line.
 * The label goes to the right of the dot unless that would run off the plot
 * or onto the peak's label at the transit dot; then to the left; and if
 * neither side is clear, underneath.
 */
function showNow(row: HTMLElement, data: NightData, id: BodyId, t: number, trackWidth: number): void {
  const here = row.querySelector<HTMLElement>('.tl-here');
  const pos = interpolate(data.bodies.get(id)?.samples ?? [], t);
  if (!here || !pos) return;
  const up = pos.alt > 0;
  const height = Math.max(0, Math.min(90, pos.alt)) / 90;
  const text = up ? `${pos.alt.toFixed(0)}° ${compass(pos.az)}` : `${pos.alt.toFixed(0)}°`;
  here.style.setProperty('--alt', height.toFixed(3));
  here.classList.toggle('below', !up);
  here.lastElementChild!.textContent = text;
  here.title = up ? `Now ${pos.alt.toFixed(0)}° up, ${compass(pos.az)} (${pos.az.toFixed(0)}°)` : `Now below the horizon (${pos.alt.toFixed(0)}°)`;

  // Where things are on the plot, in px.
  const x = axisFor(data).toFraction(t) * trackWidth;
  const y = (1 - height) * OPEN_PLOT_PX;
  const width = text.length * PLOT_CHAR_PX;
  const apex = row.querySelector<HTMLElement>('.tl-apex');
  let peakLabel: { x0: number; x1: number; y: number } | null = null;
  if (apex) {
    // The peak's label first steps aside if the time line would run through
    // it: to its other side of the transit dot, where that fits on the plot.
    const ax = (parseFloat(apex.style.left) / 100) * trackWidth;
    const aw = (apex.dataset.peak ?? '').length * PLOT_CHAR_PX;
    const start = (onLeft: boolean) => (onLeft ? ax - PLOT_LABEL_GAP_PX - aw : ax + PLOT_LABEL_GAP_PX);
    const crossed = (x0: number) => x > x0 - 5 && x < x0 + aw + 5;
    const usual = apex.dataset.side === 'left';
    const other = start(!usual);
    const onLeft = crossed(start(usual)) && !crossed(other) && other >= 0 && other + aw <= trackWidth ? !usual : usual;
    apex.classList.toggle('flip', onLeft);
    // At the transit itself the two dots are one, and the label here says
    // the same altitude as the peak's: so the peak's is left out.
    const atTransit = Math.abs(x - ax) < 9;
    apex.classList.toggle('covered', atTransit);
    if (!atTransit) {
      peakLabel = { x0: start(onLeft), x1: start(onLeft) + aw, y: (1 - Number(apex.style.getPropertyValue('--peak'))) * OPEN_PLOT_PX };
    }
  }
  const clear = (x0: number) =>
    x0 >= 0 &&
    x0 + width <= trackWidth &&
    !(peakLabel && x0 < peakLabel.x1 + 4 && x0 + width > peakLabel.x0 - 4 && Math.abs(y - peakLabel.y) < 14);
  const right = clear(x + PLOT_LABEL_GAP_PX);
  const left = clear(x - PLOT_LABEL_GAP_PX - width);
  here.classList.toggle('flip', !right && (left || x + PLOT_LABEL_GAP_PX + width > trackWidth));
  here.classList.toggle('drop', up && !right && !left);
}

/** A press on an open plot becomes a drag once it has moved this far. */
const DRAG_THRESHOLD_PX = 4;

// Dragging along an open plot. The drag is followed from the window, not
// from the plot's own element: holding it past an end runs the time on into
// another night, which rebuilds the rows, and the element that was pressed
// is replaced mid-drag. So the drag remembers which object's row it's on and
// measures against whichever element is that row's plot now.
let chart: { root: HTMLElement; onScrub: (fraction: number, id: BodyId) => void; onScrubEnd: () => void } | null = null;
let chartDrag: { id: BodyId; startX: number; moved: boolean } | null = null;
/** When the last drag ended, so the click that follows it isn't taken for one. */
let chartDragEnded = 0;

function endChartDrag(): void {
  if (chartDrag?.moved) {
    chartDragEnded = performance.now();
    document.body.classList.remove('scrubbing');
    chart?.onScrubEnd();
  }
  chartDrag = null;
}
window.addEventListener('pointermove', (ev) => {
  if (!chartDrag || !chart) return;
  // The button was let go somewhere this page never heard about (outside
  // the window): the drag is over, not still following the mouse.
  if (ev.pointerType === 'mouse' && ev.buttons === 0) {
    endChartDrag();
    return;
  }
  if (!chartDrag.moved && Math.abs(ev.clientX - chartDrag.startX) < DRAG_THRESHOLD_PX) return;
  if (!chartDrag.moved) document.body.classList.add('scrubbing'); // no text selection on the way
  chartDrag.moved = true;
  const track = chart.root.querySelector<HTMLElement>(`li[data-id="${chartDrag.id}"] .tl-track`);
  if (!track) return;
  const box = track.getBoundingClientRect();
  if (box.width > 0) chart.onScrub((ev.clientX - box.left) / box.width, chartDrag.id);
});
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, endChartDrag);

/** The chart's name column and the gap beside it, in px (--name-w + 8 in the stylesheet). */
const NAME_COLUMN_PX = 84;

/**
 * Moves labels apart along an axis so that none overlap and all stay inside
 * it. Each has a centre `at` and a `width`, both in % of the axis; they come
 * back in order, as near their own centres as the rest allow.
 */
function spread<T extends { at: number; width: number }>(items: T[]): T[] {
  const out = [...items].sort((a, b) => a.at - b.at);
  // Left to right: each clear of the axis's start and of the one before it.
  out.forEach((item, i) => {
    const min = i === 0 ? item.width / 2 : out[i - 1].at + (out[i - 1].width + item.width) / 2;
    item.at = Math.max(item.at, min);
  });
  // Then right to left: each clear of the axis's end and of the one after it.
  for (let i = out.length - 1; i >= 0; i--) {
    const max = i === out.length - 1 ? 100 - out[i].width / 2 : out[i + 1].at - (out[i + 1].width + out[i].width) / 2;
    out[i].at = Math.min(out[i].at, max);
  }
  return out;
}

/** "6:36 PM" as "6:36p", for the tightest spots. */
const shortTime = (text: string) => text.replace(/\s?([AP])M/i, (_, half: string) => half.toLowerCase());

/** Where `samples` cross the horizon: the time of each crossing, and which way. */
function horizonCrossings(samples: Sample[]): { t: number; rising: boolean }[] {
  const out: { t: number; rising: boolean }[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.alt > 0 === b.alt > 0) continue;
    out.push({ t: a.t + (a.alt / (a.alt - b.alt)) * (b.t - a.t), rising: b.alt > 0 });
  }
  return out;
}

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
  /** `shown`: drawn on the sky. `visible`: visible tonight, so listed first. */
  objects: { shown: BodyId[]; visible: BodyId[] },
  t: number,
  tz: string,
  /**
   * `onDetails`: a row was opened or closed, so the chart needs redrawing.
   * `onScrub`: an open plot (this object's) is being dragged, to this position
   * along the axis (0–1, or beyond when the pointer is past an end).
   * `onScrubEnd`: let go.
   * `onJump`: one of a row's events was pressed, to go to its time.
   */
  actions: {
    onToggle: (id: BodyId) => void;
    onLook: (id: BodyId) => void;
    onDetails: () => void;
    onScrub: (fraction: number, id: BodyId) => void;
    onScrubEnd: () => void;
    onJump: (time: Date) => void;
  },
): void {
  if (!data) {
    root.replaceChildren();
    built = null;
    return;
  }
  // The rows depend on the night, which objects are on, and which are open:
  // not on the chosen time. This is called on every step of the slider and
  // through playback, so when none of those has changed, leave the rows be
  // and just bring the time-dependent parts up to date.
  // (And on the chart's width: labels are placed by how much room they have.)
  const key = `${[objects.shown, objects.visible, [...expanded]].map((list) => list.join(',')).join('|')}|${root.clientWidth}`;
  if (built && built.root === root && built.data === data && built.tz === tz && built.key === key) {
    const trackWidth = Math.max(120, root.clientWidth - NAME_COLUMN_PX);
    for (const id of expanded) {
      const open = root.querySelector<HTMLElement>(`li[data-id="${id}"]`);
      if (open) showNow(open, data, id, t, trackWidth);
    }
    setTimelineNow(root, data, t);
    return;
  }
  built = { root, data, tz, key };
  chart = { root, onScrub: actions.onScrub, onScrubEnd: actions.onScrubEnd };

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

  // A faint mark on every plot at each hour, stronger at the hours labelled
  // under the slider (see renderHourLabels).
  const ticks = hourMarks(data)
    .map((mark) => `<span class="tl-tick${mark.major ? ' major' : ''}" style="left:${mark.at.toFixed(2)}%"></span>`)
    .join('');

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

  const row = (id: BodyId): HTMLLIElement => {
    const s = data.bodies.get(id);
    const on = objects.shown.includes(id);
    const li = document.createElement('li');
    li.className = on ? 'tl-row' : 'tl-row off';
    li.dataset.id = id;
    li.style.setProperty('--c', BODY_COLOR[id]);
    if (!s) return li;
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
    li.classList.toggle('open', open);
    li.innerHTML = `
      <div class="tl-left">
        <span class="tl-name">
          <button type="button" class="tl-toggle" aria-pressed="${on}" aria-label="Show ${id}" title="${on ? 'Hide' : 'Show'} ${id}"><span class="dot"></span></button>
          <button type="button" class="tl-label" title="Turn the view toward ${id}">${id}</button>
        </span>
      </div>
      <div class="tl-right">
        <button type="button" class="tl-track" aria-expanded="${open}">
          <span class="tl-sky" style="background:${sky}"></span>
          ${bars}
          ${ticks}
          <span class="tl-now"></span>
        </button>
      </div>`;

    const summary = sun
      ? `sets ${time(data.sunEvents.sunset)}, rises ${time(data.sunEvents.sunrise)}`
      : s.observable.length
        ? `observable ${fmtWindows(s.observable, tz)}`
        : 'not observable in darkness tonight';
    // The dot switches the object on and off; its name turns the view toward it.
    li.querySelector<HTMLButtonElement>('.tl-toggle')!.addEventListener('click', () => actions.onToggle(id));
    li.querySelector<HTMLButtonElement>('.tl-label')!.addEventListener('click', () => actions.onLook(id));
    const track = li.querySelector<HTMLButtonElement>('.tl-track')!;
    track.setAttribute('aria-label', `${id}: ${summary}. ${open ? 'Hide' : 'Show'} details`);
    track.title = `${id}: ${summary}`;
    // An open plot can be dragged along to scrub the time, like the slider
    // above it (see the window listeners below). A press that doesn't move
    // is still a click, which closes it.
    if (open) {
      track.addEventListener('pointerdown', (ev) => {
        if (ev.button === 0) chartDrag = { id, startX: ev.clientX, moved: false };
      });
    }
    track.addEventListener('click', (ev) => {
      if (performance.now() - chartDragEnded < 100) return; // the end of a drag, not a click
      // The transit dot and the peak beside it jump to the transit. (They're
      // inside the plot, which is itself a button, so the click is caught here.)
      if (s.transit && (ev.target as Element).closest('.tl-apex')) {
        actions.onJump(s.transit);
        return;
      }
      if (!expanded.delete(id)) expanded.add(id);
      // The caller redraws, with the time as it is now: this row may have
      // been built a while ago, and `t` here is the time it was built for.
      actions.onDetails();
    });
    if (!open) return li;

    // Open: the plot grows taller and its events are written under it, each
    // at its own time along the axis: rise, transit and set; for the Sun,
    // sunset, sunrise and when darkness starts and ends. On the plot itself
    // are the transit's dot with the peak altitude, and where the object is
    // at the chosen time. Beside the plot, under the name, is its brightness.
    const short = (d: Date) => shortTime(formatClock(d, tz));
    const full = (name: string, d: Date) => `${name} ${formatDate(d, tz)}, ${formatClock(d, tz)}`;
    const onAxis = (d: Date | null): d is Date => !!d && d >= data.start && d <= data.end;
    const peak = `${s.peakAlt.toFixed(0)}°`;
    const e = data.sunEvents;
    const events: { time: Date | null; icon: string; text: (d: Date) => string; name: string }[] = sun
      ? [
          { time: e.sunset, icon: ICON.set, text: short, name: 'Sunset' },
          { time: e.darkStart, icon: '', text: (d) => `dark ${short(d)}`, name: 'Dark from' },
          { time: e.darkEnd, icon: '', text: (d) => `light ${short(d)}`, name: 'Dark until' },
          { time: e.sunrise, icon: ICON.rise, text: short, name: 'Sunrise' },
        ]
      : [
          // Every rise and set the plot shows, each under its own crossing.
          // Those of tonight's pass carry its exact times; another (the tail
          // of the pass before, say, setting early in the window) carries
          // its own. A rise or set of tonight's pass that's off the axis is
          // listed only if the plot shows no other of its kind.
          ...horizonCrossings(s.samples).map((c) => {
            const exact = c.rising ? s.rise : s.set;
            const mine = !!exact && Math.abs(exact.getTime() - c.t) < 10 * 60000;
            return {
              time: mine ? exact : new Date(c.t),
              icon: c.rising ? ICON.rise : ICON.set,
              text: short,
              name: c.rising ? 'Rise' : 'Set',
            };
          }),
          ...[
            { time: s.rise, icon: ICON.rise, text: short, name: 'Rise', rising: true },
            { time: s.set, icon: ICON.set, text: short, name: 'Set', rising: false },
          ].filter(
            (ev) =>
              !!ev.time && !onAxis(ev.time) && !horizonCrossings(s.samples).some((c) => c.rising === ev.rising),
          ),
          { time: s.transit, icon: ICON.transit, text: short, name: `Transit, at ${peak}:` },
        ];

    // Labels sit centred under their moments, nudged apart where they'd
    // collide (their true places stay marked by a tick above each).
    // An event before or after this noon-to-noon window goes at that end of
    // the axis, with a ‹ or › to say it's off the end.
    const trackWidth = Math.max(120, root.clientWidth - NAME_COLUMN_PX);
    const placed = spread(
      events
        .filter((ev) => ev.time)
        .map((ev) => {
          const time = ev.time!;
          const off = time > data.end ? 1 : time < data.start ? -1 : 0;
          const text = ev.text(time);
          return {
            ev,
            off,
            html: `${off < 0 ? '‹ ' : ''}${ev.icon}${text}${off > 0 ? ' ›' : ''}`,
            at: pct(time.getTime()), // clamped to the axis's ends
            width: (((ev.icon ? 14 : 0) + (text.length + (off ? 2 : 0)) * 5.9 + 6) / trackWidth) * 100,
          };
        }),
    );
    const marks = placed
      .filter((p) => !p.off)
      .map((p) => `<span class="tl-mark" style="left:${pct(p.ev.time!.getTime()).toFixed(2)}%"></span>`)
      .join('');
    // Each label is a button that jumps to its moment.
    const labels = placed
      .map(
        (p) =>
          `<button type="button" data-t="${p.ev.time!.getTime()}" style="left:${p.at.toFixed(2)}%" title="${full(p.ev.name, p.ev.time!)}. Jump to it">${p.html}</button>`,
      )
      .join('');
    // A dot on the curve at transit, where the peak is, with the peak
    // altitude written beside it (on its left when it's near the right-hand end).
    const transitAt = onAxis(s.transit) ? pct(s.transit.getTime()) : 0;
    const apex =
      !sun && onAxis(s.transit)
        ? `<span class="tl-apex${transitAt > 82 ? ' flip' : ''}" data-side="${transitAt > 82 ? 'left' : 'right'}" data-peak="${peak}" title="${full(`Transit, at ${peak}:`, s.transit)}. Jump to it" style="left:${transitAt.toFixed(2)}%;--peak:${(Math.min(90, Math.max(0, s.peakAlt)) / 90).toFixed(3)}"></span>`
        : '';
    // And where the object is at the chosen time: a dot where the time line
    // crosses the curve, with its altitude beside it (see showNow).
    li.querySelector<HTMLElement>('.tl-track')!.insertAdjacentHTML(
      'beforeend',
      `${apex}<span class="tl-here"><span class="tl-here-dot"></span><span class="tl-here-label"></span></span>`,
    );

    li.querySelector<HTMLElement>('.tl-right')!.insertAdjacentHTML(
      'beforeend',
      `<div class="tl-events">${marks}${labels}</div>`,
    );
    for (const button of li.querySelectorAll<HTMLButtonElement>('.tl-events button')) {
      button.addEventListener('click', () => actions.onJump(new Date(Number(button.dataset.t))));
    }

    // Beside the plot. (An object whose transit isn't on the axis has no dot
    // to carry its peak, so that's listed here.)
    const side = document.createElement('div');
    side.className = 'tl-side';
    side.innerHTML = `
      <span title="Apparent magnitude (lower is brighter)">mag ${magnitude(id, date).toFixed(1)}</span>
      ${!sun && !onAxis(s.transit) ? `<span>peak ${peak}</span>` : ''}`;
    li.querySelector<HTMLElement>('.tl-left')!.append(side);
    showNow(li, data, id, t, trackWidth);
    return li;
  };

  // Every object has a row, in the usual order: those visible tonight first,
  // then the rest under a divider. Which group a row is in says whether it's
  // visible, whatever the visitor has switched on or off.
  const ids = BODIES.map((b) => b.id);
  const rest = ids.filter((id) => !objects.visible.includes(id));
  const divider = document.createElement('li');
  divider.className = 'tl-sep';
  divider.textContent = 'Not visible tonight';
  root.replaceChildren(
    ...ids.filter((id) => objects.visible.includes(id)).map(row),
    ...(rest.length ? [divider, ...rest.map(row)] : []),
  );
  setTimelineNow(root, data, t);
}

/**
 * Moves the timeline's chosen-time line. Cheap enough to call every frame, so
 * the line glides during playback while the rows themselves are rebuilt less often.
 */
export function setTimelineNow(root: HTMLElement, data: NightData, t: number): void {
  root.style.setProperty('--now', `${(axisFor(data).toFraction(t) * 100).toFixed(3)}%`);
}
