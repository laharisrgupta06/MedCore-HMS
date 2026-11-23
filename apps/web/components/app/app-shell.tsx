'use client';

import { ChevronRight, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { HeaderSearch } from '@/components/analytics/global-search';
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  // Mobile menu: focus moves into it, Escape closes it, and focus returns to the menu button.
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      // Keep keyboard focus inside the open menu.
      if (e.key === 'Tab' && drawer.current) {
        const items = drawer.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([tabindex="-1"])',
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // The page behind the open menu does not scroll.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trigger = menuButton.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [open]);
  // A route change closes the menu (state adjusted during render, as React recommends).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    if (open) setOpen(false);
  }
  if (!me) return null;
  const items = nav.filter((n) => n.roles.includes(me.user.role));
  const platform = me.user.role === 'SUPER_ADMIN';
  // The most specific matching item is current, so /dashboard/lab/samples does not also mark /dashboard/lab.
  const matches = (href: string) =>
    href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`);
  const current = items
    .filter((n) => matches(n.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === current;

  const sidebar = (
    <nav
      aria-label="Main"
      className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4"
    >
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn(
            'relative flex items-center gap-3 rounded-md px-3 py-2 text-body-sm text-sage-100 transition-colors duration-150 ease-[var(--ease-standard)] hover:bg-sage-800 hover:text-white max-lg:py-2.5',
            isActive(href) &&
              'bg-sage-800 font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-tomato-600',
          )}
        >
          <Icon
            className={cn(
              'size-4 shrink-0 transition-colors duration-150',
              isActive(href) ? 'text-white' : 'text-sage-300',
            )}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 bg-sage-900 pt-5 lg:flex">
        <div className="px-6">
          <Logo href={home} inverse />
          {platform && (
            <p className="mt-2 text-caption font-medium uppercase tracking-wide text-sage-300">
              Platform administration
            </p>
          )}
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
            tabIndex={-1}
            className="mc-overlay absolute inset-0 bg-ink/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={drawer}
            className="mc-drawer relative flex h-full w-72 max-w-[85vw] flex-col gap-6 bg-sage-900 pt-5 shadow-3"
          >
            <div className="flex items-center justify-between px-6">
              <Logo href={home} inverse />
              <button
                ref={closeButton}
                className="-mr-2 rounded-md p-2.5 text-sage-100 transition-colors duration-150 hover:bg-sage-800 hover:text-white"
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-3 sm:px-6">
          <button
            ref={menuButton}
            className="rounded-md p-2.5 text-ink-secondary transition-colors duration-150 hover:bg-sage-50 hover:text-ink lg:hidden"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-label="Open menu"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-body-sm text-ink-secondary">
            {platform && (
              <ShieldCheck className="size-4 shrink-0 text-sage-600" aria-hidden="true" />
            )}
            <span className="truncate">
              {me.hospital?.name ?? 'MedCore platform administration'}
            </span>
          </div>
          {home === '/dashboard' && me.hospital && me.user.role !== 'PATIENT' && <HeaderSearch />}
          <NotificationBell
            href={home === '/portal' ? '/portal/notifications' : '/dashboard/notifications'}
          />
          <Link
            href={`${home}/account`}
            className="hidden rounded-md px-2 py-1 text-right transition-colors duration-150 hover:bg-sage-50 sm:block"
            aria-label={`My account: ${me.user.firstName} ${me.user.lastName}, ${ROLE_LABEL[me.user.role]}`}
          >
            <span className="block text-body-sm font-medium text-ink">
              {me.user.firstName} {me.user.lastName}
            </span>
            <span className="block text-caption text-ink-muted">{ROLE_LABEL[me.user.role]}</span>
          </Link>
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
            <span className="max-sm:sr-only">Sign out</span>
          </Button>
        </header>
        <main
          id="main"
          key={pathname}
          className="mc-enter mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export interface Crumb {
  label: string;
  href: string;
}

/**
 * Page heading (DESIGN.md §5 headers): optional breadcrumbs for pages deeper than one level, the
 * title, an optional description and the page's actions on the right. It also sets the browser tab
 * title, since most app pages are client components that cannot export route metadata.
 */
export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  tabTitle,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
  /** Browser tab title when the heading is not a good one (a greeting, say). Defaults to the title. */
  tabTitle?: string;
}) {
  useEffect(() => {
    document.title = `${tabTitle ?? title} | MedCore HMS`;
  }, [title, tabTitle]);
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-body-sm text-ink-muted">
              {crumbs.map((c) => (
                <li key={c.href} className="flex items-center gap-1">
                  <Link
                    href={c.href}
                    className="rounded-sm text-sage-700 transition-colors duration-150 hover:text-sage-800 hover:underline"
                  >
                    {c.label}
                  </Link>
                  <ChevronRight className="size-3.5 text-ink-disabled" aria-hidden="true" />
                </li>
              ))}
              <li aria-current="page" className="truncate text-ink-secondary">
                {title}
              </li>
            </ol>
          </nav>
        )}
        <h1 className="font-serif text-h1 font-semibold text-ink">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-body text-ink-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
