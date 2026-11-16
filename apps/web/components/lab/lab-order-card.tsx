'use client';

import type { LabOrder, LabOrderStatus, LabResult } from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Download,
  FlaskConical,
  RotateCcw,
  TestTube,
} from 'lucide-react';
import { useState } from 'react';
import { EntryDialog, textareaClass, when } from '@/components/emr/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { labApi } from '@/services/lab';
import { saveBlob } from '@/services/prescriptions';
import { useAuth } from '@/store/auth';

const STATUS: Record<
  LabOrderStatus,
  {
    label: string;
    tone: 'info' | 'sage' | 'warning' | 'success' | 'neutral' | 'error';
    icon: typeof Clock;
  }
> = {
  ORDERED: { label: 'Ordered', tone: 'info', icon: Clock },
  SAMPLE_COLLECTED: { label: 'Sample collected', tone: 'info', icon: TestTube },
  PROCESSING: { label: 'Processing', tone: 'warning', icon: FlaskConical },
  RESULT_UPLOADED: { label: 'Awaiting approval', tone: 'warning', icon: Clock },
  APPROVED: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  REJECTED: { label: 'Sent back to lab', tone: 'error', icon: RotateCcw },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: CircleSlash },
};

export function LabStatusBadge({ status }: { status: LabOrderStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/** A value with its flag: tomato and the words HIGH or LOW, so meaning survives without colour (LAB-006). */
export function FlagValue({ r }: { r: LabResult }) {
  const out = r.flag === 'HIGH' || r.flag === 'LOW';
  return (
    <span className={out ? 'font-semibold text-tomato-700' : ''}>
      {r.valueNumeric != null ? <span className="font-mono">{r.valueNumeric}</span> : r.valueText}
      {r.unit && r.valueNumeric != null && <span className="text-ink-secondary"> {r.unit}</span>}
      {out && (
        <span className="ml-1 inline-flex items-center gap-0.5 text-caption">
          <AlertTriangle className="size-3" aria-hidden="true" />
          {r.flag}
        </span>
      )}
    </span>
  );
}

export function ResultsTable({ order }: { order: LabOrder }) {
  return (
    <table className="w-full text-body-sm">
      <caption className="sr-only">Results</caption>
      <thead className="text-left text-caption text-ink-secondary">
        <tr>
          <th className="px-4 py-1.5 font-medium">Test</th>
          <th className="px-2 py-1.5 font-medium">Result</th>
          <th className="px-4 py-1.5 font-medium">Reference</th>
        </tr>
      </thead>
      <tbody>
        {order.items.map((i) => (
          <tr key={i.id} className="border-t border-border align-top">
            <td className="px-4 py-2">
              {i.test.name}
              <span className="block font-mono text-caption text-ink-muted">{i.test.code}</span>
            </td>
            <td className="px-2 py-2">
              {i.result ? (
                <FlagValue r={i.result} />
              ) : (
                <span className="text-ink-muted">
                  {order.hasReportFile ? 'See attached report' : 'Not entered'}
                </span>
              )}
            </td>
            <td className="px-4 py-2 font-mono text-caption text-ink-secondary">
              {i.result?.referenceLow != null
                ? `${i.result.referenceLow} to ${i.result.referenceHigh}`
                : '–'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One order as doctors, nurses and patients see it: status trail, results once approved, PDFs. */
export function LabOrderCard({
  order,
  tz,
  showPatient,
}: {
  order: LabOrder;
  tz: string;
  showPatient?: boolean;
}) {
  const me = useAuth((s) => s.me?.user);
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const download = async (fn: () => Promise<Blob>, name: string) => {
    setBusy(true);
    try {
      saveBlob(await fn(), name);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const trail = [
    `Ordered ${when(order.createdAt, tz)} by Dr ${order.orderedBy.firstName} ${order.orderedBy.lastName}`,
    order.sampleCollectedAt && `sample ${when(order.sampleCollectedAt, tz)}`,
    order.approvedAt &&
      `approved ${when(order.approvedAt, tz)} by ${order.approvedBy?.firstName} ${order.approvedBy?.lastName}`,
  ].filter(Boolean);
  return (
    <article
      aria-label={`Lab order of ${when(order.createdAt, tz)}`}
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <LabStatusBadge status={order.status} />
        {order.priority === 'URGENT' && <Badge tone="error">Urgent</Badge>}
        {order.amendsLabOrderId && <Badge tone="info">Amended report</Badge>}
        <span className="text-body-sm text-ink-secondary">
          {showPatient && (
            <>
              {order.patient.firstName} {order.patient.lastName}{' '}
              <span className="font-mono">{order.patient.mrn}</span> ·{' '}
            </>
          )}
          {trail.join(' · ')}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {order.status === 'APPROVED' && (
            <Button
              size="compact"
              variant="secondary"
              loading={busy}
              onClick={() =>
                void download(
                  () => labApi.report(order.id),
                  `lab-report-${order.id.slice(0, 8)}.pdf`,
                )
              }
            >
              <Download />
              Report PDF
            </Button>
          )}
          {order.status === 'APPROVED' && order.hasReportFile && (
            <Button
              size="compact"
              variant="ghost"
              loading={busy}
              onClick={() =>
                void download(
                  () => labApi.reportFile(order.id),
                  `lab-attachment-${order.id.slice(0, 8)}.pdf`,
                )
              }
            >
              Attached report
            </Button>
          )}
          {order.status === 'ORDERED' && me?.id === order.orderedBy.id && (
            <Button size="compact" variant="ghost" onClick={() => setCancelling(true)}>
              Cancel
            </Button>
          )}
        </span>
      </header>
      {order.resultsVisible ? (
        <ResultsTable order={order} />
      ) : (
        <ul className="px-4 py-2.5 text-body-sm">
          {order.items.map((i) => (
            <li key={i.id}>
              {i.test.name}{' '}
              <span className="font-mono text-caption text-ink-muted">{i.test.code}</span>
            </li>
          ))}
          {order.status !== 'CANCELLED' && (
            <li className="mt-1 text-caption text-ink-muted">
              Results appear here once a senior technician approves them.
            </li>
          )}
        </ul>
      )}
      {(order.clinicalNotes || order.cancellationReason || order.amendmentReason) && (
        <div className="space-y-1 border-t border-border px-4 py-2.5 text-body-sm text-ink-secondary">
          {order.clinicalNotes && (
            <p>
              <span className="font-medium text-ink">Note to lab:</span> {order.clinicalNotes}
            </p>
          )}
          {order.amendmentReason && (
            <p>
              <span className="font-medium text-ink">Amended:</span> {order.amendmentReason}
            </p>
          )}
          {order.cancellationReason && (
            <p>
              <span className="font-medium text-ink">Cancelled:</span> {order.cancellationReason}
            </p>
          )}
        </div>
      )}
      {cancelling && (
        <ReasonDialog
          title="Cancel this lab order?"
          label="Reason"
          submitLabel="Cancel order"
          onClose={() => setCancelling(false)}
          onSave={async (reason) => {
            await labApi.cancel(order.id, reason);
            void qc.invalidateQueries({ queryKey: ['lab-orders'] });
          }}
        />
      )}
    </article>
  );
}

export function ReasonDialog({
  title,
  label,
  submitLabel,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  submitLabel: string;
  onClose: () => void;
  onSave: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  return (
    <EntryDialog
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      onSave={async () => {
        if (reason.trim().length < 3) throw new Error('Give a reason (at least 3 characters).');
        await onSave(reason.trim());
      }}
    >
      <Field label={label} required className="sm:col-span-2">
        {(p) => (
          <textarea
            id={p.id}
            className={textareaClass}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </EntryDialog>
  );
}
