import { describe, expect, it } from 'vitest';
import type { Camera } from '../projection';
import { Arrival, Pace, type LookNow } from './watch';

const view = (heading: number, pitch = 20, hfov = 90): Camera => ({ heading, pitch, hfov, width: 1032, height: 863 });
/** An animation frame, on a screen drawing 120 a second. */
const FRAME = 1000 / 120;

/**
 * Runs a pace through animation frames: `at(frame)` is the view at each, for
 * `ms` milliseconds. A look takes `lookMs`, and none can be made while one
 * is. Gives every look made, with when and of what heading.
 */
function run(pace: Pace, at: (frame: number) => Camera, ms: number, lookMs = 10, from = 0): { t: number; heading: number; look: LookNow }[] {
  const made: { t: number; heading: number; look: LookNow }[] = [];
  let busyUntil = -1;
  for (let frame = 0; frame * FRAME <= ms; frame++) {
    const now = from + frame * FRAME;
    const cam = at(frame);
    pace.see(now, 'here', cam);
    if (now < busyUntil) continue;
    const look = pace.next(now, lookMs);
    if (!look) continue;
    made.push({ t: Math.round(now - from), heading: cam.heading, look });
    busyUntil = now + lookMs;
  }
  return made;
}

describe('Pace', () => {
  it('looks at a view at rest at once, again at 0.15 s and at 1.5 s, and then leaves it', () => {
    const made = run(new Pace(), () => view(40), 4000);
    expect(made.map((m) => m.look)).toEqual([
      { again: false, still: true, fast: false },
      { again: true, still: true, fast: false },
      { again: true, still: true, fast: false },
    ]);
    // (The first once the view has held for two frames running.)
    expect(made[0].t).toBeLessThan(20);
    expect(made[1].t).toBeGreaterThanOrEqual(150);
    expect(made[1].t).toBeLessThan(170);
    expect(made[2].t).toBeGreaterThanOrEqual(1500);
    expect(made[2].t).toBeLessThan(1520);
  });

  it('gives a slow device one more look at rest, not two', () => {
    const made = run(new Pace(), () => view(40), 4000, 200);
    expect(made.map((m) => m.look.again)).toEqual([false, true]);
    expect(made[1].t).toBeGreaterThanOrEqual(1500);
  });

  it('looks at every view the model keeps up with while the view turns slowly, as moving looks', () => {
    // A quarter of a degree a frame; a look takes a frame and a bit, so every other frame is looked at.
    const made = run(new Pace(), (frame) => view(frame * 0.25), 1000, 10);
    expect(made.length).toBeGreaterThan(55);
    expect(made.length).toBeLessThan(65);
    expect(made.every((m) => !m.look.again && !m.look.still && !m.look.fast)).toBe(true);
    // No two looks of the same view.
    expect(new Set(made.map((m) => m.heading)).size).toBe(made.length);
  });

  it('takes a view turning fast only as a fast look, and one turning faster not at all', () => {
    const fast = run(new Pace(), (frame) => view(frame * 1.5), 500);
    expect(fast.length).toBeGreaterThan(20);
    expect(fast.every((m) => m.look.fast && !m.look.still && !m.look.again)).toBe(true);
    expect(run(new Pace(), (frame) => view((frame * 6) % 360), 500)).toEqual([]);
  });

  it('counts a change of zoom as too fast to follow', () => {
    expect(run(new Pace(), (frame) => view(40, 20, 90 - frame * 0.5), 300)).toEqual([]);
  });

  it('waits two frames after a jump, and then looks at where it landed as a view at rest', () => {
    const pace = new Pace();
    run(pace, () => view(40), 3000);
    const made = run(pace, () => view(170), 3000, 10, 3000);
    expect(made.map((m) => m.look.again)).toEqual([false, true, true]);
    expect(made[0].look).toEqual({ again: false, still: true, fast: false });
    // (Not at the jump's own frame, nor the next: at the third.)
    expect(made[0].t).toBe(Math.round(2 * FRAME));
    expect(made[1].t).toBeGreaterThanOrEqual(150);
  });

  it('looks at a view where a turn stops, and counts its rest from the stop', () => {
    const turning = 60;
    const made = run(new Pace(), (frame) => view(Math.min(frame, turning) * 0.25), 2500);
    const stop = turning * FRAME;
    const atRest = made.filter((m) => m.heading === turning * 0.25);
    expect(atRest.map((m) => m.look.again)).toEqual([false, true, true]);
    // (The first look where it stopped is a moving one if it's made at the frame the view got there, and a still
    // one if a look was in hand then and it's made a frame later: either way it's there within a look's time.)
    expect(atRest[0].t - stop).toBeLessThan(25);
    expect(atRest[1].t - stop).toBeGreaterThanOrEqual(150);
    expect(atRest[1].t - stop).toBeLessThan(170);
    expect(atRest[2].t - stop).toBeGreaterThanOrEqual(1500);
  });

  it('makes no look while one is being made, and then looks at the view as it is by then', () => {
    // A look takes 100 ms; the view turns throughout.
    const made = run(new Pace(), (frame) => view(frame * 0.25), 1000, 100);
    expect(made.length).toBeGreaterThanOrEqual(9);
    expect(made.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < made.length; i++) expect(made[i].t - made[i - 1].t).toBeGreaterThanOrEqual(100);
  });

  it('makes only the last look of a rest where the sky is already as it was left', () => {
    const pace = new Pace();
    pace.see(0, 'here', view(40));
    pace.onlyTheLast(10);
    const made = run(pace, () => view(40), 4000);
    expect(made.map((m) => m.look)).toEqual([{ again: true, still: true, fast: false }]);
    expect(made[0].t).toBeGreaterThanOrEqual(1500);
  });

  it('looks again at a view whose look could not be made', () => {
    const pace = new Pace();
    pace.see(0, 'here', view(40));
    pace.see(FRAME, 'here', view(40));
    expect(pace.next(FRAME, 10)).toEqual({ again: false, still: true, fast: false });
    expect(pace.next(FRAME, 10)).toBeNull();
    pace.retry();
    expect(pace.next(FRAME, 10)).toEqual({ again: false, still: true, fast: false });
  });

  it('starts a view over as newly come to rest', () => {
    const pace = new Pace();
    run(pace, () => view(40), 4000);
    pace.restart();
    const made = run(pace, () => view(40), 4000, 10, 4000);
    expect(made.map((m) => m.look.again)).toEqual([false, true, true]);
  });

  it('counts the rest from when a place’s picture arrived', () => {
    const pace = new Pace();
    // The view has been still for a second while the picture was awaited, and nothing was asked of the pace.
    for (let t = 0; t <= 1000; t += FRAME) pace.see(t, 'there', view(40));
    pace.rested(1000);
    const made = run(pace, () => view(40), 3000, 10, 1000);
    // (`run` sees the view under another place's name at its first frame, so that frame starts the rest too.)
    expect(made.map((m) => m.look.again)).toEqual([false, true, true]);
    expect(made[1].t).toBeGreaterThanOrEqual(150);
  });

  it('takes the same view at another place for a new view', () => {
    const pace = new Pace();
    pace.see(0, 'here', view(40));
    pace.see(FRAME, 'here', view(40));
    expect(pace.next(FRAME, 10)).not.toBeNull();
    pace.see(2 * FRAME, 'there', view(40));
    pace.see(3 * FRAME, 'there', view(40));
    expect(pace.next(3 * FRAME, 10)).toEqual({ again: false, still: true, fast: false });
  });
});

