'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, PackageX } from 'lucide-react';
import { PageHeader } from '@/components/app/app-shell';
import { when } from '@/components/emr/shared';
import { Alert } from '@/components/ui/alert';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { pharmacyApi } from '@/services/pharmacy';
import { day } from './shared';

/** PHARM-003 and PHARM-005: low stock now, expiring within 30 days, the latest nightly report. */
export function PharmacyAlertsView() {
  const tz = useHospitalTz();
  const q = useQuery({
    queryKey: ['pharmacy-alerts'],
    queryFn: () => pharmacyApi.alerts(),
    refetchInterval: 300_000,
  });
  return (
    <>
      <PageHeader
        title="Pharmacy alerts"
        description="Low stock, stock expiring within 30 days, and the nightly expiry report."
      />
      {q.error ? (
        <Alert tone="error" title="Could not load the alerts">
          {errorMessage(q.error)}
        </Alert>
      ) : q.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          <Panel title="Low stock">
            {q.data.lowStock.length === 0 ? (
              <EmptyState icon={PackageX} title="No medicine is below its reorder level" />
            ) : (
              <ul className="divide-y divide-border">
                {q.data.lowStock.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                    <span className="font-medium">
                      {m.name} {m.strength}
                    </span>
                    <Badge tone={m.available === 0 ? 'error' : 'warning'}>
                      {m.available === 0 ? 'Out of stock' : `${m.available} left`}
                    </Badge>
                    <span className="text-body-sm text-ink-secondary">
                      reorder level <span className="font-mono">{m.reorderLevel}</span>
                    </span>
                    <span className="ml-auto text-caption text-ink-muted">
                      low since {when(m.lowStockSince, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Expiring within 30 days">
            {q.data.expiringSoon.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No active stock expires in the next 30 days"
              />
            ) : (
              <ul className="divide-y divide-border">
                {q.data.expiringSoon.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                    <span className="font-medium">
                      {b.medicine.name} {b.medicine.strength}
                    </span>
                    <span className="font-mono text-body-sm">{b.batchNumber}</span>
                    <span className="text-body-sm">{b.quantity} units</span>
                    <span className="ml-auto text-body-sm">expires {day(b.expiresOn)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Nightly expiry report">
            {!q.data.latestReport ? (
              <p className="px-5 py-4 text-body-sm text-ink-muted">
                No nightly report yet. It runs at 02:00 hospital time.
              </p>
            ) : (
              <div>
                <p className="px-5 pt-3 text-body-sm text-ink-secondary">
                  Report of {day(q.data.latestReport.runDate)}, made{' '}
                  {when(q.data.latestReport.createdAt, tz)}.
                </p>
                {q.data.latestReport.items.length === 0 ? (
                  <p className="px-5 py-3 text-body-sm text-ink-muted">
                    Nothing had expired or was due to expire within 30 days.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {q.data.latestReport.items.map((i) => (
                      <li
                        key={`${i.kind}-${i.batchId}`}
                        className="flex flex-wrap items-center gap-2 px-5 py-3"
                      >
                        {i.kind === 'QUARANTINED' ? (
                          <Badge tone="error">Expired, quarantined</Badge>
                        ) : (
                          <Badge tone="warning">Expiring</Badge>
                        )}
                        <span className="font-medium">
                          {i.medicineName} {i.strength}
                        </span>
                        <span className="font-mono text-body-sm">{i.batchNumber}</span>
                        <span className="text-body-sm">{i.quantity} units</span>
                        <span className="ml-auto text-body-sm">
                          {i.kind === 'QUARANTINED' ? 'expired' : 'expires'} {day(i.expiresOn)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
