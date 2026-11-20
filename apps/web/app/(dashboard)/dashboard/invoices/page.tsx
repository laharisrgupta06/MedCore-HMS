'use client';

import { RoleGate } from '@/components/app/role-gate';
import { InvoiceList } from '@/components/billing/invoice-list';

export default function Page() {
  return (
    <RoleGate roles={['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN']}>
      <InvoiceList />
    </RoleGate>
  );
}
