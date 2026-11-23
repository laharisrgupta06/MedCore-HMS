'use client';

import { PAYMENT_METHOD_LABEL, type MyPaymentView } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { paymentsApi } from '@/services/payments';
import { downloadBlob } from './payments-panel';

const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Patient portal: payments received on the patient's own bills, with their receipts. The API scopes every row. */
export function MyPayments() {
  const q = useQuery({ queryKey: ['my-payments'], queryFn: () => paymentsApi.mine() });
  const [busy, setBusy] = useState<string | null>(null);

  const receipt = async (p: MyPaymentView) => {
    setBusy(p.id);
    try {
      downloadBlob(await paymentsApi.receiptBlob(p.id), `receipt-${p.id.slice(0, 8)}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="My payments"
        description="Payments received on your bills. Download a receipt for any of them."
      />
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : q.error ? (
        <Alert tone="error" title="Could not load your payments">
          {errorMessage(q.error)}
        </Alert>
      ) : q.data.length === 0 ? (
        <p className="text-body-sm text-ink-muted">No payments yet.</p>
      ) : (
        <Panel>
          <ul className="divide-y divide-border px-5">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-col">
                  <span className="font-medium">
                    {inr(p.amount)} · {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {new Date(p.paidAt ?? p.createdAt).toLocaleString('en-IN')} ·{' '}
                    <Link href={`/portal/invoices/${p.invoiceId}`} className="mc-link">
                      {p.invoiceNumber ?? 'Bill'}
                    </Link>
                  </span>
                </div>
                <Button
                  size="compact"
                  variant="secondary"
                  loading={busy === p.id}
                  onClick={() => void receipt(p)}
                >
                  Receipt PDF
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
