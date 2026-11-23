'use client';

import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import type { PaginationMeta } from '@medcore/types';
import type { ReactNode } from 'react';
import { Alert } from './alert';
import { Button } from './button';
import { EmptyState, Skeleton } from './misc';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Shown as the title line of the stacked mobile row. */
  primary?: boolean;
  className?: string;
  hideOnMobile?: boolean;
}

/**
 * Table on md and above; stacked rows on small screens (no horizontal page scroll, DESIGN.md §5).
 * Handles loading skeletons, errors with retry and empty states.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  actions,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode };
  actions?: (row: T) => ReactNode;
  caption: string;
}) {
  if (error)
    return (
      <div className="p-5">
        <Alert tone="error" title="Could not load the list">
          <p>{error}</p>
          {onRetry && (
            <Button variant="secondary" size="compact" className="mt-2" onClick={onRetry}>
              Try again
            </Button>
          )}
        </Alert>
      </div>
    );
  if (loading || !rows)
    return (
      <div className="flex flex-col gap-3 p-5" role="status" aria-live="polite">
        <span className="sr-only">Loading</span>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (rows.length === 0)
    return (
      <EmptyState icon={empty.icon} title={empty.title} action={empty.action}>
        {empty.text}
      </EmptyState>
    );
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  return (
    <>
      <table className="hidden w-full text-body-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-surface-muted text-left">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-5 py-2.5 text-label font-medium text-ink-secondary',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
            {actions && (
              <th scope="col" className="px-5 py-2.5 text-right">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="transition-colors duration-150 hover:bg-sage-50">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-5 py-3 align-middle', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
              {actions && <td className="whitespace-nowrap px-5 py-2 text-right">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="px-4 py-3">
            <div className="font-medium">{primary.cell(r)}</div>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              {columns
                .filter((c) => c !== primary && !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-ink-muted">{c.header}</dt>
                    <dd className="min-w-0 break-words">{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
            {actions && <div className="mt-2 flex flex-wrap gap-2">{actions(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pagination({
  meta,
  onPage,
}: {
  meta: PaginationMeta | undefined;
  onPage: (p: number) => void;
}) {
  if (!meta || meta.totalPages <= 1) return null;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.total, meta.page * meta.limit);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-body-sm text-ink-secondary"
    >
      <span>
        {from} to {to} of {meta.total}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="compact"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="secondary"
          size="compact"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
