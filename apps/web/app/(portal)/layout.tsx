'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app/app-shell';
import { AuthGate } from '@/components/app/auth-gate';
import { PATIENT_NAV } from '@/constants/navigation';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="patient">
      <AppShell nav={PATIENT_NAV} home="/portal">
        {children}
      </AppShell>
    </AuthGate>
  );
}
