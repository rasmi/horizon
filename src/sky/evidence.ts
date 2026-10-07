import type { Camera } from '../projection';
import { ALT_BOTTOM, ALT_TOP, binsInView, sampleColumn, sampleMap, viewGeometry, type ViewColumn } from './geometry';
import type { RawMap } from './types';

// The sky around one panorama as a grid: for every direction and altitude,
// what the looks so far make of it, sky or solid.
//
// It's what lets the sky map outlast the frame: what was found is still
// there when the view turns away and back, or zooms. Each look at a spot is
// set against the looks before it, by how good a view each had:
//
// - The looks are ranked. A look stands for a cell by how close the view is
//   and how near the middle of its frame it has the cell. It may change what
//   a cell is held to be only if it stands about as well as the best look
//   there's been of it. So turning away from a thing, or zooming out from
//   it, doesn't change it, and zooming in on it puts a mistake right.
// - A look at rest that ranks is weighed against the rests before it (a
//   rest: the looks at a view that has stopped, one after another), and
//   doesn't decide a cell alone. One look from as good a view can't turn
//   what a rest found; the second look of that rest can; a clearly better
//   view turns it at once.
// - Looks on the move leave alone what a rest has settled. Elsewhere they
//   fill at once the sky they're sure of, so that the sky a turning view
//   brings in is there as it arrives, and otherwise add up as odds.
//
// The sky map itself is made from these cells in fill.ts.

const RAD = Math.PI / 180;

/** A score, 0 to 1, as it's kept for a cell: a byte. */
const asByte = (score: number) => Math.round(Math.min(1, Math.max(0, score)) * 255);

/** A model's "certainly" is taken as no more than this many units of evidence, so no one look on the move settles a cell. */
const MAX_STEP = 3;
/** A cell's evidence stops accumulating here, so it can still be argued out of a mistake. */
const MAX_EVIDENCE = 24;
/** A still frame of a view this wide is worth 1; narrower (zoomed in) is worth more, up to MAX_WORTH. */
const WIDE_VIEW_DEG = 90;
const MAX_WORTH = 2;
/** A frame this good or better (its worth, before zoom) is a still one: see `viewQuality` in geometry.ts. */
const STILL_FROM = 0.8;
/** What a frame's say is worth at its left and right edges, against 1 at its middle: a model has less to go on where what it's looking at is cut off. */
const SIDE_WORTH = 0.3;
/**
 * A direction has been looked at enough once its looks come to this: each
 * counts for what it's worth there (1 for a still frame's middle, 0.6 for a
 * moving one's, less towards a frame's sides).
 */
const SETTLED = 2;
/** A look counts as closer than what a direction has had if the model's cells are under this share of the size. */
const CLOSER = 0.8;
/**
 * Where a look at rest is weighed against the rests before it, it counts
 * for this power of how well it stands. Cubed, a view half as close again
 * counts for three times as much and more, and a look with the cell well
 * out from the middle of its frame for a small share of one that has it
 * dead centre.
 */
const PLACE_POWER = 3;
/**
 * A cell remembers no more than this many times what the best look it's had
 * counted for. So one look as good as the best there's been can't turn what
 * several found, and two can.
 */
const REMEMBERS = 1.5;
/** The least a look counts for (a cell at the very edge of its frame; or solid, on the word of a look that can see no sky). Enough to answer where nothing else has, and nothing against any other look. */
const LEAST_VOTE = 1e-12;
/** What's kept of a grid (see `keep`) starts with this, and the size of the grid it's of: anything else isn't taken back. */
const KEPT_VERSION = 1;

