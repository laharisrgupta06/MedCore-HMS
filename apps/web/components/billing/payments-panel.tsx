'use client';

import {
  ONLINE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATE_LABEL,
  type CheckoutStarted,
  type OnlinePaymentMethod,
  type PaymentView,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { paymentsApi } from '@/services/payments';
import { useAuth } from '@/store/auth';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isRulesPending = (e: unknown) =>
  (e as { code?: string } | null)?.code === 'PAYMENT_RULES_PENDING';
const TONE = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'neutral',
  REVERSED: 'neutral',
} as const;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type OpenDialog = null | 'cash' | 'checkout' | { reverse: PaymentView };

/**
 * Payments of one issued invoice (8-B5, 8-B6). Receptionists record cash, start or cancel online
 * checkouts, and email receipts. Accountants also record cash, reverse unreconciled payments and
 * download receipts. A patient sees received payments only. The API enforces every rule, including
 * the wait for database migration M-12.
 */
export function PaymentsPanel({ invoiceId, patient }: { invoiceId: string; patient: boolean }) {
  const role = useAuth((s) => s.me?.user.role);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['invoice-payments', invoiceId],
    queryFn: () => paymentsApi.forInvoice(invoiceId),
  });
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutStarted | null>(null);
  const [rulesPending, setRulesPending] = useState(false);
  const canCash = !patient && (role === 'RECEPTIONIST' || role === 'ACCOUNTANT');
  const canOnline = !patient && role === 'RECEPTIONIST';
  const canEmail = canCash;
  const canReverse = !patient && role === 'ACCOUNTANT';

  const changed = () => {
    void qc.invalidateQueries({ queryKey: ['invoice-payments', invoiceId] });
    void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['billing-summary'] });
  };

  const fail = (e: unknown) => {
    if (isRulesPending(e)) setRulesPending(true);
    toast.error(errorMessage(e));
  };

  /** Runs one action: disables the panel while it runs, reports the result and refreshes the invoice. */
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setDialog(null);
      changed();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const recordCash = (amount: string) =>
    run(() => paymentsApi.cash(invoiceId, amount), `Recorded ${inr(amount)} in cash.`);

  const startCheckout = async (method: OnlinePaymentMethod) => {
    setBusy(true);
    try {
      const r = await paymentsApi.checkout(invoiceId, method);
      setCheckout(r);
      setDialog(null);
      toast.success('Online checkout opened. The invoice updates only when the provider confirms.');
      changed();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const cancelCheckout = (paymentId: string) => {
    void run(
      () => paymentsApi.cancel(paymentId),
      'Checkout cancelled. If the customer pays after this, the payment is held for the accountant.',
    ).then(() => setCheckout(null));
  };

  const receipt = async (p: PaymentView) => {
    setBusy(true);
    try {
      downloadBlob(await paymentsApi.receiptBlob(p.id), `receipt-${p.id.slice(0, 8)}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const email = async (p: PaymentView) => {
    setBusy(true);
    try {
      const r = await paymentsApi.emailReceipt(p.id);
      toast.success(`Receipt emailed to ${r.sentTo}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <Skeleton className="h-48 w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load payments">
        {errorMessage(q.error)}
      </Alert>
    );

  const p = q.data;
  const due = Number(p.balance) > 0;
  const openId = p.openCheckoutId;
  const checkoutHref = checkout
    ? checkout.checkoutUrl
    : openId
      ? `/dashboard/payments/${openId}/test-checkout`
      : null;

  return (
    <>
      <Panel
        title="Payments"
        actions={
          canCash && due ? (
            <div className="flex flex-wrap gap-2">
              <Button size="compact" variant="secondary" onClick={() => setDialog('cash')}>
                Record cash
              </Button>
              {canOnline && !openId && (
                <Button size="compact" variant="secondary" onClick={() => setDialog('checkout')}>
                  Start online checkout
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4 p-5">
          {rulesPending && (
            <Alert tone="warning" title="Payments are waiting for a database update">
              Recording, reversing and receipts that change payments need database migration M-12,
              which is prepared but not yet approved. Nothing has been changed.
            </Alert>
          )}

          <dl className="grid grid-cols-3 gap-4 text-body-sm">
            <div>
              <dt className="text-ink-muted">Total</dt>
              <dd className="font-semibold tabular-nums">{inr(p.total)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Received</dt>
              <dd className="font-semibold tabular-nums">{inr(p.paid)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Balance</dt>
              <dd className="font-semibold tabular-nums">{inr(p.balance)}</dd>
            </div>
          </dl>

          {openId && checkoutHref && (
            <Alert tone="info" title="An online checkout is open">
              <div className="flex flex-wrap items-center gap-3">
                <Link href={checkoutHref} className="mc-link">
                  Open checkout
                </Link>
                {canOnline && (
                  <Button
                    size="compact"
                    variant="danger"
                    loading={busy}
                    onClick={() => cancelCheckout(openId)}
                  >
                    Cancel checkout
                  </Button>
                )}
              </div>
            </Alert>
          )}

          {p.payments.length === 0 ? (
            <p className="text-body-sm text-ink-muted">No payments received yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {p.payments.map((x) => (
                <li key={x.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="font-medium">{PAYMENT_METHOD_LABEL[x.method]}</span>
                      <span className="text-caption text-ink-muted">
                        {new Date(x.paidAt ?? x.createdAt).toLocaleString('en-IN')}
                        {x.receivedByName ? ` · received by ${x.receivedByName}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={TONE[x.status]}>{PAYMENT_STATE_LABEL[x.status]}</Badge>
                      {x.reconciledAt && <Badge tone="neutral">Reconciled</Badge>}
                      <span className="font-semibold tabular-nums">{inr(x.amount)}</span>
                    </div>
                  </div>
                  {x.status === 'SUCCEEDED' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="compact"
                        variant="ghost"
                        loading={busy}
                        onClick={() => void receipt(x)}
                      >
                        Receipt PDF
                      </Button>
                      {canEmail && (
                        <Button
                          size="compact"
                          variant="ghost"
                          loading={busy}
                          onClick={() => void email(x)}
                        >
                          Email receipt
                        </Button>
                      )}
                      {canReverse && !x.reconciledAt && (
                        <Button
                          size="compact"
                          variant="danger"
                          onClick={() => setDialog({ reverse: x })}
                        >
                          Reverse
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {dialog === 'cash' && (
        <CashDialog
          balance={p.balance}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(amount) => void recordCash(amount)}
        />
      )}
      {dialog === 'checkout' && (
        <CheckoutDialog
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(m) => void startCheckout(m)}
        />
      )}
      {dialog && typeof dialog === 'object' && 'reverse' in dialog && (
        <ReverseDialog
          payment={dialog.reverse}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            void run(
              () => paymentsApi.reverse(dialog.reverse.id, reason),
              'Payment reversed. The balance has been updated.',
            )
          }
        />
      )}
    </>
  );
}

function CashDialog({
  balance,
  busy,
  onClose,
  onSubmit,
}: {
  balance: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: string) => void;
}) {
  const [amount, setAmount] = useState(balance);
  const [error, setError] = useState<string | undefined>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = amount.trim();
    if (!MONEY.test(v) || Number(v) <= 0) {
      setError('Enter an amount greater than zero, with at most two decimals.');
      return;
    }
    if (Number(v) > Number(balance)) {
      setError(`The balance is ${inr(balance)}. Enter that amount or less.`);
      return;
    }
    setError(undefined);
    onSubmit(Number(v).toFixed(2));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record cash"
      description="Partial payments are allowed. The invoice is marked paid when the balance reaches zero."
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <Field
          label="Cash received (₹)"
          hint={`Balance due: ${inr(balance)}`}
          error={error}
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
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Record cash
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CheckoutDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (method: OnlinePaymentMethod) => void;
}) {
  const [method, setMethod] = useState<OnlinePaymentMethod>(ONLINE_PAYMENT_METHODS[0]);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Start online checkout"
      description="The customer pays the whole balance on the provider's checkout page, and the invoice changes only when the provider confirms the payment. If online payments are not set up for this hospital, you will be told and nothing is charged."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(method);
        }}
      >
        <Field label="Payment method" required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={method}
              onChange={(e) => setMethod(e.target.value as OnlinePaymentMethod)}
            >
              {ONLINE_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" loading={busy}>
            Open checkout
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReverseDialog({
  payment,
  busy,
  onClose,
  onSubmit,
}: {
  payment: PaymentView;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reverse ${inr(payment.amount)} received by ${PAYMENT_METHOD_LABEL[payment.method]}`}
      description="The amount returns to the invoice balance. A reconciled payment cannot be reversed. The reason is kept in the audit log."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 5) {
            setError('Give a reason of at least 5 characters.');
            return;
          }
          setError(undefined);
          onSubmit(reason.trim());
        }}
      >
        <Field label="Reason" error={error} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" variant="destructive" loading={busy}>
            Reverse payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
