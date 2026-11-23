'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { RecordView } from '@/components/emr/record-view';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGate roles={['DOCTOR', 'NURSE']}>
      <RecordView recordId={id} backHref="/dashboard/appointments" />
    </RoleGate>
  );
}
