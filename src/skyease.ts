// What the chart shows of the sky map, which lags what the sky map says on
// purpose: so that nothing on screen pops. The chart draws from a copy of
// the sky map's two numbers for each cell (how far it counts as sky, and how
// far inside the sky it is: SkyFill.level and .depth), and this moves that
// copy towards the sky map's latest, a share of the way for each
// millisecond gone by.
//
// The sky map's edge is where the first number passes nothing, so a number
// that moves smoothly is an edge that slides: no cell switches on or off.
//
// Newly found sky doesn't all start at once. It's poured: a cell starts to
// rise when the pour reaches it from sky that's already drawn, or, at a
// place just arrived at, from overhead. Sky that joins nothing drawn rises
// where it is.
//
// Every move is towards wherever the sky map is now, from wherever the copy
// has got to: a new answer part-way through is only a new place to head
// for. Nothing is queued and nothing has to finish.
//
// Nothing here touches the page, so it can be run against a clock.

/** A cell that becomes sky is all but there after this long; one that stops being sky, after this long. */
export const RISE_MS = 200;
export const FALL_MS = 300;
/** The pour's pace, at its slowest: the whole dome, from overhead to the horizon, in about 0.8 s. */
export const POUR_MS_PER_DEG = 8.5;
/** The longest a pour over a whole place takes; and the longest for sky found as the view turns, which is never to be far behind what's found. */
export const POUR_MOST_MS = 800;
export const POUR_HURRIED_MS = 100;
/** What a cell nothing is known of counts for (SkyFill's NOT_KNOWN), and its depth: drawn as a building is. */
const BLANK_LEVEL = -0.25;
/** (As far outside the sky as the sky map tells of: SkyFill's DEPTH_MOST, below nothing.) */
const BLANK_DEPTH = -2.5;
/** A number this near where it's heading is taken to be there. */
const THERE = 0.004;

export interface Pour {
  /** Whether newly found sky is poured in order, or all rises at once. */
  pour: boolean;
  /** Whether sky that joins nothing drawn is poured from the highest of it in each direction, as from overhead: for a place just arrived at. */
  fromAbove: boolean;
  /** The longest the pour may take, in ms: it goes faster than its pace if it has to. */
  most: number;
}

export class EasedSky {
  readonly bins: number;
  readonly rows: number;
  readonly step: number;
  /** What's drawn: for every cell (laid out as the sky map's are), its level and then its depth. */
  readonly shown: Float32Array;
  /** The first and last direction (bin) whose cells have changed since `taken` was called; null if none. */
  changed: [from: number, to: number] | null;
  private readonly target: Float32Array;
  /** When each cell may start to move, by the clock `advance` is handed. */
  private readonly startAt: Float64Array;
  /** The cells still on their way, and whether each cell is among them. */
  private readonly moving: Int32Array;
  private readonly listed: Uint8Array;
  private count = 0;
  private last = 0;
  /** For working out a pour: whether each cell is newly sky, how long until it's reached, and how wide a cell is at each row. */
  private readonly fresh: Uint8Array;
  private readonly wait: Float32Array;
  private readonly wide: Float32Array;
  /** Shorter moves and no pour, for a visitor who has asked for less motion. */
  private readonly gentle: boolean;

  constructor(bins: number, rows: number, step: number, altTop: number, gentle = false) {
    this.bins = bins;
    this.rows = rows;
    this.step = step;
    this.gentle = gentle;
    const cells = bins * rows;
    this.shown = new Float32Array(cells * 2);
    this.target = new Float32Array(cells * 2);
    for (let cell = 0; cell < cells; cell++) {
      this.shown[cell * 2] = this.target[cell * 2] = BLANK_LEVEL;
      this.shown[cell * 2 + 1] = this.target[cell * 2 + 1] = BLANK_DEPTH;
    }
    this.startAt = new Float64Array(cells);
    this.moving = new Int32Array(cells);
    this.listed = new Uint8Array(cells);
    this.fresh = new Uint8Array(cells);
    this.wait = new Float32Array(cells);
    this.wide = new Float32Array(rows);
    for (let row = 0; row < rows; row++) this.wide[row] = step * Math.max(0.02, Math.cos(((altTop - row * step) * Math.PI) / 180));
    this.changed = [0, bins - 1];
  }

