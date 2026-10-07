import {
  BODY_COLOR,
  boldBoundary,
  interpolate,
  magnitude,
  type AltAz,
  type BodyId,
  type Sample,
  type NightData,
  type NightSummary,
} from './astro';
import { edgeIndicator, focalLength, lineLabelAnchor, project, type Camera, type LabelAnchor } from './projection';
import type { Label } from './stars';
import { formatClock, formatHour } from './time';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Points closer to the camera plane than this are treated as behind it. */
const MIN_DEPTH = 0.05;
const HOUR = 3600000;
/** A path's name is dropped within this many px of the object's own marker label. */
const NAME_CLEARANCE = 110;
/** A path's name sits this far off its line. */
const NAME_OFFSET = 7;
/** Rise and set labels start this far to the right of the crossing, like the hour labels. */
const RISE_SET_GAP = 7;
/** Rise labels sit this far above the horizon line; set labels this far below. */
const RISE_ABOVE = 5;
const SET_BELOW = 5;
/** The most a label moves right to clear its own line (shallow paths would push it far away). */
const MAX_LEAN_SHIFT = 60;
/** One that would overlap its neighbour slides right to sit this far past it. */
const RISE_SET_ADJACENT = 8;
/** Height of an 11 px label, for overlap checks. */
const LABEL_HEIGHT = 12;

const LABEL_FONT = '600 11px system-ui, sans-serif';
const COMPASS_FONT = '600 13px system-ui, sans-serif';

// The chart's names (see drawNames).
const NAME_FONT = '500 11px system-ui, sans-serif';
const CONSTELLATION_FONT = '600 10px system-ui, sans-serif';
const CONSTELLATION_COLOR = '#9db4ea';
const OBJECT_COLOR = '#9fe0d0';
/** A star is named if it's at least this bright, and a magnitude and a bit fainter for each halving of the view's width. */
const STAR_NAMES_TO = 1.7;
const STAR_NAMES_PER_ZOOM = 1.3;
/** The same for Messier's objects and the rest. */
const OBJECT_NAMES_TO = 4.1;
const OBJECT_NAMES_PER_ZOOM = 2.2;
/** The constellations are named in a view at least this many degrees wide: closer in, a name has no figure round it. */
const CONSTELLATION_NAMES_FROM_HFOV = 34;
/** Which names keep their place where two would overlap: stars, then objects, then constellations. */
const rank = (l: Label) => (l.what === 'star' ? 0 : l.what === 'constellation' ? 2 : 1);

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Whether two label boxes touch, with a little breathing room sideways. */
function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 + 6 && a.x1 > b.x0 - 6 && a.y0 < b.y1 + 1 && a.y1 > b.y0 - 1;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Whether a slanted rectangle (its four corners, in order) touches an upright
 * box grown by `pad`. Two convex shapes are apart exactly when some edge
 * direction of either one separates them, so check the box's two axes and the
 * rectangle's two.
 */
function slantedHitsBox(corners: Point[], box: Box, pad: number): boolean {
  const boxCorners: Point[] = [
    { x: box.x0 - pad, y: box.y0 - pad },
    { x: box.x1 + pad, y: box.y0 - pad },
    { x: box.x1 + pad, y: box.y1 + pad },
    { x: box.x0 - pad, y: box.y1 + pad },
  ];
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y },
    { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y },
  ];
  const span = (pts: Point[], axis: Point) => {
    const d = pts.map((p) => p.x * axis.x + p.y * axis.y);
    return [Math.min(...d), Math.max(...d)];
  };
  return axes.every((axis) => {
    const [a0, a1] = span(corners, axis);
    const [b0, b1] = span(boxCorners, axis);
    return a0 <= b1 && b0 <= a1;
  });
}

/** A rise or set time and where it goes. */
interface RiseSetLabel {
  text: string;
  /** The moment itself, in ms. */
  t: number;
  rising: boolean;
  /** The crossing happens in daylight. */
  faint: boolean;
  /** Left edge: just right of the crossing, until layoutRiseSet slides it past a neighbour. */
  x0: number;
  width: number;
  /** Screen y of the horizon at the crossing. */
  horizonY: number;
}

/** Rises sit directly above the horizon line, sets directly below it. */
function riseSetBox(l: RiseSetLabel): Box {
  const top = l.rising ? l.horizonY - RISE_ABOVE - LABEL_HEIGHT : l.horizonY + SET_BELOW;
  return { x0: l.x0, y0: top, x1: l.x0 + l.width, y1: top + LABEL_HEIGHT };
}

/**
 * Keeps rise/set labels from overlapping without ever changing their height:
 * working left to right, one that would run into its neighbour slides right
 * until it sits beside it. Everything involved is anchored to the horizon, so
 * the arrangement holds still as the view pans.
 *
 * Set labels share their strip with the compass letters. One that would run
 * into a letter ahead of it stops short instead, moving left (over its own
 * dashed line if need be) so it stays by its crossing; one that starts on a
 * letter moves just past it. If neighbours then push it back onto a letter,
 * the two overlap and the letter, drawn last, wins.
 */
function layoutRiseSet(labels: RiseSetLabel[], compass: Box[]): void {
  for (const label of labels) {
    if (label.rising) continue;
    const box = riseSetBox(label);
    const hit = compass.find((c) => overlaps(box, c));
    if (!hit) continue;
    const ahead = (hit.x0 + hit.x1) / 2 > label.x0;
    label.x0 = ahead ? hit.x0 - RISE_SET_ADJACENT - label.width : hit.x1 + RISE_SET_ADJACENT;
  }
  for (const rising of [true, false]) {
    const placed: Box[] = [];
    const row = labels.filter((l) => l.rising === rising).sort((a, b) => a.x0 - b.x0);
    for (const label of row) {
      // Each pass clears at least one obstacle, so this settles quickly.
      for (let guard = 0; guard < 20; guard++) {
        const box = riseSetBox(label);
        const hit = placed.find((o) => overlaps(box, o));
        if (!hit) break;
        label.x0 = hit.x1 + RISE_SET_ADJACENT;
      }
      placed.push(riseSetBox(label));
    }
  }
}

