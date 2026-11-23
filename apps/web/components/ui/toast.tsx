'use client';

import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

interface Toast {
  id: number;
  tone: 'success' | 'error';
  message: string;
}
interface ToastState {
  toasts: Toast[];
  push: (tone: Toast['tone'], message: string) => void;
  dismiss: (id: number) => void;
}
let next = 1;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    const id = next++;
    set({ toasts: [...get().toasts, { id, tone, message }] });
    // Errors stay until dismissed (DESIGN.md §5 notifications).
    if (tone === 'success') setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
export const toast = {
  success: (m: string) => useToasts.getState().push('success', m),
  error: (m: string) => useToasts.getState().push('error', m),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:w-96"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'mc-enter pointer-events-auto flex items-start gap-3 rounded-md border border-l-4 bg-surface px-4 py-3 text-body-sm shadow-2',
            t.tone === 'error'
              ? 'border-error/30 border-l-error'
              : 'border-success/30 border-l-success',
          )}
        >
          {t.tone === 'error' ? (
            <AlertCircle className="mt-0.5 size-4 text-error" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 text-success" aria-hidden="true" />
          )}
          <p className="flex-1">{t.message}</p>
          <button
            className="-m-1 rounded-md p-1 text-ink-muted transition-colors duration-150 hover:bg-sage-50 hover:text-ink"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
