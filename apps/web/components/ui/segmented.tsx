'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmented control for switching views or filters (tabs inside a page). The selected segment sits on
 * the surface with a tomato indicator underneath (the accent marks the current choice). Arrow keys
 * move between segments, as for ARIA tabs. Use `as="radio"` for a filter that is not a set of tabs.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  as = 'tabs',
  className,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  as?: 'tabs' | 'radio';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next]!.value);
  };
  return (
    <div
      role={as === 'tabs' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      className={cn(
        'inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-border bg-surface-muted p-0.5',
        className,
      )}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={as === 'tabs' ? 'tab' : 'radio'}
            aria-selected={as === 'tabs' ? selected : undefined}
            aria-checked={as === 'radio' ? selected : undefined}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative rounded-[5px] px-3 py-1.5 text-body-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-standard)] max-sm:py-2.5',
              selected
                ? 'bg-surface text-ink shadow-1 after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-tomato-600'
                : 'text-ink-secondary hover:bg-surface/70 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
