import type { SkyEvidence } from './evidence';
import { ALT_TOP } from './geometry';

// The sky map: a filled area, made from the grid's cells with as little
// done to them as will serve.
//
// It's every cell the grid holds as sky: each stretch of sky is filled,
// wherever it is and whether or not it joins the rest. It runs in under a
// cornice and between a tree's branches, and it's there under a canopy that
// shuts out everything overhead.
//
// Two things are added. What lies above the highest cell a direction has
// been decided at isn't known, and is taken to be sky if that cell is. And a
// patch high in the sky that isn't sky, with sky all round it, is taken for
// sky: a scrap the model was unsure of, a light out on its arm, a knot of
// wires. (What's joined to the ground through other things that aren't sky
// is left: a tower, a tree on its trunk.)
//
// And one thing is taken away: whatever lies more than 2° under the horizon,
// where there's no sky to see from the ground.
//
// A cell is in the sky map or it isn't, but the sky map's edge isn't drawn
// from cell to cell. Each cell was scored for how sky-like it is, and the
// edge runs between two cells where those scores pass a half: the model's
// own edge, as near as the grid has it (see `level`).

export interface SkyFillSettings {
  /**
   * A patch that isn't sky, and has sky all round it, is taken for sky if
   * it lies wholly above this many degrees of altitude; null to leave every
   * such patch as it is. (What's joined to the ground stands whatever its
   * height, so the height is only a guard against the odd thing near the
   * horizon.)
   */
  holesAbove: number | null;
  /**
   * Nothing lower than this many degrees of altitude is part of the sky
   * map, whatever the model made of it; null for no such floor. (From the
   * ground there's no sky under the horizon. It dips 1.6° seen from 3,000 m
   * up, and a capture's own levelling can be a degree out, so a floor 2°
   * under it costs no sky anywhere a street is. And every model tried takes
   * grey water under a grey sky for sky, right down the frame.)
   */
  floor: number | null;
}
export const SKY_FILL_SETTINGS: SkyFillSettings = { holesAbove: 10, floor: -2 };

/** A cell of sky counts for at least this much, and one that isn't for at least this much the other way, however near a half it was scored: so that it's never on the wrong side of the edge at its middle. */
const AT_LEAST = 0.02;
/** What a cell nothing is known of counts for. A little short of sky: the sky map runs most of the way out to such a cell from one that's sky, as it does to the edge of what's been looked at. */
export const NOT_KNOWN = -0.25;
/** How far inside the sky map a cell can be told to be, in degrees (see `depth`): further in than this, it's this. */
export const DEPTH_MOST = 2.5;

export class SkyFill {
  /** For every cell of the grid (laid out as SkyEvidence has them), whether it's part of the sky map: 1 where it is. */
  readonly reached: Uint8Array;
  /**
   * For every cell, how far it counts as part of the sky map: from 1 (all
   * sky) to -1 (none), by how sky-like it was scored. `at` blends these
   * between the four cells round a point, so the sky map's edge, where that
   * passes nothing, falls between two cells as far towards the one that
   * isn't sky as the scores have it: between a cell scored 0.9 and one
   * scored 0.3, two-thirds of the way across. A cell that's in the sky map
   * by the fill's own rules (above what's been seen, or a patch with sky all
   * round it) counts as all sky, one cut off by the floor as none, and one
   * nothing is known of as a little short of sky.
   *
   * It's what anything drawn from the sky map reads: a picture `rows` wide
   * and `bins` high.
   */
  readonly level: Float64Array;
  /** See `depth`: worked out only when asked for, and again only after the sky map has changed. */
  private readonly inside: Float32Array;
  private insideFresh = false;
  private readonly cells: SkyEvidence;
  private readonly settings: SkyFillSettings;
  /**
   * For finding patches (see `openHoles`). Each direction's stretches of
   * what isn't sky, top down: the direction, and the first and last row.
   * Where each direction's stretches begin in those lists. What's known of
   * each (0: nothing yet). And those waiting to be spread from.
   */
  private readonly runBin: Int16Array;
  private readonly runStart: Int16Array;
  private readonly runEnd: Int16Array;
  private readonly firstRun: Int32Array;
  private readonly runState: Uint8Array;
  private readonly waiting: Int32Array;

