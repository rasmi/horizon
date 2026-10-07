import type { Camera } from '../projection';

// When to look. The view is watched every animation frame; these say, from
// how it has been moving and what the clock reads, whether this is a frame
// to look at, and as what kind of look. Nothing here touches the page: the
// loop in index.ts hands them the view and the time, and does what they say.

/**
 * A view turning faster than this per animation frame is looked at only to
 * add the sky the look is sure of: the copy of the viewer's canvas can be a
 * frame behind the direction it reports, so the look could be this far out
 * of place. And one turning faster than MAX_FAST_TURN_DEG isn't looked at at
 * all: a jump, or a flick too quick to follow.
 */
export const MAX_TURN_DEG = 0.5;
export const MAX_FAST_TURN_DEG = 4;
/**
 * Once the view has stopped, it's looked at again after these long: almost
 * at once, and again as sharper imagery loads. Each counts as a look at
 * rest; a rest's say is its latest look's (evidence.ts), so a view just
 * arrived at sharpens over them.
 */
export const LOOK_AGAIN_MS = [150, 1500];
/**
 * On a device that takes longer than this over a look, a view at rest gets
 * one more look, once it has been still for a while, and not two: nothing
 * is looked at on the move while a look is being made, and a hand often
 * pauses for a moment in mid-drag.
 */
export const QUICK_LOOK_MS = 150;
export const SLOW_LOOK_AGAIN_MS = [1500];

/** A look to make now: of a view at rest being looked at `again` (whatever is known of it already); of one that's `still`; or of one turning `fast`, which only adds sky. */
export interface LookNow {
  again: boolean;
  still: boolean;
  fast: boolean;
}

/**
 * Paces the looks. While the view moves, each new view is looked at as soon
 * as the last look is done, so the sky map keeps up with a turn. Once it
 * stops, it's looked at again, almost at once and as sharper imagery
 * arrives.
 *
 * Each animation frame: `see` the view, then ask what's `next`.
 */
export class Pace {
  private lastKey = '';
  private lookedKey = '';
  private lastChange = 0;
  private looks = 0;
  private previous: Camera | null = null;
  private wasSlow = false;
  private wasFollowable = false;
  private steady = false;
  private fast = false;
  private unmoved = false;
  private key = '';

  /** Takes in the view as it is at this animation frame, at the `place` showing. */
  see(now: number, place: string, cam: Camera): void {
    const { previous } = this;
    // How far the view turned since the last animation frame.
    const turn = previous
      ? Math.hypot(
          (((cam.heading - previous.heading + 540) % 360) - 180) * Math.cos((cam.pitch * Math.PI) / 180),
          cam.pitch - previous.pitch,
        )
      : 0;
    // (Two frames running: after a jump, the canvas still shows the old view
    // for a frame, and reading that as the new one would put a whole look in
    // the wrong place.)
    const sameZoom = !previous || previous.hfov === cam.hfov;
    const slow = turn <= MAX_TURN_DEG && sameZoom;
    this.steady = slow && this.wasSlow;
    this.wasSlow = slow;
    // Turning faster than that, but not jumping: the sky such a look is sure of can still be taken.
    const followable = turn <= MAX_FAST_TURN_DEG && sameZoom;
    this.fast = !this.steady && followable && this.wasFollowable;
    this.wasFollowable = followable;
    this.previous = cam;
    this.key = [place, cam.heading.toFixed(2), cam.pitch.toFixed(2), cam.hfov.toFixed(2), cam.width, cam.height].join('|');
    // (The same view as at the last animation frame: it isn't turning.)
    this.unmoved = this.key === this.lastKey;
    if (!this.unmoved) {
      this.lastKey = this.key;
      this.lastChange = now;
      this.looks = 0;
    }
  }

  /** The view counts as having come to rest just now: a place's picture has arrived. */
  rested(now: number): void {
    this.lastChange = now;
    this.looks = 0;
  }

