/**
 * Hospital-local time helpers (no third-party library). Schedules are stored as local wall-clock
 * times (time columns) and turned into UTC instants with the hospital's IANA time zone.
 */
const WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;
export type WeekdayName = (typeof WEEKDAYS)[number];

function parts(instant: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, min: +p.minute!, s: +p.second! };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** UTC instant of local `date` (YYYY-MM-DD) + `minutes` after midnight in `tz`. */
export function zonedToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const first = guess - offsetMs(new Date(guess), tz);
  // Second pass settles daylight-saving transitions.
  return new Date(guess - offsetMs(new Date(first), tz));
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(instant: Date, tz: string): string {
  const p = parts(instant, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function weekdayOf(date: string): WeekdayName {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** Minutes after midnight of a Prisma TIME value (returned as 1970-01-01THH:MM:00Z). */
export const timeToMinutes = (t: Date): number => t.getUTCHours() * 60 + t.getUTCMinutes();
/** "HH:MM" → TIME value for Prisma. */
export const hhmmToTime = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);
export const minutesToHhmm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
