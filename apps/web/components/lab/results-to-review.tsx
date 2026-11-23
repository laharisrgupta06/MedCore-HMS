'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Panel, Skeleton } from '@/components/ui/misc';
import { when } from '@/components/emr/shared';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { labApi } from '@/services/lab';

/** Doctor home: the latest approved results of tests they ordered (roadmap Phase 6 widget). */
export function ResultsToReview() {
  const tz = useHospitalTz();
  const q = useQuery({
    queryKey: ['lab-orders', 'mine-approved'],
    queryFn: () => labApi.orders({ mine: true, status: 'APPROVED', limit: 5 }),
  });
  return (
    <Panel title="Latest approved lab results" className="mb-6">
      {q.error ? (
        <div className="p-5">
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        </div>
      ) : q.isPending ? (
        <div className="p-5">
          <Skeleton className="h-20" />
        </div>
      ) : q.data.items.length === 0 ? (
        <p className="px-5 py-4 text-body-sm text-ink-muted">
          No approved results for tests you ordered.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {q.data.items.map((o) => {
            const flagged = o.items.filter(
              (i) => i.result?.flag === 'HIGH' || i.result?.flag === 'LOW',
            ).length;
            return (
              <li key={o.id}>
                <Link
                  href={`/dashboard/records/${o.medicalRecordId}`}
                  className="flex flex-wrap items-center gap-2 px-5 py-3 hover:bg-sage-50"
                >
                  <span className="font-medium">
                    {o.patient.firstName} {o.patient.lastName}
                  </span>
                  <span className="text-body-sm text-ink-secondary">
                    {o.items.map((i) => i.test.name).join(', ')}
                  </span>
                  {flagged > 0 && (
                    <span className="text-body-sm font-semibold text-tomato-700">
                      {flagged} out of range
                    </span>
                  )}
                  <span className="ml-auto text-caption text-ink-muted">
                    approved {o.approvedAt ? when(o.approvedAt, tz) : ''}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
