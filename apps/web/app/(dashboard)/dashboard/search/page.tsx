'use client';

import { Suspense } from 'react';
import { GlobalSearch } from '@/components/analytics/global-search';
import { RoleGate } from '@/components/app/role-gate';
import { Skeleton } from '@/components/ui/misc';

export default function Page() {
  return (
    <RoleGate
      roles={[
        'HOSPITAL_ADMIN',
        'DOCTOR',
        'NURSE',
        'RECEPTIONIST',
        'LAB_TECHNICIAN',
        'PHARMACIST',
        'ACCOUNTANT',
      ]}
    >
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <GlobalSearch />
      </Suspense>
    </RoleGate>
  );
}
