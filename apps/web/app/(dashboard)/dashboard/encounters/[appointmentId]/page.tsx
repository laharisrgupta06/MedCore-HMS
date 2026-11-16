'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { EncounterStart } from '@/components/emr/encounter-start';

export default function Page() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  return (
    <RoleGate roles={['DOCTOR']}>
      <EncounterStart appointmentId={appointmentId} />
    </RoleGate>
  );
}
