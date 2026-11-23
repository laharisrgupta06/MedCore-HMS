'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarDays, FlaskConical, Pill, Receipt } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Skeleton, StatCard } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { fmtDateLong, fmtTime, useHospitalTz } from '@/lib/time';
import { portalApi } from '@/services/portal';

const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Tile = StatCard;

/** Patient dashboard (Phase 10): the patient's own appointments, prescriptions, lab reports, bills and inbox. */
export function PatientSummary() {
  const tz = useHospitalTz();
  const q = useQuery({ queryKey: ['portal-summary'], queryFn: () => portalApi.summary() });
  if (q.isPending) return <Skeleton className="mb-6 h-40 w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load your summary" className="mb-6">
        {errorMessage(q.error)}
      </Alert>
    );
  const s = q.data;
  return (
    <section aria-labelledby="summary" className="mb-6 space-y-4">
      <h2 id="summary" className="sr-only">
        Summary
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile
          href="/portal/appointments"
          icon={CalendarDays}
          label="Upcoming visits"
          value={s.appointments.upcoming}
          detail={s.appointments.upcoming ? 'Booked or waiting for confirmation' : 'Nothing booked'}
        />
        <Tile
          href="/portal/prescriptions"
          icon={Pill}
          label="Ready for pickup"
          value={s.prescriptions.readyForPickup}
          detail={`${s.prescriptions.active} prescription(s) being prepared`}
        />
        <Tile
          href="/portal/lab-reports"
          icon={FlaskConical}
          label="New lab reports"
          value={s.lab.reportsReady30d}
          detail={`Last 30 days · ${s.lab.inProgress} in progress`}
        />
        <Tile
          href="/portal/invoices"
          icon={Receipt}
          label="Balance due"
          value={inr(s.billing.outstanding)}
          detail={`${s.billing.openInvoices} bill(s) not paid in full`}
        />
        <Tile
          href="/portal/notifications"
          icon={Bell}
          label="Unread notifications"
          value={s.notifications.unread}
          detail="Open your notifications"
        />
      </div>
      {s.appointments.next.length > 0 && (
        <div className="rounded-lg border border-border bg-surface shadow-1">
          <h3 className="border-b border-border px-5 py-3 text-h3 font-semibold text-ink">
            Next visits
          </h3>
          <ul className="divide-y divide-border">
            {s.appointments.next.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-body-sm"
              >
                <span>
                  <span className="font-medium">{fmtDateLong(a.scheduledAt, tz)}</span>,{' '}
                  <span className="font-mono">{fmtTime(a.scheduledAt, tz)}</span> · {a.doctorName} ·{' '}
                  {a.department}
                </span>
                <span className="text-caption text-ink-muted">
                  {a.status === 'CONFIRMED' ? 'Confirmed' : 'Waiting for confirmation'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
