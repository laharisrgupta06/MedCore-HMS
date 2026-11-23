'use client';

import { RoleGate } from '@/components/app/role-gate';
import { AccountingDashboard } from '@/components/billing/accounting-dashboard';

export default function Page() {
  return (
    <RoleGate roles={['ACCOUNTANT', 'HOSPITAL_ADMIN']}>
      <AccountingDashboard />
    </RoleGate>
  );
}
