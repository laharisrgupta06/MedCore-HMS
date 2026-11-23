'use client';

import { AppointmentsView } from '@/components/appointments/appointments-view';
import { RoleGate } from '@/components/app/role-gate';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT']}>
      <AppointmentsView />
    </RoleGate>
  );
}
