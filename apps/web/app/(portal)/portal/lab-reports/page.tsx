'use client';

import { PageHeader } from '@/components/app/app-shell';
import { LabHistory } from '@/components/lab/lab-orders-panel';
import { useHospitalTz } from '@/lib/time';

export default function Page() {
  const tz = useHospitalTz();
  return (
    <>
      <PageHeader
        title="My lab reports"
        description="Reports appear here once the laboratory has approved them."
      />
      <LabHistory tz={tz} />
    </>
  );
}
