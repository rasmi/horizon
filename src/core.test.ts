import { describe, expect, it } from 'vitest';
import { boldBoundary, computeNight, horizontal, interpolate, observableTonight, observer } from './astro';
import { edgeIndicator, focalLength, lineLabelAnchor, lookAt, project, streetViewHfov, type Camera } from './projection';
import { readState, stateToSearch } from './state';
import { nightWindow, shiftDays, tzOffsetMinutes, wallTime, zonedToDate } from './time';

const cam: Camera = { heading: 90, pitch: 0, hfov: 90, width: 800, height: 600 };

describe('projection', () => {
  it('puts the view direction at the centre', () => {
    const p = project(0, 90, cam);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(300);
    expect(p.visible).toBe(true);
  });

  it('puts half the FOV at the screen edge', () => {
    expect(project(0, 135, cam).x).toBeCloseTo(800);
    expect(project(0, 45, cam).x).toBeCloseTo(0);
  });

  it('moves up for higher altitude, accounting for pitch', () => {
    expect(project(10, 90, cam).y).toBeLessThan(300);
    const p = project(30, 90, { ...cam, pitch: 30 });
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(300);
  });

  it('marks points behind the camera', () => {
    const p = project(0, 270, cam);
    expect(p.visible).toBe(false);
    expect(p.z).toBeLessThan(0);
  });

  it('points edge indicators toward the target', () => {
    const e = edgeIndicator(0, 180, cam, 20); // to the right
    expect(e.x).toBeCloseTo(780);
    expect(e.y).toBeCloseTo(300);
    const up = edgeIndicator(80, 90, cam, 20);
    expect(up.y).toBeCloseTo(20);
  });

  it('anchors a path name where the path crosses the guide', () => {
    // A rising diagonal across an 800 × 600 view (screen y grows downward).
    const pts = [{ x: 0, y: 500 }, { x: 200, y: 400 }, { x: 400, y: 300 }];
    const a = lineLabelAnchor(pts, 100, 800, 600)!;
    expect(a.x).toBe(100);
    expect(a.y).toBeCloseTo(450);
    expect(a.angle).toBeCloseTo(Math.atan2(-100, 200));
  });

  it('keeps path names upright whichever way the path was drawn', () => {
    const a = lineLabelAnchor([{ x: 400, y: 300 }, { x: 0, y: 500 }], 100, 800, 600)!;
    expect(a.angle).toBeCloseTo(Math.atan2(-100, 200)); // same as left-to-right
  });

  it('slides to where a path enters the view when it misses the guide there', () => {
    // Comes in through the top edge, well right of the guide.
    const a = lineLabelAnchor([{ x: 200, y: -100 }, { x: 400, y: 300 }], 100, 800, 600)!;
    expect(a.y).toBeCloseTo(24); // the inset top edge
    expect(a.x).toBeCloseTo(262);
    expect(a.maxX).toBeCloseTo(400);
    // Panning a little moves the anchor a little: no jumps.
    const b = lineLabelAnchor([{ x: 205, y: -100 }, { x: 405, y: 300 }], 100, 800, 600)!;
    expect(b.x - a.x).toBeCloseTo(5);
    expect(b.y).toBeCloseTo(a.y);
  });

  it('falls back to the leftmost on-screen point, and skips breaks', () => {
    // The path only enters on the right; a null breaks it in two.
    const pts = [{ x: 500, y: 200 }, { x: 700, y: 150 }, null, { x: 300, y: 590 }, { x: 350, y: 595 }];
    const a = lineLabelAnchor(pts, 100, 800, 600)!;
    expect(a).toMatchObject({ x: 500, y: 200 }); // (300, 590) is too close to the bottom edge
    expect(lineLabelAnchor([{ x: 900, y: 100 }, { x: 950, y: 90 }], 100, 800, 600)).toBeNull();
  });

  it('lookAt centres a direction', () => {
    const v = lookAt(25, 200);
    const p = project(25, 200, { ...cam, ...v });
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(300);
  });

  it('maps zoom to FOV, doubling focal length per level', () => {
    // 800 × 600: the vertical cap (focal ≥ 300) doesn't apply at these zooms.
    expect(streetViewHfov(1, 800, 600)).toBeCloseTo(90);
    const f = (z: number, w = 800, h = 600) => focalLength({ ...cam, width: w, height: h, hfov: streetViewHfov(z, w, h) });
    expect(f(1)).toBeCloseTo(400);
    expect(f(2)).toBeCloseTo(800);
    expect(f(3.5)).toBeCloseTo(400 * Math.pow(2, 2.5));
  });

  it('never shows more than 90° vertically, however far the zoom goes', () => {
    const f = (z: number, w: number, h: number) => focalLength({ ...cam, width: w, height: h, hfov: streetViewHfov(z, w, h) });
    // 920 × 800 (the measured case): zoom 0.8 and 0 render identically.
    expect(f(0, 920, 800)).toBeCloseTo(400);
    expect(f(0.5, 920, 800)).toBeCloseTo(400);
    expect(f(1, 920, 800)).toBeCloseTo(460);
  });
});

