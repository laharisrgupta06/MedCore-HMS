'use client';

import type { Appointment } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Pagination } from '@/components/ui/data-table';
import { EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { fmtDateLong, fmtTime, useHospitalTz } from '@/lib/time';
import { appointmentsApi } from '@/services/appointments';
import { AppointmentActions } from './appointment-actions';
import { BookingForm } from './booking-form';
import { AppointmentStatusBadge } from './status-badge';

function AppointmentCard({ a, tz }: { a: Appointment; tz: string }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex-1">
        <p className="font-medium">
          {fmtDateLong(a.scheduledAt, tz)},{' '}
          <span className="font-mono">{fmtTime(a.scheduledAt, tz)}</span>
        </p>
        <p className="text-body-sm text-ink-secondary">
          Dr {a.doctor.firstName} {a.doctor.lastName} · {a.doctor.specialisation} ·{' '}
          {a.department.name}
        </p>
        {a.cancellationReason && (
          <p className="text-body-sm text-ink-muted">Cancelled: {a.cancellationReason}</p>
        )}
        <div className="mt-1">
          <AppointmentStatusBadge status={a.status} type={a.type} />
        </div>
      </div>
      <AppointmentActions appt={a} tz={tz} />
    </li>
  );
}

function List({ when, tz }: { when: 'upcoming' | 'past'; tz: string }) {
  const [page, setPage] = useState(1);
  const [now] = useState(() => new Date().toISOString());
  const q = useQuery({
    queryKey: ['appointments', 'mine', when, page],
    queryFn: () =>
      appointmentsApi.list(
        when === 'upcoming'
          ? { from: now, order: 'asc', page, limit: 10 }
          : { to: now, order: 'desc', page, limit: 10 },
      ),
  });
  if (q.error)
    return (
      <div className="p-5">
        <Alert tone="error" title="Could not load appointments">
          {errorMessage(q.error)}
        </Alert>
      </div>
    );
  if (q.isPending)
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  if (q.data.items.length === 0)
    return when === 'upcoming' ? (
      <EmptyState
        icon={CalendarDays}
        title="No upcoming appointments"
        action={
          <Link href="/portal/book" className={buttonVariants()}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Book an appointment
          </Link>
        }
      />
    ) : (
      <EmptyState icon={CalendarDays} title="No past appointments" />
    );
  return (
    <>
      <ul className="divide-y divide-border">
        {q.data.items.map((a) => (
          <AppointmentCard key={a.id} a={a} tz={tz} />
        ))}
      </ul>
      <Pagination meta={q.data.meta} onPage={setPage} />
    </>
  );
}

/** Patient portal: own appointments (APPT-006), with cancel and reschedule. */
export function PortalAppointments() {
  const tz = useHospitalTz();
  return (
    <>
      <PageHeader
        title="My appointments"
        description={`Times are in the hospital's time zone (${tz}). You will get reminders a day and an hour before.`}
        actions={
          <Link href="/portal/book" className={buttonVariants()}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Book appointment
          </Link>
        }
      />
      <div className="space-y-6">
        <Panel title="Upcoming">
          <List when="upcoming" tz={tz} />
        </Panel>
        <Panel title="Past">
          <List when="past" tz={tz} />
        </Panel>
      </div>
    </>
  );
}

export function PortalBook() {
  const tz = useHospitalTz();
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Book an appointment"
        description={`Choose a doctor, a day and a time. Times are in the hospital's time zone (${tz}).`}
        actions={
          <Button variant="secondary" onClick={() => router.push('/portal/appointments')}>
            My appointments
          </Button>
        }
      />
      <Panel className="max-w-2xl p-5">
        <BookingForm mode="patient" tz={tz} onBooked={() => router.push('/portal/appointments')} />
      </Panel>
    </>
  );
}
