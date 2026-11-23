'use client';

import { RoleGate } from '@/components/app/role-gate';
import { HospitalSettings } from '@/components/org/hospital-settings';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN']}>
      <HospitalSettings />
    </RoleGate>
  );
}
