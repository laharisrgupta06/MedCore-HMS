import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 ease-[var(--ease-standard)] disabled:pointer-events-none disabled:bg-surface-muted disabled:text-ink-disabled disabled:border-transparent [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-sage-600 text-white hover:bg-sage-700 active:bg-sage-800',
        accent: 'bg-tomato-600 text-white hover:bg-tomato-700',
        secondary: 'border border-border-strong bg-surface text-ink hover:bg-sage-50',
        ghost: 'text-ink-secondary hover:bg-sage-50 hover:text-ink',
        destructive: 'bg-error text-white hover:bg-[#8f1c13]',
        link: 'h-auto px-0 text-sage-700 underline-offset-4 hover:underline',
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
