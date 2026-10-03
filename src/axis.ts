import type { NightData } from './astro';

/**
 * The time axis shared by the slider and the timeline: the noon-to-noon
 * window, with daytime squeezed so the night gets most of the width.
 */
export interface TimeAxis {
  /** Position of a time along the axis, 0–1 (clamped to the window). */
  toFraction(ms: number): number;
  /** The time at a position 0–1 along the axis. */
  toTime(fraction: number): number;
}

/** A daytime hour is drawn this fraction of the width of a night-time hour. */
export const DAY_SCALE = 1 / 3;
/**
 * The scale eases between day and night over this long either side of sunset
 * and sunrise. A sudden change would put a corner in every curve drawn on the
 * axis at those two moments.
 */
const EASE_MS = 120 * 60000;
/** Spacing of the table the axis is built from. */
const TABLE_STEP_MS = 5 * 60000;

/** 0 below 0, 1 above 1, and a smooth S-curve between. */
function smoothstep(x: number): number {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
}

/**
 * An axis from `start` to `end` on which the daytime, before `sunset` and
 * after `sunrise`, is squeezed by `dayScale`. A fixed ratio rather than a
 * fixed share of the width, so the scale of the night doesn't change with the
 * season. Without both a sunset and a sunrise inside the window (polar day or
 * night), the axis is plain linear.
 */
export function nightAxis(
  start: number,
  end: number,
  sunset: number | null,
  sunrise: number | null,
  dayScale = DAY_SCALE,
): TimeAxis {
  const hasNight = sunset !== null && sunrise !== null && start < sunset && sunset < sunrise && sunrise < end;
  /** How wide a moment is drawn: `dayScale` by day, 1 at night, easing between. */
  const scale = (t: number): number => {
    if (!hasNight) return 1;
    const night = smoothstep((t - (sunset - EASE_MS)) / (2 * EASE_MS)) * (1 - smoothstep((t - (sunrise - EASE_MS)) / (2 * EASE_MS)));
    return dayScale + (1 - dayScale) * night;
  };

  // Distance along the axis at each table time: the running total of the scale.
  const n = Math.max(1, Math.ceil((end - start) / TABLE_STEP_MS));
  const step = (end - start) / n;
  const at = [0];
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    at.push(at[i] + ((scale(t) + scale(t + step)) / 2) * step);
  }
  const total = at[n];

  return {
    toFraction(ms) {
      const x = (Math.max(start, Math.min(end, ms)) - start) / step;
      const i = Math.min(Math.floor(x), n - 1);
      return (at[i] + (at[i + 1] - at[i]) * (x - i)) / total;
    },
    toTime(fraction) {
      const target = Math.max(0, Math.min(1, fraction)) * total;
      // The last table entry at or before the target.
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (at[mid] <= target) lo = mid;
        else hi = mid;
      }
      return start + (lo + (target - at[lo]) / (at[lo + 1] - at[lo])) * step;
    },
  };
}

const cache = new WeakMap<NightData, TimeAxis>();

/** The axis for a computed night. */
export function axisFor(data: NightData): TimeAxis {
  let axis = cache.get(data);
  if (!axis) {
    const { sunset, sunrise } = data.sunEvents;
    axis = nightAxis(data.start.getTime(), data.end.getTime(), sunset?.getTime() ?? null, sunrise?.getTime() ?? null);
    cache.set(data, axis);
  }
  return axis;
}
