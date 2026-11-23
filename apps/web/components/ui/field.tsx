import { AlertCircle } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/** Shared look of every text control: 36 px (44 px on touch), radius 4, sage border on focus. */
export const controlClass =
  'h-9 w-full rounded-sm border border-border-strong bg-surface px-3 text-body text-ink shadow-[inset_0_1px_1px_rgba(30,36,32,0.04)] placeholder:text-ink-muted transition-[border-color,box-shadow,background-color] duration-150 ease-[var(--ease-standard)] hover:border-ink-secondary focus-visible:border-sage-600 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-disabled aria-[invalid=true]:border-error aria-[invalid=true]:bg-error-bg/40 max-sm:h-11';
const control = controlClass;
/** Multi-line text: same border and focus as inputs, at least three lines tall, resizable vertically. */
export const textareaClass = cn(
  controlClass,
  'h-auto min-h-24 resize-y py-2 leading-6 max-sm:h-auto',
);

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
        {required && <span className="font-normal text-ink-muted"> (required)</span>}
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

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(textareaClass, className)} {...props} />
));
Textarea.displayName = 'Textarea';

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
        {required && <span className="font-normal text-ink-muted"> (required)</span>}
      </span>
      {children}
    </div>
  );
}
