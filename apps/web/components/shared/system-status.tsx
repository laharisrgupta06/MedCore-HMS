'use client';

import type { DependencyStatus, HealthStatus } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { getHealth, healthQueryKey } from '@/services/health';

const LABELS: Record<'db' | 'redis' | 'queue', string> = {
  db: 'PostgreSQL',
  redis: 'Redis',
  queue: 'Job queue (BullMQ)',
};

function StatusList({ status }: { status: Pick<HealthStatus, 'db' | 'redis' | 'queue'> }) {
  return (
    <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => {
        const value: DependencyStatus = status[key];
        return (
          <li key={key} className="flex justify-between py-2 text-sm">
            <span>{LABELS[key]}</span>
            <span className={value === 'up' ? 'text-green-700' : 'text-red-700'}>
              {value === 'up' ? 'Up' : 'Down'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SystemStatus() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: healthQueryKey,
    queryFn: getHealth,
  });

  if (isPending) {
    return (
      <p role="status" className="mt-6 text-sm text-neutral-600">
        Checking services...
      </p>
    );
  }

  if (error) {
    const apiError = error instanceof ApiClientError ? error : undefined;
    const degraded =
      apiError?.code === 'SERVICE_UNAVAILABLE'
        ? (apiError.details as HealthStatus | undefined)
        : undefined;
    return (
      <section role="alert" className="mt-6">
        <p className="text-sm font-medium text-red-700">{error.message}</p>
        {degraded ? <StatusList status={degraded} /> : null}
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-4 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 focus-visible:outline-2 disabled:opacity-50"
        >
          {isFetching ? 'Retrying...' : 'Retry'}
        </button>
      </section>
    );
  }

  return (
    <section className="mt-6" aria-live="polite">
      <p className="text-sm font-medium text-green-700">All services are running.</p>
      <StatusList status={data} />
    </section>
  );
}
