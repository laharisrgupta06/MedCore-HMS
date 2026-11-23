'use client';

import type { MedicalRecord } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { Pill, Plus } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { prescriptionsApi } from '@/services/prescriptions';
import { PrescriptionCard } from './prescription-card';
import { PrescriptionForm } from './prescription-form';

/** Prescriptions of one consultation (RX-001); the treating doctor issues while it is open. */
export function PrescriptionsPanel({
  record,
  canIssue,
  tz,
}: {
  record: MedicalRecord;
  canIssue: boolean;
  tz: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['prescriptions', 'record', record.id],
    queryFn: () => prescriptionsApi.list({ medicalRecordId: record.id, limit: 50 }),
  });
  return (
    <Panel
      title="Prescriptions"
      actions={
        canIssue && (
          <Button size="compact" variant="secondary" onClick={() => setOpen(true)}>
            <Plus />
            New prescription
          </Button>
        )
      }
    >
      <div className="space-y-3 p-4">
        {q.error ? (
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        ) : q.isPending ? (
          <Skeleton className="h-24" />
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={Pill} title="No prescriptions">
            {canIssue ? 'Add medicines from the hospital catalogue.' : undefined}
          </EmptyState>
        ) : (
          q.data.items.map((rx) => <PrescriptionCard key={rx.id} rx={rx} tz={tz} />)
        )}
      </div>
      {open && <PrescriptionForm record={record} onClose={() => setOpen(false)} />}
    </Panel>
  );
}

/** A patient's prescriptions across consultations (chart tab and patient portal). */
export function PrescriptionHistory({ patientId, tz }: { patientId?: string; tz: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['prescriptions', 'patient', patientId ?? 'me', page],
    queryFn: () => prescriptionsApi.list({ ...(patientId ? { patientId } : {}), page, limit: 10 }),
  });
  if (q.error)
    return (
      <Alert tone="error" title="Could not load prescriptions">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.data.items.length === 0) return <EmptyState icon={Pill} title="No prescriptions yet" />;
  return (
    <div className="space-y-3">
      {q.data.items.map((rx) => (
        <PrescriptionCard key={rx.id} rx={rx} tz={tz} />
      ))}
      {q.data.meta.totalPages > 1 && (
        <div className="flex justify-between">
          <Button
            size="compact"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Newer
          </Button>
          <Button
            size="compact"
            variant="secondary"
            disabled={page >= q.data.meta.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
