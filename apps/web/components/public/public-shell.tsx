import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/shared/site-footer';
import { buttonVariants } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav aria-label="Account" className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: 'ghost' })}>
              Sign in
            </Link>
            <Link href="/register" className={buttonVariants({ variant: 'primary' })}>
              Patient registration
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** Long-form legal/document layout. */
export function DocumentPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-5 py-12 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-h2 [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6">
        <h1 className="font-serif text-display font-semibold">{title}</h1>
        <p className="mt-2 text-body-sm text-ink-muted">Last updated {updated}</p>
        {children}
      </article>
    </PublicShell>
  );
}
