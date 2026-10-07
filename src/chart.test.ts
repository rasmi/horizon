import * as A from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import type { NightSummary, Sample } from './astro';
import { splitBySky } from './overlay';
import { duskShare, skyColorSmooth } from './skycolor';
import { openSky } from './roofline';
import { SkyEvidence } from './sky/evidence';
import { DEPTH_MOST, SkyFill } from './sky/fill';
import { ALT_TOP } from './sky/geometry';
import { EasedSky, FALL_MS, POUR_HURRIED_MS, POUR_MOST_MS, RISE_MS } from './skyease';
import data from '../third_party/star-catalogues/stars-data.json';
import { faintestShown, inSky, lifted, readCatalogue, skyRotation } from './stars';

// What the chart over the view is drawn from (see dev-assets/skyline-eval/OVERLAY-DESIGN.md): the sky map's depth, the
// easing and the pour, the stars' places, the paths split by the sky map, and the times an object is in open sky.

const BINS = 720;
const ROWS = 201;
const STEP = 0.5;
const rowOf = (alt: number) => Math.round((ALT_TOP - alt) / STEP);
const cellAt = (alt: number, az: number) => Math.round(az / STEP) * ROWS + rowOf(alt);

/** A sky map's two numbers for a made-up place: sky above `roof(az)` degrees, scored `sure`; solid below. */
function place(roof: (az: number) => number, sure = 1): { level: Float32Array; depth: Float32Array } {
  const level = new Float32Array(BINS * ROWS);
  const depth = new Float32Array(BINS * ROWS);
  for (let bin = 0; bin < BINS; bin++) {
    for (let row = 0; row < ROWS; row++) {
      const alt = ALT_TOP - row * STEP;
      const sky = alt > roof(bin * STEP);
      level[bin * ROWS + row] = sky ? sure : -1;
      depth[bin * ROWS + row] = sky ? Math.min(DEPTH_MOST, alt - roof(bin * STEP)) : -STEP;
    }
  }
  return { level, depth };
}
const POURED = { pour: true, fromAbove: true, most: POUR_MOST_MS };

