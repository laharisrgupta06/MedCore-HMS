'use client';

import {
  APPOINTMENT_STATUSES,
  type Appointment,
  type AppointmentStatus,
  type Doctor,
} from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Button } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { Panel } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { addDays, dayBounds, fmtDateLong, fmtTime, localDate, useHospitalTz } from '@/lib/time';
import { appointmentsApi } from '@/services/appointments';
import { useAuth } from '@/store/auth';
import { AppointmentActions } from './appointment-actions';
import { BookingForm } from './booking-form';
import { DoctorPicker } from './pickers';
import { AppointmentStatusBadge } from './status-badge';

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In consultation',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Did not attend',
};

/** Staff day agenda (APPT-005): doctors see their own list; reception and admins see the hospital's. */
export function AppointmentsView() {
  const role = useAuth((s) => s.me?.user.role);
  const tz = useHospitalTz();
  const [date, setDate] = useState(() => localDate(new Date(), tz));
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [page, setPage] = useState(1);
  const [booking, setBooking] = useState(false);
  const isDoctor = role === 'DOCTOR';
  const canBook = role === 'RECEPTIONIST';
  const bounds = dayBounds(date, tz);
  const q = useQuery({
    queryKey: ['appointments', 'day', date, status, doctor?.id, page],
    queryFn: () =>
      appointmentsApi.list({
        ...bounds,
        page,
        limit: 50,
        order: 'asc',
        ...(status ? { status } : {}),
        ...(doctor ? { doctorId: doctor.id } : {}),
      }),
    refetchInterval: 60_000,
  });
  const go = (d: string) => {
    setDate(d);
    setPage(1);
  };
  const today = localDate(new Date(), tz);

  return (
    <>
      <PageHeader
        title={isDoctor ? 'My appointments' : 'Appointments'}
        description={`Times are in the hospital's time zone (${tz}).`}
        actions={
          canBook && (
            <Button onClick={() => setBooking(true)}>
              <CalendarPlus />
              Book appointment
            </Button>
          )
        }
      />
      <Panel
        title={
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous day"
              onClick={() => go(addDays(date, -1))}
            >
              <ChevronLeft />
            </Button>
            <span>{fmtDateLong(date, tz)}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next day"
              onClick={() => go(addDays(date, 1))}
            >
              <ChevronRight />
            </Button>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {date !== today && (
              <Button variant="secondary" size="compact" onClick={() => go(today)}>
                Today
              </Button>
            )}
            <input
              type="date"
              aria-label="Go to date"
              className="h-8 rounded-md border border-border-strong px-2 text-body-sm"
              value={date}
              onChange={(e) => e.target.value && go(e.target.value)}
            />
            <Select
              aria-label="Filter by status"
              className="h-8 w-full sm:w-44"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as AppointmentStatus | '');
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {!isDoctor && (
          <div className="border-b border-border px-5 py-3 sm:max-w-md">
            <p className="mb-1 text-body-sm font-medium">Doctor</p>
            {doctor ? (
              <DoctorPicker
                selected={doctor}
                onSelect={(d) => {
                  setDoctor(d);
                  setPage(1);
                }}
              />
            ) : (
              <details>
                <summary className="cursor-pointer text-body-sm text-sage-700">
                  All doctors (choose one to filter)
                </summary>
                <div className="mt-2">
                  <DoctorPicker
                    selected={null}
                    onSelect={(d) => {
                      setDoctor(d);
                      setPage(1);
                    }}
                  />
                </div>
              </details>
            )}
          </div>
        )}
        <DataTable<Appointment>
          caption={`Appointments on ${fmtDateLong(date, tz)}`}
          rows={q.data?.items}
          rowKey={(a) => a.id}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          empty={{
            icon: CalendarDays,
            title: 'No appointments on this day',
            text: canBook ? 'Book one with the button above.' : undefined,
          }}
          columns={[
            {
              key: 'time',
              header: 'Time',
              primary: true,
              cell: (a) => (
                <span className="font-mono">
                  {fmtTime(a.scheduledAt, tz)} to {fmtTime(a.endAt, tz)}
                </span>
              ),
            },
            {
              key: 'patient',
              header: 'Patient',
              cell: (a) => (
                <span>
                  <span className="font-medium">
                    {a.patient.firstName} {a.patient.lastName}
                  </span>
                  <span className="block font-mono text-caption text-ink-muted">
                    {a.patient.mrn}
                  </span>
                </span>
              ),
            },
            ...(isDoctor
              ? []
              : [
                  {
                    key: 'doctor',
                    header: 'Doctor',
                    cell: (a: Appointment) => `Dr ${a.doctor.firstName} ${a.doctor.lastName}`,
                  },
                ]),
            {
              key: 'dept',
              header: 'Department',
              hideOnMobile: true,
              cell: (a) => a.department.name,
            },
            {
              key: 'reason',
              header: 'Reason',
              hideOnMobile: true,
              cell: (a) =>
                a.cancellationReason ? (
                  <span className="text-ink-muted">Cancelled: {a.cancellationReason}</span>
                ) : (
                  (a.reason ?? <span className="text-ink-muted">Not given</span>)
                ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (a) => <AppointmentStatusBadge status={a.status} type={a.type} />,
            },
          ]}
          actions={(a) => <AppointmentActions appt={a} tz={tz} />}
        />
        {q.data && <Pagination meta={q.data.meta} onPage={setPage} />}
      </Panel>
      <Dialog
        open={booking}
        onOpenChange={setBooking}
        wide
        title="Book an appointment"
        description="Times are in the hospital's time zone."
      >
        <BookingForm mode="staff" tz={tz} onBooked={() => setBooking(false)} />
      </Dialog>
    </>
  );
}