describe('Arrival', () => {
  /** A glimpse of the viewer, all one level of brightness (with a little texture, so it isn't taken for nothing). */
  const glimpse = (level: number) => Uint8ClampedArray.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : level + (i % 7)));

  it('waits for the picture to change from what was showing, and then to hold still', () => {
    const before = glimpse(90);
    const arrival = new Arrival(0, before);
    expect(arrival.here(50, before)).toBe(false);
    expect(arrival.here(400, before)).toBe(false);
    const after = glimpse(160);
    expect(arrival.here(700, after)).toBe(false);
    expect(arrival.here(800, after)).toBe(false);
    expect(arrival.here(860, after)).toBe(true);
  });

  it('goes on waiting while the picture is still changing', () => {
    const arrival = new Arrival(0, glimpse(90));
    for (let t = 100, level = 100; t < 1000; t += 100, level += 10) expect(arrival.here(t, glimpse(level))).toBe(false);
    expect(arrival.here(1000, glimpse(180))).toBe(false);
    expect(arrival.here(1160, glimpse(180))).toBe(true);
  });

  it('takes a black frame for no picture, however long it holds', () => {
    const arrival = new Arrival(0, glimpse(90));
    expect(arrival.here(500, glimpse(0))).toBe(false);
    expect(arrival.here(3000, glimpse(0))).toBe(false);
    expect(arrival.here(3000, null)).toBe(false);
  });

  it('needs only stillness where nothing was showing on arrival', () => {
    const arrival = new Arrival(0, null);
    const picture = glimpse(120);
    expect(arrival.here(100, picture)).toBe(false);
    expect(arrival.here(260, picture)).toBe(true);
  });

  it('gives up waiting after two and a half seconds, and looks at what is there', () => {
    const same = glimpse(90);
    const arrival = new Arrival(0, same);
    expect(arrival.here(2400, same)).toBe(false);
    expect(arrival.here(2500, same)).toBe(true);
  });
});
