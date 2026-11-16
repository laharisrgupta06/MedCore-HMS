import { AlertCircle } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const control =
  'h-9 w-full rounded-sm border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-ink-muted transition-colors duration-150 hover:border-ink-secondary disabled:bg-surface-muted disabled:text-ink-disabled aria-[invalid=true]:border-error max-sm:h-11';

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Label above, hint below, error with icon (DESIGN.md §5 inputs and forms). */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-label font-medium text-ink">
        {label}
        {required && <span className="text-ink-muted"> (required)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-caption text-error">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-caption text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(control, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(control, 'pr-8', className)} {...props} />
  ),
);
Select.displayName = 'Select';

/** A labelled group for composite controls (pickers, slot grids) that are not a single input. */
export function FieldGroup({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={cn('flex flex-col gap-1.5', className)}>
      <span id={id} className="text-label font-medium text-ink">
        {label}
        {required && <span className="text-ink-muted"> (required)</span>}
      </span>
      {children}
    </div>
  );
}
