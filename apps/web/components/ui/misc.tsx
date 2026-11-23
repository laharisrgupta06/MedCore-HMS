import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-sm bg-surface-muted', className)}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-lg bg-sage-50 text-sage-700">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-4 text-body font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-body-sm text-ink-secondary">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-surface-muted text-ink-secondary',
  sage: 'bg-sage-50 text-sage-800',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
} as const;

/** Status label: always text (never colour alone), with an optional icon. */
export function Badge({
  tone = 'neutral',
  icon: Icon,
  children,
}: {
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption font-medium',
        TONES[tone],
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // min-w-0: a panel in a grid column may shrink to the column; wide tables scroll inside it.
    <section
      className={cn('min-w-0 rounded-lg border border-border bg-surface shadow-1', className)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          {title && <h2 className="text-h3 font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * One headline figure with its label and context (dashboards). When it links somewhere the whole card
 * is the link: border and shadow lift on hover, and an arrow shows it opens the list behind it.
 * Values come from the API only; never pass a placeholder number.
 */
export function StatCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
  icon?: LucideIcon;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-label font-medium text-ink-secondary">
        {Icon && <Icon className="size-4 text-sage-600" strokeWidth={1.75} aria-hidden="true" />}
        <span className="flex-1">{label}</span>
        {href && (
          <ArrowUpRight
            className="size-4 text-ink-disabled transition-colors duration-150 group-hover:text-sage-700"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="text-h2 font-semibold tabular-nums text-ink">{value}</span>
      {detail && <span className="text-caption text-ink-muted">{detail}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="mc-card-link group flex-col gap-1 p-4">
      {body}
    </Link>
  ) : (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-1">
      {body}
    </div>
  );
}