/** The numbers the grid is kept by. Most are first guesses, settled by eye and not measured. */
export interface SkyEvidenceSettings {
  /** The size of the grid's cells, in degrees each way. (The models answer on cells of 0.7° to 1.4°: little is gained below half a degree, and every step costs in proportion to the number of cells.) */
  cellDeg: number;
  /** A frame's say fades out over this share of its height towards its top and bottom edges, where models mislabel a thin band. */
  edgeMargin: number;
  /** For looks on the move: a cell is taken for sky or for solid once its evidence is this strong one way, and stays so until it's this strong the other, so that cells whose evidence hovers about even don't flicker. */
  decidedAt: number;
  /** What a look on the move that says "not sky" counts for against a cell whose evidence for sky stands: sky that's been found isn't given up as readily as it was taken. */
  keepSky: number;
  /** A look can change what a cell is held to be, or count against it, only if it stands this good a share as well for the cell as the best look to have spoken for that. */
  asGood: number;
  /** What a look stands for at a cell out at the very edge of its frame, against one that has it in the middle. At a half, a view twice as close stands as well at its edge as the wider one does at its middle. */
  edgeStands: number;
  /** What a look on the move stands for against one at rest that has a cell as near the middle of its frame: its picture can be a frame behind, and less sharp. */
  movingStands: number;
  /**
   * A look at rest takes settled sky back only if at least this share of its
   * own frame is sky as it has it. (A model goes by what's round a point:
   * zoomed in on a pale sky with no other sky in the frame, it takes it for
   * wall.)
   */
  seesSky: number;
  /**
   * From a view narrower than `zoomedUnder` degrees across (30° is about
   * zoom 3), that share is `zoomedSeesSky`, far more: zoomed in on a patch
   * of pale sky between towers, with little other sky in the frame, a model
   * takes it for building, and the closer view would overrule the wider one
   * that had it right. With plenty of sky in the frame (a roofline against
   * it) the model has what it needs, and the closer look puts things right
   * as ever. `zoomedUnder` 0 for no such difference.
   */
  zoomedUnder: number;
  zoomedSeesSky: number;
  /** A look at rest is in doubt about a point from this score up to a half, and leaves it be. */
  unsureFrom: number;
  /** A look on the move fills at once what it scores this much or more: sky it's sure of, which plain open sky always is. */
  fillsAtOnce: number;
}
export const SKY_EVIDENCE_SETTINGS: SkyEvidenceSettings = {
  cellDeg: 0.5,
  edgeMargin: 0.02,
  decidedAt: 1,
  keepSky: 0.25,
  asGood: 0.95,
  edgeStands: 0.5,
  movingStands: 0.9,
  seesSky: 0.03,
  zoomedUnder: 30,
  zoomedSeesSky: 0.3,
  unsureFrom: 0.2,
  fillsAtOnce: 0.8,
};

/**
 * How sky-like a frame is over each cell of a column: its mean over the
 * whole cell, taken at `n` by `n` points. For a map finer than the cells (a
 * view zoomed in): a cell with the sky's edge running through it then scores
 * by how much of it is sky, and the edge can be drawn through it where it
 * lies (see fill.ts).
 */
function sampleCells(map: RawMap, column: ViewColumn, n: number, cam: Camera): number[] {
  const count = column.alts.length;
  const sky = new Array<number>(count);
  const across = cam.height / cam.width;
  for (let i = 0; i < count; i++) {
    // The cell's size on the frame: down it, as far as to the next row; across it, that less by the cosine of
    // its altitude (directions close up towards the point overhead).
    const down = Math.abs(i + 1 < count ? column.ys[i + 1] - column.ys[i] : column.ys[i] - column.ys[i - 1]);
    const wide = down * across * Math.max(0.05, Math.cos(column.alts[i] * RAD));
    let sum = 0;
    for (let a = 0; a < n; a++) {
      const y = Math.min(1, Math.max(0, column.ys[i] + ((a + 0.5) / n - 0.5) * down));
      for (let b = 0; b < n; b++) sum += sampleMap(map, Math.min(1, Math.max(0, column.xs[i] + ((b + 0.5) / n - 0.5) * wide)), y);
    }
    sky[i] = sum / (n * n);
  }
  return sky;
}

