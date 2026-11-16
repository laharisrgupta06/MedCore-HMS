import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to MedCore HMS.',
};

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" description="Use the email address registered with your hospital.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
