'use client';

import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Accessible modal (Radix): focus trap, Esc closes, labelled by its title (DESIGN.md §5). */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="mc-overlay fixed inset-0 z-50 bg-ink/40" />
        <D.Content
          className={cn(
            'mc-enter fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-lg bg-surface shadow-3 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg',
            wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          <div className="flex items-start gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <D.Title className="text-h3 font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-body-sm text-ink-secondary">
                  {description}
                </D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close
              className="-mr-1 rounded-md p-1.5 text-ink-muted transition-colors duration-150 hover:bg-sage-50 hover:text-ink max-sm:p-2.5"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden="true" />
            </D.Close>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-muted/50 px-5 py-4 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-3">
              {footer}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
