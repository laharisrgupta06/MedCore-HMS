import type { ReactNode } from 'react';
import { HospitalScene } from '@/components/brand/hospital-scene';
import { Logo } from '@/components/ui/logo';
import { SiteFooter } from '@/components/shared/site-footer';

/**
 * Two-column authentication layout: a cream brand panel with the animated hospital scene, and the
 * form on the page background. Below lg the panel is hidden and the scene sits as a band under the
 * form, never behind it.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="grid flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside className="relative hidden flex-col overflow-hidden border-r border-border bg-surface-muted lg:flex">
          <div className="px-10 pt-10">
            <Logo />
            <div className="mt-14 max-w-sm">
              <p className="font-serif text-h1 font-semibold text-ink">
                One record for every step of a hospital visit.
              </p>
              <p className="mt-4 text-body text-ink-secondary">
                Registration, appointments, consultations, prescriptions, laboratory, pharmacy and
                billing, kept separate for every hospital.
              </p>
            </div>
          </div>
          <div className="mt-auto pt-10">
            <HospitalScene className="opacity-80" />
          </div>
        </aside>
        <main
          id="main"
          className="flex items-start justify-center px-5 py-10 sm:px-8 lg:items-center"
        >
          <div className="mc-enter w-full max-w-[420px]">
            <div className="mb-8 lg:hidden">
              <Logo />
            </div>
            <h1 className="font-serif text-h1 font-semibold text-ink sm:text-display">{title}</h1>
            {description && <div className="mt-2 text-body text-ink-secondary">{description}</div>}
            <div className="mt-8">{children}</div>
          </div>
        </main>
      </div>
      <div className="border-t border-border bg-surface-muted lg:hidden">
        <HospitalScene className="mx-auto max-w-xl opacity-80" />
      </div>
      <SiteFooter />
    </div>
  );
}
