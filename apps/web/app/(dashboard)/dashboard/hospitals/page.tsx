'use client';

import { HospitalsView } from '@/components/org/hospitals-view';
import { RoleGate } from '@/components/app/role-gate';

export default function HospitalsPage() {
  return (
    <RoleGate roles={['SUPER_ADMIN']}>
      <HospitalsView />
    </RoleGate>
  );
}
