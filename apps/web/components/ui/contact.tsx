import { cn } from '@/lib/utils';

const base =
  'rounded-sm text-sage-700 underline decoration-sage-700/30 underline-offset-2 transition-colors duration-150 hover:text-sage-800 hover:decoration-current';

/** A phone number that dials on tap (tel: link). Spaces and dashes are dropped from the link only. */
export function PhoneLink({ value, className }: { value: string; className?: string }) {
  return (
    <a
      href={`tel:${value.replace(/[^\d+]/g, '')}`}
      className={cn(base, 'whitespace-nowrap', className)}
    >
      {value}
    </a>
  );
}

/** An email address that opens the mail app (mailto: link). */
export function EmailLink({ value, className }: { value: string; className?: string }) {
  return (
    <a href={`mailto:${value}`} className={cn(base, 'break-all', className)}>
      {value}
    </a>
  );
}
