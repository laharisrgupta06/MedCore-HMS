'use client';

import type { MedicalRecord } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Pagination } from '@/components/ui/data-table';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { emrApi } from '@/services/emr';
import { patientsApi } from '@/services/org';
import { useAuth } from '@/store/auth';
import { HistoryPanel } from './history-panel';
import { age, when } from './shared';

/** A patient's chart (API-019): history plus every consultation, newest first. */
export function ChartView({ patientId, portal }: { patientId?: string; portal?: boolean }) {
  const tz = useHospitalTz();
  const role = useAuth((s) => s.me?.user.role);
  const me = useQuery({
    queryKey: ['patient', 'me'],
    queryFn: patientsApi.me,
    enabled: Boolean(portal),
  });
  const id = portal ? me.data?.id : patientId;
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['chart', id, page],
    queryFn: () => emrApi.chart(id!, page),
    enabled: Boolean(id),
  });
  if (me.error || q.error)
    return (
      <Alert tone="error" title="Could not load the record">
        {errorMessage(me.error ?? q.error)}
      </Alert>
    );
  if (!id || q.isPending) return <Skeleton className="h-96" />;
  const first = q.data.items[0]?.patient;
  const href = (r: MedicalRecord) =>
    portal ? `/portal/records/${r.id}` : `/dashboard/records/${r.id}`;
  return (
    <>
      <PageHeader
        title={
          portal
            ? 'My health record'
            : first
              ? `${first.firstName} ${first.lastName}`
              : 'Patient chart'
        }
        description={
          portal ? (
            'Your consultations, diagnoses, allergies and vaccinations. Only you and your care team can see this.'
          ) : first ? (
            <span>
              <span className="font-mono">{first.mrn}</span> · {age(first.dateOfBirth)} years
            </span>
          ) : undefined
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Consultations">
          {q.data.items.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No consultations yet" />
          ) : (
            <ol className="divide-y divide-border">
              {q.data.items.map((r) => {
                const confirmed = r.diagnoses.filter((d) => !d.corrected);
                return (
                  <li key={r.id}>
                    <Link href={href(r)} className="block px-5 py-3 hover:bg-sage-50">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{when(r.appointment.scheduledAt, tz)}</span>
                        <span className="text-body-sm text-ink-secondary">
                          Dr {r.doctor.firstName} {r.doctor.lastName} · {r.department.name}
                        </span>
                        {r.status === 'OPEN' && <Badge tone="info">In progress</Badge>}
                      </div>
                      <p className="text-body-sm">{r.chiefComplaint}</p>
                      {confirmed.length > 0 && (
                        <p className="text-body-sm text-ink-secondary">
                          {confirmed
                            .map((d) =>
                              d.icd10 ? `${d.description} (${d.icd10.code})` : d.description,
                            )
                            .join('; ')}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
          <Pagination meta={q.data.meta} onPage={setPage} />
        </Panel>
        <HistoryPanel patientId={id} canEdit={role === 'DOCTOR' || role === 'NURSE'} tz={tz} />
      </div>
    </>
  );
}
