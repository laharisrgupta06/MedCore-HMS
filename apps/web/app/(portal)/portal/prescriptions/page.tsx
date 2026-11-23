'use client';

import { PageHeader } from '@/components/app/app-shell';
import { PrescriptionHistory } from '@/components/prescriptions/prescriptions-panel';
import { useHospitalTz } from '@/lib/time';

export default function Page() {
  const tz = useHospitalTz();
  return (
    <>
      <PageHeader
        title="My prescriptions"
        description="Download the signed PDF, and see when your medicines are ready for collection at the pharmacy."
      />
      <PrescriptionHistory tz={tz} />
    </>
  );
}