describe('SkyFill.depth', () => {
  /** A grid with sky decided above 20° everywhere, and solid below. */
  function filled(): SkyFill {
    const cells = new SkyEvidence();
    for (let bin = 0; bin < cells.bins; bin++) {
      for (let row = 0; row < cells.rows; row++) {
        const sky = ALT_TOP - row * cells.step > 20;
        cells.decided[bin * cells.rows + row] = sky ? 1 : -1;
        cells.soft[bin * cells.rows + row] = sky ? 255 : 0;
      }
      cells.top[bin] = 0;
      cells.bottom[bin] = cells.rows - 1;
    }
    const fill = new SkyFill(cells);
    fill.update();
    return fill;
  }

  it('is how far inside the sky a cell is, in degrees, and passes nothing where the sky map’s edge is', () => {
    const fill = filled();
    const depth = fill.depth();
    // The edge is halfway between the last row of sky (20.25°) and the first that isn't (19.75°): at 20°.
    expect(fill.at(20.01, 100)).toBeGreaterThan(0);
    expect(fill.at(19.99, 100)).toBeLessThan(0);
    expect(depth[cellAt(20.25, 100)]).toBeCloseTo(0.25, 5);
    expect(depth[cellAt(19.75, 100)]).toBeCloseTo(-0.25, 5);
    expect(depth[cellAt(21.25, 100)]).toBeCloseTo(1.25, 5);
    // Further in than can be told, it's the most; and what isn't beside sky is below nothing.
    expect(depth[cellAt(60, 100)]).toBe(DEPTH_MOST);
    expect(depth[cellAt(5, 100)]).toBeLessThan(0);
  });

  it('counts across in degrees of the sky itself, so directions close up towards the point overhead', () => {
    const cells = new SkyEvidence();
    // Sky everywhere but one upright bar, 2° wide by the compass, from the ground to the top.
    for (let bin = 0; bin < cells.bins; bin++) {
      const bar = bin * cells.step >= 100 && bin * cells.step < 102;
      for (let row = 0; row < cells.rows; row++) {
        cells.decided[bin * cells.rows + row] = bar ? -1 : 1;
        cells.soft[bin * cells.rows + row] = bar ? 0 : 255;
      }
      cells.top[bin] = 0;
      cells.bottom[bin] = cells.rows - 1;
    }
    const fill = new SkyFill(cells, { floor: null, holesAbove: null });
    fill.update();
    const depth = fill.depth();
    // The bar's edge is at 101.75° (halfway between its last cell and the first of sky): 1.25° of compass from 103°,
    // which is all of that low down and half of it at 60° up.
    expect(depth[cellAt(0.25, 103)]).toBeCloseTo(1.25, 2);
    expect(depth[cellAt(60.25, 103)]).toBeCloseTo(1.25 * Math.cos((60.25 * Math.PI) / 180), 2);
  });

  it('is the distance to the edge as the crow flies, along a slanting roof: a fade drawn by it is as smooth as the edge', () => {
    const cells = new SkyEvidence();
    // A roof that climbs a degree for every two of compass, from 20° up at 100° round; each cell scored by how much of it is sky.
    const roof = (az: number) => 20 + (az - 100) * 0.5;
    for (let bin = 0; bin < cells.bins; bin++) {
      const sloped = bin * cells.step >= 60 && bin * cells.step <= 160;
      for (let row = 0; row < cells.rows; row++) {
        const above = ALT_TOP - row * cells.step - (sloped ? roof(bin * cells.step) : 20);
        const share = Math.max(0, Math.min(1, above / cells.step + 0.5));
        cells.decided[bin * cells.rows + row] = share >= 0.5 ? 1 : -1;
        cells.soft[bin * cells.rows + row] = Math.round(share * 255);
      }
      cells.top[bin] = 0;
      cells.bottom[bin] = cells.rows - 1;
    }
    const fill = new SkyFill(cells, { floor: null, holesAbove: null });
    fill.update();
    const depth = fill.depth();
    // The roof's slope on the sky itself (a degree of compass is shorter than a degree up, by the cosine of the altitude).
    const across = Math.cos((30 * Math.PI) / 180);
    const slope = 0.5 / across;
    let worst = 0;
    let worstStep = 0;
    for (let az = 110; az <= 130; az += 0.5) {
      for (let up = 0.25; up < 2; up += 0.5) {
        const alt = Math.round((roof(az) + up) * 2) / 2 + 0.25;
        const truly = (alt - roof(az)) / Math.hypot(1, slope);
        if (truly <= 0.15 || truly >= 2) continue;
        worst = Math.max(worst, Math.abs(depth[cellAt(alt, az)] - truly));
        // And from one cell to the next along the roof's own line (two across, one up), it's the same depth.
        worstStep = Math.max(worstStep, Math.abs(depth[cellAt(alt, az)] - depth[cellAt(alt + 0.5, az + 1)]));
      }
    }
    expect(worst).toBeLessThan(0.12);
    expect(worstStep).toBeLessThan(0.06);
  });

  // (A few milliseconds on a desktop, where it's logged below; a shared build machine has taken 14. The limit is
  // only there to catch it getting many times slower, not to hold any one machine to a time.)
  it('is quick: milliseconds, not a frame’s worth many times over', () => {
    const cells = new SkyEvidence();
    for (let bin = 0; bin < cells.bins; bin++) {
      const roofAt = 15 + 25 * Math.abs(Math.sin(bin / 9)) + (bin % 7);
      for (let row = 0; row < cells.rows; row++) {
        const sky = ALT_TOP - row * cells.step > roofAt;
        cells.decided[bin * cells.rows + row] = sky ? 1 : -1;
        cells.soft[bin * cells.rows + row] = sky ? 230 : 20;
      }
      cells.top[bin] = 0;
      cells.bottom[bin] = cells.rows - 1;
    }
    const fill = new SkyFill(cells);
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      fill.update();
      const start = performance.now();
      fill.depth();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(`depth(): ${times[6].toFixed(2)} ms (middle of 12)`);
    expect(times[6]).toBeLessThan(100);
  });

  it('is worked out again only after the sky map has changed', () => {
    const fill = filled();
    const first = fill.depth()[cellAt(21.25, 100)];
    expect(fill.depth()[cellAt(21.25, 100)]).toBe(first);
    fill.update();
    expect(fill.depth()[cellAt(21.25, 100)]).toBe(first);
  });
});