  /** The view counts as newly come to rest from the next frame on, and is looked at as one is: the model has just become ready, or what's being asked of it has changed. */
  restart(): void {
    this.lookedKey = '';
    this.lastKey = '';
  }

  /** The view seen is still to be looked at: the look just asked for couldn't be made (nothing drawn yet), or the place has changed under it. */
  retry(): void {
    this.lookedKey = '';
  }

  /** The view seen is one whose sky is already as it was left: of its looks at rest, only the last is to be made. (`lookMs`: as for `next`.) */
  onlyTheLast(lookMs: number): void {
    this.looks = Math.max(0, (lookMs <= QUICK_LOOK_MS ? LOOK_AGAIN_MS : SLOW_LOOK_AGAIN_MS).length - 1);
    this.lookedKey = this.key;
  }

  /**
   * The look to make at this frame, if any. `lookMs` is how long the model's
   * last look took. Asked only when a look can be made (the model is ready,
   * and not in the middle of one): a look returned counts as made.
   */
  next(now: number, lookMs: number): LookNow | null {
    const lookAgain = lookMs <= QUICK_LOOK_MS ? LOOK_AGAIN_MS : SLOW_LOOK_AGAIN_MS;
    if (this.looks < lookAgain.length && now - this.lastChange >= lookAgain[this.looks]) {
      // At rest, wherever it came to rest (and whether or not it was looked at on the way there).
      this.looks++;
      this.lookedKey = this.key;
      return { again: true, still: true, fast: false };
    }
    if (this.key === this.lookedKey || (!this.steady && !this.fast)) return null;
    this.lookedKey = this.key;
    // A view that has just arrived, or stopped, is a still one from its first
    // look: that's most of what's on screen until the looks at rest come.
    return { again: false, still: this.unmoved, fast: this.fast };
  }
}

/** Whether a glimpse of the viewer (see frame.ts) shows nothing: a place can arrive, and hold still, as a black frame. */
export function blank(a: Uint8ClampedArray): boolean {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += a[i] + a[i + 1] + a[i + 2];
  return sum / (a.length / 4) / 3 < 8;
}

/** How far apart two glimpses are: their mean difference, 0–255. */
export function differ(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * A place just arrived at isn't looked at until its picture is there. The
 * viewer reports a new place at once, well before it shows it: until then
 * its canvas holds the place before, or nothing, and a look at that would
 * be filed under the new place. The picture has arrived once a glimpse of
 * the canvas isn't blank, has differed this much from what was showing on
 * arrival (mean difference, 0–255), and has then held this still for this
 * long. A place whose picture never passes is looked at anyway after the
 * last of these.
 */
const ARRIVED_CHANGE = 6;
const ARRIVED_STILL = 1.5;
const ARRIVED_STILL_MS = 150;
const ARRIVE_BY_MS = 2500;

/** A place being arrived at: made with what the viewer was showing when the place was reported (null if that couldn't be read). */
export class Arrival {
  private readonly since: number;
  private readonly before: Uint8ClampedArray | null;
  private changed: boolean;
  private held: Uint8ClampedArray | null;
  private heldSince: number;

  constructor(now: number, showing: Uint8ClampedArray | null) {
    this.since = now;
    this.before = showing;
    this.changed = !showing || blank(showing);
    this.held = showing;
    this.heldSince = now;
  }

  /** Whether the place's picture is there, given what the viewer is showing now. */
  here(now: number, showing: Uint8ClampedArray | null): boolean {
    if (!showing || blank(showing)) return false;
    if (now - this.since >= ARRIVE_BY_MS) return true;
    if (this.before && differ(showing, this.before) > ARRIVED_CHANGE) this.changed = true;
    if (!this.held || differ(showing, this.held) > ARRIVED_STILL) {
      this.held = showing;
      this.heldSince = now;
    }
    return this.changed && now - this.heldSince >= ARRIVED_STILL_MS;
  }
}
