import type { Metadata } from 'next';
import { PublicShell } from '@/components/public/public-shell';
import { SystemStatus } from '@/components/shared/system-status';

export const metadata: Metadata = {
  title: 'System status',
  description: 'Live status of MedCore services.',
};

export default function StatusPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-xl px-5 py-12">
        <h1 className="font-serif text-h1 font-semibold">System status</h1>
        <p className="mt-1 text-body text-ink-secondary">
          Checked live through the web application and API.
        </p>
        <SystemStatus />
      </div>
    </PublicShell>
  );
}
