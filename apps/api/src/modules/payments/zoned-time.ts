const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Offset of a time zone from UTC at an instant, in milliseconds. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return local - (at.getTime() - (at.getTime() % 1000));
}

/** The instant at which a calendar day (YYYY-MM-DD) starts in a time zone (hospital timezone). */
export function zonedMidnight(day: string, tz: string): Date {
  if (!DAY.test(day)) throw new Error('Expected a YYYY-MM-DD day');
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Two passes: the offset is taken at the first guess, so days that start next to a daylight-saving
  // change resolve to the right instant.
  const guess = utcMidnight - tzOffsetMs(new Date(utcMidnight), tz);
  return new Date(utcMidnight - tzOffsetMs(new Date(guess), tz));
}

export function nextDay(day: string): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Today's calendar day (YYYY-MM-DD) in a time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