export class SkyEvidence {
  /** The grid: its cells' size, and how many directions and altitudes that makes. A cell is `bin * rows + row`: direction by direction, top row first. */
  readonly step: number;
  readonly bins: number;
  readonly rows: number;
  /** Evidence per cell, as log-odds: positive for sky. What looks on the move add up. */
  readonly evidence: Float32Array;
  /** What each cell is held to be: 1 sky, -1 solid, 0 not known yet. */
  readonly decided: Int8Array;
  /**
   * How sky-like each cell comes out, 0 to 255 (a half is 127.5). What a
   * cell is held to be is all or nothing; this is how much of it, which is
   * what lets the sky map's edge be drawn between cells where the model put
   * it (see fill.ts). For a cell that's been decided it's on the side of a
   * half that the cell is held to be. One that hasn't may have been scored
   * short of sky all the same (a look in doubt about it); 128 is one no look
   * has scored.
   */
  readonly soft: Uint8Array;
  /** Whether a look at rest has settled each cell: 1 where one has. */
  readonly settled: Uint8Array;
  /** How well the best look to speak for what each cell is held to be stood for it. */
  private readonly rank: Float32Array;
  /** The rests there have been, the view of the one in hand, and for each cell the rest in which a look found it to be sky. */
  private rest = 0;
  private restView = '';
  private readonly restOf: Uint32Array;
  /** For each cell, what the looks at rest weighed at it have counted for in all (as much as it remembers), and that times the score each gave it. */
  private readonly total: Float32Array;
  private readonly sum: Float32Array;
  /** The rest that last had a say at each cell, how many of its looks have, and what was behind the cell before it. A rest's say is its latest look's, so each look of it is weighed afresh against what was there before. */
  private readonly votedIn: Uint32Array;
  private readonly votes: Uint8Array;
  private readonly totalBefore: Float32Array;
  private readonly sumBefore: Float32Array;
  /** The rows each direction has been seen over (highest and lowest), and how much the looks at it were worth. */
  readonly top: Int16Array;
  readonly bottom: Int16Array;
  private readonly seen: Float32Array;
  /** How finely each direction has been looked at: the smallest a model's cell has been on the sky there, in degrees. */
  private readonly finest: Float32Array;
  private readonly settings: SkyEvidenceSettings;
  /** Where the view last asked about falls on the grid (see `geometryOf`). */
  private lastView: { key: string; columns: ViewColumn[] } | null = null;

  constructor(settings: Partial<SkyEvidenceSettings> = {}) {
    this.settings = { ...SKY_EVIDENCE_SETTINGS, ...settings };
    this.step = this.settings.cellDeg;
    this.bins = Math.round(360 / this.step);
    this.rows = Math.round((ALT_TOP - ALT_BOTTOM) / this.step) + 1;
    const cells = this.bins * this.rows;
    this.evidence = new Float32Array(cells);
    this.decided = new Int8Array(cells);
    this.soft = new Uint8Array(cells).fill(128);
    this.settled = new Uint8Array(cells);
    this.rank = new Float32Array(cells);
    this.restOf = new Uint32Array(cells);
    this.total = new Float32Array(cells);
    this.sum = new Float32Array(cells);
    this.votedIn = new Uint32Array(cells);
    this.votes = new Uint8Array(cells);
    this.totalBefore = new Float32Array(cells);
    this.sumBefore = new Float32Array(cells);
    this.top = new Int16Array(this.bins).fill(this.rows);
    this.bottom = new Int16Array(this.bins).fill(-1);
    this.seen = new Float32Array(this.bins);
    this.finest = new Float32Array(this.bins).fill(Infinity);
  }

  /**
   * Where a view falls on the grid (see `viewGeometry`), kept for the view
   * last asked about: one at rest is added several times, and working this
   * out is most of what adding a look costs.
   */
  private geometryOf(cam: Camera): ViewColumn[] {
    const key = `${cam.heading}|${cam.pitch}|${cam.hfov}|${cam.width}|${cam.height}`;
    if (this.lastView?.key !== key) this.lastView = { key, columns: viewGeometry(cam, this.step) };
    return this.lastView.columns;
  }