  /** Whether anything is still on its way: whether another frame is wanted. */
  get busy(): boolean {
    return this.count > 0;
  }

  /** Says the changes so far have been taken up (drawn from). */
  taken(): void {
    this.changed = null;
  }

  /**
   * Heads for the sky map as it is now (`level` and `depth`, a number for
   * each cell; null for nothing known anywhere). Cells that are newly sky
   * are poured as `how` says. Returns how many of those there were.
   */
  retarget(level: ArrayLike<number> | null, depth: ArrayLike<number> | null, now: number, how: Pour): number {
    const { bins, rows, step, shown, target, startAt, moving, listed, fresh, wait, wide } = this;
    if (this.count === 0) this.last = now;
    let freshCount = 0;
    let binFrom = bins;
    let binTo = -1;
    let rowFrom = rows;
    let rowTo = -1;
    for (let cell = 0; cell < bins * rows; cell++) {
      const to = level ? Math.fround(level[cell]) : BLANK_LEVEL;
      const deep = depth ? Math.fround(depth[cell]) : BLANK_DEPTH;
      if (target[cell * 2] === to && target[cell * 2 + 1] === deep) continue;
      target[cell * 2] = to;
      target[cell * 2 + 1] = deep;
      // (A cell a pour hasn't reached yet keeps its turn, if it's still to be sky.)
      const waiting = listed[cell] === 1 && startAt[cell] > now;
      if (!listed[cell]) {
        listed[cell] = 1;
        moving[this.count++] = cell;
      }
      if (waiting && to > 0) continue;
      startAt[cell] = now;
      if (to > 0 && shown[cell * 2] <= 0) {
        fresh[cell] = 1;
        freshCount++;
        const bin = (cell / rows) | 0;
        const row = cell - bin * rows;
        if (bin < binFrom) binFrom = bin;
        if (bin > binTo) binTo = bin;
        if (row < rowFrom) rowFrom = row;
        if (row > rowTo) rowTo = row;
      }
    }
    if (!freshCount) return 0;
    if (!how.pour || this.gentle) {
      for (let bin = binFrom; bin <= binTo; bin++) fresh.fill(0, bin * rows + rowFrom, bin * rows + rowTo + 1);
      return freshCount;
    }

    // Where the pour starts: at sky that's drawn already and stays; and, arriving, at the highest new sky in each direction,
    // as late as it is low, so that it comes down from overhead as one front.
    const drawn = (cell: number) => shown[cell * 2] > 0 && target[cell * 2] > 0;
    for (let bin = binFrom; bin <= binTo; bin++) {
      const from = bin * rows;
      const left = (bin === 0 ? bins - 1 : bin - 1) * rows;
      const right = (bin === bins - 1 ? 0 : bin + 1) * rows;
      let top = true;
      for (let row = rowFrom; row <= rowTo; row++) {
        if (!fresh[from + row]) continue;
        let reached = Infinity;
        if (row > 0 && drawn(from + row - 1)) reached = step;
        if (row < rows - 1 && drawn(from + row + 1)) reached = step;
        if (drawn(left + row) || drawn(right + row)) reached = Math.min(reached, wide[row]);
        if (top && how.fromAbove) reached = Math.min(reached, (row - rowFrom) * step);
        top = false;
        wait[from + row] = reached * POUR_MS_PER_DEG;
      }
    }
    // Then on through the new sky, cell to cell: two sweeps each way (the second for what lies round a corner).
    for (let round = 0; round < 2; round++) {
      for (let pass = 0; pass < 2; pass++) {
        const back = pass === 1;
        for (let i = binFrom; i <= binTo; i++) {
          const bin = back ? binFrom + binTo - i : i;
          const from = bin * rows;
          const beside = (back ? (bin === bins - 1 ? 0 : bin + 1) : bin === 0 ? bins - 1 : bin - 1) * rows;
          for (let j = rowFrom; j <= rowTo; j++) {
            const row = back ? rowFrom + rowTo - j : j;
            if (!fresh[from + row]) continue;
            let best = wait[from + row];
            const across = wide[row] * POUR_MS_PER_DEG;
            if (fresh[beside + row] && wait[beside + row] + across < best) best = wait[beside + row] + across;
            const next = back ? row + 1 : row - 1;
            if (next >= 0 && next < rows && fresh[from + next] && wait[from + next] + step * POUR_MS_PER_DEG < best) {
              best = wait[from + next] + step * POUR_MS_PER_DEG;
            }
            wait[from + row] = best;
          }
        }
      }
    }
    // No slower than its pace, and no longer than it's allowed: behind, it hurries.
    let longest = 0;
    for (let bin = binFrom; bin <= binTo; bin++) {
      for (let cell = bin * rows + rowFrom; cell <= bin * rows + rowTo; cell++) {
        if (fresh[cell] && wait[cell] !== Infinity && wait[cell] > longest) longest = wait[cell];
      }
    }
    const hurry = longest > how.most ? how.most / longest : 1;
    for (let bin = binFrom; bin <= binTo; bin++) {
      for (let cell = bin * rows + rowFrom; cell <= bin * rows + rowTo; cell++) {
        if (!fresh[cell]) continue;
        fresh[cell] = 0;
        // (What the pour never reached joins nothing drawn: it rises where it is.)
        if (wait[cell] !== Infinity) startAt[cell] = now + wait[cell] * hurry;
      }
    }
    return freshCount;
  }

