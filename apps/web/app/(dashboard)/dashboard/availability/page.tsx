'use client';

import { AvailabilityView } from '@/components/appointments/availability-view';
import { RoleGate } from '@/components/app/role-gate';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN', 'DOCTOR']}>
      <AvailabilityView />
    </RoleGate>
  );
}