  /**
   * Adds a look: what was made of the frame (`map`), from the view `cam`,
   * worth `quality` (see `viewQuality`, which also says whether the view
   * was at rest). `fast` is for a frame copied while the view was turning
   * fast: the picture can be a frame behind the direction the viewer
   * reports, so such a look is trusted only to add the sky it's sure of. It
   * takes nothing away, and doesn't count towards a direction's having been
   * looked at.
   */
  add(map: RawMap, cam: Camera, quality: number, fast = false): void {
    const { step, rows } = this;
    const { edgeMargin, decidedAt, keepSky, asGood, edgeStands, movingStands, seesSky, unsureFrom, fillsAtOnce } = this.settings;
    const { zoomedUnder, zoomedSeesSky } = this.settings;
    const columns = this.geometryOf(cam);
    // What a frame is worth is how closely it looks (zoomed in is better)
    // and whether it was still, but not how fine the model's own grid is.
    const worth = Math.min(MAX_WORTH, (quality / map.width) * WIDE_VIEW_DEG);
    const still = (quality * cam.hfov) / map.width >= STILL_FROM;
    const side = SIDE_WORTH;
    // Looks at rest at the same view, one after another, are one rest.
    if (still) {
      const view = `${cam.heading}|${cam.pitch}|${cam.hfov}|${cam.width}|${cam.height}`;
      if (view !== this.restView) {
        this.restView = view;
        this.rest++;
      }
    }
    // How fine a look this is: the size of one of the model's cells on the sky.
    const fine = cam.hfov / map.width;
    // (And so how many of them go across one of the grid's: a map finer than the grid is read over the whole of each cell.)
    const across = Math.min(3, Math.max(1, Math.round(step / fine)));
    // Whether the look can see any sky to speak of: one that can't doesn't get to say what isn't sky (see `seesSky`).
    // (Zoomed far in, it has to see a good deal more of it: see `zoomedUnder`.)
    const needs = cam.hfov < zoomedUnder ? zoomedSeesSky : seesSky;
    let skyCells = 0;
    if (still && needs > 0) for (let i = 0; i < map.sky.length; i++) if (map.sky[i] >= 0.5) skyCells++;
    const blind = still && needs > 0 && skyCells < needs * map.sky.length;
    for (const column of columns) {
      const { bin } = column;
      const n = column.alts.length;
      if (n < 4) continue;
      const sky = across > 1 ? sampleCells(map, column, across, cam) : sampleColumn(map, column);
      const say = worth;
      const base = bin * rows + column.firstRow;
      for (let i = 0; i < n; i++) {
        // Worth more near the middle of the frame, where the model has more
        // to go on, and next to nothing right at its top and bottom edges.
        const fromEdge = Math.min(column.ys[i], 1 - column.ys[i]);
        const faded = Math.min(1, fromEdge / edgeMargin);
        const weight = say * (side + (1 - side) * (1 - Math.min(1, Math.abs(column.xs[i] - 0.5) * 2))) * faded;
        const p = Math.min(0.999, Math.max(0.001, sky[i]));
        const evidence = Math.max(-MAX_STEP, Math.min(MAX_STEP, Math.log(p / (1 - p))));
        const cell = base + i;
        // How this look stands for the cell: the nearer the middle of its frame it has it (across times down)
        // and the closer the view, the better; and a look on the move a little less well than one at rest. And
        // whether that's as good as the best look to have spoken for what the cell is held to be.
        const midAcross = Math.max(0, 1 - 2 * Math.abs(column.xs[i] - 0.5));
        const midDown = Math.max(0, 1 - 2 * Math.abs(column.ys[i] - 0.5));
        const middle = midAcross * midDown;
        const standing = ((edgeStands + (1 - edgeStands) * middle) * (still ? 1 : movingStands)) / fine;
        const good = standing >= this.rank[cell] * asGood;
        if (still && good) {
          // A look at rest, with as good a view of the cell as any that's spoken for it. Sure of the cell, it
          // has a say. (Sky that an earlier look of this same rest found is this one's to take back in doubt
          // or out of it: within a rest the latest look has the whole say.)
          const found = this.restOf[cell] === this.rest && this.decided[cell] === 1;
          // (Sky an earlier rest settled isn't a look's to take back if it can't see any sky itself.)
          const stands = blind && !found && this.settled[cell] === 1 && this.decided[cell] === 1;
          if (sky[i] >= 0.5 || (sky[i] < (found ? 0.5 : unsureFrom) && !stands)) {
            const said = sky[i] >= 0.5 ? 1 : -1;
            // Its answer is set against what the rests before this one left behind the cell, and the cell is
            // what the two come to. (What a look that sees no sky calls solid counts for nothing against any other.)
            const counts = blind && said < 0 ? LEAST_VOTE : Math.max(LEAST_VOTE, standing ** PLACE_POWER);
            if (this.votedIn[cell] !== this.rest) {
              // This rest's first say here. Behind the cell is what earlier rests left: nothing, where none has
              // settled it (sky found on the move, or a guess from the place before, is a look at rest's to settle).
              this.votedIn[cell] = this.rest;
              this.votes[cell] = 0;
              this.totalBefore[cell] = this.settled[cell] ? this.total[cell] : 0;
              this.sumBefore[cell] = this.settled[cell] ? this.sum[cell] : 0;
            }
            // The rest's say is this look's score, counting for as many looks as the rest has made of the cell.
            const looks = Math.min(255, this.votes[cell] + 1);
            this.votes[cell] = looks;
            let total = this.totalBefore[cell] + looks * counts;
            let weighedSum = this.sumBefore[cell] + looks * counts * sky[i];
            // (It remembers only so much: what's over is let go of evenly.)
            const most = Math.max(this.rank[cell] ** PLACE_POWER, counts) * REMEMBERS;
            if (total > most) {
              weighedSum *= most / total;
              total = most;
            }
            this.total[cell] = total;
            this.sum[cell] = weighedSum;
            const scored = weighedSum / total;
            const answer = scored >= 0.5 ? 1 : -1;
            const sum = Math.max(-MAX_EVIDENCE, Math.min(MAX_EVIDENCE, this.evidence[cell] + weight * evidence));
            this.evidence[cell] = answer > 0 ? Math.max(sum, decidedAt) : Math.min(sum, -decidedAt);
            if (answer > 0 && !(this.settled[cell] && this.decided[cell] === 1)) this.restOf[cell] = this.rest;
            this.decided[cell] = answer;
            this.soft[cell] = asByte(scored);
            this.settled[cell] = 1;
            // (A look stands behind what the cell is held to be only if that's what it said; and what a look
            // that sees no sky calls solid gives it no standing there.)
            if (said === answer && standing > this.rank[cell] && !(blind && said < 0)) this.rank[cell] = standing;
            continue;
          }
          // In doubt. Sky that only looks on the move had found is cleared, and left open to the next look:
          // it was filled on their word, and this is the better look.
          if (this.decided[cell] === 1 && !this.settled[cell]) {
            this.evidence[cell] = 0;
            this.decided[cell] = -1;
            this.soft[cell] = asByte(sky[i]);
            continue;
          }
          // (And a cell that isn't held as sky is as sky-like as this look has it, short of sky: that's what
          // puts the sky map's edge where it is between this cell and the sky beside it.)
          if (this.decided[cell] !== 1) this.soft[cell] = asByte(sky[i]);
        }
        // (What a look at rest has settled is left alone by the rest.)
        if (this.settled[cell]) continue;
        // Nor does a look count against what a better-placed look made of a cell: sky found with a thing in
        // the middle of the frame isn't argued away by the looks that have it out at their edge as the view
        // turns on, and nor is a wall.
        const says = sky[i] >= 0.5 ? 1 : -1;
        if (this.decided[cell] !== 0 && says !== this.decided[cell] && !good) continue;
        // A look on the move fills at once the sky it's sure of, all but the band at the frame's very top and
        // bottom, and all but what's held as solid on the strength of evidence that still stands.
        if (sky[i] >= fillsAtOnce && faded >= 0.5 && this.evidence[cell] > -decidedAt) {
          const sum = Math.max(-MAX_EVIDENCE, Math.min(MAX_EVIDENCE, this.evidence[cell] + weight * evidence));
          this.evidence[cell] = Math.max(sum, decidedAt);
          this.decided[cell] = 1;
          this.soft[cell] = asByte(sky[i]);
          if (standing > this.rank[cell]) this.rank[cell] = standing;
          continue;
        }
        // (A look made turning fast is trusted for nothing else.)
        if (fast) continue;
        // (Sky that's been found is slow to be given up: see `keepSky`.)
        const counted = evidence < 0 && this.evidence[cell] >= decidedAt ? weight * evidence * keepSky : weight * evidence;
        const now = Math.max(-MAX_EVIDENCE, Math.min(MAX_EVIDENCE, this.evidence[cell] + counted));
        this.evidence[cell] = now;
        if (now >= decidedAt) this.decided[cell] = 1;
        else if (now <= -decidedAt) this.decided[cell] = -1;
        // (A look that speaks for what the cell is held to be stands behind it, as well placed as it was.)
        if (this.decided[cell] === says && standing > this.rank[cell]) this.rank[cell] = standing;
        // (How sky-like the cell is, by the latest look that agrees with what it's held to be; or, held to be
        // nothing yet, that scores it short of sky.)
        if (this.decided[cell] > 0 ? sky[i] >= 0.5 : sky[i] < 0.5) this.soft[cell] = asByte(sky[i]);
      }
      this.top[bin] = Math.min(this.top[bin], column.firstRow);
      this.bottom[bin] = Math.max(this.bottom[bin], column.firstRow + n - 1);
      // (A look made turning fast leaves a direction as much in want of looking at as it was.)
      if (fast) continue;
      this.seen[bin] += say * (side + (1 - side) * (1 - Math.min(1, Math.abs(column.xs[n >> 1] - 0.5) * 2)));
      if (fine < this.finest[bin]) this.finest[bin] = fine;
    }
  }

