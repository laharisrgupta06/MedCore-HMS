'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { OtpInput } from '@/components/auth/otp-input';
import { ResendButton } from '@/components/auth/resend-button';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { errorMessage } from '@/lib/forms';
import { email, otp } from '@/lib/validation';
import { authApi } from '@/services/auth';

const schema = z.object({ email, otp });
type Values = z.infer<typeof schema>;

export function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const isNew = params.get('new') === '1';
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: params.get('email') ?? '', otp: '' },
  });

  const onSubmit = async (v: Values) => {
    setMsg(null);
    try {
      await authApi.verifyEmail(v.email, v.otp);
      router.replace('/login?notice=verified');
    } catch (e) {
      setMsg({ ok: false, message: errorMessage(e) });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {isNew && !msg && (
        <Alert tone="success" title="Account created">
          We sent a 6-digit code to your email address. It expires in 10 minutes.
        </Alert>
      )}
      {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert>}
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
      <Field label="Verification code" error={errors.otp?.message} required>
        {({ id, describedBy, invalid }) => (
          <OtpInput
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('otp')}
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={isSubmitting}>
        Verify email
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm text-ink-secondary">
        <span>Did not receive it?</span>
        <ResendButton
          initialCooldown={isNew ? 60 : 0}
          onResend={async () => {
            if (!(await trigger('email'))) throw new Error('Enter a valid email address first.');
            return (await authApi.resendEmail(getValues('email'))).message;
          }}
          onResult={setMsg}
        />
      </div>
      <p className="text-center text-body-sm">
        <Link href="/login" className="font-medium text-sage-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
