'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { homeFor } from '@/services/auth';
import { useAuth } from '@/store/auth';

/**
 * Client-side route protection for signed-in areas. It only decides what to render; the API
 * enforces authentication, roles and tenancy on every request.
 */
export function AuthGate({ area, children }: { area: 'staff' | 'patient'; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, me, expired, init } = useAuth();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      const q = new URLSearchParams({ next: pathname });
      if (expired) q.set('expired', '1');
      router.replace(`/login?${q.toString()}`);
    } else if (status === 'authenticated' && me) {
      const isPatient = me.user.role === 'PATIENT';
      if ((area === 'patient') !== isPatient) router.replace(homeFor(me.user.role));
    }
  }, [status, me, expired, area, pathname, router]);

  const allowed =
    status === 'authenticated' && me && (area === 'patient') === (me.user.role === 'PATIENT');
  if (!allowed) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
        <span className="sr-only">Loading your session</span>
        <div className="flex items-center gap-3 text-body-sm text-ink-muted">
          <span className="size-2 animate-pulse rounded-full bg-sage-600" aria-hidden="true" />
          Checking your session
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
