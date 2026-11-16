'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PasswordInput } from '@/components/auth/password-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/forms';
import { loginSchema } from '@/lib/validation';
import { homeFor, safeNext } from '@/services/auth';
import { useAuth } from '@/store/auth';

type Values = z.infer<typeof loginSchema>;

const NOTICES: Record<string, string> = {
  verified: 'Your email address is verified. You can now sign in.',
  reset:
    'Your password has been changed and every device was signed out. Sign in with the new password.',
  registered: 'Account created. Verify your email address, then sign in.',
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const login = useAuth((s) => s.login);
  const expired = useAuth((s) => s.expired) || params.get('expired') === '1';
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(loginSchema), mode: 'onBlur' });
  const notice = NOTICES[params.get('notice') ?? ''];
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.me);
  const init = useAuth((s) => s.init);

  // Already signed in (refresh cookie still valid): go straight to the role's area.
  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    if (status === 'authenticated' && me)
      router.replace(safeNext(params.get('next'), me.user.role) || homeFor(me.user.role));
  }, [status, me, params, router]);

  const onSubmit = async (v: Values) => {
    setFailure(null);
    try {
      const me = await login(v.email, v.password);
      router.replace(safeNext(params.get('next'), me.user.role));
    } catch (e) {
      setFailure({
        code: e instanceof ApiClientError ? e.code : 'UNKNOWN',
        message: errorMessage(e),
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {notice && <Alert tone="success">{notice}</Alert>}
      {expired && !failure && !notice && (
        <Alert tone="info" title="Your session has ended">
          For your security you were signed out. Sign in again to continue.
        </Alert>
      )}
      {failure && (
        <Alert tone="error" title="Could not sign in">
          {failure.message}
          {failure.code === 'EMAIL_NOT_VERIFIED' && (
            <>
              {' '}
              <Link
                className="font-medium text-sage-700 underline"
                href={`/verify-email?email=${encodeURIComponent(getValues('email'))}`}
              >
                Verify your email
              </Link>
            </>
          )}
        </Alert>
      )}
      <Field label="Email" error={errors.email?.message} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            inputMode="email"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('email')}
          />
        )}
      </Field>
      <Field label="Password" error={errors.password?.message} required>
        {({ id, describedBy, invalid }) => (
          <PasswordInput
            id={id}
            autoComplete="current-password"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('password')}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-body-sm font-medium text-sage-700 hover:underline"
        >
          Forgot your password?
        </Link>
      </div>
      <Button type="submit" size="lg" loading={isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-body-sm text-ink-secondary">
        New patient?{' '}
        <Link href="/register" className="font-medium text-sage-700 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
