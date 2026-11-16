'use client';

import { RoleGate } from '@/components/app/role-gate';
import { LabTestsView } from '@/components/lab/lab-tests-view';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN']}>
      <LabTestsView />
    </RoleGate>
  );
}
