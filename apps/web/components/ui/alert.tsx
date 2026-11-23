import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const styles = {
  error: { box: 'border-error/30 bg-error-bg text-error', Icon: AlertCircle },
  success: { box: 'border-success/30 bg-success-bg text-success', Icon: CheckCircle2 },
  warning: { box: 'border-warning/30 bg-warning-bg text-warning', Icon: TriangleAlert },
  info: { box: 'border-info/30 bg-info-bg text-info', Icon: Info },
} as const;

/** Inline status message. Errors are announced assertively, others politely. */
export function Alert({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof styles;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { box, Icon } = styles[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border px-4 py-3 text-body-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-ink-secondary', title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}