describe('EasedSky', () => {
  const eased = (gentle = false) => new EasedSky(BINS, ROWS, STEP, ALT_TOP, gentle);
  const levelAt = (sky: EasedSky, alt: number, az: number) => sky.shown[cellAt(alt, az) * 2];
  /** Runs a sky on through `ms` of frames at 120 a second, from time `from`. */
  const run = (sky: EasedSky, from: number, ms: number) => {
    for (let t = from; t <= from + ms; t += 1000 / 120) sky.advance(t);
  };

  it('starts with nothing drawn as sky, and nothing to do', () => {
    const sky = eased();
    expect(sky.busy).toBe(false);
    expect(levelAt(sky, 45, 10)).toBeLessThan(0);
  });

  it('pours a place’s sky from overhead: what’s higher starts sooner, and all of it is there within the pour’s time', () => {
    const sky = eased();
    const { level, depth } = place(() => 10);
    sky.retarget(level, depth, 0, POURED);
    expect(sky.busy).toBe(true);
    run(sky, 0, 150);
    // 80° up is on its way after 150 ms; 15° up hasn't started.
    expect(levelAt(sky, 80, 10)).toBeGreaterThan(0.3);
    expect(levelAt(sky, 15, 10)).toBeLessThan(0);
    run(sky, 150, POUR_MOST_MS + RISE_MS);
    expect(levelAt(sky, 15, 10)).toBeCloseTo(1, 1);
    run(sky, 1150, 400);
    expect(sky.busy).toBe(false);
    expect(levelAt(sky, 15, 10)).toBe(1);
  });

  it('moves smoothly: no cell jumps, and the edge slides where it’s put right', () => {
    const sky = eased();
    const first = place(() => 10, 0.5);
    sky.retarget(first.level, first.depth, 0, POURED);
    run(sky, 0, 2000);
    // A later look scores the same cells surer.
    const surer = place(() => 10, 0.9);
    sky.retarget(surer.level, surer.depth, 2000, { ...POURED, most: POUR_HURRIED_MS });
    let last = levelAt(sky, 30, 10);
    for (let t = 2000; t < 2400; t += 1000 / 120) {
      sky.advance(t);
      const now = levelAt(sky, 30, 10);
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now - last).toBeLessThan(0.08);
      last = now;
    }
    expect(last).toBeCloseTo(0.9, 2);
  });

  it('draws sky back over about a third of a second where there turned out to be none', () => {
    const sky = eased();
    const open = place(() => 10);
    sky.retarget(open.level, open.depth, 0, POURED);
    run(sky, 0, 2000);
    const ceiling = place(() => 50);
    sky.retarget(ceiling.level, ceiling.depth, 2000, POURED);
    run(sky, 2000, FALL_MS / 3);
    // Part-way: still above nothing a third of the way through, and not where it began.
    expect(levelAt(sky, 30, 10)).toBeLessThan(0.9);
    expect(levelAt(sky, 30, 10)).toBeGreaterThan(-0.9);
    run(sky, 2000 + FALL_MS / 3, FALL_MS);
    expect(levelAt(sky, 30, 10)).toBeLessThan(-0.9);
  });

  it('pours newly found sky from the sky beside it, and is never far behind what’s found', () => {
    const sky = eased();
    // The sky is known from 0° to 90° round the compass; then a look finds it on to 120°.
    const known = place((az) => (az <= 90 ? 10 : 95));
    sky.retarget(known.level, known.depth, 0, POURED);
    run(sky, 0, 2000);
    const more = place((az) => (az <= 120 ? 10 : 95));
    sky.retarget(more.level, more.depth, 2000, { ...POURED, most: POUR_HURRIED_MS });
    run(sky, 2000, 30);
    // Beside the sky that was drawn it has started; furthest from it, not yet.
    expect(levelAt(sky, 30, 91)).toBeGreaterThan(-0.6);
    expect(levelAt(sky, 30, 119)).toBe(-1);
    // And all of it is there a tenth of a second and a rise later.
    run(sky, 2030, POUR_HURRIED_MS + RISE_MS);
    expect(levelAt(sky, 30, 119)).toBeGreaterThan(0.9);
  });

  it('heads for a new answer from wherever it has got to: nothing has to finish first', () => {
    const sky = eased();
    const open = place(() => 10);
    sky.retarget(open.level, open.depth, 0, POURED);
    run(sky, 0, 2000);
    const shut = place(() => 95);
    sky.retarget(shut.level, shut.depth, 2000, POURED);
    run(sky, 2000, 60);
    const partWay = levelAt(sky, 30, 10);
    expect(partWay).toBeLessThan(1);
    expect(partWay).toBeGreaterThan(-1);
    // Sky again after all: it rises from where it had fallen to, with no wait.
    sky.retarget(open.level, open.depth, 2060, POURED);
    sky.advance(2060 + 1000 / 120);
    expect(levelAt(sky, 30, 10)).toBeGreaterThan(partWay);
  });

  it('takes the same time whatever the screen draws at', () => {
    const at = (fps: number) => {
      const sky = eased();
      const { level, depth } = place(() => 10);
      sky.retarget(level, depth, 0, { pour: false, fromAbove: false, most: 0 });
      for (let t = 0; t <= 120; t += 1000 / fps) sky.advance(t);
      sky.advance(120);
      return levelAt(sky, 30, 10);
    };
    expect(at(60)).toBeCloseTo(at(120), 2);
  });

  it('says which directions changed, for sending only those on', () => {
    const sky = eased();
    sky.taken();
    const patch = place((az) => (az >= 40 && az <= 50 ? 10 : 95));
    sky.retarget(patch.level, patch.depth, 0, { pour: false, fromAbove: false, most: 0 });
    sky.advance(1000 / 120);
    sky.advance(2000 / 120);
    // (Every cell changed here, solid ones too, so it's all of them; then nothing once they're there.)
    expect(sky.changed).toEqual([0, BINS - 1]);
    run(sky, 0, 2000);
    sky.taken();
    sky.advance(3000);
    expect(sky.changed).toBeNull();
  });

  it('can be put where it’s heading at once, for a device that isn’t keeping up', () => {
    const sky = eased();
    const { level, depth } = place(() => 10);
    sky.retarget(level, depth, 0, POURED);
    sky.settle();
    expect(sky.busy).toBe(false);
    expect(levelAt(sky, 15, 10)).toBe(1);
  });

  it('doesn’t pour, and moves in half the time, for a visitor who has asked for less motion', () => {
    const sky = eased(true);
    const { level, depth } = place(() => 10);
    sky.retarget(level, depth, 0, POURED);
    run(sky, 0, RISE_MS / 2);
    expect(levelAt(sky, 15, 10)).toBeGreaterThan(0.9);
  });
});

