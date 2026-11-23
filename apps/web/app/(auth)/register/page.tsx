import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = {
  title: 'Create a patient account',
  description: 'Register as a patient of your hospital on MedCore HMS.',
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create a patient account"
      description="Staff accounts are created by your hospital administrator."
    >
      <RegisterForm />
    </AuthShell>
  );
}
