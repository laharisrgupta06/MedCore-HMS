'use client';

import type { DependencyStatus, HealthStatus } from '@medcore/types';
import { useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { getHealth, healthQueryKey } from '@/services/health';
import { buttonVariants } from '@/components/ui/button';

const LABELS: Record<'db' | 'redis' | 'queue', string> = {
  db: 'PostgreSQL',
  redis: 'Redis',
  queue: 'Job queue (BullMQ)',
};

function StatusList({ status }: { status: Pick<HealthStatus, 'db' | 'redis' | 'queue'> }) {
  return (
    <ul className="mt-4 divide-y divide-border border-y border-border">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => {
        const value: DependencyStatus = status[key];
        return (
          <li key={key} className="flex justify-between py-2 text-sm">
            <span>{LABELS[key]}</span>
            <span className={value === 'up' ? 'text-success' : 'text-error'}>
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
      <p role="status" className="mt-6 text-sm text-ink-secondary">
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
        <p className="text-sm font-medium text-error">{error.message}</p>
        {degraded ? <StatusList status={degraded} /> : null}
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className={buttonVariants({ variant: 'secondary', className: 'mt-4' })}
        >
          {isFetching ? 'Retrying' : 'Retry'}
        </button>
      </section>
    );
  }

  return (
    <section className="mt-6" aria-live="polite">
      <p className="text-sm font-medium text-success">All services are running.</p>
      <StatusList status={data} />
    </section>
  );
}