describe('the stars’ places', () => {
  const catalogue = readCatalogue(data as never);

  it('reads the catalogue: stars brightest first, the figures’ lines, and what has a name', () => {
    expect(catalogue.count).toBeGreaterThan(8000);
    expect(catalogue.magnitudes[0]).toBeLessThan(-1.4);
    for (let i = 1; i < catalogue.count; i++) expect(catalogue.magnitudes[i]).toBeGreaterThanOrEqual(catalogue.magnitudes[i - 1]);
    expect(catalogue.lines.length % 6).toBe(0);
    expect(catalogue.lines.length / 6).toBeGreaterThan(600);
    const texts = catalogue.named.map((n) => n.text);
    for (const name of ['Sirius', 'Polaris', 'Orion', 'Ursa Major', 'M31', 'M45', 'Large Magellanic Cloud']) expect(texts).toContain(name);
  });

  it('puts a star where astronomy-engine puts it, for a place and a time', () => {
    const when = new Date('2026-10-07T04:30:00Z');
    const [lat, lng] = [47.6, -122.33];
    const rotation = skyRotation(when, lat, lng);
    const observer = new A.Observer(lat, lng, 0);
    for (const name of ['Vega', 'Capella', 'Fomalhaut', 'Polaris', 'Aldebaran', 'Sirius']) {
      const star = catalogue.named.find((n) => n.text === name)!;
      const ra = ((Math.atan2(star.y, star.x) * 12) / Math.PI + 24) % 24;
      const dec = (Math.asin(star.z) * 180) / Math.PI;
      A.DefineStar(A.Body.Star1, ra, dec, 1000);
      const of = A.Equator(A.Body.Star1, when, observer, true, false);
      const there = A.Horizon(when, observer, of.ra, of.dec, 'normal');
      const here = inSky(star.x, star.y, star.z, rotation);
      expect(here.alt).toBeCloseTo(there.altitude, 1);
      expect((((here.az - there.azimuth + 540) % 360) - 180) * Math.cos((here.alt * Math.PI) / 180)).toBeCloseTo(0, 1);
    }
  });

  it('lifts what’s near the horizon as the air does, and next to nothing higher', () => {
    expect(lifted(0)).toBeGreaterThan(0.4);
    expect(lifted(0)).toBeLessThan(0.6);
    expect(lifted(45)).toBeLessThan(0.02);
    expect(lifted(-30)).toBeLessThan(lifted(-1));
  });

  it('shows the brightest stars first as the Sun goes down, and more as the view closes in', () => {
    expect(faintestShown(1, 90)).toBeLessThan(-1.5);
    expect(faintestShown(-6, 90)).toBeGreaterThan(1);
    expect(faintestShown(-6, 90)).toBeLessThan(3);
    expect(faintestShown(-18, 90)).toBe(5);
    expect(faintestShown(-18, 22.5)).toBeCloseTo(6.5, 5);
  });

  it('blends the sky’s colours with no steps', () => {
    for (let alt = 2; alt > -20; alt -= 0.25) {
      const a = skyColorSmooth(alt);
      const b = skyColorSmooth(alt - 0.25);
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - b[c])).toBeLessThan(0.03);
    }
    expect(skyColorSmooth(-30)).toEqual([0x0b / 255, 0x10 / 255, 0x24 / 255]);
  });
});

