'use client';

import { PAYMENT_STATE_LABEL } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { RoleGate } from '@/components/app/role-gate';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { paymentsApi } from '@/services/payments';
import { buttonVariants } from '@/components/ui/button';

/**
 * Where Stripe or Razorpay sends the browser after checkout. The redirect proves nothing: the status
 * shown is MedCore's, which changes only on a verified webhook. It polls until the checkout closes.
 */
function Return() {
  const { id } = useParams<{ id: string }>();
  const result = useSearchParams().get('result');
  const q = useQuery({
    queryKey: ['payment', id],
    queryFn: () => paymentsApi.get(id),
    refetchInterval: (query) => (query.state.data?.checkoutOpen ? 3000 : false),
  });
  return (
    <>
      <PageHeader
        title="Online payment"
        crumbs={
          q.data
            ? [
                { label: 'Invoices', href: '/dashboard/invoices' },
                {
                  label: q.data.invoiceNumber ?? 'Draft invoice',
                  href: `/dashboard/invoices/${q.data.invoiceId}`,
                },
              ]
            : [{ label: 'Invoices', href: '/dashboard/invoices' }]
        }
      />
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <Alert tone="error">{errorMessage(q.error)}</Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert
            tone={
              q.data.status === 'SUCCEEDED' ? 'success' : q.data.checkoutOpen ? 'info' : 'warning'
            }
            title={`Status: ${PAYMENT_STATE_LABEL[q.data.status]}`}
          >
            {q.data.checkoutOpen
              ? result === 'cancelled'
                ? 'The customer left the checkout. It stays open until it expires or is cancelled.'
                : 'Waiting for the provider to confirm. This page updates by itself.'
              : `₹${q.data.amount}.`}
          </Alert>
          <Link
            href={`/dashboard/invoices/${q.data.invoiceId}`}
            className={buttonVariants({ variant: 'secondary', size: 'compact' })}
          >
            Back to the invoice
          </Link>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <RoleGate roles={['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN']}>
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <Return />
      </Suspense>
    </RoleGate>
  );
}