  /** The fill of a grid's cells. It's empty until `update` is called, and as it was then until the next call. */
  constructor(cells: SkyEvidence, settings: Partial<SkyFillSettings> = {}) {
    this.cells = cells;
    this.settings = { ...SKY_FILL_SETTINGS, ...settings };
    this.reached = new Uint8Array(cells.bins * cells.rows);
    this.level = new Float64Array(cells.bins * cells.rows).fill(NOT_KNOWN);
    this.inside = new Float32Array(cells.bins * cells.rows);
    // (A direction has at most a stretch to every two rows.)
    const most = cells.bins * Math.ceil(cells.rows / 2);
    this.runBin = new Int16Array(most);
    this.runStart = new Int16Array(most);
    this.runEnd = new Int16Array(most);
    this.firstRun = new Int32Array(cells.bins + 1);
    this.runState = new Uint8Array(most);
    this.waiting = new Int32Array(most);
  }

  /**
   * Takes for sky every patch that isn't sky, has sky all round it, and
   * lies wholly above `above` degrees. What isn't sky stands if it's joined,
   * through other cells that aren't (touching at a corner counts), to the
   * ground: below the lowest a direction has been seen at. Or to what
   * nothing is known of: above the highest it's been seen at (unless that's
   * taken for sky), and directions never looked in. A patch that doesn't
   * stand has only sky round it.
   *
   * (Worked out on each direction's stretches of what isn't sky, not cell
   * by cell: most of the grid isn't sky, and this is done at every look.)
   */
  private openHoles(above: number): void {
    const { bins, rows, step, top, bottom } = this.cells;
    const { reached, runBin, runStart, runEnd, firstRun, runState, waiting } = this;
    let runs = 0;
    for (let bin = 0; bin < bins; bin++) {
      firstRun[bin] = runs;
      const from = bin * rows;
      for (let row = 0; row < rows; row++) {
        if (reached[from + row]) continue;
        runBin[runs] = bin;
        runStart[runs] = row;
        while (row + 1 < rows && !reached[from + row + 1]) row++;
        runEnd[runs++] = row;
      }
    }
    firstRun[bins] = runs;
    // The stretches that reach the ground, or what nothing is known of.
    let found = 0;
    for (let run = 0; run < runs; run++) {
      const bin = runBin[run];
      const stands = bottom[bin] < 0 || runStart[run] < top[bin] || runEnd[run] > bottom[bin] || runEnd[run] === rows - 1;
      runState[run] = stands ? 1 : 0;
      if (stands) waiting[found++] = run;
    }
    /** Calls `each` with the stretches that touch one, in the directions either side of it (round the compass). */
    const touching = (run: number, each: (other: number) => void) => {
      const bin = runBin[run];
      for (let turn = 0; turn < 2; turn++) {
        const side = turn ? (bin === bins - 1 ? 0 : bin + 1) : bin === 0 ? bins - 1 : bin - 1;
        for (let other = firstRun[side]; other < firstRun[side + 1] && runStart[other] <= runEnd[run] + 1; other++) {
          if (runEnd[other] >= runStart[run] - 1) each(other);
        }
      }
    };
    const hold = (run: number) => {
      if (runState[run]) return;
      runState[run] = 1;
      waiting[found++] = run;
    };
    for (let next = 0; next < found; next++) touching(waiting[next], hold);
    // What's left has sky all round it. Patch by patch: it's sky, if none of it is as low as the altitude.
    const tooLow = Math.ceil((ALT_TOP - above) / step);
    for (let start = 0; start < runs; start++) {
      if (runState[start]) continue;
      let count = 0;
      let high = true;
      const gather = (run: number) => {
        if (runState[run]) return;
        runState[run] = 1;
        waiting[count++] = run;
        if (runEnd[run] >= tooLow) high = false;
      };
      gather(start);
      for (let next = 0; next < count; next++) touching(waiting[next], gather);
      if (!high) continue;
      for (let i = 0; i < count; i++) {
        const run = waiting[i];
        reached.fill(1, runBin[run] * rows + runStart[run], runBin[run] * rows + runEnd[run] + 1);
      }
    }
  }