describe('duskShare', () => {
  it('brings the backdrop in as the Sun goes down, smoothly, and takes it out the same way at dawn', () => {
    expect(duskShare(5, [0, -6])).toBe(0);
    expect(duskShare(0, [0, -6])).toBe(0);
    expect(duskShare(-3, [0, -6])).toBeCloseTo(0.5, 5);
    expect(duskShare(-6, [0, -6])).toBe(1);
    expect(duskShare(-40, [0, -6])).toBe(1);
    for (let alt = 1; alt > -8; alt -= 0.1) expect(duskShare(alt - 0.1, [0, -6]) - duskShare(alt, [0, -6])).toBeLessThan(0.03);
  });

  it('lets buildings darken later than the sky, and a pair set to one altitude switch there', () => {
    expect(duskShare(-6, [0, -12])).toBeCloseTo(0.5, 5);
    expect(duskShare(-6, [0, -6])).toBeGreaterThan(duskShare(-6, [0, -12]));
    expect(duskShare(-4.9, [-5, -5])).toBe(0);
    expect(duskShare(-5, [-5, -5])).toBe(1);
  });
});

describe('splitBySky', () => {
  const gap = { alt: NaN, az: NaN };
  const isGap = (p: { alt: number }) => Number.isNaN(p.alt);
  /** A level line 30° up from azimuth 0 to 40, in 1.25° steps (as a path's five-minute samples are). */
  const line = Array.from({ length: 33 }, (_, i) => ({ alt: 30, az: i * 1.25 }));
  const lengthOf = (points: { alt: number; az: number }[]) => {
    let total = 0;
    for (let i = 0; i + 1 < points.length; i++) if (!isGap(points[i]) && !isGap(points[i + 1])) total += Math.abs(points[i + 1].az - points[i].az);
    return total;
  };

  it('gives a line’s open stretches and those behind something, meeting where it goes behind', () => {
    // A tower from 10° to 20°.
    const { clear, behind } = splitBySky(line, isGap, gap, (_alt, az) => az < 10 || az > 20);
    expect(lengthOf(behind)).toBeCloseTo(10, 0);
    expect(lengthOf(clear)).toBeCloseTo(30, 0);
    const behindAz = behind.filter((p) => !isGap(p)).map((p) => p.az);
    expect(Math.min(...behindAz)).toBeGreaterThanOrEqual(9.5);
    expect(Math.max(...behindAz)).toBeLessThanOrEqual(20.5);
  });

  it('says where and when the line goes behind something and comes out again', () => {
    // The same line with a time at each point, a minute to the degree; the same tower.
    const timed = line.map((p) => ({ ...p, t: p.az * 60000 }));
    const { changes } = splitBySky(timed, isGap, gap, (_alt, az) => az < 10 || az > 20);
    expect(changes.map((c) => c.opens)).toEqual([false, true]);
    expect(changes[0].at.az).toBeGreaterThan(9.5);
    expect(changes[0].at.az).toBeLessThan(10.5);
    expect(changes[1].at.az).toBeGreaterThan(19.5);
    expect(changes[1].at.az).toBeLessThan(20.5);
    // Each has the time of its own point, between the line's own.
    expect(changes[0].t! / 60000).toBeCloseTo(changes[0].at.az, 5);
    expect(changes[1].t! / 60000).toBeCloseTo(changes[1].at.az, 5);
    // And none where the line's points have no times.
    expect(splitBySky(line, isGap, gap, (_alt, az) => az < 10 || az > 20).changes.every((c) => c.t === undefined)).toBe(true);
  });

  it('goes by what most of the degree round a point is: through leaves it would flicker', () => {
    // Scraps of sky a fifth of a degree wide, every degree, between 10° and 20°.
    const leaves = splitBySky(line, isGap, gap, (_alt, az) => az < 10 || az > 20 || az % 1 < 0.2);
    expect(lengthOf(leaves.behind)).toBeCloseTo(10, 0);
    // And a wire against open sky doesn't dim the path.
    const wire = splitBySky(line, isGap, gap, (_alt, az) => az < 15 || az > 15.4);
    expect(lengthOf(wire.behind)).toBe(0);
    expect(lengthOf(wire.clear)).toBeCloseTo(40, 5);
  });

  it('keeps a line’s own breaks', () => {
    const broken = [...line.slice(0, 10), gap, ...line.slice(20)];
    const { clear, behind } = splitBySky(broken, isGap, gap, () => true);
    expect(lengthOf(clear)).toBeCloseTo(9 * 1.25 + 12 * 1.25, 5);
    expect(lengthOf(behind)).toBe(0);
  });
});

