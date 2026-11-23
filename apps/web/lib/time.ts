'use client';

import { useQuery } from '@tanstack/react-query';
import { hospitalsApi } from '@/services/org';
import { useAuth } from '@/store/auth';

/**
 * Appointments are shown in the hospital's own time zone, whatever the viewer's device says, so a
 * receptionist and a patient travelling abroad see the same clock time (DEC-020).
 */
export function useHospitalTz(): string {
  const hospitalId = useAuth((s) => s.me?.user.hospitalId);
  const q = useQuery({
    queryKey: ['hospital', hospitalId],
    queryFn: () => hospitalsApi.get(hospitalId!),
    enabled: Boolean(hospitalId),
    staleTime: 300_000,
  });
  return q.data?.timezone ?? 'Asia/Kolkata';
}

const fmt = (tz: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...o });
export const fmtTime = (iso: string, tz: string) =>
  fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
export const fmtDate = (iso: string, tz: string) =>
  fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtDateLong = (dateOrIso: string, tz: string) =>
  fmt(tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(dateOrIso.length === 10 ? `${dateOrIso}T12:00:00Z` : dateOrIso),
  );

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Offset of `tz` from UTC at instant `t`, in milliseconds. */
function offsetAt(t: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return (
    Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) -
    Math.floor(t / 1000) * 1000
  );
}

/** The instant a local wall-clock time on `date` occurs in `tz` (mirrors the API's zonedToUtc). */
export function zonedToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let t = wall - offsetAt(wall, tz);
  t = wall - offsetAt(t, tz);
  return new Date(t);
}

/** UTC bounds [from, to) of a local calendar day in `tz`. */
export function dayBounds(date: string, tz: string): { from: string; to: string } {
  return {
    from: zonedToUtc(date, 0, tz).toISOString(),
    to: zonedToUtc(addDays(date, 1), 0, tz).toISOString(),
  };
}
