'use client';

import type { BatchStatus, StockBatch, StockMovementType } from '@medcore/types';
import { Badge } from '@/components/ui/misc';

export function BatchStatusBadge({ b }: { b: Pick<StockBatch, 'status' | 'expired'> }) {
  if (b.status === 'QUARANTINED') return <Badge tone="error">Quarantined</Badge>;
  if (b.status === 'DEPLETED') return <Badge>Used up</Badge>;
  // Expired by date but not yet quarantined by the nightly run: never dispensable.
  if (b.expired) return <Badge tone="error">Expired</Badge>;
  return <Badge tone="success">Active</Badge>;
}

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  ACTIVE: 'Active',
  QUARANTINED: 'Quarantined',
  DEPLETED: 'Used up',
};

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  RECEIPT: 'Received',
  DISPENSE: 'Dispensed',
  ADJUSTMENT: 'Adjusted',
  QUARANTINE: 'Quarantined',
};

/** A YYYY-MM-DD date as "12 Mar 2027" (dates have no time zone). */
export function day(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
