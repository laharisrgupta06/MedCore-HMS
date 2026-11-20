'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { InvoiceDetail } from '@/components/billing/invoice-detail';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGate roles={['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN']}>
      <InvoiceDetail id={id} />
    </RoleGate>
  );
}
