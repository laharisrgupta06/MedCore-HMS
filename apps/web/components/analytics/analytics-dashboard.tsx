'use client';

import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Panel, Skeleton, StatCard } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { localDate, useHospitalTz } from '@/lib/time';
import { analyticsApi } from '@/services/analytics';
import { DayBars, RankBars } from './charts';
import { Segmented } from '@/components/ui/segmented';

const inr = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const addDays = (day: string, n: number) => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const Card = StatCard;

function State({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  return (
    <Alert tone="error" title="Could not load analytics">
      {errorMessage(q.error)}
    </Alert>
  );
}

function Overview({ from, to }: { from: string; to: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'overview', from, to],
    queryFn: () => analyticsApi.overview(from, to),
  });
  if (!q.data) return <State q={q} />;
  const d = q.data;
  const k = d.kpis;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card
          label="Patients"
          value={k.patientsTotal.toLocaleString('en-IN')}
          detail={`${k.patientsNew} registered in this range`}
          href="/dashboard/patients"
        />
        <Card
          label="Appointments today"
          value={k.appointmentsToday}
          detail="Not cancelled"
          href="/dashboard/appointments"
        />
        <Card label="Active doctors" value={k.activeDoctors} href="/dashboard/doctors" />
        <Card
          label="Beds occupied"
          value={`${k.beds.occupied} / ${k.beds.total}`}
          detail={
            k.beds.maintenance ? `${k.beds.maintenance} under maintenance` : 'From bed status'
          }
          href="/dashboard/rooms"
        />
        <Card
          label="Received today"
          value={inr(k.receivedToday)}
          detail="Payments recorded in MedCore"
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Patient registrations">
          <div className="p-5">
            <DayBars title="New patients" points={d.registrations} />
          </div>
        </Panel>
        <Panel title="Appointments">
          <div className="p-5">
            <DayBars title="Appointments scheduled" points={d.appointments} />
          </div>
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Appointment status in this range">
          <div className="p-5">
            <RankBars
              rows={d.appointmentStatus.map((s) => ({ label: words(s.key), value: s.count }))}
            />
          </div>
        </Panel>
        <Panel title="By department">
          <Table
            head={['Department', 'Appointments', 'Completed', 'Cancelled']}
            rows={d.departments.map((x) => [x.name, x.appointments, x.completed, x.cancelled])}
            href="/dashboard/departments"
          />
        </Panel>
      </div>
      <Panel title="By doctor (top 15)">
        <Table
          head={['Doctor', 'Main department', 'Appointments', 'Completed', 'Cancelled', 'No-show']}
          rows={d.doctors.map((x) => [
            `Dr ${x.name}`,
            x.department ?? 'Not assigned',
            x.appointments,
            x.completed,
            x.cancelled,
            x.noShow,
          ])}
          href="/dashboard/doctors"
        />
      </Panel>
      <p className="text-caption text-ink-muted">
        Admissions and discharges are not tracked in MedCore (there is no admissions record), so bed
        occupancy comes from each bed&apos;s current status. Days are in the hospital&apos;s time
        zone ({d.timezone}).
      </p>
    </div>
  );
}

