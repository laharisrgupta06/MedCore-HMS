'use client';

import { RoleGate } from '@/components/app/role-gate';
import { MedicinesView } from '@/components/prescriptions/medicines-view';

export default function Page() {
  return (
    <RoleGate roles={['PHARMACIST', 'HOSPITAL_ADMIN']}>
      <MedicinesView />
    </RoleGate>
  );
}
