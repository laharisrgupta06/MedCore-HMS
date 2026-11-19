'use client';

import { RoleGate } from '@/components/app/role-gate';
import { TaxSettingsView } from '@/components/tax/tax-settings-view';

export default function Page() {
  return (
    <RoleGate roles={['HOSPITAL_ADMIN', 'ACCOUNTANT']}>
      <TaxSettingsView />
    </RoleGate>
  );
}
