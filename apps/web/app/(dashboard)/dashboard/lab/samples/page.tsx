'use client';

import { RoleGate } from '@/components/app/role-gate';
import { SamplesView } from '@/components/lab/lab-work-views';

export default function Page() {
  return (
    <RoleGate roles={['RECEPTIONIST', 'LAB_TECHNICIAN']}>
      <SamplesView />
    </RoleGate>
  );
}
