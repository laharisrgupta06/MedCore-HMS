'use client';

import { ArrowRight, MailWarning, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { ResultsToReview } from '@/components/lab/results-to-review';
import { PatientSummary } from './patient-summary';
import { ROLE_LABEL, type NavItem } from '@/constants/navigation';
import { useAuth } from '@/store/auth';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Role landing page: real account state and the sections this role can open. No placeholder metrics. */
export function HomeView({ nav, home }: { nav: NavItem[]; home: string }) {
  const me = useAuth((s) => s.me)!;
  const sections = nav.filter((n) => n.href !== home && n.roles.includes(me.user.role));
  return (
    <>
      <PageHeader
        tabTitle="Home"
        title={`${greeting()}, ${me.user.firstName}`}
        description={`${ROLE_LABEL[me.user.role]}${me.hospital ? ` at ${me.hospital.name}` : ' on the MedCore platform'}`}
      />
      {me.user.phone && !me.user.phoneVerified && (
        <Alert tone="info" title="Verify your mobile number" className="mb-6">
          <span className="inline-flex items-center gap-1">
            <Smartphone className="size-3.5" aria-hidden="true" /> {me.user.phone} is not verified
            yet.{' '}
            <Link className="mc-link" href={`${home}/account`}>
              Verify it now
            </Link>
          </span>
        </Alert>
      )}
      {!me.user.emailVerified && (
        <Alert tone="warning" title="Email not verified" className="mb-6">
          <MailWarning className="inline size-3.5" aria-hidden="true" /> Some messages may not reach
          you until it is verified.
        </Alert>
      )}
      {me.user.role === 'DOCTOR' && <ResultsToReview />}
      {me.user.role === 'PATIENT' && <PatientSummary />}
      <section
        aria-labelledby="sections"
        className="rounded-lg border border-border bg-surface shadow-1"
      >
        <h2
          id="sections"
          className="border-b border-border px-5 py-3 text-h3 font-semibold text-ink"
        >
          Your workspace
        </h2>
        <ul className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
          {sections.map(({ href, label, icon: Icon }) => (
            <li
              key={href}
              className="sm:border-b sm:border-border sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
            >
              <Link
                href={href}
                className="group flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-sage-50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sage-50 text-sage-700 transition-colors duration-150 group-hover:bg-sage-100">
                  <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="flex-1 font-medium">{label}</span>
                <ArrowRight
                  className="size-4 text-ink-muted transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