  /** Works the sky map out afresh, from the cells as they're now held. */
  update(): void {
    const { bins, rows, step, decided, soft } = this.cells;
    const { reached, level } = this;
    const { holesAbove, floor } = this.settings;
    // The first row that lies under the floor.
    const under = floor === null ? rows : Math.max(0, Math.min(rows, Math.floor((ALT_TOP - floor) / step) + 1));
    for (let bin = 0; bin < bins; bin++) {
      const from = bin * rows;
      // Above the highest cell that's been decided nothing is known, and
      // it's taken to be sky if that cell is.
      let first = 0;
      while (first < rows && !decided[from + first]) first++;
      const above = first < rows && decided[from + first] === 1 ? 1 : 0;
      for (let row = 0; row < first; row++) reached[from + row] = above;
      for (let row = first; row < rows; row++) reached[from + row] = decided[from + row] === 1 ? 1 : 0;
      if (under < rows) reached.fill(0, from + under, from + rows);
    }
    if (holesAbove !== null) this.openHoles(holesAbove);
    // What each cell counts for (see `level`).
    for (let cell = 0; cell < level.length; cell++) {
      if (reached[cell]) level[cell] = decided[cell] === 1 ? Math.max(AT_LEAST, (soft[cell] - 127.5) / 127.5) : 1;
      else if (decided[cell] === 1) level[cell] = -1;
      // (Held as solid; or held as nothing yet, but scored short of sky by a look in doubt about it.)
      else level[cell] = decided[cell] === -1 || soft[cell] < 128 ? Math.min(-AT_LEAST, (soft[cell] - 127.5) / 127.5) : NOT_KNOWN;
    }
    this.insideFresh = false;
  }

  /**
   * For every cell, how far inside the sky map it is, in degrees of the sky
   * itself (directions close up towards the point overhead), up to
   * DEPTH_MOST. It's what a soft edge is drawn by: `level` says where the
   * edge is, and this how far in from it a point lies, which the level
   * can't (a cell that's only just sky counts for next to nothing however
   * much sky is round it).
   *
   * It's the distance to the edge as the crow flies, so that a line of equal
   * depth runs alongside the edge as smoothly as the edge does. (As first
   * made it was counted across or up and down, and then cell to cell: along
   * a slanting roof that came out in steps, and a fade drawn by it was
   * rougher than the edge it followed.)
   *
   * A cell of sky beside one that isn't: the edge crosses the way to that
   * neighbour where `at` passes nothing between the two. Where it crosses
   * both across and up or down from the cell, it's taken for a straight
   * line through the two crossings, and the cell is as far in as it is
   * from that line. A cell that isn't sky has the same the other way, below
   * nothing, where it's beside sky.
   *
   * Every other cell of sky is as far in as its neighbours make it, going by
   * the two nearest the edge together and not one at a time (the sum that
   * says a distance grows by a degree for each degree gone: an eikonal
   * equation, solved by sweeping the grid from each corner in turn).
   *
   * Worked out when first asked for after a change, not at every look: only
   * what draws the sky map wants it.
   */
  depth(): Float32Array {
    if (this.insideFresh) return this.inside;
    this.insideFresh = true;
    const { bins, rows, step } = this.cells;
    const { level, inside } = this;
    // How wide a cell is, in degrees of the sky, at each row.
    const wide = new Float32Array(rows);
    for (let row = 0; row < rows; row++) wide[row] = step * Math.max(0.02, Math.cos(((ALT_TOP - row * step) * Math.PI) / 180));
    for (let bin = 0; bin < bins; bin++) {
      const left = (bin === 0 ? bins - 1 : bin - 1) * rows;
      const right = (bin === bins - 1 ? 0 : bin + 1) * rows;
      const from = bin * rows;
      for (let row = 0; row < rows; row++) {
        const mine = level[from + row];
        const sky = mine > 0;
        // How far it is to where the edge crosses the way to a neighbour on the other side of it, across and up or down;
        // no distance where the neighbour is on this side.
        let across = Infinity;
        let along = Infinity;
        let other = level[left + row];
        if (other > 0 !== sky) across = (wide[row] * mine) / (mine - other);
        other = level[right + row];
        if (other > 0 !== sky) across = Math.min(across, (wide[row] * mine) / (mine - other));
        if (row > 0 && (other = level[from + row - 1]) > 0 !== sky) along = (step * mine) / (mine - other);
        if (row < rows - 1 && (other = level[from + row + 1]) > 0 !== sky) along = Math.min(along, (step * mine) / (mine - other));
        let far: number;
        if (across === Infinity && along === Infinity) far = DEPTH_MOST;
        else if (across === Infinity) far = along;
        else if (along === Infinity) far = across;
        else far = (across * along) / Math.hypot(across, along);
        inside[from + row] = sky ? Math.min(far, DEPTH_MOST) : -Math.min(far, DEPTH_MOST);
      }
    }
    // Further from the edge, on both sides of it: from each corner of the grid in turn, each cell by its neighbours on its
    // own side that are nearer the edge. (Outside the sky the same, below nothing: how far outside.)
    const stepSquared = step * step;
    for (let sweep = 0; sweep < 4; sweep++) {
      const backBins = sweep === 1 || sweep === 3;
      const backRows = sweep === 1 || sweep === 2;
      for (let i = 0; i < bins; i++) {
        const bin = backBins ? bins - 1 - i : i;
        const from = bin * rows;
        const left = (bin === 0 ? bins - 1 : bin - 1) * rows;
        const right = (bin === bins - 1 ? 0 : bin + 1) * rows;
        for (let j = 0; j < rows; j++) {
          const row = backRows ? rows - 1 - j : j;
          const signed = inside[from + row];
          // (Worked as a distance above nothing whichever side it's on: what's on the other side counts as nothing there.)
          const side = signed > 0 ? 1 : -1;
          const now = signed * side;
          // The nearer of the two beside it, and of the two above and below: only its own side counts (the other has had its say already).
          let a = inside[left + row] * side;
          const other = inside[right + row] * side;
          if (!(a > 0) || (other > 0 && other < a)) a = other;
          let b = row > 0 ? inside[from + row - 1] * side : 0;
          const below = row < rows - 1 ? inside[from + row + 1] * side : 0;
          if (!(b > 0) || (below > 0 && below < b)) b = below;
          const hasA = a > 0 && a < now;
          const hasB = b > 0 && b < now;
          if (!hasA && !hasB) continue;
          const width = wide[row];
          let far: number;
          if (!hasA) far = b + step;
          else if (!hasB) far = a + width;
          else {
            // By both together: the distance that's a degree further for each degree gone, across and down at once.
            const widthSquared = width * width;
            const both = widthSquared + stepSquared;
            const apart = both - (a - b) * (a - b);
            far = apart > 0 ? (a * stepSquared + b * widthSquared + width * step * Math.sqrt(apart)) / both : Infinity;
            // (That holds only if it comes out further than both; if not, by the nearer one alone.)
            if (!(far >= a && far >= b)) far = Math.min(a + width, b + step);
          }
          if (far < now) inside[from + row] = far * side;
        }
      }
    }
    return inside;
  }

