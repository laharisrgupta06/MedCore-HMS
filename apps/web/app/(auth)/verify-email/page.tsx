import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyEmailForm } from '@/components/auth/verify-email-form';

export const metadata: Metadata = {
  title: 'Verify your email',
  description: 'Confirm your email address.',
};

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Verify your email"
      description="Enter the 6-digit code we sent to your email address."
    >
      <Suspense>
        <VerifyEmailForm />
      </Suspense>
    </AuthShell>
  );
}
