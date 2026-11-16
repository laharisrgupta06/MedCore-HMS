import Link from 'next/link';
import { cn } from '@/lib/utils';

/** MedCore wordmark with an original mark (a cross formed by two offset leaves). */
export function Logo({ href = '/', inverse = false }: { href?: string; inverse?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 rounded-sm font-serif text-h3 font-semibold',
        inverse ? 'text-white' : 'text-ink',
      )}
      aria-label="MedCore HMS home"
    >
      <svg viewBox="0 0 28 28" className="size-7" aria-hidden="true">
        <rect x="11" y="3" width="6" height="22" rx="2" fill={inverse ? '#C8D7C4' : '#52714D'} />
        <rect x="3" y="11" width="22" height="6" rx="2" fill={inverse ? '#C8D7C4' : '#52714D'} />
        <circle cx="14" cy="14" r="3" fill="#C8432B" />
      </svg>
      MedCore
    </Link>
  );
}
