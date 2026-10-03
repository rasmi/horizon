// Time-zone helpers. All app times are absolute Dates; these convert to and
// from wall-clock time in the *location's* IANA zone, not the browser's.

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

export function wallTime(date: Date, tz: string): WallTime & { second: number } {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset of `tz` from UTC at `date`, in minutes (east positive). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const w = wallTime(date, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Absolute instant for a wall-clock time in `tz`. */
export function zonedToDate(w: WallTime, tz: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  let t = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  // Second pass settles DST boundaries where the first offset was wrong.
  t = guess - tzOffsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** The same wall-clock time `days` later in `tz` (so not always 24 h, across DST). */
export function shiftDays(date: Date, days: number, tz: string): Date {
  const w = wallTime(date, tz);
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return zonedToDate(
    { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: w.hour, minute: w.minute },
    tz,
  );
}

/**
 * The 24 h window, local noon to local noon, holding the night of `date`.
 * Times before local noon belong to the previous evening's night.
 */
export function nightWindow(date: Date, tz: string): { start: Date; end: Date } {
  const w = wallTime(date, tz);
  let day = new Date(Date.UTC(w.year, w.month - 1, w.day));
  if (w.hour < 12) day = new Date(day.getTime() - 86400000);
  const next = new Date(day.getTime() + 86400000);
  const noon = (d: Date) =>
    zonedToDate(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 12, minute: 0 },
      tz,
    );
  return { start: noon(day), end: noon(next) };
}

// The formats used for display, in the visitor's own locale. Formatters are
// slow to build and these run every frame of playback, so each is made once
// per time zone.
const FORMATS = {
  time: { hour: '2-digit', minute: '2-digit' },
  clock: { hour: 'numeric', minute: '2-digit' },
  hour: { hour: 'numeric' },
  date: { weekday: 'short', month: 'short', day: 'numeric' },
  dateYear: { month: 'short', day: 'numeric', year: 'numeric' },
  zone: { timeZoneName: 'short' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function display(format: keyof typeof FORMATS, tz: string): Intl.DateTimeFormat {
  const key = `${format}|${tz}`;
  let f = displayFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { timeZone: tz, ...FORMATS[format] });
    displayFormatters.set(key, f);
  }
  return f;
}

export function formatTime(date: Date, tz: string): string {
  return display('time', tz).format(date);
}

/** Like formatTime, but without a leading zero on the hour: for labels on the sky. */
export function formatClock(date: Date, tz: string): string {
  return display('clock', tz).format(date);
}

export function formatHour(date: Date, tz: string): string {
  return display('hour', tz).format(date);
}

export function formatDate(date: Date, tz: string): string {
  return display('date', tz).format(date);
}

/**
 * The date for the main readout: "Sat, Oct 3" in the current year, and
 * "Oct 3, 2027" in any other, where the year matters more than the weekday
 * (and there isn't room for both).
 */
export function formatReadoutDate(date: Date, tz: string, now = new Date()): string {
  const sameYear = wallTime(date, tz).year === wallTime(now, tz).year;
  return display(sameYear ? 'date' : 'dateYear', tz).format(date);
}

/** YYYY-MM-DD in `tz`, for <input type="date">. */
export function isoDate(date: Date, tz: string): string {
  const w = wallTime(date, tz);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

export function tzAbbrev(date: Date, tz: string): string {
  const p = display('zone', tz)
    .formatToParts(date)
    .find((x) => x.type === 'timeZoneName');
  return p?.value ?? tz;
}
