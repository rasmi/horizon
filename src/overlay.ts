import {
  BODY_COLOR,
  boldBoundary,
  interpolate,
  magnitude,
  type AltAz,
  type BodyId,
  type NightData,
  type NightSummary,
} from './astro';
import { edgeIndicator, lineLabelAnchor, project, type Camera, type LabelAnchor } from './projection';
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

export interface RenderInput {
  cam: Camera;
  data: NightData | null;
  time: number;
  bodies: BodyId[];
  tz: string;
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

  constructor(
    container: HTMLElement,
    private onSelect: (id: BodyId) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.layer = document.createElement('div');
    this.layer.className = 'overlay-markers';
    container.append(this.canvas, this.layer);
    this.ctx = this.canvas.getContext('2d')!;
  }

  render({ cam, data, time, bodies, tz }: RenderInput): void {
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
      for (const id of bodies) this.drawRiseSet(riseSet.get(id) ?? [], BODY_COLOR[id]);
    }
    // Last, so a compass letter stays readable over a set time that reaches it.
    this.drawCompass(cam);
    this.placeMarkers(cam, data, time, bodies);
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

    ctx.globalAlpha = 1;
    strokeSolid(strong);

    // Hour ticks. The window starts at local noon and paths share its time
    // grid, so whole hours from the window start are whole local hours.
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // This object's rise/set times take precedence over its own hour labels:
    // where they'd overlap, the dot stays and the hour text is left out.
    // Zooming in spreads them apart, and both show again.
    const reserved = riseSet.map(riseSetBox);
    let lastLabel: { x: number; y: number } | null = null;
    // (Not on the fading ends: those hours belong to the day before and after.)
    for (let i = firstFull; i <= lastFull; i++) {
      const sample = s[i];
      if ((sample.t - data.start.getTime()) % HOUR !== 0 || !bold[i]) continue;
      const p = project(sample.alt, sample.az, cam);
      if (p.z < MIN_DEPTH || !p.visible) continue;
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
    }

    this.drawPathName(cam, id, order, solid, interpolate(summary.samples, time), riseSetBoxes);
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
    for (let i = 0; i + 1 < s.length; i++) {
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

    const { alignRight, below } = place(anchor);
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
