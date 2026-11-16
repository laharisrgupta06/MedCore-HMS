import type { ReactNode } from 'react';
import { Logo } from '@/components/ui/logo';
import { SiteFooter } from '@/components/shared/site-footer';

/** Two-column authentication layout: an original illustrated panel and the form. */
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
        <aside className="relative hidden overflow-hidden bg-sage-900 p-10 text-sage-100 lg:flex lg:flex-col">
          <Logo inverse />
          <div className="relative z-10 mt-auto max-w-sm">
            <p className="font-serif text-h1 text-white">
              One record for every step of a hospital visit.
            </p>
            <p className="mt-4 text-body text-sage-200">
              Registration, appointments, consultations, prescriptions, laboratory, pharmacy and
              billing, kept separate for every hospital.
            </p>
          </div>
          <AuthArt />
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
      <SiteFooter />
    </div>
  );
}

/** Abstract care-pathway illustration (original SVG, decorative). */
function AuthArt() {
  return (
    <svg
      className="pointer-events-none absolute -right-24 top-24 h-[520px] w-[520px] opacity-90"
      viewBox="0 0 520 520"
      aria-hidden="true"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#2F432D" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="520" height="520" fill="url(#grid)" />
      <path
        d="M40 420 C 140 420, 140 300, 240 300 S 340 160, 460 160"
        fill="none"
        stroke="#84A47E"
        strokeWidth="2"
        strokeDasharray="6 8"
      />
      {[
        [40, 420],
        [240, 300],
        [460, 160],
      ].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="18" fill="#1F2D1E" stroke="#A6BEA1" strokeWidth="2" />
          <circle cx={x} cy={y} r="5" fill={i === 2 ? '#C8432B' : '#C8D7C4'} />
        </g>
      ))}
    </svg>
  );
}
