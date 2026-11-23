'use client';

import { RoleGate } from '@/components/app/role-gate';
import { PharmacyQueueView } from '@/components/pharmacy/queue-view';

export default function Page() {
  return (
    <RoleGate roles={['PHARMACIST']}>
      <PharmacyQueueView />
    </RoleGate>
  );
}
