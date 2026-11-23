'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { LabOrderWork } from '@/components/lab/lab-work-views';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGate roles={['LAB_TECHNICIAN']}>
      <LabOrderWork id={id} />
    </RoleGate>
  );
}
