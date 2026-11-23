'use client';

import { RoleGate } from '@/components/app/role-gate';
import { PatientsView } from '@/components/org/patients-view';

export default function Page() {
  return (
    <RoleGate
      roles={[
        'HOSPITAL_ADMIN',
        'RECEPTIONIST',
        'DOCTOR',
        'NURSE',
        'ACCOUNTANT',
        'LAB_TECHNICIAN',
        'PHARMACIST',
      ]}
    >
      <PatientsView />
    </RoleGate>
  );
}
