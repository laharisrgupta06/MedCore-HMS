import type { Metadata } from 'next';
import { SystemStatus } from '@/components/shared/system-status';

export const metadata: Metadata = { title: 'System status' };

/**
 * Phase 0 development page: verifies the browser -> Next.js proxy -> NestJS -> PostgreSQL/Redis path.
 * Replaced by the authenticated entry point in Phase 1.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">MedCore HMS</h1>
      <p className="mt-1 text-sm text-neutral-600">Development environment status</p>
      <SystemStatus />
    </main>
  );
}
