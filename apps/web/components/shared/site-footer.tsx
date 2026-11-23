import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-5 text-caption text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p>&copy; {new Date().getFullYear()} MedCore HMS</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link
            className="rounded-sm transition-colors duration-150 hover:text-ink hover:underline"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          <Link
            className="rounded-sm transition-colors duration-150 hover:text-ink hover:underline"
            href="/terms"
          >
            Terms and Conditions
          </Link>
          <Link
            className="rounded-sm transition-colors duration-150 hover:text-ink hover:underline"
            href="/status"
          >
            System status
          </Link>
        </nav>
      </div>
    </footer>
  );
}