  /**
   * Whether a view on the move has nothing to add: every direction it takes
   * in has been looked at enough (see SETTLED), as far up and down as this
   * view reaches, and about as finely as this view would look (`gridWidth`
   * is how many cells across the model answers on). A closer view always
   * has something to add, and so does one that reaches higher or lower than
   * what's been seen.
   *
   * (Asked of every view on the move, so it's kept cheap: how far up and
   * down the view reaches is taken from its middle, where it reaches
   * furthest, and asked of every direction alike, give or take a row.)
   */
  covers(cam: Camera, gridWidth?: number): boolean {
    const { step, bins, rows } = this;
    const fine = gridWidth ? cam.hfov / gridWidth : Infinity;
    const reach = Math.atan((Math.tan((cam.hfov / 2) * RAD) * cam.height) / cam.width) / RAD;
    const firstRow = Math.max(0, Math.ceil((ALT_TOP - (cam.pitch + reach)) / step)) + 1;
    const lastRow = Math.min(rows - 1, Math.floor((ALT_TOP - (cam.pitch - reach)) / step)) - 1;
    const [first, count] = binsInView(cam, step);
    for (let k = 0; k < count; k++) {
      const bin = (((first + k) % bins) + bins) % bins;
      if (this.seen[bin] < SETTLED || fine < this.finest[bin] * CLOSER) return false;
      if (this.top[bin] > firstRow || this.bottom[bin] < lastRow) return false;
    }
    return true;
  }