/** A time at the skyline: when a path comes out from behind it (`opens`) or goes behind it, and where its label goes. */
interface SkyTimeLabel {
  text: string;
  /** The moment itself, in ms. */
  t: number;
  opens: boolean;
  /** Its left edge and its top. */
  x0: number;
  top: number;
  width: number;
}
/** The eye drawn before each is this wide. */
const SKY_TIME_ICON_PX = 11.5;
/** A stretch of a path, in the open or behind something, shorter than this on screen has no times: leaves, a pole, a chimney. */
const SKY_TIME_MIN_STRETCH_PX = 36;
/** One that would have to slide further than this from its crossing to be clear of other labels is left out. */
const SKY_TIME_MAX_SLIDE_PX = 70;

function skyTimeBox(l: SkyTimeLabel): Box {
  return { x0: l.x0, y0: l.top, x1: l.x0 + l.width, y1: l.top + LABEL_HEIGHT };
}

export interface RenderInput {
  cam: Camera;
  data: NightData | null;
  time: number;
  bodies: BodyId[];
  tz: string;
  /**
   * The sky map, where it's on (sky/index.ts): how far a point of the sky is
   * open sky, above nothing where it is. A path, its hour dots and a marker
   * are then dimmed where they're behind a building or a tree, or in sky
   * that hasn't been looked at yet.
   */
  sky?: { at(alt: number, az: number): number; known?(alt: number, az: number): boolean } | null;
  /** The chart's names to write, where the chart is on (see ChartNames). */
  names?: ChartNames | null;
}

/** What's needed to write the chart's names: the stars', the constellations' and the objects'. */
export interface ChartNames {
  /** Everything in view that has a name (stars.ts). */
  labels: Label[];
  /** The faintest star being shown, and how far it's night (0–1): names come out as their stars do. */
  faintest: number;
  night: number;
  /** How strong the chart's stars are in open sky, over anything else, and below the horizon. */
  strength: [open: number, other: number, below: number];
  /**
   * With the view turned down under the horizon, the chart draws what's
   * below the horizon stronger, over most of the view (ChartLook.lookedBelow
   * in skychart.ts): the stars' strength there; how far that's come on, 0
   * to 1; and how far from the view's middle it's at its full strength, and
   * gone, as the tangents of those angles. The names below the horizon go
   * with their stars.
   */
  lookedBelow: { strength: number; open: number; full: number; none: number; zoomed: number; zoomedFull: number; zoomedNone: number; lines: number };
}

/** A path, an hour dot or a marker that's behind something is drawn this strong. */
const BEHIND_ALPHA = 0.42;
/** A path is asked whether it's in open sky at points this many degrees apart, or this many pixels where that's closer (a view zoomed in). */
const BEHIND_STEP_DEG = 0.25;
const BEHIND_STEP_PX = 2.5;
/** And its strength at a point goes by this many pixels of it round the point, where that's less than BEHIND_STRETCH_DEG. */
const BEHIND_STRETCH_PX = 10;
/** Whether a point of a path is behind something goes by what most of this many degrees of the path round it is: through leaves it would flicker. */
const BEHIND_STRETCH_DEG = 1;

/** Where a line passes between open sky and behind something: the point, its time if the line's points have times, which way (`opens`: it comes out into the open), and the point just on the hidden side of it. */
export interface SkyChange {
  at: AltAz;
  t?: number;
  opens: boolean;
  behind: AltAz;
}

/**
 * Splits a line (points in order; `gap` between stretches) into what's in
 * open sky and what's behind something, by the sky map: each point by what
 * most of the BEHIND_STRETCH_DEG round it is.
 */
export function splitBySky(
  points: AltAz[],
  isGap: (p: AltAz) => boolean,
  gapPoint: AltAz,
  open: (alt: number, az: number) => boolean,
  /**
   * How finely to ask along the piece of the line between two of its
   * points, and how much of the line round a point its strength goes by,
   * both in degrees. They're sizes on the screen at heart (a couple of
   * pixels, and a dozen), so a view that's zoomed in wants them smaller: at
   * a degree, the line changed strength well off the sky map's edge there.
   */
  stepFor: (a: AltAz, b: AltAz) => number = () => BEHIND_STEP_DEG,
  stretch = BEHIND_STRETCH_DEG,
): { clear: AltAz[]; behind: AltAz[]; changes: SkyChange[] } {
  const clear: AltAz[] = [];
  const behind: AltAz[] = [];
  const changes: SkyChange[] = [];
  const timeOf = (p: AltAz) => (p as Partial<Sample>).t;
  let start = 0;
  while (start < points.length) {
    while (start < points.length && isGap(points[start])) start++;
    let end = start;
    while (end < points.length && !isGap(points[end])) end++;
    if (end - start >= 2) {
      // The stretch, at points close enough together to find where it goes behind something.
      const fine: AltAz[] = [points[start]];
      const along: number[] = [0];
      for (let i = start; i + 1 < end; i++) {
        const a = points[i];
        const b = points[i + 1];
        const daz = ((b.az - a.az + 540) % 360) - 180;
        const apart = Math.hypot(b.alt - a.alt, daz * Math.cos((a.alt * Math.PI) / 180));
        const pieces = Math.max(1, Math.ceil(apart / stepFor(a, b)));
        const ta = timeOf(a);
        const tb = timeOf(b);
        for (let k = 1; k <= pieces; k++) {
          const between: AltAz & { t?: number } = { alt: a.alt + ((b.alt - a.alt) * k) / pieces, az: (a.az + (daz * k) / pieces + 360) % 360 };
          // (Where the line's points have a time, so do those between them: for saying when it goes behind something.)
          if (ta !== undefined && tb !== undefined) between.t = ta + ((tb - ta) * k) / pieces;
          fine.push(k === pieces ? b : between);
          along.push(along[along.length - 1] + apart / pieces);
        }
      }
      const asked = fine.map((p) => open(p.alt, p.az));
      // Each point goes by how much of the stretch round it is open: mostly open, it's clear; mostly not, it's behind;
      // and in between it stays as the point before it was. So a wire doesn't dim a path, and scraps of sky through
      // leaves don't light it up.
      const inOpen: boolean[] = [];
      for (let i = 0, from = 0, to = 0; i < fine.length; i++) {
        while (along[i] - along[from] > stretch / 2) from++;
        while (to + 1 < fine.length && along[to + 1] - along[i] <= stretch / 2) to++;
        let count = 0;
        for (let k = from; k <= to; k++) if (asked[k]) count++;
        const share = count / (to - from + 1);
        inOpen.push(share > 0.55 ? true : share < 0.45 ? false : i > 0 ? inOpen[i - 1] : asked[i]);
      }
      for (let i = 0; i < fine.length; i++) {
        const list = inOpen[i] ? clear : behind;
        list.push(fine[i]);
        if (i + 1 < fine.length && inOpen[i + 1] !== inOpen[i]) {
          // (Both get the point where it changes, so they meet with no hole.)
          list.push(fine[i + 1], gapPoint);
          changes.push({ at: fine[i + 1], t: timeOf(fine[i + 1]), opens: inOpen[i + 1], behind: inOpen[i] ? fine[i + 1] : fine[i] });
        }
      }
      clear.push(gapPoint);
      behind.push(gapPoint);
    }
    start = end;
  }
  return { clear, behind, changes };
}

