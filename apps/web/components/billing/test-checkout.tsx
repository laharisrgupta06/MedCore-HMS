'use client';

import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATE_LABEL,
  type PaymentDetailView,
  type TestCheckoutOutcome,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { paymentsApi } from '@/services/payments';

/**
 * Test checkout (development only). It stands in for a payment provider's checkout page while the
 * FakeProvider is configured. Its buttons send the same signed webhook a real provider would, through
 * the same code path. No money moves.
 */
export function TestCheckout({ paymentId }: { paymentId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => paymentsApi.get(paymentId),
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const act = async (fn: () => Promise<PaymentDetailView>, message: string) => {
    setBusy(true);
    try {
      const d = await fn();
      qc.setQueryData(['payment', paymentId], d);
      void qc.invalidateQueries({ queryKey: ['invoice-payments', d.invoiceId] });
      setDone(message);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isPending) return <Skeleton className="h-80 w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load this checkout">
        {errorMessage(q.error)}
      </Alert>
    );

  const d = q.data;
  if (!d.testCheckout)
    return (
      <Alert tone="info" title="This is not a test checkout">
        Payments are not simulated in this environment. The payment provider completes this
        checkout.
      </Alert>
    );

  const simulate = (outcome: TestCheckoutOutcome) =>
    act(
      () => paymentsApi.simulate(paymentId, outcome),
      outcome === 'SUCCEEDED'
        ? 'Simulated a successful payment. The invoice has been updated.'
        : 'Simulated a failed payment. Nothing was received.',
    );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Invoices', href: '/dashboard/invoices' },
          { label: d.invoiceNumber ?? 'Draft invoice', href: `/dashboard/invoices/${d.invoiceId}` },
        ]}
        title="Test checkout"
        description="Development only. A stand-in for the payment provider's checkout page."
      />
      <div className="flex flex-col gap-6">
        <Alert tone="warning" title="Test checkout. No money moves.">
          These buttons send the same signed webhook a real provider sends, through the same code.
          Use them only in development.
        </Alert>

        <Panel title={`Invoice ${d.invoiceNumber ?? ''}`.trim()}>
          <div className="flex flex-col gap-4 p-5">
            <dl className="grid grid-cols-2 gap-4 text-body-sm">
              <div>
                <dt className="text-ink-muted">Method</dt>
                <dd className="font-medium">{PAYMENT_METHOD_LABEL[d.method]}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Amount</dt>
                <dd className="font-semibold tabular-nums">₹{d.amount}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Status</dt>
                <dd>
                  <Badge tone={d.status === 'PENDING' ? 'warning' : 'neutral'}>
                    {PAYMENT_STATE_LABEL[d.status]}
                  </Badge>
                </dd>
              </div>
            </dl>

            {d.checkoutOpen ? (
              <div className="flex flex-wrap gap-3">
                <Button loading={busy} onClick={() => void simulate('SUCCEEDED')}>
                  Simulate successful payment
                </Button>
                <Button variant="secondary" loading={busy} onClick={() => void simulate('FAILED')}>
                  Simulate failed payment
                </Button>
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={() =>
                    act(
                      () => paymentsApi.cancel(paymentId),
                      'Checkout cancelled. Nothing was received.',
                    )
                  }
                >
                  Cancel checkout
                </Button>
              </div>
            ) : (
              <p className="text-body-sm text-ink-muted">{done ?? 'This checkout is closed.'}</p>
            )}

            <Link
              href={`/dashboard/invoices/${d.invoiceId}`}
              className={buttonVariants({ variant: 'secondary', size: 'compact' })}
            >
              Back to the invoice
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
