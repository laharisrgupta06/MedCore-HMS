'use client';

import { useParams } from 'next/navigation';
import { InvoiceDetail } from '@/components/billing/invoice-detail';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <InvoiceDetail id={id} patient />;
}
