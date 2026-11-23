'use client';

import { RoleGate } from '@/components/app/role-gate';
import { ClaimsQueue } from '@/components/billing/claims-panel';

export default function Page() {
  return (
    <RoleGate roles={['ACCOUNTANT', 'HOSPITAL_ADMIN']}>
      <ClaimsQueue />
    </RoleGate>
  );
}