  /** How far a point of the sky is part of the sky map: above nothing it is, below it isn't (see `level`). */
  at(alt: number, az: number): number {
    const { step, bins, rows } = this.cells;
    const { level } = this;
    const across = az / step;
    const down = (ALT_TOP - alt) / step;
    const bin = Math.floor(across);
    const row = Math.floor(down);
    const right = across - bin;
    const lower = down - row;
    const a = (((bin % bins) + bins) % bins) * rows;
    const b = ((((bin + 1) % bins) + bins) % bins) * rows;
    const r0 = Math.min(rows - 1, Math.max(0, row));
    const r1 = Math.min(rows - 1, Math.max(0, row + 1));
    return (level[a + r0] * (1 - right) + level[b + r0] * right) * (1 - lower) + (level[a + r1] * (1 - right) + level[b + r1] * right) * lower;
  }

  /** Whether anything is known of a point of the sky: looked at, carried over from the place before, or kept from an earlier visit. */
  known(alt: number, az: number): boolean {
    const { step, bins, rows, decided, soft, top } = this.cells;
    const bin = ((Math.round(az / step) % bins) + bins) % bins;
    const row = Math.min(rows - 1, Math.max(0, Math.round((ALT_TOP - alt) / step)));
    const cell = bin * rows + row;
    // (Above the highest cell seen in a direction counts as known where that cell is: it's taken to be sky if that is.)
    return decided[cell] !== 0 || soft[cell] < 128 || (row < top[bin] && this.reached[cell] === 1);
  }
}
