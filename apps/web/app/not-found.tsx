import type { Metadata } from 'next';
import Link from 'next/link';
import { HospitalScene } from '@/components/brand/hospital-scene';
import { PublicShell } from '@/components/public/public-shell';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <PublicShell>
      <div className="mx-auto flex max-w-xl flex-col items-start px-5 pb-8 pt-16 sm:pt-24">
        <p className="font-mono text-body-sm text-tomato-700">404</p>
        <h1 className="mt-2 font-serif text-h1 font-semibold sm:text-display">
          This page does not exist
        </h1>
        <p className="mt-3 text-body text-ink-secondary">
          The link may be out of date, or the address may have a typo.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className={buttonVariants()}>
            Go to the home page
          </Link>
          <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
            Sign in
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-5xl">
        <HospitalScene variant="wide" className="opacity-75" />
      </div>
    </PublicShell>
  );
}
