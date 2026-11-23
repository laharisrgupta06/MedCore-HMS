'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_POLICY } from '@medcore/types';
import { Check, Circle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { PasswordInput } from '@/components/auth/password-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ApiClientError } from '@/lib/api-client';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { registerSchema } from '@/lib/validation';
import { authApi } from '@/services/auth';

type Values = z.input<typeof registerSchema>;
const FIELDS = [
  'hospitalCode',
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'gender',
  'password',
] as const;

export function RegisterForm() {
  const router = useRouter();
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
    defaultValues: { phone: '', gender: undefined },
  });
  const password = useWatch({ control, name: 'password' }) ?? '';
  const rules = [
    {
      ok: password.length >= PASSWORD_POLICY.minLength,
      text: `At least ${PASSWORD_POLICY.minLength} characters`,
    },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), text: 'A letter and a number' },
  ];

  const onSubmit = async (raw: Values) => {
    setFailure(null);
    const v = registerSchema.parse(raw);
    try {
      const res = await authApi.register({
        hospitalCode: v.hospitalCode,
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        ...(v.phone ? { phone: v.phone } : {}),
        dateOfBirth: v.dateOfBirth,
        gender: v.gender,
        password: v.password,
      });
      router.push(`/verify-email?email=${encodeURIComponent(res.email)}&new=1`);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'INVALID_HOSPITAL_CODE') {
        setError('hospitalCode', { type: 'server', message: e.message });
        return;
      }
      if (e instanceof ApiClientError && e.code === 'PASSWORD_POLICY') {
        setError('password', { type: 'server', message: e.message });
        return;
      }
      if (applyServerFieldErrors(e, setError, FIELDS)) return;
      setFailure({
        code: e instanceof ApiClientError ? e.code : 'UNKNOWN',
        message: errorMessage(e),
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {failure && (
        <Alert tone="error" title="Could not create the account">
          {failure.message}
          {failure.code === 'EMAIL_IN_USE' && (
            <>
              {' '}
              <Link className="mc-link" href="/login">
                Sign in
              </Link>{' '}
              or{' '}
              <Link className="mc-link" href="/forgot-password">
                reset your password
              </Link>
              .
            </>
          )}
        </Alert>
      )}
      <Field
        label="Hospital code"
        hint="Your hospital gives you this code at registration or on your appointment letter."
        error={errors.hospitalCode?.message}
        required
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            autoComplete="off"
            className="uppercase"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('hospitalCode')}
          />
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="given-name"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('firstName')}
            />
          )}
        </Field>
        <Field label="Last name" error={errors.lastName?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              autoComplete="family-name"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('lastName')}
            />
          )}
        </Field>
      </div>
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
      <Field
        label="Mobile number"
        hint="Optional. International format, for example +919876543210."
        error={errors.phone?.message}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            {...register('phone')}
          />
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Date of birth" error={errors.dateOfBirth?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              autoComplete="bday"
              max={new Date().toISOString().slice(0, 10)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('dateOfBirth')}
            />
          )}
        </Field>
        <Field label="Gender" error={errors.gender?.message} required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              defaultValue=""
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('gender')}
            >
              <option value="" disabled>
                Select
              </option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
              <option value="UNDISCLOSED">Prefer not to say</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Password" error={errors.password?.message} required>
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
      <ul className="-mt-2 flex flex-col gap-1 text-caption" aria-label="Password requirements">
        {rules.map((r) => (
          <li
            key={r.text}
            className={
              r.ok
                ? 'flex items-center gap-1.5 text-success'
                : 'flex items-center gap-1.5 text-ink-muted'
            }
          >
            {r.ok ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Circle className="size-3.5" aria-hidden="true" />
            )}
            {r.text}
            <span className="sr-only">{r.ok ? '(met)' : '(not met)'}</span>
          </li>
        ))}
      </ul>
      <Field label="Confirm password" error={errors.confirmPassword?.message} required>
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
      <p className="text-caption text-ink-muted">
        By creating an account you agree to the{' '}
        <Link href="/terms" className="mc-link">
          Terms and Conditions
        </Link>{' '}
        and acknowledge the{' '}
        <Link href="/privacy" className="mc-link">
          Privacy Policy
        </Link>
        .
      </p>
      <Button type="submit" size="lg" loading={isSubmitting}>
        Create account
      </Button>
      <p className="text-center text-body-sm text-ink-secondary">
        Already registered?{' '}
        <Link href="/login" className="mc-link">
          Sign in
        </Link>
      </p>
    </form>
  );
}
