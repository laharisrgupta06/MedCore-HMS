'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { errorMessage } from '@/lib/forms';
import { email } from '@/lib/validation';
import { authApi } from '@/services/auth';

const schema = z.object({ email });
type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' });

  if (sent)
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="success" title="Check your email">
          {sent} The link expires in 30 minutes and works once.
        </Alert>
        <Link href="/login" className="text-body-sm font-medium text-sage-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    );

  return (
    <form
      onSubmit={handleSubmit(async (v) => {
        setFailure(null);
        try {
          setSent((await authApi.forgotPassword(v.email)).message);
        } catch (e) {
          setFailure(errorMessage(e));
        }
      })}
      noValidate
      className="flex flex-col gap-5"
    >
      {failure && <Alert tone="error">{failure}</Alert>}
      <Field label="Email" error={errors.email?.message} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="email"
            autoComplete="email"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('email')}
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={isSubmitting}>
        Send reset link
      </Button>
      <p className="text-center text-body-sm">
        <Link href="/login" className="font-medium text-sage-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
