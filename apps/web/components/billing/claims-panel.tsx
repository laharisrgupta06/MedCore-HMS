'use client';

import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUSES,
  type ClaimStatus,
  type ClaimView,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { claimsApi } from '@/services/claims';
import { useAuth } from '@/store/auth';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const POLICY = /^[A-Za-z0-9/-]{3,60}$/;
const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = {
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'neutral',
  SETTLED: 'success',
} as const;

/** Insurance claims on one invoice (PRD 7.7). Settlements are tracked here and do not change the balance yet. */
export function ClaimsPanel({ invoiceId }: { invoiceId: string }) {
  const role = useAuth((s) => s.me?.user.role);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['invoice-claims', invoiceId],
    queryFn: () => claimsApi.forInvoice(invoiceId),
  });
  const [creating, setCreating] = useState(false);
  const canCreate = role === 'RECEPTIONIST' || role === 'ACCOUNTANT';
  const accountant = role === 'ACCOUNTANT';
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['invoice-claims', invoiceId] });
    void qc.invalidateQueries({ queryKey: ['claims'] });
  };

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load insurance claims">
        {errorMessage(q.error)}
      </Alert>
    );

  return (
    <Panel
      title="Insurance claims"
      actions={
        canCreate ? (
          <Button size="compact" variant="secondary" onClick={() => setCreating(true)}>
            Submit claim
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <p className="text-caption text-ink-muted">
          A settlement is recorded against the claim. It does not change the patient&apos;s balance
          until the TPA payment is posted.
        </p>
        {q.data.length === 0 ? (
          <p className="text-body-sm text-ink-muted">No claims on this invoice.</p>
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((c) => (
              <ClaimLine key={c.id} claim={c} accountant={accountant} onDone={done} />
            ))}
          </ul>
        )}
      </div>
      {creating && (
        <ClaimDialog
          invoiceId={invoiceId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            done();
          }}
        />
      )}
    </Panel>
  );
}

