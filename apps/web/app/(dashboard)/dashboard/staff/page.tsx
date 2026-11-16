'use client';

import { RoleGate } from '@/components/app/role-gate';
import { StaffView } from '@/components/org/staff-view';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN']}>
      <StaffView />
    </RoleGate>
  );
}