function Operations({ from, to }: { from: string; to: string }) {
  const q = useQuery({
    queryKey: ['analytics', 'operations', from, to],
    queryFn: () => analyticsApi.operations(from, to),
  });
  if (!q.data) return <State q={q} />;
  const d = q.data;
  const totals = d.cancellations.reduce(
    (s, x) => ({
      total: s.total + x.total,
      cancelled: s.cancelled + x.cancelled,
      noShow: s.noShow + x.noShow,
    }),
    { total: 0, cancelled: 0, noShow: 0 },
  );
  const pct = (n: number) =>
    totals.total ? `${Math.round((n / totals.total) * 1000) / 10}%` : 'No appointments';
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Cancellations and no-shows">
        <div className="flex flex-col gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card label="Appointments" value={totals.total} />
            <Card
              label="Cancelled"
              value={totals.cancelled}
              detail={`${pct(totals.cancelled)} of appointments`}
            />
            <Card
              label="No-shows"
              value={totals.noShow}
              detail={`${pct(totals.noShow)} of appointments`}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <DayBars
              title="Cancelled"
              points={d.cancellations.map((x) => ({ day: x.day, value: x.cancelled }))}
            />
            <DayBars
              title="No-shows"
              points={d.cancellations.map((x) => ({ day: x.day, value: x.noShow }))}
            />
          </div>
        </div>
      </Panel>
      <Panel title="Laboratory">
        <div className="flex flex-col gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card label="Orders placed" value={d.lab.ordered} />
            <Card label="Reports approved" value={d.lab.approved} />
            <Card
              label="Median turnaround"
              value={
                d.lab.turnaroundMedianHours == null ? 'No data' : `${d.lab.turnaroundMedianHours} h`
              }
              detail="Order to approval"
            />
            <Card
              label="90th percentile"
              value={d.lab.turnaroundP90Hours == null ? 'No data' : `${d.lab.turnaroundP90Hours} h`}
              detail="Order to approval"
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <DayBars title="Lab orders" points={d.lab.orders} />
            <div>
              <p className="mb-3 text-label font-medium text-ink-secondary">
                Status of orders placed in this range
              </p>
              <RankBars
                rows={d.lab.byStatus.map((s) => ({ label: words(s.key), value: s.count }))}
              />
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="Pharmacy">
        <div className="flex flex-col gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card
              label="Dispenses"
              value={d.pharmacy.dispenses}
              detail={`${d.pharmacy.unitsDispensed.toLocaleString('en-IN')} units`}
            />
            <Card
              label="Low stock"
              value={d.pharmacy.lowStock}
              detail="Below reorder level now"
              href="/dashboard/pharmacy/alerts"
            />
            <Card
              label="Expiring in 30 days"
              value={d.pharmacy.expiringIn30Days}
              detail="Active batches with stock"
              href="/dashboard/pharmacy/alerts"
            />
            <Card
              label="Active medicines"
              value={d.pharmacy.activeMedicines}
              href="/dashboard/medicines"
            />
          </div>
          <DayBars title="Units dispensed" points={d.pharmacy.dispensed} />
        </div>
      </Panel>
      <Panel title="Billing">
        <div className="flex flex-col gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card
              label="Invoices issued"
              value={d.billing.invoicesIssued}
              href="/dashboard/invoices"
            />
            <Card
              label="Invoiced"
              value={inr(d.billing.invoicedTotal)}
              detail="Issued in this range"
            />
            <Card
              label="Received"
              value={inr(d.billing.received)}
              detail="Payments recorded in this range"
            />
            <Card
              label="Outstanding now"
              value={inr(d.billing.outstanding)}
              detail="Issued, not yet paid in full"
            />
          </div>
          <DayBars title="Invoiced (₹)" points={d.billing.invoiced} format={(v) => inr(v)} />
          {d.billing.receivedByMethod.length > 0 && (
            <RankBars
              rows={d.billing.receivedByMethod.map((m) => ({
                label: PAYMENT_METHOD_LABEL[m.method as PaymentMethod] ?? m.method,
                value: Number(m.amount),
              }))}
              format={(v) => inr(v)}
            />
          )}
          <p className="text-caption text-ink-muted">
            Payments can only be recorded once database migration M-12 is applied, so received
            amounts stay at zero until then.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Table({
  head,
  rows,
  href,
}: {
  head: string[];
  rows: (string | number)[][];
  href?: string;
}) {
  if (rows.length === 0)
    return <p className="p-5 text-body-sm text-ink-muted">No data in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="mc-table min-w-full">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i > 0 && typeof rows[0]?.[i] === 'number' ? 'text-right' : ''}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={typeof c === 'number' ? 'text-right tabular-nums' : ''}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {href && (
        <div className="border-t border-border px-5 py-3">
          <Link href={href} className={buttonVariants({ variant: 'secondary', size: 'compact' })}>
            Open the full list
          </Link>
        </div>
      )}
    </div>
  );
}

/** Hospital admin analytics (Phase 11): overview and operations for a date range. */
export function AnalyticsDashboard() {
  const tz = useHospitalTz();
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<'overview' | 'operations'>('overview');
  const invalid = from > to || addDays(from, 365) < to;
  const preset = (days: number) => {
    setFrom(addDays(today, -(days - 1)));
    setTo(today);
  };
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Real figures from this hospital's records, for the dates you choose."
      />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="w-40">
          <Field label="From">
            {({ id, describedBy, invalid: inv }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={inv}
                type="date"
                value={from}
                max={today}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="w-40">
          <Field label="To" error={invalid ? 'Up to a year, on or after the start.' : undefined}>
            {({ id, describedBy, invalid: inv }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={inv}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex gap-2" role="group" aria-label="Quick ranges">
          {[7, 30, 90].map((n) => (
            <Button key={n} size="compact" variant="secondary" onClick={() => preset(n)}>
              Last {n} days
            </Button>
          ))}
        </div>
      </div>
      <Segmented
        className="mb-6"
        label="Analytics"
        value={tab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'operations', label: 'Operations' },
        ]}
        onChange={setTab}
      />
      {invalid ? null : tab === 'overview' ? (
        <Overview from={from} to={to} />
      ) : (
        <Operations from={from} to={to} />
      )}
    </>
  );
}
