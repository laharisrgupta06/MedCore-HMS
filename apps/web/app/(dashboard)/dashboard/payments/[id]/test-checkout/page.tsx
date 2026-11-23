'use client';

import { useParams } from 'next/navigation';
import { RoleGate } from '@/components/app/role-gate';
import { TestCheckout } from '@/components/billing/test-checkout';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGate roles={['RECEPTIONIST']}>
      <TestCheckout paymentId={id} />
    </RoleGate>
  );
}
