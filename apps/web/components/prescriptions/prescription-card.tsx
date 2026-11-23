'use client';

import {
  FREQUENCY_LABEL,
  type Prescription,
  type PrescriptionEventKind,
  type PrescriptionStatus,
} from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import { CircleSlash, Clock, Download, PackageCheck, Pill, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { EntryDialog, textareaClass, when } from '@/components/emr/shared';
import { errorMessage } from '@/lib/forms';
import { prescriptionsApi, saveBlob } from '@/services/prescriptions';
import { useAuth } from '@/store/auth';

const STATUS: Record<
  PrescriptionStatus,
  { label: string; tone: 'info' | 'sage' | 'warning' | 'success' | 'neutral'; icon: typeof Pill }
> = {
  ISSUED: { label: 'Issued', tone: 'info', icon: Pill },
  READY_FOR_PICKUP: { label: 'Ready for collection', tone: 'sage', icon: PackageCheck },
  PARTIALLY_DISPENSED: { label: 'Partly dispensed', tone: 'warning', icon: Clock },
  DISPENSED: { label: 'Dispensed', tone: 'success', icon: PackageCheck },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: CircleSlash },
};

const EVENT_LABEL: Record<PrescriptionEventKind, string> = {
  ISSUED: 'Issued',
  VERIFIED: 'Verified by the pharmacy',
  DISPENSED: 'Dispensed',
  HANDED_OVER: 'Handed over',
  CANCELLED: 'Cancelled',
  BASELINE: 'History recorded from here',
};

/** M-10: the prescription's append-only history, oldest first. */
export function PrescriptionTimeline({ rx, tz }: { rx: Prescription; tz: string }) {
  if (rx.history.length === 0) return null;
  return (
    <ol aria-label="Prescription history" className="space-y-2 border-l border-border pl-4">
      {rx.history.map((e, i) => (
        <li key={i} className="text-body-sm">
          <span className="font-medium">{EVENT_LABEL[e.kind]}</span>
          {e.kind === 'DISPENSED' && (
            <span className="text-ink-secondary">
              {e.status === 'READY_FOR_PICKUP' ? ', ready for collection' : ', partly'}
            </span>
          )}
          <span className="block text-caption text-ink-muted">
            {when(e.occurredAt, tz)}
            {e.actor ? ` · ${e.actor.firstName} ${e.actor.lastName}` : ''}
            {e.reason ? ` · ${e.reason}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PrescriptionStatusBadge({ status }: { status: PrescriptionStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/** PDF download: shows "being prepared" until the worker has stored it (RX-002). */
export function PdfButton({ rx, onChanged }: { rx: Prescription; onChanged?: () => void }) {
  const me = useAuth((s) => s.me?.user);
  const [busy, setBusy] = useState(false);
  if (rx.status === 'CANCELLED') return null;
  const download = async () => {
    setBusy(true);
    try {
      saveBlob(await prescriptionsApi.pdf(rx.id), `prescription-${rx.id.slice(0, 8)}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };
  if (rx.pdfReady)
    return (
      <Button size="compact" variant="secondary" loading={busy} onClick={() => void download()}>
        <Download />
        PDF<span className="sr-only"> of prescription {rx.id.slice(0, 8)}</span>
      </Button>
    );
  const issuer = me?.role === 'DOCTOR' && me.id === rx.doctor.userId;
  return (
    <span className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
      PDF being prepared
      <Button size="compact" variant="ghost" onClick={() => onChanged?.()}>
        Refresh
      </Button>
      {issuer && (
        <Button
          size="compact"
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await prescriptionsApi.retryPdf(rx.id);
              onChanged?.();
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Request again
        </Button>
      )}
    </span>
  );
}

/** One prescription: items with dose and instructions, status, PDF, cancel for the prescribing doctor. */
export function PrescriptionCard({
  rx,
  tz,
  showPatient,
}: {
  rx: Prescription;
  tz: string;
  showPatient?: boolean;
}) {
  const me = useAuth((s) => s.me?.user);
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['prescriptions'] });
  const canCancel =
    me?.role === 'DOCTOR' &&
    me.id === rx.doctor.userId &&
    rx.status === 'ISSUED' &&
    rx.items.every((i) => i.dispensedQuantity === 0);
  return (
    <article
      aria-label={`Prescription of ${when(rx.issuedAt, tz)}`}
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <PrescriptionStatusBadge status={rx.status} />
        <span className="text-body-sm text-ink-secondary">
          {when(rx.issuedAt, tz)} · Dr {rx.doctor.firstName} {rx.doctor.lastName}
          {showPatient && (
            <>
              {' '}
              · {rx.patient.firstName} {rx.patient.lastName}{' '}
              <span className="font-mono">{rx.patient.mrn}</span>
            </>
          )}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <PdfButton rx={rx} onChanged={refresh} />
          {canCancel && (
            <Button size="compact" variant="ghost" onClick={() => setCancelling(true)}>
              Cancel
            </Button>
          )}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rx.items.map((i) => (
          <li
            key={i.id}
            className="grid gap-1 px-4 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
          >
            <div>
              <p className="font-medium">
                {i.medicine.name} {i.medicine.strength}
              </p>
              <p className="text-caption text-ink-muted">
                {i.medicine.form.toLowerCase()}
                {i.medicine.genericName ? ` · ${i.medicine.genericName}` : ''}
              </p>
            </div>
            <p className="text-body-sm">
              {i.dosage} · {i.frequency} ({FREQUENCY_LABEL[i.frequency].toLowerCase()}) ·{' '}
              {i.durationDays} days
              {i.instructions && <span className="block text-ink-secondary">{i.instructions}</span>}
            </p>
            <p className="font-mono text-body-sm sm:text-right">
              {i.dispensedQuantity > 0
                ? `${i.dispensedQuantity} of ${i.quantity}`
                : `Qty ${i.quantity}`}
            </p>
          </li>
        ))}
      </ul>
      {(rx.notes || rx.allergyOverrideReason || rx.cancellationReason) && (
        <div className="space-y-1 border-t border-border px-4 py-2.5 text-body-sm">
          {rx.notes && (
            <p>
              <span className="font-medium">Notes:</span> {rx.notes}
            </p>
          )}
          {rx.allergyOverrideReason && (
            <p className="text-tomato-700">
              <ShieldAlert className="mr-1 inline size-3.5" aria-hidden="true" />
              <span className="font-medium">Allergy acknowledged:</span> {rx.allergyOverrideReason}
            </p>
          )}
          {rx.cancellationReason && (
            <p className="text-ink-secondary">
              <span className="font-medium">Cancelled:</span> {rx.cancellationReason}
            </p>
          )}
        </div>
      )}
      {cancelling && <CancelDialog rx={rx} onClose={() => setCancelling(false)} onDone={refresh} />}
    </article>
  );
}

function CancelDialog({
  rx,
  onClose,
  onDone,
}: {
  rx: Prescription;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <EntryDialog
      title="Cancel this prescription?"
      submitLabel="Cancel prescription"
      onClose={onClose}
      onSave={async () => {
        if (reason.trim().length < 3) throw new Error('Give a reason for the cancellation.');
        await prescriptionsApi.cancel(rx.id, reason.trim());
        onDone();
      }}
    >
      <p className="text-body-sm text-ink-secondary sm:col-span-2">
        The prescription stays in the record, marked cancelled. Issue a new one if the patient still
        needs medicines.
      </p>
      <Field label="Reason" required className="sm:col-span-2">
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
