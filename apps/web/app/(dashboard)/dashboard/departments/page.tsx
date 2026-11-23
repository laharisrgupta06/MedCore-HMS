'use client';

import { RoleGate } from '@/components/app/role-gate';
import { DepartmentsView } from '@/components/org/departments-view';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN']}>
      <DepartmentsView />
    </RoleGate>
  );
}
