import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/public/public-shell';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = {
  title: { absolute: 'MedCore HMS: hospital management for every role' },
  description:
    'MedCore HMS connects registration, appointments, consultations, prescriptions, laboratory, pharmacy and billing for each hospital.',
};

const STEPS = [
  [
    'Registration',
    'Patients register with their hospital code; staff accounts are created by the hospital.',
  ],
  [
    'Appointments',
    'Bookings are checked against doctor availability so a slot cannot be taken twice.',
  ],
  [
    'Consultation',
    'Doctors record vitals, diagnoses and notes; corrections never overwrite the original.',
  ],
  ['Orders', 'Prescriptions and laboratory tests flow to the pharmacy and laboratory teams.'],
  ['Billing', 'Invoices are built from the visit and settled by card, UPI or cash.'],
] as const;

export default function HomePage() {
  return (
    <PublicShell>
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:py-24">
          <div className="mc-enter">
            <p className="text-label font-medium uppercase tracking-wide text-sage-700">
              Hospital management system
            </p>
            <h1 className="mt-4 max-w-xl font-serif text-[40px] font-semibold leading-[48px] sm:text-[48px] sm:leading-[56px]">
              Every step of a patient visit, in one place.
            </h1>
            <p className="mt-5 max-w-lg text-body text-ink-secondary">
              MedCore gives administrators, doctors, nurses, reception, laboratory, pharmacy and
              accounts teams their own workspace, and keeps each hospital&apos;s data separate from
              every other hospital.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={buttonVariants({ size: 'lg' })}>
                Sign in
              </Link>
              <Link
                href="/register"
                className={buttonVariants({ variant: 'secondary', size: 'lg' })}
              >
                Register as a patient
              </Link>
            </div>
          </div>
          <ol
            className="relative self-center border-l border-sage-300 pl-8"
            aria-label="Care pathway"
          >
            {STEPS.map(([title, text], i) => (
              <li key={title} className="relative pb-7 last:pb-0">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[41px] top-0.5 flex size-[18px] items-center justify-center rounded-full border-2 ${i === STEPS.length - 1 ? 'border-tomato-600 bg-tomato-50' : 'border-sage-600 bg-bg'}`}
                />
                <p className="font-medium text-ink">{title}</p>
                <p className="mt-1 text-body-sm text-ink-secondary">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </PublicShell>
  );
}