interface MarkerEls {
  root: HTMLButtonElement;
  dot: HTMLSpanElement;
}

export class Overlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLDivElement;
  private markers = new Map<BodyId, MarkerEls>();
  private hourLabels = new Map<string, string>();
  /** The sky map for the frame being drawn, if it's on. */
  private sky: RenderInput['sky'] = null;
  /** The skyline times of the paths drawn so far this frame, each with its path's colour (see skyTimeLabels). */
  private skyTimes: { label: SkyTimeLabel; color: string }[] = [];

  /**
   * What's written on the canvas that can be pressed, this frame: an
   * object's name along its path (turns to it and follows it, as its marker
   * does), and its times above the horizon (go to that time, following the
   * object). The canvas itself takes no presses, so each has an unseen
   * button laid over it in the markers' layer: a press there is the
   * object's, and doesn't reach Street View (where it would be a step along
   * the street).
   */
  private hits: { box: Box; id: BodyId; t?: number; says: string }[] = [];
  private hitEls: HTMLButtonElement[] = [];

  constructor(
    container: HTMLElement,
    private onSelect: (id: BodyId) => void,
    private onJump: (t: number, id: BodyId) => void = () => {},
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.layer = document.createElement('div');
    this.layer.className = 'overlay-markers';
    container.append(this.canvas, this.layer);
    this.ctx = this.canvas.getContext('2d')!;
  }

  render({ cam, data, time, bodies, tz, sky = null, names = null }: RenderInput): void {
    this.sky = sky;
    this.skyTimes = [];
    this.hits = [];
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cam.width * dpr);
    const h = Math.round(cam.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cam.width, cam.height);

    // (Under everything else: a path's own labels are written over a star's name.)
    if (names) this.drawNames(cam, names);
    this.drawHorizon(cam);
    if (data) {
      // Rise/set labels are laid out first, since an object's own hour labels
      // give way to them, and drawn last, on top of the paths.
      const riseSet = new Map<BodyId, RiseSetLabel[]>();
      for (const id of bodies) {
        const summary = data.bodies.get(id);
        if (summary) riseSet.set(id, this.riseSetLabels(cam, summary, tz));
      }
      layoutRiseSet([...riseSet.values()].flat(), this.compassLetters(cam).map((c) => c.box));
      const riseSetBoxes = [...riseSet.values()].flat().map(riseSetBox);
      bodies.forEach((id, order) =>
        this.drawPath(cam, data, id, tz, order, time, riseSet.get(id) ?? [], riseSetBoxes),
      );
      for (const id of bodies) {
        this.drawRiseSet(riseSet.get(id) ?? [], BODY_COLOR[id]);
        // (A rise time sits above the horizon, and can be pressed; a set time sits below it, among the street.)
        for (const label of riseSet.get(id) ?? []) if (label.rising) this.hits.push({ box: riseSetBox(label), id, t: label.t, says: `Go to when ${id} rises, and follow it` });
      }
      this.drawSkyTimes();
    }
    // Last, so a compass letter stays readable over a set time that reaches it.
    this.drawCompass(cam);
    this.placeMarkers(cam, data, time, bodies);
    this.placeHits();
  }

  /** Lays an unseen button over each thing on the canvas that can be pressed (see `hits`). */
  private placeHits(): void {
    this.hits.forEach((hit, i) => {
      let el = this.hitEls[i];
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'label-hit';
        el.addEventListener('click', () => {
          const pressed = this.hits[i];
          if (!pressed) return;
          if (pressed.t === undefined) this.onSelect(pressed.id);
          else this.onJump(pressed.t, pressed.id);
        });
        this.layer.append(el);
        this.hitEls[i] = el;
      }
      const { box } = hit;
      el.style.transform = `translate(${(box.x0 - 3).toFixed(1)}px, ${(box.y0 - 3).toFixed(1)}px)`;
      el.style.width = `${(box.x1 - box.x0 + 6).toFixed(1)}px`;
      el.style.height = `${(box.y1 - box.y0 + 6).toFixed(1)}px`;
      if (el.title !== hit.says) {
        el.title = hit.says;
        el.setAttribute('aria-label', hit.says);
      }
      el.hidden = false;
    });
    for (let i = this.hits.length; i < this.hitEls.length; i++) this.hitEls[i].hidden = true;
  }

  /**
   * The chart's names: the brightest stars', the constellations' and the
   * objects' (each of those with a small ring where it is). More of them as
   * the sky darkens and the view closes in; each as strong as the chart is
   * where it stands, so dimmed behind a building like the star it names; and
   * the less important left out where two would sit on each other.
   */
  private drawNames(cam: Camera, names: ChartNames): void {
    const ctx = this.ctx;
    const closer = Math.max(0, Math.log2(90 / cam.hfov));
    const dark = Math.max(0, Math.min(1, (names.faintest - 2.5) / 2));
    const wanted = names.labels
      .filter((l) => {
        if (l.what === 'star') return l.magnitude <= Math.min(names.faintest - 0.6, STAR_NAMES_TO + STAR_NAMES_PER_ZOOM * closer);
        // (A constellation none of whose stars is showing isn't named: its lines aren't drawn either.)
        if (l.what === 'constellation') return dark > 0 && cam.hfov >= CONSTELLATION_NAMES_FROM_HFOV && l.magnitude <= names.faintest;
        return dark > 0 && l.magnitude <= OBJECT_NAMES_TO + OBJECT_NAMES_PER_ZOOM * closer;
      })
      // The brightest stars first, then the objects, then the constellations: what's placed first keeps its place.
      .sort((a, b) => rank(a) - rank(b) || a.magnitude - b.magnitude);
    const placed: Box[] = [];
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of wanted) {
      const open = this.sky ? this.sky.at(l.alt, l.az) > 0 : false;
      // (Below the horizon, as the chart has it: stronger towards the middle of a view that's turned down under it.)
      // (And over buildings, up to full strength there as the view is zoomed in a little.)
      const { strength: lookedAt, open: lookedOpen, full, none, zoomed, zoomedFull, zoomedNone } = names.lookedBelow;
      const out = Math.hypot(l.px - cam.width / 2, l.py - cam.height / 2) / focalLength(cam);
      const through = (from: number, to: number) => {
        const edge = Math.max(0, Math.min(1, (out - from) / (to - from)));
        return 1 - edge * edge * (3 - 2 * edge);
      };
      const below = names.strength[2] + (lookedAt - names.strength[2]) * lookedOpen * through(full, none);
      const behind = names.strength[1] + (1 - names.strength[1]) * zoomed * through(zoomedFull, zoomedNone);
      // A constellation's name goes with its lines, not its stars: none below the horizon but through the porthole, and
      // none over buildings in a view at its widest, coming in there (all across the view) as the lines do with the zoom.
      const constellationBelow = lookedAt * lookedOpen * through(full, none);
      const constellationBehind = names.strength[0] * names.lookedBelow.lines;
      const strength =
        l.what === 'constellation'
          ? l.alt <= 0
            ? constellationBelow
            : open
              ? names.strength[0]
              : constellationBehind
          : l.alt <= 0
            ? below
            : open
              ? names.strength[0]
              : behind;
      const alpha = strength * names.night * (l.what === 'star' ? 0.9 : l.what === 'constellation' ? 0.6 * dark : 0.8 * dark);
      if (alpha < 0.06) continue;
      const constellation = l.what === 'constellation';
      const text = constellation ? l.text.toUpperCase() : l.text;
      ctx.font = constellation ? CONSTELLATION_FONT : NAME_FONT;
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = constellation ? '1.5px' : '0px';
      const width = ctx.measureText(text).width;
      const x = constellation ? l.px - width / 2 : l.px + (l.what === 'star' ? 8 : 9);
      const box = { x0: x, y0: l.py - 7, x1: x + width, y1: l.py + 7 };
      if (placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);
      ctx.globalAlpha = alpha;
      if (l.what !== 'star' && !constellation) {
        // A ring where the object is, a little bigger for one that's wide in the sky.
        ctx.beginPath();
        ctx.arc(l.px, l.py, Math.max(3.5, Math.min(14, (l.size / 60) * (cam.width / cam.hfov) * 0.5)), 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = OBJECT_COLOR;
        ctx.stroke();
      }
      ctx.textAlign = 'left';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(4, 8, 20, 0.7)';
      ctx.strokeText(text, x, l.py);
      ctx.fillStyle = constellation ? CONSTELLATION_COLOR : l.what === 'star' ? '#e9eefc' : OBJECT_COLOR;
      ctx.fillText(text, x, l.py);
    }
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
    ctx.restore();
  }

  private drawHorizon(cam: Camera): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    this.strokePolyline(cam, (i) => (i <= 360 ? { alt: 0, az: i } : null));

    // Tick marks every 5°, except where a compass letter goes.
    ctx.lineWidth = 1;
    for (let az = 0; az < 360; az += 5) {
      if (az % 45 === 0) continue;
      const p = project(0, az, cam);
      if (p.z < MIN_DEPTH || !p.visible) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + (az % 15 === 0 ? 7 : 4));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The compass letters in view: where each is centred, and the box it fills. */
  private compassLetters(cam: Camera): { text: string; x: number; y: number; box: Box }[] {
    const ctx = this.ctx;
    const out: { text: string; x: number; y: number; box: Box }[] = [];
    ctx.save();
    ctx.font = COMPASS_FONT;
    for (let az = 0; az < 360; az += 45) {
      const p = project(0, az, cam);
      if (p.z < MIN_DEPTH || !p.visible) continue;
      const text = COMPASS[az / 45];
      const half = ctx.measureText(text).width / 2;
      const y = p.y + 6;
      out.push({ text, x: p.x, y, box: { x0: p.x - half, y0: y, x1: p.x + half, y1: y + 14 } });
    }
    ctx.restore();
    return out;
  }

  /** Compass letters just below the horizon line. */
  private drawCompass(cam: Camera): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    ctx.font = COMPASS_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.fillStyle = '#fff';
    for (const letter of this.compassLetters(cam)) {
      ctx.strokeText(letter.text, letter.x, letter.y);
      ctx.fillText(letter.text, letter.x, letter.y);
    }
    ctx.restore();
  }

  /** Strokes a polyline, breaking it wherever points fall behind the camera. */
  private strokePolyline(cam: Camera, point: (i: number) => { alt: number; az: number } | null): void {
    const ctx = this.ctx;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; ; i++) {
      const pt = point(i);
      if (!pt) break;
      const p = project(pt.alt, pt.az, cam);
      // Negated so NaN gap points also lift the pen.
      if (!(p.z >= MIN_DEPTH)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
  }

  /** A small ">" at `from`, pointing toward `to`, in the current stroke colour. */
  private drawChevron(cam: Camera, from: AltAz, to: AltAz): void {
    const p = project(from.alt, from.az, cam);
    const q = project(to.alt, to.az, cam);
    if (p.z < MIN_DEPTH || q.z < MIN_DEPTH || !p.visible) return;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length < 1e-6) return;
    const ux = (q.x - p.x) / length;
    const uy = (q.y - p.y) / length;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Two wings back from the tip, either side of the line.
    ctx.moveTo(p.x - ux * CHEVRON_SIZE - uy * CHEVRON_SIZE, p.y - uy * CHEVRON_SIZE + ux * CHEVRON_SIZE);
    ctx.lineTo(p.x + ux * CHEVRON_SIZE * 0.6, p.y + uy * CHEVRON_SIZE * 0.6);
    ctx.lineTo(p.x - ux * CHEVRON_SIZE + uy * CHEVRON_SIZE, p.y - uy * CHEVRON_SIZE - ux * CHEVRON_SIZE);
    ctx.stroke();
    ctx.restore();
  }

  private drawPath(
    cam: Camera,
    data: NightData,
    id: BodyId,
    tz: string,
    order: number,
    time: number,
    riseSet: RiseSetLabel[],
    riseSetBoxes: Box[],
  ): void {
    const summary = data.bodies.get(id);
    if (!summary) return;
    const s = summary.path;
    const ctx = this.ctx;
    const color = BODY_COLOR[id];
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Bold only where the body is up and the sky isn't in daylight (the sun's
    // own path is bold whenever it's up); everything else faint and dashed.
    const bold = s.map((x) => x.bold);

    // Each end of the path runs on past its cycle, into the previous and next
    // day's track (see NightSummary.pathOverlap). Those stretches fade out,
    // so the two ends pass alongside each other at their true offset: a few
    // degrees for the Moon, whose track shifts daily; none to speak of for
    // the planets, whose ends then read as one continuous line. Usually the
    // ends are below the horizon and dashed; for an object that never sets
    // they're up in the sky and solid, and fade just the same.
    const fade = Math.min(summary.pathOverlap, Math.floor((s.length - 1) / 2));
    const firstFull = fade;
    const lastFull = s.length - 1 - fade;

    // The part between the fading ends, split into solid and dashed runs at
    // the exact point each change happens (the horizon crossing, or
    // sunset/sunrise), not at the nearest sample: both runs get that point,
    // so they meet with no hole and no overshoot.
    const solid: AltAz[] = [];
    const faint: AltAz[] = [];
    for (let i = firstFull; i <= lastFull; i++) {
      const cur = s[i];
      (cur.bold ? solid : faint).push(cur);
      const next = i < lastFull ? s[i + 1] : undefined;
      if (!next) {
        (cur.bold ? solid : faint).push(gap);
      } else if (next.bold !== cur.bold) {
        const edge = boldBoundary(cur, next);
        (cur.bold ? solid : faint).push(edge, gap);
        (cur.bold ? faint : solid).push(edge);
      }
    }
    const strong = (i: number) => (i < solid.length ? solid[i] : null);
    const strokeSolid = (point: (i: number) => AltAz | null) => {
      ctx.setLineDash([]);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      this.strokePolyline(cam, point);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      this.strokePolyline(cam, point);
    };
    const strokeDashed = (point: (i: number) => AltAz | null) => {
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      this.strokePolyline(cam, point);
    };

    ctx.globalAlpha = FAINT_ALPHA;
    strokeDashed((i) => (i < faint.length ? faint[i] : null));

    // The fading ends, a step at a time, dimmer toward the tip, each step in
    // the style of the path there. (Square-ended steps: round ends would
    // overlap at the joins and show as beads.)
    ctx.lineCap = 'butt';
    for (let j = 0; j < fade; j++) {
      const strength = (j + 0.5) / fade;
      for (const [a, b] of [
        [s[j], s[j + 1]],
        [s[s.length - 1 - j], s[s.length - 2 - j]],
      ]) {
        const step = (i: number) => (i === 0 ? a : i === 1 ? b : null);
        if (a.bold && b.bold) {
          ctx.globalAlpha = strength;
          strokeSolid(step);
        } else {
          ctx.globalAlpha = FAINT_ALPHA * strength;
          strokeDashed(step);
        }
      }
    }
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    // One small chevron midway along the earlier fading end, pointing the way
    // the object travels. (The later end runs the same way, so one is enough.)
    if (fade > 1) {
      const half = Math.floor(fade / 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.globalAlpha = CHEVRON_ALPHA;
      this.drawChevron(cam, s[half], s[half + 1]);
    }

    // The solid part, at full strength in open sky and dimmed where it's behind a building or a tree. (Dashed says "not
    // up, or not dark"; dimmed says "up, and behind something".)
    const sky = this.sky;
    /** When this path comes out from behind the skyline and goes behind it, where those are on screen (see skyTimeLabels). */
    let skyTimes: SkyTimeLabel[] = [];
    if (sky) {
      // (Asked every couple of pixels where the line is on screen, and its strength by what most of a dozen pixels of it
      // is: so it changes at the sky map's edge at any zoom. Off screen, coarsely: nothing of it shows.)
      const pxPerDeg = (focalLength(cam) * Math.PI) / 180;
      const fine = Math.max(0.01, Math.min(BEHIND_STEP_DEG, BEHIND_STEP_PX / pxPerDeg));
      const onScreen = (p: AltAz) => {
        const at = project(p.alt, p.az, cam);
        return at.z >= MIN_DEPTH && at.x > -cam.width / 2 && at.x < cam.width * 1.5 && at.y > -cam.height / 2 && at.y < cam.height * 1.5;
      };
      const { clear, behind, changes } = splitBySky(
        solid,
        (p) => p === gap,
        gap,
        (alt, az) => sky.at(alt, az) > 0,
        (a, b) => (onScreen(a) || onScreen(b) ? fine : BEHIND_STEP_DEG),
        Math.max(4 * fine, Math.min(BEHIND_STRETCH_DEG, BEHIND_STRETCH_PX / pxPerDeg)),
      );
      ctx.globalAlpha = BEHIND_ALPHA;
      strokeSolid((i) => (i < behind.length ? behind[i] : null));
      ctx.globalAlpha = 1;
      strokeSolid((i) => (i < clear.length ? clear[i] : null));
      skyTimes = this.skyTimeLabels(cam, changes, tz, [...riseSetBoxes, ...this.skyTimes.map((s) => skyTimeBox(s.label))]);
      for (const label of skyTimes) {
        this.skyTimes.push({ label, color });
        this.hits.push({ box: skyTimeBox(label), id, t: label.t, says: `Go to when ${id} ${label.opens ? 'comes out from behind the skyline' : 'goes behind the skyline'}, and follow it` });
      }
    } else {
      ctx.globalAlpha = 1;
      strokeSolid(strong);
    }

    // Hour ticks. The window starts at local noon and paths share its time
    // grid, so whole hours from the window start are whole local hours.
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // This object's rise/set times take precedence over its own hour labels:
    // where they'd overlap, the dot stays and the hour text is left out.
    // Zooming in spreads them apart, and both show again.
    const reserved = [...riseSet.map(riseSetBox), ...skyTimes.map(skyTimeBox)];
    let lastLabel: { x: number; y: number } | null = null;
    // (Not on the fading ends: those hours belong to the day before and after.)
    for (let i = firstFull; i <= lastFull; i++) {
      const sample = s[i];
      if ((sample.t - data.start.getTime()) % HOUR !== 0 || !bold[i]) continue;
      const p = project(sample.alt, sample.az, cam);
      if (p.z < MIN_DEPTH || !p.visible) continue;
      // (Dimmed with its stretch of the path, where that's behind something.)
      ctx.globalAlpha = sky && sky.at(sample.alt, sample.az) <= 0 ? BEHIND_ALPHA : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
      if (lastLabel && Math.hypot(p.x - lastLabel.x, p.y - lastLabel.y) < 44) continue;
      const text = this.hourLabel(sample.t, tz);
      const box = { x0: p.x - 4, y0: p.y - 7, x1: p.x + 7 + ctx.measureText(text).width, y1: p.y + 7 };
      if (reserved.some((r) => overlaps(box, r))) continue;
      ctx.lineWidth = 3;
      ctx.strokeText(text, p.x + 7, p.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, p.x + 7, p.y);
      lastLabel = p;
      // (Pressed, the hour and its dot go to that time, on this object.)
      this.hits.push({ box, id, t: sample.t, says: `Go to ${text}, and follow ${id}` });
    }
    ctx.globalAlpha = 1;

    this.drawPathName(cam, id, order, solid, interpolate(summary.samples, time), [...riseSetBoxes, ...this.skyTimes.map((s) => skyTimeBox(s.label))]);
    ctx.restore();
  }

  /**
   * The times a path comes out from behind the skyline (an open eye) and
   * goes behind it (a closed one), by the sky map: each to the right of
   * where the path crosses the sky map's edge, like a rise or set time at
   * the horizon. Coming out sits just above the crossing, going behind just
   * below. One that would sit on another label slides right, a little way;
   * if that isn't enough it's left out.
   *
   * Not where the sky on the hidden side hasn't been looked at (that's the
   * edge of what's known, not a skyline); and not for a stretch too short
   * to read, as through leaves or past a pole.
   */
  private skyTimeLabels(cam: Camera, changes: SkyChange[], tz: string, taken: Box[]): SkyTimeLabel[] {
    const sky = this.sky;
    const ctx = this.ctx;
    const at = changes.map((c) => project(c.at.alt, c.at.az, cam));
    const out: SkyTimeLabel[] = [];
    const placed = [...taken];
    ctx.save();
    ctx.font = LABEL_FONT;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const p = at[i];
      // (A change and the one after it close together on screen are the two ends of a short stretch: neither is said.)
      const next = at[i + 1];
      if (next && p.z >= MIN_DEPTH && next.z >= MIN_DEPTH && Math.hypot(next.x - p.x, next.y - p.y) < SKY_TIME_MIN_STRETCH_PX) {
        i++;
        continue;
      }
      if (change.t === undefined || p.z < MIN_DEPTH || !p.visible) continue;
      if (sky?.known && !sky.known(change.behind.alt, change.behind.az)) continue;
      const text = formatClock(new Date(change.t), tz);
      const label: SkyTimeLabel = {
        text,
        t: change.t,
        opens: change.opens,
        x0: p.x + RISE_SET_GAP,
        top: change.opens ? p.y - RISE_ABOVE - LABEL_HEIGHT : p.y + SET_BELOW,
        width: SKY_TIME_ICON_PX + 3 + ctx.measureText(text).width,
      };
      const from = label.x0;
      let clear = false;
      for (let guard = 0; guard < 8 && !clear; guard++) {
        const box = skyTimeBox(label);
        const hit = placed.find((o) => overlaps(box, o));
        if (!hit) clear = true;
        else label.x0 = hit.x1 + RISE_SET_ADJACENT;
      }
      if (!clear || label.x0 - from > SKY_TIME_MAX_SLIDE_PX) continue;
      placed.push(skyTimeBox(label));
      out.push(label);
    }
    ctx.restore();
    return out;
  }

  /** Draws the skyline times where skyTimeLabels put them: an eye, open or closed, and the time, in each path's colour. */
  private drawSkyTimes(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const { label, color } of this.skyTimes) {
      const x = label.x0;
      const y = label.top + LABEL_HEIGHT / 2;
      const eye = new Path2D();
      if (label.opens) {
        // An open eye: two lids, and the pupil (filled below).
        eye.moveTo(x + 0.5, y);
        eye.quadraticCurveTo(x + 5.75, y - 6, x + 11, y);
        eye.quadraticCurveTo(x + 5.75, y + 6, x + 0.5, y);
      } else {
        // A closed one: the lower lid, and three lashes.
        eye.moveTo(x + 0.5, y - 1);
        eye.quadraticCurveTo(x + 5.75, y + 4.5, x + 11, y - 1);
        eye.moveTo(x + 2.8, y + 1.7);
        eye.lineTo(x + 1.9, y + 4.2);
        eye.moveTo(x + 5.75, y + 2.7);
        eye.lineTo(x + 5.75, y + 5.4);
        eye.moveTo(x + 8.7, y + 1.7);
        eye.lineTo(x + 9.6, y + 4.2);
      }
      const pupil = new Path2D();
      if (label.opens) pupil.arc(x + 5.75, y, 1.9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3.6;
      ctx.stroke(eye);
      ctx.stroke(pupil);
      ctx.lineWidth = 3;
      ctx.strokeText(label.text, x + SKY_TIME_ICON_PX + 3, label.top);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke(eye);
      ctx.fill(pupil);
      ctx.fillText(label.text, x + SKY_TIME_ICON_PX + 3, label.top);
    }
    ctx.restore();
  }

  /**
   * Rise (↑) and set (↓) times where the path crosses the horizon. After dark
   * these are the ends of the solid segment; a daylight rise or set is
   * labelled more faintly. Upright, in the line's colour, and to the right of
   * the crossing like the hour labels: rises just above the horizon, sets just
   * below it. layoutRiseSet then slides any that would overlap each other sideways.
   */
  private riseSetLabels(cam: Camera, summary: NightSummary, tz: string): RiseSetLabel[] {
    const s = summary.path;
    const ctx = this.ctx;
    const out: RiseSetLabel[] = [];
    ctx.save();
    ctx.font = LABEL_FONT;
    // Not on the path's fading ends (see drawPath): a crossing there belongs
    // to the day before or after.
    const fade = Math.min(summary.pathOverlap, Math.floor((s.length - 1) / 2));
    for (let i = fade; i + 1 < s.length - fade; i++) {
      const a = s[i];
      const b = s[i + 1];
      const rising = a.alt <= 0 && b.alt > 0;
      const setting = a.alt > 0 && b.alt <= 0;
      if (!rising && !setting) continue;

      // Where and when the path crosses altitude 0, between the two samples.
      const f = a.alt / (a.alt - b.alt);
      const daz = ((b.az - a.az + 540) % 360) - 180;
      const p = project(0, a.az + f * daz, cam);
      if (p.z < MIN_DEPTH || !p.visible) continue;

      // Prefer the card's exact time (for the Sun and Moon that's the upper
      // limb, a minute or two from where the centre crosses).
      const crossing = a.t + f * (b.t - a.t);
      const exact = rising ? summary.rise : summary.set;
      const when = exact && Math.abs(exact.getTime() - crossing) < 10 * 60000 ? exact : new Date(crossing);
      const text = `${rising ? '↑' : '↓'} ${formatClock(when, tz)}`;

      // The path passes through the label's strip on its way from the
      // horizon: rising, the climbing line; setting, its dashed continuation
      // underground. Start the label the same distance from that line
      // whichever way it leans, measured where the two come closest: at the
      // strip's far edge if the line leans right (as for northern observers),
      // so the label clears it; at its near edge if the line leans away left.
      const along = s[Math.min(i + 4, s.length - 1)]; // a little further along, on the label's side
      const q = project(along.alt, along.az, cam);
      const near = rising ? RISE_ABOVE : SET_BELOW;
      const vertical = Math.abs(q.y - p.y);
      const lean = q.z >= MIN_DEPTH && vertical > 1 ? (q.x - p.x) / vertical : 0;
      const clear = Math.max(-MAX_LEAN_SHIFT, Math.min(lean * (lean > 0 ? near + LABEL_HEIGHT : near), MAX_LEAN_SHIFT));

      const w = ctx.measureText(text).width;
      out.push({
        text,
        t: when.getTime(),
        rising,
        faint: !(rising ? b : a).bold,
        // To the right of the crossing, like the hour labels.
        x0: p.x + clear + RISE_SET_GAP,
        width: w,
        horizonY: p.y,
      });
    }
    ctx.restore();
    return out;
  }

  /** Draws rise/set labels where layoutRiseSet put them. */
  private drawRiseSet(labels: RiseSetLabel[], color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    // Round joins: the default mitred outline spikes out of sharp corners like the M's.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = color;
    for (const label of labels) {
      const box = riseSetBox(label);
      ctx.globalAlpha = label.faint ? 0.6 : 1;
      ctx.strokeText(label.text, box.x0, box.y0);
      ctx.fillText(label.text, box.x0, box.y0);
    }
    ctx.restore();
  }

  /**
   * Names the solid part of the path, written along it like a road name on a
   * map. The name holds a fixed position across the screen, toward the left,
   * and slides along its line as the view pans. Each object gets its own
   * guide so that near-parallel paths (the planets share the ecliptic) step
   * their names instead of stacking.
   */
  private drawPathName(
    cam: Camera,
    id: BodyId,
    order: number,
    solid: AltAz[],
    pos: AltAz | null,
    riseSetBoxes: Box[],
  ): void {
    const pts = solid.map((x) => {
      if (x === gap) return null;
      const p = project(x.alt, x.az, cam);
      return p.z >= MIN_DEPTH ? p : null;
    });
    const guideX = cam.width * (0.08 + 0.07 * (order % 6));
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '700 11px system-ui, sans-serif';
    const width = ctx.measureText(id).width;

    // Where the name goes for a given anchor on the line.
    const place = (anchor: LabelAnchor) => {
      // Run rightward from the anchor, unless that would carry the text past
      // the end of the visible path.
      const alignRight = anchor.x + width * Math.cos(anchor.angle) > anchor.maxX + 4;
      // Hour labels sit to the right of their dots, so the name takes the
      // left side of the line: above a line climbing to the right, below one
      // descending to the right.
      const below = anchor.angle > 0;
      // The slanted rectangle the text occupies: its corners on screen.
      const x0 = alignRight ? -width : 0;
      const y0 = below ? NAME_OFFSET : -NAME_OFFSET - LABEL_HEIGHT;
      const cos = Math.cos(anchor.angle);
      const sin = Math.sin(anchor.angle);
      const corners = [
        [x0, y0],
        [x0 + width, y0],
        [x0 + width, y0 + LABEL_HEIGHT],
        [x0, y0 + LABEL_HEIGHT],
      ].map(([x, y]): Point => ({ x: anchor.x + x * cos - y * sin, y: anchor.y + x * sin + y * cos }));
      return { alignRight, below, corners };
    };

    // Slide to the guide; then, if the name would sit on a rise or set time,
    // nudge it up the line a little at a time until it's clear. The test uses
    // the slanted rectangle itself: an upright box around diagonal text is
    // mostly empty corners, and would nudge names that have plenty of room.
    const onRiseSet = (a: LabelAnchor) => riseSetBoxes.some((b) => slantedHitsBox(place(a).corners, b, 2));
    let anchor = lineLabelAnchor(pts, guideX, cam.width, cam.height);
    for (let tries = 0; anchor && tries < 16 && onRiseSet(anchor); tries++) {
      anchor = lineLabelAnchor(pts, guideX, cam.width, cam.height, 24, anchor.y - 5);
    }
    // The object's own floating label: a name right beside it would be redundant.
    // Only while the object is up, and so on this solid line: below the
    // horizon its marker is on the dashed part, and the line still wants a name.
    const m = pos && pos.alt > 0 && project(pos.alt, pos.az, cam);
    const redundant = anchor && m && m.z >= MIN_DEPTH && Math.hypot(m.x - anchor.x, m.y - anchor.y) < NAME_CLEARANCE;
    if (!anchor || redundant) {
      ctx.restore();
      return;
    }

    const { alignRight, below, corners } = place(anchor);
    // (Pressed, the name turns the view to its object and follows it, as the object's marker does. The upright box
    // round the slanted name.)
    this.hits.push({
      box: { x0: Math.min(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), x1: Math.max(...corners.map((c) => c.x)), y1: Math.max(...corners.map((c) => c.y)) },
      id,
      says: `Turn to ${id}, and follow it`,
    });
    ctx.translate(anchor.x, anchor.y);
    ctx.rotate(anchor.angle);
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.textBaseline = below ? 'top' : 'bottom';
    const offset = below ? NAME_OFFSET : -NAME_OFFSET;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(id, 0, offset);
    ctx.fillStyle = BODY_COLOR[id];
    ctx.fillText(id, 0, offset);
    ctx.restore();
  }

  private hourLabel(t: number, tz: string): string {
    const key = `${tz}|${t}`;
    let label = this.hourLabels.get(key);
    if (!label) {
      if (this.hourLabels.size > 2000) this.hourLabels.clear();
      label = formatHour(new Date(t), tz);
      this.hourLabels.set(key, label);
    }
    return label;
  }

  private marker(id: BodyId): MarkerEls {
    let m = this.markers.get(id);
    if (!m) {
      const root = document.createElement('button');
      root.type = 'button';
      root.className = 'marker';
      root.style.setProperty('--c', BODY_COLOR[id]);
      const dot = document.createElement('span');
      dot.className = 'marker-dot';
      const label = document.createElement('span');
      label.className = 'marker-label';
      label.textContent = id;
      root.append(dot, label);
      root.addEventListener('click', () => this.onSelect(id));
      this.layer.append(root);
      m = { root, dot };
      this.markers.set(id, m);
    }
    return m;
  }

  private placeMarkers(cam: Camera, data: NightData | null, time: number, bodies: BodyId[]): void {
    const shown = new Set<BodyId>();
    const date = new Date(time);
    for (const id of bodies) {
      const pos = data && interpolate(data.bodies.get(id)?.samples ?? [], time);
      if (!pos) continue;
      const m = this.marker(id);
      const p = project(pos.alt, pos.az, cam);
      const below = pos.alt <= 0;
      const onScreen = p.z >= MIN_DEPTH && p.visible;
      // Off-screen arrows only for bodies that are up, to limit clutter.
      if (!onScreen && below) continue;
      shown.add(id);

      const size = markerSize(id, date);
      m.dot.style.width = m.dot.style.height = `${size}px`;
      m.root.classList.toggle('below', below);
      m.root.classList.toggle('offscreen', !onScreen);
      // Up, on screen, and behind a building or a tree: dimmed, and still there to be pressed.
      m.root.classList.toggle('behind', !!this.sky && !below && onScreen && this.sky.at(pos.alt, pos.az) <= 0);
      const where = `altitude ${pos.alt.toFixed(0)}°, azimuth ${pos.az.toFixed(0)}°`;
      if (onScreen) {
        m.root.style.transform = `translate(${p.x}px, ${p.y}px)`;
        // Keep labels inside the viewport near the right edge.
        m.root.classList.toggle('label-left', p.x > cam.width - 90);
        m.root.style.removeProperty('--angle');
        m.root.setAttribute('aria-label', `${id}, ${where}${below ? ', below horizon' : ''}. Centre view`);
      } else {
        const e = edgeIndicator(pos.alt, pos.az, cam, 28);
        m.root.style.transform = `translate(${e.x}px, ${e.y}px)`;
        m.root.style.setProperty('--angle', `${e.angle}rad`);
        m.root.classList.remove('label-left');
        m.root.setAttribute('aria-label', `${id} is out of view, ${where}. Turn to face it`);
      }
      m.root.hidden = false;
    }
    for (const [id, m] of this.markers) if (!shown.has(id)) m.root.hidden = true;
  }
}

const gap = { alt: NaN, az: NaN };

/** Opacity of the dashed (daylight or below-horizon) part of a path. */
const FAINT_ALPHA = 0.35;
/** The direction chevron on a path's earlier fading end: a little stronger than the line, and small. */
const CHEVRON_ALPHA = 0.5;
const CHEVRON_SIZE = 4.5;

function markerSize(id: BodyId, date: Date): number {
  if (id === 'Sun') return 26;
  if (id === 'Moon') return 22;
  return Math.max(7, Math.min(18, 12 - 2 * magnitude(id, date)));
}
