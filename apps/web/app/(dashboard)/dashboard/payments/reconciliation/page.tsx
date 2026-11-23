'use client';

import { RoleGate } from '@/components/app/role-gate';
import { Reconciliation } from '@/components/billing/reconciliation';

export default function Page() {
  return (
    <RoleGate roles={['ACCOUNTANT', 'HOSPITAL_ADMIN']}>
      <Reconciliation />
    </RoleGate>
  );
}
