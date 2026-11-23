'use client';

import {
  flagFor,
  selectRange,
  ageInYears,
  type LabOrder,
  type LabOrderStatus,
  type LabTest,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, TestTube, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { textareaClass, when } from '@/components/emr/shared';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { labApi } from '@/services/lab';
import { useAuth } from '@/store/auth';
import { LabStatusBadge, ReasonDialog, ResultsTable } from './lab-order-card';

const columns = (tz: string, extra?: (o: LabOrder) => React.ReactNode) => [
  {
    key: 'patient',
    header: 'Patient',
    primary: true,
    cell: (o: LabOrder) => (
      <span>
        <span className="font-medium">
          {o.patient.firstName} {o.patient.lastName}
        </span>
        <span className="block font-mono text-caption text-ink-muted">{o.patient.mrn}</span>
      </span>
    ),
  },
  {
    key: 'tests',
    header: 'Tests',
    cell: (o: LabOrder) => o.items.map((i) => i.test.name).join(', '),
  },
  {
    key: 'when',
    header: 'Ordered',
    hideOnMobile: true,
    cell: (o: LabOrder) => (
      <span className="text-body-sm">
        {when(o.createdAt, tz)}
        <span className="block text-caption text-ink-muted">
          Dr {o.orderedBy.firstName} {o.orderedBy.lastName}
        </span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (o: LabOrder) => (
      <span className="inline-flex flex-wrap gap-1">
        <LabStatusBadge status={o.status} />
        {o.priority === 'URGENT' && <Badge tone="error">Urgent</Badge>}
        {extra?.(o)}
      </span>
    ),
  },
];

/** Reception and lab: orders waiting for a sample (LAB-002). */
export function SamplesView() {
  const tz = useHospitalTz();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['lab-orders', 'samples', page],
    queryFn: () => labApi.orders({ status: 'ORDERED', page, limit: 20 }),
    refetchInterval: 60_000,
  });
  const collect = async (o: LabOrder) => {
    setBusy(o.id);
    try {
      await labApi.sample(o.id);
      toast.success(`Sample recorded for ${o.patient.firstName} ${o.patient.lastName}.`);
      void qc.invalidateQueries({ queryKey: ['lab-orders'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageHeader title="Lab samples" description="Orders waiting for a sample, urgent first." />
      <Panel>
        <DataTable<LabOrder>
          caption="Orders waiting for a sample"
          rows={q.data?.items}
          rowKey={(o) => o.id}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          empty={{ icon: TestTube, title: 'No samples waiting' }}
          columns={columns(tz)}
          actions={(o) => (
            <Button size="compact" loading={busy === o.id} onClick={() => void collect(o)}>
              Sample collected
            </Button>
          )}
        />
        {q.data && <Pagination meta={q.data.meta} onPage={setPage} />}
      </Panel>
    </>
  );
}

const WORK_STATUSES: LabOrderStatus[] = [
  'SAMPLE_COLLECTED',
  'PROCESSING',
  'REJECTED',
  'RESULT_UPLOADED',
  'APPROVED',
  'ORDERED',
];
const STATUS_LABEL: Record<string, string> = {
  SAMPLE_COLLECTED: 'Sample collected',
  PROCESSING: 'Processing',
  REJECTED: 'Sent back',
  RESULT_UPLOADED: 'Awaiting approval',
  APPROVED: 'Approved',
  ORDERED: 'Waiting for sample',
};

/** Lab technician worklist (ROLE-006). */
export function WorklistView() {
  const tz = useHospitalTz();
  const [status, setStatus] = useState<LabOrderStatus>('SAMPLE_COLLECTED');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['lab-orders', 'worklist', status, page],
    queryFn: () => labApi.orders({ status, page, limit: 20 }),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageHeader title="Lab worklist" description="Urgent orders first, then oldest first." />
      <Panel
        actions={
          <Select
            aria-label="Show orders that are"
            className="h-9 w-full sm:w-56"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as LabOrderStatus);
              setPage(1);
            }}
          >
            {WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        }
      >
        <DataTable<LabOrder>
          caption="Lab worklist"
          rows={q.data?.items}
          rowKey={(o) => o.id}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          empty={{ icon: FlaskConical, title: 'Nothing here right now' }}
          columns={columns(tz)}
          actions={(o) => (
            <Link
              href={`/dashboard/lab/orders/${o.id}`}
              className={buttonVariants({ size: 'compact' })}
            >
              Open
            </Link>
          )}
        />
        {q.data && <Pagination meta={q.data.meta} onPage={setPage} />}
      </Panel>
    </>
  );
}

/** One order for the lab: processing, result entry with live flags, report upload, review (LAB-003/004). */
export function LabOrderWork({ id }: { id: string }) {
  const tz = useHospitalTz();
  const me = useAuth((s) => s.me?.user);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lab-orders', 'one', id], queryFn: () => labApi.order(id) });
  const tests = useQuery({
    queryKey: ['lab-tests', 'all'],
    queryFn: () => labApi.tests({ limit: 100, active: true }),
    staleTime: 300_000,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'reject' | 'amend' | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (q.error)
    return (
      <Alert tone="error" title="Could not open the order">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending) return <Skeleton className="h-96" />;
  const o = q.data;
  const saved = (next: LabOrder) => {
    qc.setQueryData(['lab-orders', 'one', id], next);
    void qc.invalidateQueries({ queryKey: ['lab-orders'] });
  };
  const run = async (fn: () => Promise<LabOrder>, message: string) => {
    setBusy(true);
    try {
      saved(await fn());
      toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const editable = o.status === 'PROCESSING' || o.status === 'REJECTED';
  const testById = new Map<string, LabTest>((tests.data?.items ?? []).map((t) => [t.id, t]));
  const age = ageInYears(o.patient.dateOfBirth);
  const payload = () =>
    o.items
      .filter((i) => (values[i.id] ?? '').trim())
      .map((i) =>
        i.test.category === 'RADIOLOGY'
          ? { itemId: i.id, valueText: values[i.id]!.trim() }
          : Number.isFinite(Number(values[i.id]))
            ? { itemId: i.id, valueNumeric: Number(values[i.id]) }
            : { itemId: i.id, valueText: values[i.id]!.trim() },
      );
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Lab worklist', href: '/dashboard/lab' }]}
        title={`${o.patient.firstName} ${o.patient.lastName}`}
        description={
          <span>
            <span className="font-mono">{o.patient.mrn}</span> · {age} years ·{' '}
            {o.patient.gender.toLowerCase()} · ordered {when(o.createdAt, tz)} by Dr{' '}
            {o.orderedBy.firstName} {o.orderedBy.lastName}
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <LabStatusBadge status={o.status} />
            {o.priority === 'URGENT' && <Badge tone="error">Urgent</Badge>}
          </span>
        }
      />
      <div className="space-y-6">
        {o.clinicalNotes && (
          <Alert tone="info" title="Note from the doctor">
            {o.clinicalNotes}
          </Alert>
        )}
        {o.status === 'REJECTED' && (
          <Alert
            tone="warning"
            title={`Sent back by ${o.rejectedBy?.firstName ?? ''} ${o.rejectedBy?.lastName ?? ''}`}
          >
            {o.rejectionReason}
          </Alert>
        )}
        {o.status === 'SAMPLE_COLLECTED' && (
          <Panel>
            <div className="flex flex-wrap items-center gap-3 p-5">
              <p className="flex-1">
                Sample collected {o.sampleCollectedAt ? when(o.sampleCollectedAt, tz) : ''}.
              </p>
              <Button
                loading={busy}
                onClick={() => void run(() => labApi.processing(o.id), 'Processing started.')}
              >
                Start processing
              </Button>
            </div>
          </Panel>
        )}
        {o.status === 'ORDERED' && (
          <Alert tone="info">Waiting for the sample. Reception or the lab records it first.</Alert>
        )}
        {editable ? (
          <Panel
            title="Results"
            actions={
              <span className="flex flex-wrap gap-2">
                <input
                  ref={file}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  aria-label="Choose a PDF report"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void run(() => labApi.attach(o.id, f), `${f.name} attached.`);
                    if (file.current) file.current.value = '';
                  }}
                />
                <Button size="compact" variant="secondary" onClick={() => file.current?.click()}>
                  <Upload />
                  {o.hasReportFile ? 'Replace PDF report' : 'Attach PDF report'}
                </Button>
              </span>
            }
          >
            <ul className="divide-y divide-border">
              {o.items.map((i) => {
                const t = testById.get(i.test.id);
                const raw =
                  values[i.id] ??
                  (i.result ? String(i.result.valueNumeric ?? i.result.valueText ?? '') : '');
                const num = Number(raw);
                const range =
                  t && raw.trim() && Number.isFinite(num)
                    ? selectRange(t.ranges, o.patient.gender, age)
                    : null;
                const flag = range ? flagFor(num, range) : null;
                return (
                  <li
                    key={i.id}
                    className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
                  >
                    <div>
                      <p className="font-medium">
                        {i.test.name}{' '}
                        <span className="font-mono text-caption text-ink-muted">{i.test.code}</span>
                      </p>
                      <p className="text-caption text-ink-muted">
                        {range
                          ? `Reference ${range.low} to ${range.high}${i.test.unit ? ` ${i.test.unit}` : ''}`
                          : i.test.category === 'RADIOLOGY'
                            ? 'Findings'
                            : 'No reference range applies'}
                      </p>
                    </div>
                    {i.test.category === 'RADIOLOGY' ? (
                      <Field label={`Findings for ${i.test.name}`}>
                        {(p) => (
                          <textarea
                            id={p.id}
                            className={textareaClass}
                            maxLength={4000}
                            value={raw}
                            onChange={(e) => setValues({ ...values, [i.id]: e.target.value })}
                          />
                        )}
                      </Field>
                    ) : (
                      <div className="flex items-end gap-2">
                        <Field
                          label={`Value for ${i.test.name}${i.test.unit ? ` (${i.test.unit})` : ''}`}
                          className="flex-1"
                        >
                          {(p) => (
                            <Input
                              id={p.id}
                              inputMode="decimal"
                              value={raw}
                              onChange={(e) => setValues({ ...values, [i.id]: e.target.value })}
                            />
                          )}
                        </Field>
                        {flag && (
                          <span aria-live="polite" className="mb-2">
                            {flag === 'NORMAL' ? (
                              <Badge tone="success">Normal</Badge>
                            ) : (
                              <Badge tone="error">{flag}</Badge>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void run(() => labApi.results(o.id, payload()), 'Results saved.')}
              >
                Save
              </Button>
              <Button
                loading={busy}
                onClick={() =>
                  void run(() => labApi.results(o.id, payload(), true), 'Sent for approval.')
                }
              >
                Send for approval
              </Button>
            </div>
          </Panel>
        ) : (
          o.status !== 'ORDERED' &&
          o.status !== 'SAMPLE_COLLECTED' && (
            <Panel title="Results">
              <ResultsTable order={o} />
            </Panel>
          )
        )}
        {o.status === 'RESULT_UPLOADED' && (
          <Panel title="Review">
            <div className="flex flex-wrap items-center gap-3 p-5">
              <p className="flex-1 text-body-sm text-ink-secondary">
                A senior technician who entered none of these results approves the report or sends
                it back.
                {o.items.some((i) => i.result?.enteredBy.id === me?.id)
                  ? ' You entered results here, so another senior must review it.'
                  : ''}
              </p>
              <Button variant="secondary" onClick={() => setDialog('reject')}>
                Send back
              </Button>
              <Button
                loading={busy}
                onClick={() =>
                  void run(
                    () => labApi.approve(o.id),
                    'Report approved. The doctor and the patient can now see it.',
                  )
                }
              >
                Approve report
              </Button>
            </div>
          </Panel>
        )}
        {o.status === 'APPROVED' && (
          <Panel>
            <div className="flex flex-wrap items-center gap-3 p-5">
              <p className="flex-1 text-body-sm text-ink-secondary">
                Approved {o.approvedAt ? when(o.approvedAt, tz) : ''} by {o.approvedBy?.firstName}{' '}
                {o.approvedBy?.lastName}. Approved reports are locked; a correction is an amended
                report.
              </p>
              <Button variant="secondary" onClick={() => setDialog('amend')}>
                Amend report
              </Button>
            </div>
          </Panel>
        )}
      </div>
      {dialog === 'reject' && (
        <ReasonDialog
          title="Send back to the technician"
          label="What needs correcting"
          submitLabel="Send back"
          onClose={() => setDialog(null)}
          onSave={async (r) => saved(await labApi.reject(o.id, r))}
        />
      )}
      {dialog === 'amend' && (
        <ReasonDialog
          title="Amend this approved report"
          label="Reason for the amendment"
          submitLabel="Create amended report"
          onClose={() => setDialog(null)}
          onSave={async (r) => {
            const a = await labApi.amend(o.id, r);
            router.push(`/dashboard/lab/orders/${a.id}`);
          }}
        />
      )}
    </>
  );
}
