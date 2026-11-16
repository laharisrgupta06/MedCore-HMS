'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { ChartView } from '@/components/emr/chart-view';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGate roles={['DOCTOR', 'NURSE']}>
      <ChartView patientId={id} />
    </RoleGate>
  );
}
