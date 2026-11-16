import Link from 'next/link';
import { PublicShell } from '@/components/public/public-shell';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <PublicShell>
      <div className="mx-auto flex max-w-xl flex-col items-start px-5 py-24">
        <p className="font-mono text-body-sm text-tomato-700">404</p>
        <h1 className="mt-2 font-serif text-display font-semibold">This page does not exist</h1>
        <p className="mt-3 text-body text-ink-secondary">
          The link may be out of date, or the address may have a typo.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/" className={buttonVariants()}>
            Go to the home page
          </Link>
          <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
            Sign in
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
