// Street View capture dates ("historical imagery").
//
// Not part of the documented Maps JavaScript API: getPanorama() results carry
// an undocumented `time` array, one entry per capture of the spot, each with a
// `pano` ID and the capture month as a Date under a minified property name.
// Panoramas are then loaded by ID, which is documented. Everything here
// degrades to an empty list if that array changes shape or disappears.

export interface Capture {
  pano: string;
  /** Capture month, or null if the entry had no recognisable date. */
  date: Date | null;
}

/** Captures of the spot `data` describes, oldest first. */
export function parseCaptures(data: unknown): Capture[] {
  const time = (data as { time?: unknown } | null)?.time;
  if (!Array.isArray(time)) return [];
  const out: Capture[] = [];
  for (const entry of time) {
    if (!entry || typeof entry !== 'object') continue;
    const pano = (entry as { pano?: unknown }).pano;
    if (typeof pano !== 'string' || out.some((c) => c.pano === pano)) continue;
    // Find the date by type, not by its minified name, which can change.
    const date = Object.values(entry).find((v): v is Date => v instanceof Date && !Number.isNaN(v.getTime()));
    out.push({ pano, date: date ?? null });
  }
  return out.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}

/** "2011-08" (the documented imageDate format) as a local-midnight Date, like the `time` entries. */
export function parseImageDate(s: string | undefined): Date | null {
  const m = s?.match(/^(\d{4})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null;
}

/** Capture dates are local midnight on the 1st, so read them in local time. */
export function formatCapture(date: Date | null, short = false): string {
  if (!date) return 'Unknown date';
  return date.toLocaleDateString(undefined, short ? { year: 'numeric' } : { month: 'short', year: 'numeric' });
}

/** Meteorological winter at `lat`; no winter in the tropics. Leaf-off imagery is useful for seeing past trees. */
export function isWinter(date: Date | null, lat: number): boolean {
  if (!date || Math.abs(lat) < 23.5) return false;
  const m = date.getMonth(); // 0 = Jan
  return lat > 0 ? m === 11 || m <= 1 : m >= 5 && m <= 7;
}
