'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/app/app-shell';
import { OtpInput } from '@/components/auth/otp-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ROLE_LABEL } from '@/constants/navigation';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { otp, personName, phone } from '@/lib/validation';
import { authApi } from '@/services/auth';
import { usersApi } from '@/services/users';
import { useAuth } from '@/store/auth';

const profileSchema = z.object({
  firstName: personName('your first name'),
  lastName: personName('your last name'),
  phone: z.union([z.literal(''), phone]),
});
type Profile = z.infer<typeof profileSchema>;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-1 sm:p-6">
      <h2 className="text-h3 font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AccountView() {
  const me = useAuth((s) => s.me)!;
  const updateMe = useAuth((s) => s.updateMe);
  const logout = useAuth((s) => s.logout);
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<Profile>({
    resolver: zodResolver(profileSchema),
    mode: 'onBlur',
    values: {
      firstName: me.user.firstName,
      lastName: me.user.lastName,
      phone: me.user.phone ?? '',
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const save = form.handleSubmit(async (v) => {
    setSaved(null);
    setFailure(null);
    try {
      await usersApi.update(me.user.id, {
        firstName: v.firstName,
        lastName: v.lastName,
        phone: v.phone || null,
      });
      updateMe(await authApi.me());
      setSaved('Your details were saved.');
    } catch (e) {
      if (!applyServerFieldErrors(e, form.setError, ['firstName', 'lastName', 'phone']))
        setFailure(errorMessage(e));
    }
  });

  return (
    <>
      <PageHeader title="My account" description="Your profile, contact details and sessions." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Profile">
          <form onSubmit={save} noValidate className="flex flex-col gap-5">
            {saved && <Alert tone="success">{saved}</Alert>}
            {failure && <Alert tone="error">{failure}</Alert>}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" error={errors.firstName?.message} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    autoComplete="given-name"
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    {...form.register('firstName')}
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
                    {...form.register('lastName')}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Mobile number"
              hint="Changing it requires verifying the new number."
              error={errors.phone?.message}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="tel"
                  autoComplete="tel"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('phone')}
                />
              )}
            </Field>
            <dl className="grid gap-3 rounded-md bg-surface-muted p-4 text-body-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">Email</dt>
                <dd className="break-all">{me.user.email}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Role</dt>
                <dd>{ROLE_LABEL[me.user.role]}</dd>
              </div>
              {me.hospital && (
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Hospital</dt>
                  <dd>
                    {me.hospital.name}{' '}
                    <span className="font-mono text-caption text-ink-muted">
                      {me.hospital.code}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
            <div>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                Save changes
              </Button>
            </div>
          </form>
        </Panel>
        <div className="flex flex-col gap-6">
          <PhoneVerification />
          <Panel title="Sessions">
            <p className="text-body-sm text-ink-secondary">
              Sign out on every device where you are signed in, including this one.
            </p>
            <SignOutEverywhere
              onConfirm={async () => {
                await logout(true);
                router.replace('/login');
              }}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}

function PhoneVerification() {
  const me = useAuth((s) => s.me)!;
  const updateMe = useAuth((s) => s.updateMe);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const form = useForm<{ otp: string }>({
    resolver: zodResolver(z.object({ otp })),
    mode: 'onBlur',
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-1 sm:p-6">
      <h2 className="text-h3 font-semibold">Phone verification</h2>
      <div className="mt-4 flex flex-col gap-4">
        {!me.user.phone && (
          <p className="text-body-sm text-ink-secondary">
            Add a mobile number to your profile to verify it.
          </p>
        )}
        {me.user.phone && me.user.phoneVerified && (
          <Alert tone="success">{me.user.phone} is verified.</Alert>
        )}
        {me.user.phone && !me.user.phoneVerified && (
          <>
            {msg && <Alert tone={msg.ok ? 'success' : 'error'}>{msg.message}</Alert>}
            {!sentTo ? (
              <div>
                <p className="mb-3 text-body-sm text-ink-secondary">
                  We will send a 6-digit code to {me.user.phone}.
                </p>
                <Button
                  variant="secondary"
                  loading={sending}
                  onClick={async () => {
                    setSending(true);
                    setMsg(null);
                    try {
                      setSentTo((await authApi.sendPhoneOtp()).sentTo);
                    } catch (e) {
                      setMsg({ ok: false, message: errorMessage(e) });
                    } finally {
                      setSending(false);
                    }
                  }}
                >
                  Send code
                </Button>
              </div>
            ) : (
              <form
                noValidate
                className="flex flex-col gap-4"
                onSubmit={form.handleSubmit(async (v) => {
                  setMsg(null);
                  try {
                    await authApi.verifyPhone(v.otp);
                    updateMe(await authApi.me());
                  } catch (e) {
                    setMsg({ ok: false, message: errorMessage(e) });
                  }
                })}
              >
                <p className="text-body-sm text-ink-secondary">
                  Code sent to {sentTo}. It expires in 10 minutes.
                </p>
                <Field
                  label="Verification code"
                  error={form.formState.errors.otp?.message}
                  required
                >
                  {({ id, describedBy, invalid }) => (
                    <OtpInput
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      {...form.register('otp')}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" loading={form.formState.isSubmitting}>
                    Verify phone
                  </Button>
                  <Button variant="ghost" onClick={() => setSentTo(null)}>
                    Send a new code
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SignOutEverywhere({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming)
    return (
      <Button variant="secondary" className="mt-4" onClick={() => setConfirming(true)}>
        Sign out everywhere
      </Button>
    );
  return (
    <div className="mt-4 rounded-md border border-error/30 bg-error-bg p-4">
      <p className="text-body-sm text-ink">Sign out on all devices now?</p>
      <div className="mt-3 flex gap-3">
        <Button
          variant="destructive"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
          }}
        >
          Sign out everywhere
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
