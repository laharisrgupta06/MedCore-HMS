'use client';

import { RoleGate } from '@/components/app/role-gate';
import { DoctorsView } from '@/components/org/doctors-view';

export default function Page() {
  return (
    <RoleGate
      roles={[
        'HOSPITAL_ADMIN',
        'DOCTOR',
        'NURSE',
        'RECEPTIONIST',
        'LAB_TECHNICIAN',
        'PHARMACIST',
        'ACCOUNTANT',
      ]}
    >
      <DoctorsView />
    </RoleGate>
  );
}
