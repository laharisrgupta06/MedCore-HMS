'use client';

import { RoleGate } from '@/components/app/role-gate';
import { WorklistView } from '@/components/lab/lab-work-views';

export default function Page() {
  return (
    <RoleGate roles={['LAB_TECHNICIAN']}>
      <WorklistView />
    </RoleGate>
  );
}