describe('openSky', () => {
  const MINUTE = 60000;
  /** An object that rises due east, climbs to 40° by the south, and sets due west, over eight hours of five-minute samples; the Sun well down throughout. */
  const samples: Sample[] = Array.from({ length: 97 }, (_, i) => ({ t: i * 5 * MINUTE, alt: 40 * Math.sin((i / 96) * Math.PI) - 0.01, az: 90 + (i / 96) * 180 }));
  const sun: Sample[] = samples.map((s) => ({ t: s.t, alt: -30, az: 0 }));
  const summary = { samples } as NightSummary;

  it('gives when the object is in open sky, behind something, and where the sky hasn’t been looked at', () => {
    // A tower in the south-east up to 35°, and nothing known west of 240°.
    const sky = {
      at: (alt: number, az: number) => (az >= 240 ? -0.25 : az > 120 && az < 150 && alt < 35 ? -1 : 1),
      known: (_alt: number, az: number) => az < 240,
    };
    const result = openSky(summary, sun, 12, sky);
    expect(result.behind.length).toBe(1);
    expect(result.unseen.length).toBe(1);
    expect(result.open.length).toBe(2);
    expect(result.clear.length).toBe(2);
    expect(result.partlyUnseen).toBe(true);
    // It goes behind the tower as it passes 120°, and clears it at 150°: on the five-minute samples either side.
    const azAt = (t: number) => 90 + (t / (96 * 5 * MINUTE)) * 180;
    expect(azAt(result.clear[0][1])).toBeLessThanOrEqual(120);
    expect(azAt(result.clear[0][1])).toBeGreaterThan(120 - 180 / 96 - 0.01);
    expect(azAt(result.clear[1][0])).toBeGreaterThanOrEqual(150);
    expect(azAt(result.clear[1][1])).toBeLessThan(240);
    // The stretches meet: each runs half a sample past its ends.
    expect(result.behind[0][0]).toBe(result.open[0][1]);
    expect(result.open[1][0]).toBe(result.behind[0][1]);
  });

  it('counts nothing as clear while the sky isn’t dark, and nothing at all while the object is down', () => {
    const sky = { at: () => 1, known: () => true };
    const light = openSky(summary, sun.map((s) => ({ ...s, alt: -3 })), 12, sky);
    expect(light.clear).toEqual([]);
    expect(light.open.length).toBe(1);
    const down = openSky({ samples: samples.map((s) => ({ ...s, alt: -5 })) } as NightSummary, sun, 12, sky);
    expect(down.open).toEqual([]);
    expect(down.clear).toEqual([]);
  });
});
