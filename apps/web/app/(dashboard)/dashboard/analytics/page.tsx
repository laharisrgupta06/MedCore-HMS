'use client';

import { RoleGate } from '@/components/app/role-gate';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN']}>
      <AnalyticsDashboard />
    </RoleGate>
  );
}
