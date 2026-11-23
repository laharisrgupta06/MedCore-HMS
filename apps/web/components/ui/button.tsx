import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Buttons (DESIGN.md §5). Variants, in order of emphasis:
 * - primary: the main action of a view (sage).
 * - accent: the one key call to action on a screen, used sparingly (tomato).
 * - secondary: supporting actions (surface with a strong border).
 * - outline: a sage-outlined action that fills with sage on hover.
 * - destructive: deletes, voids, cancels something that cannot be undone (error red).
 * - ghost: low-emphasis actions inside panels, toolbars and menus.
 * - danger: a low-emphasis trigger for a destructive action (opens a confirmation, or rejects).
 * - link: an inline text action only where a button would be out of place.
 * Radius 6 (never pill-shaped), 150 ms colour and shadow transitions, focus ring from globals.css.
 */
export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-medium transition-[background-color,border-color,color,box-shadow] duration-150 ease-[var(--ease-standard)] disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-muted disabled:text-ink-disabled disabled:shadow-none aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-sage-600 text-white shadow-1 hover:bg-sage-700 hover:shadow-hover active:bg-sage-800 active:shadow-none',
        accent:
          'bg-tomato-600 text-white shadow-1 hover:bg-tomato-700 hover:shadow-hover active:bg-tomato-800 active:shadow-none',
        secondary:
          'border-border-strong bg-surface text-ink shadow-1 hover:border-sage-600 hover:bg-sage-50 hover:text-sage-800 active:bg-sage-100 active:shadow-none',
        outline:
          'border-sage-600 bg-transparent text-sage-700 hover:bg-sage-600 hover:text-white active:bg-sage-700',
        ghost: 'text-ink-secondary hover:bg-sage-50 hover:text-ink active:bg-sage-100',
        danger: 'text-error hover:bg-error-bg hover:text-error-hover active:bg-error-bg',
        destructive:
          'bg-error text-white shadow-1 hover:bg-error-hover hover:shadow-hover active:shadow-none',
        link: 'h-auto border-0 px-0 text-sage-700 underline decoration-sage-700/40 underline-offset-4 hover:text-sage-800 hover:decoration-current',
      },
      size: {
        default: 'h-9 px-4 text-body-sm max-sm:h-11',
        compact: 'h-8 px-3 text-body-sm',
        lg: 'h-11 px-5 text-body',
        icon: 'size-9 max-sm:size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
