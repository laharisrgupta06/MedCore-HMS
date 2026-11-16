'use client';

import { RoleGate } from '@/components/app/role-gate';
import { RoomsView } from '@/components/org/rooms-view';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN', 'NURSE', 'RECEPTIONIST', 'DOCTOR', 'ACCOUNTANT']}>
      <RoomsView />
    </RoleGate>
  );
}
