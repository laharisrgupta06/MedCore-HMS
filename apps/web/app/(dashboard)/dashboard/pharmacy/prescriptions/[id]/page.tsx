'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { PharmacyPrescriptionView } from '@/components/pharmacy/queue-view';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGate roles={['PHARMACIST']}>
      <PharmacyPrescriptionView id={id} />
    </RoleGate>
  );
}
