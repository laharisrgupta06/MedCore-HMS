'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app/app-shell';
import { AuthGate } from '@/components/app/auth-gate';
import { STAFF_NAV } from '@/constants/navigation';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="staff">
      <AppShell nav={STAFF_NAV} home="/dashboard">
        {children}
      </AppShell>
    </AuthGate>
  );
}
