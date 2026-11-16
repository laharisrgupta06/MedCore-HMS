'use client';

import type { Slot } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { addDays, fmtDateLong, fmtTime, localDate } from '@/lib/time';
import { cn } from '@/lib/utils';
import { appointmentsApi } from '@/services/appointments';

/** Day navigator plus the doctor's real slots for that day (APPT-001). Taken slots stay visible but disabled. */
export function SlotPicker({
  doctorId,
  date,
  onDateChange,
  value,
  onChange,
  tz,
  exclude,
}: {
  doctorId: string;
  date: string;
  onDateChange: (d: string) => void;
  value: string | null;
  onChange: (slot: Slot) => void;
  tz: string;
  /** The appointment being moved: its own slot reads as current, not taken. */
  exclude?: string;
}) {
  const today = localDate(new Date(), tz);
  const q = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => appointmentsApi.slots(doctorId, date),
    enabled: Boolean(doctorId),
    staleTime: 15_000,
    // Times already gone are not offered (the API refuses them with IN_THE_PAST anyway).
    select: (all: Slot[]) => all.filter((s) => new Date(s.start).getTime() > Date.now()),
  });
  const slots = q.data ?? [];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous day"
          disabled={date <= today}
          onClick={() => onDateChange(addDays(date, -1))}
        >
          <ChevronLeft />
        </Button>
        <label className="flex flex-1 flex-col items-center text-center">
          <span className="font-medium">{fmtDateLong(date, tz)}</span>
          <input
            type="date"
            aria-label="Choose a date"
            className="mt-1 rounded-sm border border-border px-2 py-1 text-body-sm"
            min={today}
            value={date}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
          />
        </label>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next day"
          onClick={() => onDateChange(addDays(date, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="mt-4" aria-live="polite">
        {q.error ? (
          <Alert tone="error" title="Could not load times">
            {errorMessage(q.error)}
          </Alert>
        ) : q.isPending ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : slots.length === 0 ? (
          <EmptyState icon={CalendarX2} title="No times on this day">
            The doctor is not available on this date. Try another day.
          </EmptyState>
        ) : (
          <div
            role="radiogroup"
            aria-label="Available times"
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          >
            {slots.map((s) => {
              const selected = value === s.start;
              const free = s.available || s.start === exclude;
              return (
                <button
                  key={s.start}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${fmtTime(s.start, tz)}${free ? '' : ' (taken)'}`}
                  disabled={!free}
                  onClick={() => onChange(s)}
                  className={cn(
                    'h-10 rounded-md border font-mono text-body-sm transition-colors max-sm:h-11',
                    selected
                      ? 'border-sage-700 bg-sage-600 text-white'
                      : free
                        ? 'border-border-strong bg-surface hover:bg-sage-50'
                        : 'cursor-not-allowed border-transparent bg-surface-muted text-ink-disabled line-through',
                  )}
                >
                  {fmtTime(s.start, tz)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