describe('time zones', () => {
  it('converts wall time in a zone to an instant and back', () => {
    const d = zonedToDate({ year: 2026, month: 7, day: 4, hour: 21, minute: 30 }, 'America/New_York');
    expect(d.toISOString()).toBe('2026-07-05T01:30:00.000Z');
    expect(wallTime(d, 'America/New_York')).toMatchObject({ day: 4, hour: 21, minute: 30 });
  });

  it('handles half-hour offsets', () => {
    expect(tzOffsetMinutes(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('builds a noon-to-noon night window', () => {
    const tz = 'Europe/London';
    const evening = nightWindow(new Date('2026-01-10T22:00:00Z'), tz);
    const morning = nightWindow(new Date('2026-01-11T03:00:00Z'), tz);
    expect(evening.start.toISOString()).toBe('2026-01-10T12:00:00.000Z');
    expect(morning.start.toISOString()).toBe(evening.start.toISOString());
    expect(evening.end.toISOString()).toBe('2026-01-11T12:00:00.000Z');
  });

  it('keeps the window at local noon across a DST change', () => {
    const w = nightWindow(new Date('2026-03-08T04:00:00Z'), 'America/New_York');
    expect(w.start.toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-08T16:00:00.000Z');
  });

  it('shifts days keeping the local clock time, across DST and month ends', () => {
    const tz = 'America/New_York';
    // 9:30 PM EST on Mar 7 → 9:30 PM EDT on Mar 8: only 23 h later.
    const before = zonedToDate({ year: 2026, month: 3, day: 7, hour: 21, minute: 30 }, tz);
    const after = shiftDays(before, 1, tz);
    expect(wallTime(after, tz)).toMatchObject({ month: 3, day: 8, hour: 21, minute: 30 });
    expect(after.getTime() - before.getTime()).toBe(23 * 3600000);
    expect(shiftDays(after, -1, tz).getTime()).toBe(before.getTime());
    const eom = zonedToDate({ year: 2026, month: 1, day: 31, hour: 2, minute: 0 }, tz);
    expect(wallTime(shiftDays(eom, 1, tz), tz)).toMatchObject({ month: 2, day: 1, hour: 2 });
  });
});

describe('astronomy', () => {
  it('has the sun low in the south at winter-solstice noon in London', () => {
    const p = horizontal('Sun', new Date('2026-12-21T12:00:00Z'), observer(51.5, 0));
    expect(p.alt).toBeGreaterThan(13);
    expect(p.alt).toBeLessThan(16);
    expect(p.az).toBeGreaterThan(170);
    expect(p.az).toBeLessThan(190);
  });

  it('computes night summaries with observable windows', () => {
    const tz = 'America/New_York';
    const win = nightWindow(new Date('2026-06-15T02:00:00Z'), tz);
    const n = computeNight(40.7, -74, win, ['Sun', 'Saturn'], 12);
    const sun = n.bodies.get('Sun')!;
    expect(sun.set).not.toBeNull();
    expect(sun.rise).not.toBeNull();
    const sat = n.bodies.get('Saturn')!;
    for (const w of sat.observable) expect(w.end.getTime()).toBeGreaterThanOrEqual(w.start.getTime());
    const mid = interpolate(sat.samples, win.start.getTime() + 3.3 * 3600000)!;
    const exact = horizontal('Saturn', new Date(win.start.getTime() + 3.3 * 3600000), observer(40.7, -74));
    expect(mid.alt).toBeCloseTo(exact.alt, 1);
  });
});

describe('night events', () => {
  const tz = 'America/New_York';
  // Night of 2026-10-02 in New York: the waning Moon rises late evening.
  const win = nightWindow(new Date('2026-10-03T02:00:00Z'), tz);
  const n = computeNight(40.7, -74, win, ['Moon', 'Mercury', 'Saturn'], 12);

  it('keeps rise, transit and set in one pass', () => {
    for (const id of ['Moon', 'Mercury', 'Saturn'] as const) {
      const b = n.bodies.get(id)!;
      expect(b.rise && b.transit && b.set, id).toBeTruthy();
      expect(b.rise!.getTime(), id).toBeLessThan(b.transit!.getTime());
      expect(b.transit!.getTime(), id).toBeLessThan(b.set!.getTime());
    }
  });

  it('picks the pass that peaks in darkness', () => {
    const moon = n.bodies.get('Moon')!;
    // Rises this evening rather than reporting yesterday's moonset.
    expect(moon.rise!.getTime()).toBeGreaterThan(win.start.getTime());
    expect(moon.peakAlt).toBeGreaterThan(30);
  });

  it('draws each path as one unbroken cycle around the pass', () => {
    const RAD = Math.PI / 180;
    const sep = (a: { alt: number; az: number }, b: { alt: number; az: number }) =>
      Math.acos(
        Math.min(1, Math.sin(a.alt * RAD) * Math.sin(b.alt * RAD) + Math.cos(a.alt * RAD) * Math.cos(b.alt * RAD) * Math.cos((a.az - b.az) * RAD)),
      ) / RAD;
    for (const id of ['Moon', 'Saturn'] as const) {
      const b = n.bodies.get(id)!;
      const p = b.path;
      // Covers the whole pass, even where it runs past the noon-to-noon window
      // (the Moon sets at 2:46 PM, after the window ends).
      expect(p[0].t, id).toBeLessThan(b.rise!.getTime());
      expect(p[p.length - 1].t, id).toBeGreaterThan(b.set!.getTime());
      // Starts and ends at the bottom of the cycle, well under the horizon.
      expect(p[0].alt, id).toBeLessThan(-20);
      expect(p[p.length - 1].alt, id).toBeLessThan(-20);
      // Runs an hour past the cycle at each end (12 five-minute steps), so
      // the whole path spans the cycle (about a day) plus two hours.
      expect(b.pathOverlap, id).toBe(12);
      const hours = (p[p.length - 1].t - p[0].t) / 3600000;
      expect(hours, id).toBeGreaterThan(25.5);
      expect(hours, id).toBeLessThan(27.5);
      // Evenly sampled with no jumps: 5 minutes of sky is at most ~1.3°.
      for (let i = 1; i < p.length; i++) {
        expect(p[i].t - p[i - 1].t).toBe(5 * 60000);
        expect(sep(p[i], p[i - 1])).toBeLessThan(1.5);
      }
    }
    // The old noon-to-noon window left the Moon's ends ~13° apart in the sky.
    const w = n.bodies.get('Moon')!.samples;
    expect(sep(w[0], w[w.length - 1])).toBeGreaterThan(10);
    expect(n.bodies.get('Moon')!.set!.getTime()).toBeGreaterThan(win.end.getTime());
  });

  it('splits solid from dashed at the exact horizon or sunset point', () => {
    const at = (alt: number, az: number, sunAlt: number) => ({ t: 0, alt, az, sunAlt, bold: alt > 0 && sunAlt < -0.833 });
    // Rising after dark: the solid line starts on the horizon, not at the sample below it.
    const rise = boldBoundary(at(-0.5, 90, -20), at(1.5, 92, -21));
    expect(rise.alt).toBeCloseTo(0);
    expect(rise.az).toBeCloseTo(90.5);
    // Already up at sunset: it starts where the Sun reaches -0.833°, part-way along.
    const dusk = boldBoundary(at(10, 100, 0.167), at(11, 101, -1.833));
    expect(dusk.alt).toBeCloseTo(10.5);
    // Rising just before sunset (both change within one step): the later of the two.
    const both = boldBoundary(at(-0.1, 90, -0.433), at(0.9, 91, -1.433));
    expect(both.alt).toBeCloseTo(0.3); // sunset, 40% along; the horizon was at 10%
    // Setting in darkness: ends on the horizon.
    expect(boldBoundary(at(1, 270, -30), at(-1, 271, -30)).alt).toBeCloseTo(0);
    // Azimuth wraps through north.
    expect(boldBoundary(at(-1, 359, -30), at(1, 1, -30)).az % 360).toBeCloseTo(0);
  });

  it('orders the sun events through the night', () => {
    const e = n.sunEvents;
    const order = [e.sunset, e.darkStart, e.darkEnd, e.sunrise].map((d) => d!.getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[0]).toBeGreaterThan(win.start.getTime());
    expect(order[3]).toBeLessThan(win.end.getTime());
  });
});

describe('url state', () => {
  it('serialises compactly', () => {
    const s = stateToSearch({
      lat: 40.7,
      lng: -74,
      pano: 'abc',
      heading: 12.34,
      pitch: 5,
      zoom: 1,
      time: new Date('2026-07-04T21:30:12Z'),
      bodies: ['Moon', 'Jupiter'],
      bodiesAuto: false,
      twilight: 12,
    });
    expect(s).toBe('?lat=40.700000&lng=-74.000000&pano=abc&h=12.3&p=5.0&z=1.00&t=2026-07-04T21:30Z&b=Moon,Jupiter&tw=12');
  });

  it('keeps the object list out of the link while it is automatic', () => {
    const auto = readState('?lat=40.7&lng=-74');
    expect(auto.bodiesAuto).toBe(true);
    expect(stateToSearch(auto)).not.toContain('b=');
    // An explicit list, even an empty one, is a choice and is preserved.
    const chosen = readState('?lat=40.7&lng=-74&b=Mars');
    expect(chosen).toMatchObject({ bodiesAuto: false, bodies: ['Mars'] });
    expect(stateToSearch(chosen)).toContain('b=Mars');
    expect(readState('?b=')).toMatchObject({ bodiesAuto: false, bodies: [] });
  });
});

describe('default selection', () => {
  it('picks the naked-eye objects observable that night', () => {
    // New York, night of 2026-10-02: Mercury and Venus are only up in daylight.
    const win = nightWindow(new Date('2026-10-03T02:00:00Z'), 'America/New_York');
    const all = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'] as const;
    const night = computeNight(40.7, -74, win, [...all], 12);
    expect(observableTonight(night)).toEqual(['Moon', 'Mars', 'Jupiter', 'Saturn']);
  });

  it('always includes the Moon, even when it is never up in darkness', () => {
    // 2026-10-11 is just after new moon: the Moon has no observable window.
    const win = nightWindow(new Date('2026-10-12T02:00:00Z'), 'America/New_York');
    const night = computeNight(40.7, -74, win, ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'], 12);
    expect(night.bodies.get('Moon')!.observable).toEqual([]);
    expect(observableTonight(night)).toEqual(['Moon', 'Mars', 'Jupiter', 'Saturn']);
  });
});
