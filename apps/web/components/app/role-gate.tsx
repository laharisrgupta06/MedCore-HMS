'use client';

import type { Role } from '@medcore/types';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { useAuth } from '@/store/auth';

/** Renders a page only for the listed roles (the API enforces the same rule). */
export function RoleGate({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const role = useAuth((s) => s.me?.user.role);
  if (!role || !roles.includes(role))
    return (
      <EmptyState
        icon={ShieldX}
        title="You do not have access to this page"
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: 'secondary' })}>
            Back to home
          </Link>
        }
      >
        Ask your hospital administrator if you need access.
      </EmptyState>
    );
  return <>{children}</>;
}