  /** Forgets everything: a place not been to before. */
  clear(): void {
    this.decided.fill(0);
    this.soft.fill(128);
    this.top.fill(this.rows);
    this.bottom.fill(-1);
    this.carryOver();
  }

  /**
   * Makes the grid a first guess at somewhere else nearby (the next
   * panorama along the street): every cell keeps what it's held to be, with
   * nothing behind it, and nothing counts as looked at. So the sky map is
   * there from the start, and the first clear look that says otherwise
   * changes it.
   */
  carryOver(): void {
    this.evidence.fill(0);
    this.settled.fill(0);
    this.rank.fill(0);
    this.restOf.fill(0);
    this.total.fill(0);
    this.sum.fill(0);
    this.votedIn.fill(0);
    this.votes.fill(0);
    this.totalBefore.fill(0);
    this.sumBefore.fill(0);
    this.restView = '';
    this.seen.fill(0);
    this.finest.fill(Infinity);
  }

  /** How much of what a view takes in a look at rest has settled, 0 to 1: whether a first look at it has anything left to do. */
  settledShare(cam: Camera): number {
    let all = 0;
    let done = 0;
    for (const column of this.geometryOf(cam)) {
      const base = column.bin * this.rows + column.firstRow;
      for (let i = 0; i < column.alts.length; i++) {
        all++;
        if (this.settled[base + i]) done++;
      }
    }
    return all ? done / all : 0;
  }

  /**
   * What's held of the sky here, small enough to keep by for when the place
   * is come back to (see places.ts): for each cell what it's held to be,
   * whether a look at rest settled that, and how sky-like it was scored (to
   * an eighth of its half of the scale); and how far up and down each
   * direction has been seen. Runs of cells alike are written once, down each
   * direction: a place seen all round comes to some tens of kilobytes.
   *
   * What isn't kept is the weighing behind it. So what's taken back with
   * `recall` has nothing behind it for a look to be weighed against, and
   * the next look at rest that's sure of something else changes it.
   */
  keep(): Uint8Array {
    const { bins, rows, decided, settled, soft, top, bottom } = this;
    const out: number[] = [KEPT_VERSION, bins & 255, bins >> 8, rows & 255, rows >> 8];
    for (const edge of [top, bottom]) for (let bin = 0; bin < bins; bin++) out.push(edge[bin] & 255, (edge[bin] >> 8) & 255);
    /**
     * A cell as one byte. Decided: 1, and 16 for sky, 8 for settled, and 0
     * to 7 for where in its half of the scale it was scored. Not decided: 0,
     * or 33 to 40 if a look scored it short of sky (0 to 7, likewise).
     */
    const symbol = (cell: number) => {
      if (!decided[cell]) return soft[cell] < 128 ? 33 + (soft[cell] >> 4) : 0;
      const level = decided[cell] > 0 ? Math.min(7, Math.max(0, (soft[cell] - 128) >> 4)) : Math.min(7, soft[cell] >> 4);
      return 1 + level + (settled[cell] ? 8 : 0) + (decided[cell] > 0 ? 16 : 0);
    };
    const cells = bins * rows;
    for (let cell = 0; cell < cells; ) {
      const s = symbol(cell);
      let run = 1;
      while (cell + run < cells && symbol(cell + run) === s) run++;
      out.push(s);
      // (The run's length, seven bits at a time, the low ones first.)
      for (let left = run; ; left >>= 7) {
        if (left < 128) {
          out.push(left);
          break;
        }
        out.push((left & 127) | 128);
      }
      cell += run;
    }
    return Uint8Array.from(out);
  }

