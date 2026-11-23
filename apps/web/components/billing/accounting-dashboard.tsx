'use client';

import { PAYMENT_METHOD_LABEL } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { paymentsApi } from '@/services/payments';
import { buttonVariants } from '@/components/ui/button';

const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The accountant's day (8-B5): what came in, what is owed, what to reconcile, and what needs a decision. */
export function AccountingDashboard() {
  const q = useQuery({
    queryKey: ['billing-summary'],
    queryFn: () => paymentsApi.summary(),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load the accounts summary">
        {errorMessage(q.error)}
      </Alert>
    );
  const s = q.data;
  return (
    <>
      <PageHeader
        title="Accounts"
        description={`Today, ${s.date} (${s.timezone}). Refreshes every minute.`}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Collected today">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-h2 font-semibold tabular-nums">{inr(s.collectedToday.total)}</p>
            <p className="text-body-sm text-ink-muted">
              {s.collectedToday.count} payment(s) received
            </p>
            <ul className="text-body-sm">
              {s.collectedToday.byMethod.map((m) => (
                <li key={m.method} className="flex justify-between py-1">
                  <span>{PAYMENT_METHOD_LABEL[m.method]}</span>
                  <span className="tabular-nums">{inr(m.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <Panel title="Outstanding balance">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-h2 font-semibold tabular-nums">{inr(s.outstanding.amount)}</p>
            <p className="text-body-sm text-ink-muted">
              Across {s.outstanding.invoices} issued invoice(s) not yet paid in full.
            </p>
            <Link
              href="/dashboard/invoices"
              className={buttonVariants({
                variant: 'secondary',
                size: 'compact',
                className: 'self-start',
              })}
            >
              Open invoices
            </Link>
          </div>
        </Panel>
        <Panel title="To reconcile">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-h2 font-semibold tabular-nums">{inr(s.unreconciled.amount)}</p>
            <p className="text-body-sm text-ink-muted">
              {s.unreconciled.count} received payment(s) not yet reconciled.
            </p>
            <Link
              href="/dashboard/payments/reconciliation"
              className={buttonVariants({
                variant: 'secondary',
                size: 'compact',
                className: 'self-start',
              })}
            >
              Go to reconciliation
            </Link>
          </div>
        </Panel>
        <Panel title="Online checkouts">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-h2 font-semibold tabular-nums">{s.openCheckouts}</p>
            <p className="text-body-sm text-ink-muted">
              Checkouts open now, waiting for the customer.
            </p>
          </div>
        </Panel>
        <Panel title="Held for review">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-h2 font-semibold tabular-nums">{s.heldWebhooks30d}</p>
            <p className="text-body-sm text-ink-muted">
              Provider successes in the last 30 days for checkouts that were cancelled or did not
              match the record. They are never applied automatically; review them with the payment
              provider.
            </p>
          </div>
        </Panel>
        <Panel title="Insurance claims">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-h2 font-semibold tabular-nums">{s.claims.submitted}</p>
            <p className="text-body-sm text-ink-muted">
              Submitted and awaiting a decision. Approved and not yet settled:{' '}
              {s.claims.approvedUnsettled.count} ({inr(s.claims.approvedUnsettled.amount)}).
            </p>
            <Link
              href="/dashboard/billing/claims"
              className={buttonVariants({
                variant: 'secondary',
                size: 'compact',
                className: 'self-start',
              })}
            >
              Open claims queue
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
