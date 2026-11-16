'use client';

import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { ROLE_LABEL, type NavItem } from '@/constants/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

/** Authenticated layout: sage sidebar (drawer below lg), header with user and sign-out. */
export function AppShell({
  nav,
  home,
  children,
}: {
  nav: NavItem[];
  home: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  if (!me) return null;
  const items = nav.filter((n) => n.roles.includes(me.user.role));
  // The most specific matching item is current, so /dashboard/lab/samples does not also mark /dashboard/lab.
  const matches = (href: string) =>
    href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`);
  const current = items
    .filter((n) => matches(n.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === current;

  const sidebar = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3">
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn(
            'relative flex items-center gap-3 rounded-md px-3 py-2 text-body-sm text-sage-100 transition-colors duration-150 hover:bg-sage-800',
            isActive(href) &&
              'bg-sage-800 font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-tomato-600',
          )}
        >
          <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 bg-sage-900 py-5 lg:flex">
        <div className="px-6">
          <Logo href={home} inverse />
        </div>
        {sidebar}
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            className="absolute inset-0 bg-ink/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="mc-enter relative flex h-full w-72 flex-col gap-6 bg-sage-900 py-5">
            <div className="flex items-center justify-between px-6">
              <Logo href={home} inverse />
              <button
                className="rounded-sm p-2 text-sage-100"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur-sm sm:px-6">
          <button
            className="rounded-sm p-2 text-ink-secondary lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 truncate text-body-sm text-ink-secondary">
            {me.hospital?.name ?? 'MedCore platform'}
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-body-sm font-medium text-ink">
              {me.user.firstName} {me.user.lastName}
            </p>
            <p className="text-caption text-ink-muted">{ROLE_LABEL[me.user.role]}</p>
          </div>
          <Button
            variant="ghost"
            size="compact"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                await logout(false);
              } finally {
                router.replace('/login');
              }
            }}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-serif text-h1 font-semibold">{title}</h1>
        {description && <p className="mt-1 text-body text-ink-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