/** Claims queue for accountants and hospital admins (all invoices, filtered by status). */
export function ClaimsQueue() {
  const role = useAuth((s) => s.me?.user.role);
  const qc = useQueryClient();
  const [status, setStatus] = useState<ClaimStatus | ''>('SUBMITTED');
  const q = useQuery({
    queryKey: ['claims', status],
    queryFn: () => claimsApi.list(status || undefined),
  });
  const done = () => void qc.invalidateQueries({ queryKey: ['claims'] });
  return (
    <>
      <PageHeader
        title="Insurance claims"
        description="Claims submitted to third-party administrators."
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-56">
          <Field label="Status">
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={status}
                onChange={(e) => setStatus(e.target.value as ClaimStatus | '')}
              >
                <option value="">All</option>
                {CLAIM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CLAIM_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : q.error ? (
        <Alert tone="error" title="Could not load claims">
          {errorMessage(q.error)}
        </Alert>
      ) : q.data.length === 0 ? (
        <p className="text-body-sm text-ink-muted">No claims with this status.</p>
      ) : (
        <Panel>
          <ul className="divide-y divide-border px-5">
            {q.data.map((c) => (
              <ClaimLine
                key={c.id}
                claim={c}
                accountant={role === 'ACCOUNTANT'}
                onDone={done}
                showInvoice
              />
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function ClaimLine({
  claim,
  accountant,
  onDone,
  showInvoice = false,
}: {
  claim: ClaimView;
  accountant: boolean;
  onDone: () => void;
  showInvoice?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    try {
      await claimsApi.decide(claim.id, decision);
      toast.success(decision === 'APPROVED' ? 'Claim approved.' : 'Claim rejected.');
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium">
            {claim.tpaName} · policy {claim.policyNumber}
          </span>
          <span className="text-caption text-ink-muted">
            {showInvoice ? (
              <>
                {claim.patientName} ·{' '}
                <Link href={`/dashboard/invoices/${claim.invoiceId}`} className="mc-link">
                  {claim.invoiceNumber ?? 'Draft invoice'}
                </Link>{' '}
                ·{' '}
              </>
            ) : null}
            submitted {new Date(claim.submittedAt).toLocaleDateString('en-IN')}
            {claim.settledAmount ? ` · settled ${inr(claim.settledAmount)}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={TONE[claim.status]}>{CLAIM_STATUS_LABEL[claim.status]}</Badge>
          <span className="font-semibold tabular-nums">{inr(claim.claimAmount)}</span>
        </div>
      </div>
      {accountant && claim.status === 'SUBMITTED' && (
        <div className="flex justify-end gap-2">
          <Button
            size="compact"
            variant="secondary"
            loading={busy}
            onClick={() => void decide('APPROVED')}
          >
            Approve
          </Button>
          <Button
            size="compact"
            variant="danger"
            loading={busy}
            onClick={() => void decide('REJECTED')}
          >
            Reject
          </Button>
        </div>
      )}
      {accountant && claim.status === 'APPROVED' && (
        <div className="flex justify-end">
          <Button size="compact" variant="secondary" onClick={() => setSettling(true)}>
            Record settlement
          </Button>
        </div>
      )}
      {settling && (
        <SettleDialog
          claim={claim}
          onClose={() => setSettling(false)}
          onDone={() => {
            setSettling(false);
            onDone();
          }}
        />
      )}
    </li>
  );
}

function ClaimDialog({
  invoiceId,
  onClose,
  onDone,
}: {
  invoiceId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({ tpaName: '', policyNumber: '', claimAmount: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.tpaName.trim().length < 2) errs.tpaName = 'Enter the TPA name.';
    if (!POLICY.test(f.policyNumber.trim()))
      errs.policyNumber = 'Use 3 to 60 letters, digits, / or -.';
    if (!MONEY.test(f.claimAmount) || Number(f.claimAmount) <= 0)
      errs.claimAmount = 'Enter an amount above zero, with at most two decimals.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await claimsApi.create(invoiceId, {
        tpaName: f.tpaName.trim(),
        policyNumber: f.policyNumber.trim(),
        claimAmount: Number(f.claimAmount).toFixed(2),
        ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      });
      toast.success('Claim submitted.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Submit insurance claim"
      description="The claim is tracked against this invoice."
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="TPA name" error={errors.tpaName} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={f.tpaName}
              onChange={set('tpaName')}
            />
          )}
        </Field>
        <Field label="Policy number" error={errors.policyNumber} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={f.policyNumber}
              onChange={set('policyNumber')}
            />
          )}
        </Field>
        <Field label="Claim amount (₹)" error={errors.claimAmount} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              inputMode="decimal"
              value={f.claimAmount}
              onChange={set('claimAmount')}
            />
          )}
        </Field>
        <Field label="Notes">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={f.notes}
              onChange={set('notes')}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" loading={busy}>
            Submit claim
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SettleDialog({
  claim,
  onClose,
  onDone,
}: {
  claim: ClaimView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(claim.claimAmount);
  const [post, setPost] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = amount.trim();
    if (!MONEY.test(v) || Number(v) <= 0 || Number(v) > Number(claim.claimAmount)) {
      setError(`Enter an amount above zero and no more than ${inr(claim.claimAmount)}.`);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await claimsApi.settle(claim.id, Number(v).toFixed(2), post);
      toast.success(
        post
          ? 'Settlement posted to the invoice as a TPA payment.'
          : 'Settlement recorded. The patient balance is unchanged.',
      );
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record settlement"
      description="The amount the TPA has agreed to pay for this claim."
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <Field
          label="Settled amount (₹)"
          error={error}
          hint={`Claimed: ${inr(claim.claimAmount)}`}
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <label className="flex items-start gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={post}
            onChange={(e) => setPost(e.target.checked)}
            className="mt-1"
          />
          <span>
            Also post this amount to the invoice balance as a TPA payment. This needs database
            migrations M-12 and M-13; until they are applied it is refused and nothing changes.
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" loading={busy}>
            Record settlement
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
