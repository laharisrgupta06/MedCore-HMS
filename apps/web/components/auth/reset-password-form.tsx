'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { PasswordInput } from '@/components/auth/password-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ApiClientError } from '@/lib/api-client';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { resetSchema } from '@/lib/validation';
import { authApi } from '@/services/auth';

type Values = z.infer<typeof resetSchema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(resetSchema), mode: 'onBlur' });

  if (!validToken || failure?.code === 'RESET_TOKEN_INVALID')
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="error" title="This reset link cannot be used">
          It is invalid, already used or expired. Request a new link to continue.
        </Alert>
        <Link href="/forgot-password" className="mc-link text-body-sm">
          Request a new link
        </Link>
      </div>
    );

  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        setFailure(null);
        try {
          await authApi.resetPassword(token, v.password);
          router.replace('/login?notice=reset');
        } catch (e) {
          if (e instanceof ApiClientError && e.code === 'PASSWORD_POLICY') {
            setError('password', { type: 'server', message: e.message });
            return;
          }
          if (applyServerFieldErrors(e, setError, ['password'])) return;
          setFailure({
            code: e instanceof ApiClientError ? e.code : 'UNKNOWN',
            message: errorMessage(e),
          });
        }
      })}
      noValidate
      className="flex flex-col gap-5"
    >
      {failure && <Alert tone="error">{failure.message}</Alert>}
      <Field
        label="New password"
        hint="10 to 128 characters with a letter and a number."
        error={errors.password?.message}
        required
      >
        {({ id, describedBy, invalid }) => (
          <PasswordInput
            id={id}
            autoComplete="new-password"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('password')}
          />
        )}
      </Field>
      <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
        {({ id, describedBy, invalid }) => (
          <PasswordInput
            id={id}
            autoComplete="new-password"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('confirmPassword')}
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={isSubmitting}>
        Change password
      </Button>
    </form>
  );
}
