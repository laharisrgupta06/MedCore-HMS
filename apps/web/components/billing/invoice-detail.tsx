'use client';

import {
  CORRECTION_REQUEST_KINDS,
  type CorrectionRequestKind,
  type InvoiceView,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { fmtDate, localDate, useHospitalTz } from '@/lib/time';
import { invoicesApi } from '@/services/invoices';
import { useAuth } from '@/store/auth';
import {
  BLOCKER_TEXT,
  DOCUMENT_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  documentTitle,
  rupees,
  treatmentText,
} from './invoice-format';
import { PaymentsPanel } from './payments-panel';
import { ClaimsPanel } from './claims-panel';

/**
 * One invoice (BILL-001..003). Staff act on it by role (receptionist, accountant); the hospital admin
 * reads it; a patient sees an issued document of their own, without history or requests. The API and
 * database refuse anything not allowed, whatever this screen shows.
 */
const CORRECTION_LABEL: Record<CorrectionRequestKind, string> = {
  CANCEL_DOCUMENT: 'Cancel the document',
  CHANGE_AMOUNTS: 'Change amounts',
  WRONG_PATIENT: 'Wrong patient',
  WRONG_DETAILS: 'Wrong details',
};

export function InvoiceDetail({ id, patient = false }: { id: string; patient?: boolean }) {
  const role = useAuth((s) => s.me?.user.role);
  const tz = useHospitalTz();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => invoicesApi.get(id) });
  const [dialog, setDialog] = useState<
    null | 'charge' | 'discount' | 'finalise' | 'void' | 'correction' | { note: string }
  >(null);
  const [busy, setBusy] = useState(false);
  const base = patient ? '/portal/invoices' : '/dashboard/invoices';
  const staff = role === 'RECEPTIONIST' || role === 'ACCOUNTANT';
  const accountant = role === 'ACCOUNTANT';

  const run = async (
    fn: () => Promise<InvoiceView | { invoice: InvoiceView; message: string }>,
    done: string,
    go?: (v: InvoiceView) => void,
  ) => {
    setBusy(true);
    try {
      const r = await fn();
      const v = 'invoice' in r ? r.invoice : r;
      toast.success('message' in r ? r.message : done);
      qc.setQueryData(['invoice', v.id], v);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      setDialog(null);
      go?.(v);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <Skeleton className="h-[30rem] w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load the invoice">
        {errorMessage(q.error)}
      </Alert>
    );
  const inv = q.data;
  const draft = inv.status === 'DRAFT';
  const issued = ['FINALISED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status);
  const live = inv.lines.filter((l) => !l.releasedAt);

  return (
    <>
      <PageHeader
        crumbs={[{ label: patient ? 'My bills' : 'Invoices', href: base }]}
        title={documentTitle(inv)}
        description={`${inv.patient.name} (${inv.patient.mrn}), visit of ${fmtDate(inv.appointment.scheduledAt, tz)} with Dr ${inv.appointment.doctorName}`}
      />
      <div className="flex flex-col gap-6">
        <Panel>
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1.5 text-body-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                {inv.kind === 'LATE_CHARGES' && <Badge tone="neutral">Late charges</Badge>}
                {inv.documentType && (
                  <span className="text-ink-secondary">{DOCUMENT_LABEL[inv.documentType]}</span>
                )}
              </p>
              {inv.issueDate && (
                <p className="text-ink-secondary">
                  Issued {fmtDate(`${inv.issueDate}T12:00:00Z`, tz)}
                </p>
              )}
              {inv.seller?.gstin && (
                <p className="text-ink-secondary">
                  {inv.seller.legalName}, GSTIN{' '}
                  <span className="font-mono">{inv.seller.gstin}</span>
                </p>
              )}
              {inv.relatedInvoiceId && (
                <p>
                  Follows{' '}
                  <Link className="mc-link" href={`${base}/${inv.relatedInvoiceId}`}>
                    the original invoice
                  </Link>
                </p>
              )}
              {inv.lateChargeInvoiceIds.map((lid, i) => (
                <p key={lid}>
                  <Link className="mc-link" href={`${base}/${lid}`}>
                    Late charges {i + 1}
                  </Link>
                </p>
              ))}
              {inv.status === 'VOID' && inv.voidReason && (
                <p className="text-ink-secondary">Voided: {inv.voidReason}</p>
              )}
            </div>
            {staff && (
              <div className="flex flex-wrap gap-2">
                {draft && (
                  <>
                    <Button size="compact" variant="secondary" onClick={() => setDialog('charge')}>
                      <Plus aria-hidden="true" /> Add charge
                    </Button>
                    <Button
                      size="compact"
                      variant="secondary"
                      loading={busy}
                      onClick={() =>
                        run(
                          () => invoicesApi.reresolve(id),
                          'Tax re-applied from current settings.',
                        )
                      }
                    >
                      Re-resolve tax
                    </Button>
                    {accountant && (
                      <Button
                        size="compact"
                        variant="secondary"
                        onClick={() => setDialog('discount')}
                      >
                        Discount
                      </Button>
                    )}
                    <Button size="compact" variant="danger" onClick={() => setDialog('void')}>
                      Void draft
                    </Button>
                    <Button
                      size="compact"
                      disabled={inv.finaliseBlockers.length > 0}
                      onClick={() => setDialog('finalise')}
                    >
                      Finalise
                    </Button>
                  </>
                )}
                {inv.status === 'VOID' && (
                  <Button
                    size="compact"
                    loading={busy}
                    onClick={() =>
                      run(
                        () => invoicesApi.create(inv.appointment.id),
                        'Replacement draft created with the released charges.',
                        (v) => router.push(`${base}/${v.id}`),
                      )
                    }
                  >
                    Create replacement draft
                  </Button>
                )}
                {issued && (
                  <>
                    {inv.kind === 'ORIGINAL' && (
                      <Button
                        size="compact"
                        variant="secondary"
                        loading={busy}
                        onClick={() =>
                          run(
                            () => invoicesApi.lateCharges(id),
                            'Late-charge draft created.',
                            (v) => router.push(`${base}/${v.id}`),
                          )
                        }
                      >
                        Add late charges
                      </Button>
                    )}
                    <Button
                      size="compact"
                      variant="secondary"
                      onClick={() => setDialog('correction')}
                    >
                      Request correction
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          {staff && draft && inv.finaliseBlockers.length > 0 && (
            <div className="px-5 pb-5">
              <Alert tone="warning" title="Not ready to finalise">
                <ul className="list-disc pl-5">
                  {inv.finaliseBlockers.map((b) => (
                    <li key={b}>{BLOCKER_TEXT[b] ?? b}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
          {issued && staff && (
            <p className="border-t border-border px-5 py-3 text-caption text-ink-muted">
              Issued documents never change in MedCore. Corrections and cancellations are handled by
              the accountant outside MedCore; record a request here.
            </p>
          )}
        </Panel>

        <Panel title="Charges">
          {inv.lines.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={ReceiptText} title="No charges yet">
                Consultations, lab tests and dispensed medicines appear here automatically.
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <caption className="sr-only">Charges on this invoice</caption>
                <thead className="border-b border-border text-left text-caption text-ink-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Charge</th>
                    <th className="px-3 py-2 font-medium">Tax</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Discount</th>
                    <th className="px-3 py-2 text-right font-medium">Tax amount</th>
                    <th className="px-5 py-2 text-right font-medium">Total</th>
                    {staff && draft && (
                      <th className="px-3 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr
                      key={l.id}
                      className={`border-b border-border last:border-0 ${l.releasedAt ? 'text-ink-muted line-through' : ''}`}
                    >
                      <td className="px-5 py-2.5">
                        <span className="font-medium">{l.description}</span>
                        <span className="block text-caption text-ink-muted">
                          {l.quantity} × {rupees(l.unitPrice)} ·{' '}
                          {fmtDate(`${l.serviceDate}T12:00:00Z`, tz)}
                          {l.hsnSac
                            ? ` · ${l.supplyType === 'GOODS' ? 'HSN' : 'SAC'} ${l.hsnSac}`
                            : ''}
                          {l.releasedAt ? ' · released for a replacement draft' : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {l.unclassified ? (
                          <Badge tone="warning">Not classified</Badge>
                        ) : (
                          treatmentText(l)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">{rupees(l.grossAmount)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {Number(l.discountShare) ? `−${rupees(l.discountShare)}` : ''}
                      </td>
                      <td className="px-3 py-2.5 text-right">{rupees(l.taxAmount)}</td>
                      <td className="px-5 py-2.5 text-right">{rupees(l.lineTotal)}</td>
                      {staff && draft && (
                        <td className="px-3 py-2.5 text-right">
                          {l.manual && (
                            <Button
                              size="compact"
                              variant="ghost"
                              loading={busy}
                              onClick={() =>
                                run(() => invoicesApi.removeLine(id, l.id), 'Charge removed.')
                              }
                            >
                              Remove
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border px-5 py-4 text-body-sm sm:ml-auto sm:w-80">
            <dt className="text-ink-secondary">Taxable value</dt>
            <dd className="text-right">{rupees(inv.subtotal)}</dd>
            <dt className="text-ink-secondary">GST</dt>
            <dd className="text-right">{rupees(inv.taxAmount)}</dd>
            {Number(inv.discountAmount) > 0 && (
              <>
                <dt className="text-ink-secondary">
                  Discount included{inv.discountReason ? ` (${inv.discountReason})` : ''}
                </dt>
                <dd className="text-right">{rupees(inv.discountAmount)}</dd>
              </>
            )}
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">{rupees(inv.total)}</dd>
          </dl>
          {inv.status === 'VOID' && live.length === 0 && staff && (
            <p className="border-t border-border px-5 py-3 text-caption text-ink-muted">
              The charges of a void draft are released: a replacement draft for this visit bills
              them again.
            </p>
          )}
        </Panel>

        {issued && <PaymentsPanel invoiceId={inv.id} patient={patient} />}

        {issued && !patient && <ClaimsPanel invoiceId={inv.id} />}

        {!patient && (inv.correctionRequests.length > 0 || inv.events.length > 0) && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Correction requests">
              {inv.correctionRequests.length === 0 ? (
                <p className="p-5 text-body-sm text-ink-secondary">None.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {inv.correctionRequests.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 px-5 py-3 text-body-sm">
                      <p>
                        <span className="font-medium">{CORRECTION_LABEL[r.kind]}</span>{' '}
                        <span className="text-ink-muted">
                          by {r.requestedByName}, {fmtDate(r.createdAt, tz)}
                        </span>
                      </p>
                      <p>{r.description}</p>
                      {r.notes.map((n, i) => (
                        <p key={i} className="rounded-md bg-surface-muted px-3 py-2">
                          {n.note}
                          {n.externalReference ? ` (ref. ${n.externalReference})` : ''}{' '}
                          <span className="text-caption text-ink-muted">
                            · {n.authorName}, {fmtDate(n.createdAt, tz)}
                          </span>
                        </p>
                      ))}
                      {accountant && (
                        <div>
                          <Button
                            size="compact"
                            variant="ghost"
                            onClick={() => setDialog({ note: r.id })}
                          >
                            Add outcome note
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="History">
              <ol className="divide-y divide-border">
                {inv.events.map((e, i) => (
                  <li key={i} className="px-5 py-2.5 text-body-sm">
                    <span className="font-medium">{EVENT_LABEL[e.kind]}</span>{' '}
                    <span className="text-ink-muted">
                      by {e.actorName}, {fmtDate(e.createdAt, tz)}
                    </span>
                    {e.note && (
                      <span className="block text-caption text-ink-secondary">{e.note}</span>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        )}
      </div>

      {dialog === 'charge' && (
        <ChargeDialog
          invoice={inv}
          tz={tz}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(b) => run(() => invoicesApi.addLine(id, b), 'Charge added.')}
        />
      )}
      {dialog === 'discount' && (
        <DiscountDialog
          invoice={inv}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(a, r) =>
            run(
              () => invoicesApi.discount(id, a, r),
              Number(a) ? 'Discount applied.' : 'Discount removed.',
            )
          }
        />
      )}
      {dialog === 'finalise' && (
        <Confirm
          title="Finalise this invoice?"
          busy={busy}
          action="Finalise and issue"
          onClose={() => setDialog(null)}
          onConfirm={() => run(() => invoicesApi.finalise(id), 'Invoice issued.')}
        >
          It receives its document number now and can never be changed or cancelled in MedCore
          afterwards. Total {rupees(inv.total)}.
        </Confirm>
      )}
      {dialog === 'void' && (
        <ReasonDialog
          title="Void this draft?"
          label="Reason"
          action="Void draft"
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(r) =>
            run(
              () => invoicesApi.void(id, r),
              'Draft voided. Its charges are released for a replacement draft.',
            )
          }
          hint="No number is used. The draft and its charges stay in the history."
        />
      )}
      {dialog === 'correction' && (
        <CorrectionDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(k, d) => run(() => invoicesApi.requestCorrection(id, k, d), '')}
        />
      )}
      {dialog && typeof dialog === 'object' && (
        <NoteDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(n, ref) =>
            run(() => invoicesApi.addNote(id, dialog.note, n, ref), 'Outcome note added.')
          }
        />
      )}
    </>
  );
}

const EVENT_LABEL: Record<InvoiceView['events'][number]['kind'], string> = {
  CREATED: 'Created',
  DISCOUNT_CHANGED: 'Discount changed',
  FINALISED: 'Finalised',
  VOIDED: 'Voided',
  CORRECTION_REQUESTED: 'Correction requested',
};

function Confirm({
  title,
  action,
  busy,
  children,
  onClose,
  onConfirm,
}: {
  title: string;
  action: string;
  busy: boolean;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      <p className="text-body-sm">{children}</p>
    </Dialog>
  );
}

function ReasonDialog({
  title,
  label,
  action,
  hint,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  action: string;
  hint?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 3) return setError('Give a reason of at least 3 characters.');
          onSubmit(reason.trim());
        }}
      >
        <Field label={label} hint={hint} error={error ?? undefined} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              maxLength={500}
              value={reason}
              onChange={(e) => (setReason(e.target.value), setError(null))}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={busy}>
            {action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

function DiscountDialog({
  invoice,
  busy,
  onClose,
  onSubmit,
}: {
  invoice: InvoiceView;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: string, reason?: string) => void;
}) {
  const gross = invoice.lines
    .filter((l) => !l.releasedAt)
    .reduce((s, l) => s + Number(l.grossAmount), 0);
  const [amount, setAmount] = useState(
    Number(invoice.discountAmount) ? invoice.discountAmount : '',
  );
  const [reason, setReason] = useState(invoice.discountReason ?? '');
  const [error, setError] = useState<Record<string, string>>({});
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Discount"
      description="Shared across the charges in proportion to their amounts; tax is recalculated on each charge. Enter 0 to remove it."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const errs: Record<string, string> = {};
          if (!MONEY.test(amount)) errs.amount = 'Enter an amount with at most two decimals.';
          else if (Number(amount) > gross) errs.amount = `At most ${rupees(gross.toFixed(2))}.`;
          if (Number(amount) > 0 && reason.trim().length < 3) errs.reason = 'Give a reason.';
          setError(errs);
          if (!Object.keys(errs).length)
            onSubmit(amount, Number(amount) > 0 ? reason.trim() : undefined);
        }}
      >
        <Field label="Amount (₹)" error={error.amount} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Reason" error={error.reason}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              maxLength={500}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChargeDialog({
  invoice,
  tz,
  busy,
  onClose,
  onSubmit,
}: {
  invoice: InvoiceView;
  tz: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (b: Parameters<typeof invoicesApi.addLine>[1]) => void;
}) {
  const opts = useQuery({ queryKey: ['invoice-options'], queryFn: invoicesApi.options });
  const today = localDate(new Date(), tz);
  const [kind, setKind] = useState<'ROOM' | 'OTHER'>('ROOM');
  const [f, setF] = useState({
    roomId: '',
    days: '1',
    description: '',
    classificationId: '',
    unitPrice: '',
    quantity: '1',
    serviceDate: today,
  });
  const [error, setError] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  void invoice;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a charge"
      description="Consultations, lab tests and medicines are added automatically. Add room stays and other charges here."
    >
      {opts.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : opts.error ? (
        <Alert tone="error">{errorMessage(opts.error)}</Alert>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const errs: Record<string, string> = {};
            if (!/^\d{4}-\d{2}-\d{2}$/.test(f.serviceDate) || f.serviceDate > today)
              errs.serviceDate = 'Choose today or an earlier date.';
            if (kind === 'ROOM') {
              if (!f.roomId) errs.roomId = 'Choose a room.';
              if (!/^\d+$/.test(f.days) || +f.days < 1 || +f.days > 366)
                errs.days = 'Between 1 and 366 days.';
            } else {
              if (!f.description.trim()) errs.description = 'Describe the charge.';
              if (!f.classificationId) errs.classificationId = 'Choose a tax classification.';
              if (!MONEY.test(f.unitPrice))
                errs.unitPrice = 'Enter a price with at most two decimals.';
              if (!/^\d+$/.test(f.quantity) || +f.quantity < 1 || +f.quantity > 1000)
                errs.quantity = 'Between 1 and 1000.';
            }
            setError(errs);
            if (Object.keys(errs).length) return;
            onSubmit(
              kind === 'ROOM'
                ? { kind, roomId: f.roomId, days: +f.days, serviceDate: f.serviceDate }
                : {
                    kind,
                    description: f.description.trim(),
                    classificationId: f.classificationId,
                    unitPrice: f.unitPrice,
                    quantity: +f.quantity,
                    serviceDate: f.serviceDate,
                  },
            );
          }}
        >
          <Field label="Charge" required>
            {({ id }) => (
              <Select
                id={id}
                value={kind}
                onChange={(e) => setKind(e.target.value as 'ROOM' | 'OTHER')}
              >
                <option value="ROOM">Room stay</option>
                <option value="OTHER">Other charge</option>
              </Select>
            )}
          </Field>
          {kind === 'ROOM' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Room"
                error={error.roomId}
                required
                hint={opts.data.rooms.length ? undefined : 'No room has a daily charge yet.'}
              >
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={f.roomId}
                    onChange={set('roomId')}
                  >
                    <option value="">Choose a room</option>
                    {opts.data.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.number} ({rupees(r.dailyCharge)} a day)
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Days" error={error.days} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={f.days}
                    onChange={set('days')}
                  />
                )}
              </Field>
            </div>
          ) : (
            <>
              <Field label="Description" error={error.description} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    maxLength={300}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={f.description}
                    onChange={set('description')}
                  />
                )}
              </Field>
              <Field label="Tax classification" error={error.classificationId} required>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    value={f.classificationId}
                    onChange={set('classificationId')}
                  >
                    <option value="">Choose a classification</option>
                    {opts.data.classifications.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.supplyType === 'GOODS' ? 'HSN' : 'SAC'} {c.hsnSac})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Price (₹)" error={error.unitPrice} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      inputMode="decimal"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={f.unitPrice}
                      onChange={set('unitPrice')}
                    />
                  )}
                </Field>
                <Field label="Quantity" error={error.quantity} required>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      inputMode="numeric"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={f.quantity}
                      onChange={set('quantity')}
                    />
                  )}
                </Field>
              </div>
            </>
          )}
          <Field label="Date of service" error={error.serviceDate} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                max={today}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={f.serviceDate}
                onChange={set('serviceDate')}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Add charge
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function CorrectionDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (k: CorrectionRequestKind, d: string) => void;
}) {
  const [kind, setKind] = useState<CorrectionRequestKind>('WRONG_DETAILS');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Request a correction"
      description="The document stays as issued. Your accountant handles the correction through the legally appropriate process, such as a credit note, outside MedCore."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length < 10)
            return setError('Describe what is wrong in at least 10 characters.');
          onSubmit(kind, text.trim());
        }}
      >
        <Field label="What is wrong" required>
          {({ id }) => (
            <Select
              id={id}
              value={kind}
              onChange={(e) => setKind(e.target.value as CorrectionRequestKind)}
            >
              {CORRECTION_REQUEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CORRECTION_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Details" error={error ?? undefined} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              maxLength={2000}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={text}
              onChange={(e) => (setText(e.target.value), setError(null))}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Record request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NoteDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string, ref?: string) => void;
}) {
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Outcome note"
      description="For your records, for example the reference of a credit note issued outside MedCore. It does not change the document or its balance."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim().length < 3) return setError('Write at least 3 characters.');
          onSubmit(note.trim(), ref.trim() || undefined);
        }}
      >
        <Field label="Note" error={error ?? undefined} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              maxLength={2000}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={note}
              onChange={(e) => (setNote(e.target.value), setError(null))}
            />
          )}
        </Field>
        <Field label="External reference">
          {({ id }) => (
            <Input id={id} maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Add note
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
