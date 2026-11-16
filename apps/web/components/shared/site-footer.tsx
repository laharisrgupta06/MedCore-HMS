import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-5 text-caption text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} MedCore HMS</p>
        <nav aria-label="Legal" className="flex gap-5">
          <Link className="hover:text-ink" href="/privacy">
            Privacy Policy
          </Link>
          <Link className="hover:text-ink" href="/terms">
            Terms and Conditions
          </Link>
          <Link className="hover:text-ink" href="/status">
            System status
          </Link>
        </nav>
      </div>
    </footer>
  );
}
