'use client';

import {
  allocateFifo,
  type Prescription,
  type PrescriptionStatus,
  type StockBatch,
} from '@medcore/types';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, PackageCheck, Pill } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { when } from '@/components/emr/shared';
import {
  PrescriptionStatusBadge,
  PrescriptionTimeline,
} from '@/components/prescriptions/prescription-card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field, Input, Select } from '@/components/ui/field';
import { Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { pharmacyApi } from '@/services/pharmacy';
import { prescriptionsApi } from '@/services/prescriptions';
import { day } from './shared';

const TABS: { value: '' | PrescriptionStatus; label: string }[] = [
  { value: '', label: 'Waiting (to verify or dispense)' },
  { value: 'READY_FOR_PICKUP', label: 'Ready for collection' },
  { value: 'DISPENSED', label: 'Handed over' },
];

/** Verification and dispensing queue (PHARM-006), oldest first. */
export function PharmacyQueueView() {
  const tz = useHospitalTz();
  const [status, setStatus] = useState<'' | PrescriptionStatus>('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['pharmacy-queue', status, page],
    queryFn: () => pharmacyApi.queue({ page, limit: 20, ...(status ? { status } : {}) }),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageHeader
        title="Pharmacy queue"
        description="Prescriptions to verify, dispense and hand over, oldest first."
      />
      <Panel
        actions={
          <Select
            aria-label="Show"
            className="h-9 w-72"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | PrescriptionStatus);
              setPage(1);
            }}
          >
            {TABS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        }
      >
        <DataTable<Prescription>
          caption="Pharmacy queue"
          rows={q.data?.items}
          rowKey={(p) => p.id}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          empty={{ icon: ClipboardCheck, title: 'Nothing waiting' }}
          columns={[
            {
              key: 'p',
              header: 'Patient',
              primary: true,
              cell: (p) => (
                <span>
                  <span className="font-medium">
                    {p.patient.firstName} {p.patient.lastName}
                  </span>
                  <span className="block font-mono text-caption text-ink-muted">
                    {p.patient.mrn}
                  </span>
                </span>
              ),
            },
            {
              key: 'items',
              header: 'Medicines',
              cell: (p) => p.items.map((i) => i.medicine.name).join(', '),
            },
            {
              key: 'when',
              header: 'Issued',
              hideOnMobile: true,
              cell: (p) => (
                <span className="text-body-sm">
                  {when(p.issuedAt, tz)}
                  <span className="block text-caption text-ink-muted">
                    Dr {p.doctor.firstName} {p.doctor.lastName}
                  </span>
                </span>
              ),
            },
            {
              key: 'st',
              header: 'Status',
              cell: (p) => (
                <span className="inline-flex flex-wrap items-center gap-1">
                  <PrescriptionStatusBadge status={p.status} />
                  {p.status === 'ISSUED' && !p.verifiedAt && (
                    <span className="text-caption text-ink-secondary">Not verified</span>
                  )}
                  {p.allergyOverrideReason && (
                    <span className="inline-flex items-center gap-0.5 text-caption font-semibold text-tomato-700">
                      <AlertTriangle className="size-3" aria-hidden="true" />
                      Allergy noted
                    </span>
                  )}
                </span>
              ),
            },
          ]}
          actions={(p) => (
            <Link
              href={`/dashboard/pharmacy/prescriptions/${p.id}`}
              className="inline-flex h-8 items-center rounded-md bg-sage-600 px-3 text-body-sm font-medium text-white hover:bg-sage-700"
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

/** One prescription at the pharmacy: verify, dispense with a FIFO preview, hand over. */
export function PharmacyPrescriptionView({ id }: { id: string }) {
  const tz = useHospitalTz();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prescription', id], queryFn: () => prescriptionsApi.get(id) });
  const [give, setGive] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const medicineIds = [...new Set(q.data?.items.map((i) => i.medicine.id) ?? [])];
  const stock = useQueries({
    queries: medicineIds.map((m) => ({
      queryKey: ['batches', m],
      queryFn: () => pharmacyApi.batches(m),
    })),
  });
  if (q.error)
    return (
      <Alert tone="error" title="Could not open the prescription">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending) return <Skeleton className="h-96" />;
  const p = q.data;
  const batchesOf = new Map<string, StockBatch[]>(
    medicineIds.map((m, i) => [m, stock[i]?.data ?? []]),
  );
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const waiting = p.status === 'ISSUED' || p.status === 'PARTIALLY_DISPENSED';
  const canDispense = waiting && !!p.verifiedAt;
  const done = (next: Prescription, message: string) => {
    qc.setQueryData(['prescription', id], next);
    void qc.invalidateQueries({ queryKey: ['pharmacy-queue'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
    void qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
    setGive({});
    toast.success(message);
  };
  const run = async (fn: () => Promise<Prescription>, message: string) => {
    setBusy(true);
    try {
      done(await fn(), message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const lines = p.items
    .map((i) => ({
      item: i,
      remaining: i.quantity - i.dispensedQuantity,
      n: Number(give[i.id] ?? ''),
    }))
    .filter((l) => l.n > 0);
  return (
    <>
      <PageHeader
        title={`${p.patient.firstName} ${p.patient.lastName}`}
        description={
          <span>
            <span className="font-mono">{p.patient.mrn}</span> · issued {when(p.issuedAt, tz)} by Dr{' '}
            {p.doctor.firstName} {p.doctor.lastName}
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <PrescriptionStatusBadge status={p.status} />
            <Link href="/dashboard/pharmacy" className="text-body-sm text-sage-700 underline">
              Back to queue
            </Link>
          </span>
        }
      />
      <div className="space-y-6">
        {p.allergyOverrideReason && (
          <Alert tone="warning" title="Prescribed despite a recorded allergy">
            The doctor noted: {p.allergyOverrideReason}
          </Alert>
        )}
        {p.notes && (
          <Alert tone="info" title="Note from the doctor">
            {p.notes}
          </Alert>
        )}
        {p.status === 'ISSUED' && !p.verifiedAt && (
          <Panel>
            <div className="flex flex-wrap items-center gap-3 p-5">
              <p className="flex-1 text-body-sm text-ink-secondary">
                Check the medicines, doses and any allergy note, then record your verification.
                Dispensing opens after that.
              </p>
              <Button
                loading={busy}
                onClick={() =>
                  void run(() => pharmacyApi.verify(id), 'Verified. You can dispense now.')
                }
              >
                Verify prescription
              </Button>
            </div>
          </Panel>
        )}
        {p.verifiedAt && (
          <p className="text-body-sm text-ink-secondary">
            Verified {when(p.verifiedAt, tz)}
            {p.verifiedBy ? ` by ${p.verifiedBy.firstName} ${p.verifiedBy.lastName}` : ''}.
          </p>
        )}
        <Panel title="Medicines">
          <ul className="divide-y divide-border">
            {p.items.map((i) => {
              const remaining = i.quantity - i.dispensedQuantity;
              const n = Number(give[i.id] ?? '');
              const batches = batchesOf.get(i.medicine.id) ?? [];
              const plan = n > 0 ? allocateFifo(batches, n, today) : null;
              const byId = new Map(batches.map((b) => [b.id, b]));
              return (
                <li
                  key={i.id}
                  className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <div>
                    <p className="font-medium">
                      {i.medicine.name} {i.medicine.strength}
                    </p>
                    <p className="text-body-sm text-ink-secondary">
                      {i.dosage} · {i.frequency} · {i.durationDays} days
                      {i.instructions ? ` · ${i.instructions}` : ''}
                    </p>
                    <p className="mt-1 text-body-sm">
                      Prescribed <span className="font-mono">{i.quantity}</span> · given{' '}
                      <span className="font-mono">{i.dispensedQuantity}</span> · left{' '}
                      <span className="font-mono">{remaining}</span>
                    </p>
                  </div>
                  {canDispense && remaining > 0 && (
                    <div>
                      <Field
                        label={`Units to give of ${i.medicine.name}`}
                        hint={`Up to ${remaining}`}
                      >
                        {(fp) => (
                          <Input
                            id={fp.id}
                            aria-describedby={fp.describedBy}
                            type="number"
                            min={1}
                            max={remaining}
                            value={give[i.id] ?? ''}
                            onChange={(e) => setGive({ ...give, [i.id]: e.target.value })}
                          />
                        )}
                      </Field>
                      {plan && (
                        <div aria-live="polite" className="mt-2 text-body-sm">
                          {plan.allocations.length > 0 && (
                            <p>
                              From{' '}
                              {plan.allocations
                                .map(
                                  (a) =>
                                    `${byId.get(a.batchId)?.batchNumber} (${a.quantity}, expires ${day(byId.get(a.batchId)!.expiresOn)})`,
                                )
                                .join(', ')}
                            </p>
                          )}
                          {plan.short > 0 && (
                            <p className="font-semibold text-tomato-700">
                              Only {n - plan.short} in usable stock.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {canDispense && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              <p className="mr-auto text-caption text-ink-muted">
                Stock is taken from the batch that expires first. Expired and quarantined stock is
                never used.
              </p>
              <Button
                loading={busy}
                disabled={lines.length === 0 || lines.some((l) => l.n > l.remaining)}
                onClick={() =>
                  void run(
                    () =>
                      pharmacyApi.dispense(
                        id,
                        lines.map((l) => ({ itemId: l.item.id, quantity: l.n })),
                      ),
                    'Dispensed.',
                  )
                }
              >
                <Pill />
                Dispense
              </Button>
            </div>
          )}
        </Panel>
        {p.status === 'READY_FOR_PICKUP' && (
          <Panel>
            <div className="flex flex-wrap items-center gap-3 p-5">
              <p className="flex-1 text-body-sm text-ink-secondary">
                Everything is prepared. Hand the medicines to the patient, then record it.
              </p>
              <Button
                loading={busy}
                onClick={() => void run(() => pharmacyApi.handover(id), 'Handed over.')}
              >
                <PackageCheck />
                Handed over
              </Button>
            </div>
          </Panel>
        )}
        <Panel title="History">
          <div className="p-5">
            <PrescriptionTimeline rx={p} tz={tz} />
          </div>
        </Panel>
        {p.status === 'CANCELLED' && (
          <Alert tone="info">
            This prescription was cancelled
            {p.cancellationReason ? `: ${p.cancellationReason}` : '.'}
          </Alert>
        )}
      </div>
    </>
  );
}