  /**
   * Makes the grid what `keep` kept of it: false, with the grid left as it
   * was, if that isn't of a grid this size or doesn't read through.
   *
   * With `over`, what was kept is laid over what the grid holds now: a cell
   * the kept grid knew nothing of is left as it is. That's for a place a
   * step along the street, after `carryOver`: what's known of it is taken
   * back, and where it was never looked at, the sky of the place just left
   * still stands in as a first guess.
   */
  recall(kept: Uint8Array, over = false): boolean {
    const { bins, rows } = this;
    if (kept[0] !== KEPT_VERSION || (kept[1] | (kept[2] << 8)) !== bins || (kept[3] | (kept[4] << 8)) !== rows) return false;
    const cells = bins * rows;
    const decided = over ? Int8Array.from(this.decided) : new Int8Array(cells);
    const settled = over ? Uint8Array.from(this.settled) : new Uint8Array(cells);
    const soft = over ? Uint8Array.from(this.soft) : new Uint8Array(cells).fill(128);
    /** The cells the kept grid had something to say of. */
    const known = new Uint8Array(cells);
    let at = 5 + bins * 4;
    let cell = 0;
    while (at < kept.length && cell < cells) {
      const s = kept[at++];
      let run = 0;
      for (let shift = 0; at < kept.length; shift += 7) {
        const byte = kept[at++];
        run |= (byte & 127) << shift;
        if (byte < 128) break;
      }
      if (s > 40 || run < 1 || cell + run > cells) return false;
      if (s) {
        known.fill(1, cell, cell + run);
        settled.fill(0, cell, cell + run);
        if (s > 32) {
          decided.fill(0, cell, cell + run);
          soft.fill(8 + (s - 33) * 16, cell, cell + run);
        } else {
          const level = (s - 1) & 7;
          const sky = s - 1 >= 16;
          decided.fill(sky ? 1 : -1, cell, cell + run);
          soft.fill(sky ? 136 + level * 16 : 8 + level * 16, cell, cell + run);
          if ((s - 1) & 8) settled.fill(1, cell, cell + run);
        }
      }
      cell += run;
    }
    if (cell !== cells) return false;
    const signed = (low: number, high: number) => ((low | (high << 8)) << 16) >> 16;
    for (let bin = 0; bin < bins; bin++) {
      const top = signed(kept[5 + bin * 2], kept[6 + bin * 2]);
      const bottom = signed(kept[5 + bins * 2 + bin * 2], kept[6 + bins * 2 + bin * 2]);
      this.top[bin] = over ? Math.min(this.top[bin], top) : top;
      this.bottom[bin] = over ? Math.max(this.bottom[bin], bottom) : bottom;
    }
    this.decided.set(decided);
    this.settled.set(settled);
    this.soft.set(soft);
    const { decidedAt } = this.settings;
    for (let i = 0; i < cells; i++) {
      if (known[i]) this.evidence[i] = decided[i] * decidedAt;
      else if (!over) this.evidence[i] = 0;
    }
    this.rank.fill(0);
    this.restOf.fill(0);
    this.total.fill(0);
    this.sum.fill(0);
    this.votedIn.fill(0);
    this.votes.fill(0);
    this.totalBefore.fill(0);
    this.sumBefore.fill(0);
    this.restView = '';
    this.seen.fill(0);
    this.finest.fill(Infinity);
    return true;
  }
}