  /** Moves what's shown on to time `now` (ms, by any steady clock). Returns whether anything moved. */
  advance(now: number): boolean {
    const { rows, shown, target, startAt, moving, listed } = this;
    // (A frame that came very late is caught up in one go, but not by so much that a move is skipped.)
    const gone = Math.max(0, Math.min(100, now - this.last));
    this.last = now;
    if (!this.count || gone === 0) return false;
    const quick = this.gentle ? 0.5 : 1;
    const rise = 1 - Math.exp(-gone / ((RISE_MS * quick) / 3));
    const fall = 1 - Math.exp(-gone / ((FALL_MS * quick) / 3));
    let from = this.changed ? this.changed[0] : Infinity;
    let to = this.changed ? this.changed[1] : -1;
    let moved = false;
    for (let i = this.count - 1; i >= 0; i--) {
      const cell = moving[i];
      if (now < startAt[cell]) continue;
      const at = shown[cell * 2];
      const heading = target[cell * 2];
      const share = heading > at ? rise : fall;
      let level = at + (heading - at) * share;
      let depth = shown[cell * 2 + 1] + (target[cell * 2 + 1] - shown[cell * 2 + 1]) * share;
      if (Math.abs(heading - level) < THERE && Math.abs(target[cell * 2 + 1] - depth) < THERE) {
        level = heading;
        depth = target[cell * 2 + 1];
        listed[cell] = 0;
        moving[i] = moving[--this.count];
      }
      shown[cell * 2] = level;
      shown[cell * 2 + 1] = depth;
      const bin = (cell / rows) | 0;
      if (bin < from) from = bin;
      if (bin > to) to = bin;
      moved = true;
    }
    if (moved) this.changed = [from, to];
    return moved;
  }

  /** Puts everything where it's heading, at once: for a device that isn't keeping up, where jumpy is better than slow. */
  settle(): void {
    const { rows, shown, target, moving, listed } = this;
    if (!this.count) return;
    let from = this.changed ? this.changed[0] : Infinity;
    let to = this.changed ? this.changed[1] : -1;
    for (let i = 0; i < this.count; i++) {
      const cell = moving[i];
      shown[cell * 2] = target[cell * 2];
      shown[cell * 2 + 1] = target[cell * 2 + 1];
      listed[cell] = 0;
      const bin = (cell / rows) | 0;
      if (bin < from) from = bin;
      if (bin > to) to = bin;
    }
    this.count = 0;
    this.changed = [from, to];
  }
}
