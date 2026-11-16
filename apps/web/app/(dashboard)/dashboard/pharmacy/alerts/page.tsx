'use client';

import { RoleGate } from '@/components/app/role-gate';
import { PharmacyAlertsView } from '@/components/pharmacy/alerts-view';

export default function Page() {
  return (
    <RoleGate roles={['PHARMACIST', 'HOSPITAL_ADMIN']}>
      <PharmacyAlertsView />
    </RoleGate>
  );
}
