'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { email, phone } from '@/lib/validation';
import { hospitalsApi } from '@/services/org';
import { useAuth } from '@/store/auth';

/** A time zone the browser knows (the API checks the IANA list again). */
function isTimeZone(v: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return v.includes('/') || v === 'UTC';
  } catch {
    return false;
  }
}

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the hospital name.').max(120),
  email,
  phone,
  licenseNumber: z.string().trim().min(2).max(60),
  timezone: z
    .string()
    .trim()
    .refine(isTimeZone, 'Use an IANA time zone, for example Asia/Kolkata.'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code.'),
  defaultSlotMinutes: z.coerce
    .number()
    .int()
    .min(5, 'At least 5 minutes.')
    .max(240, 'At most 240 minutes.'),
  taxRatePercent: z.coerce.number().min(0, 'Between 0 and 100.').max(100, 'Between 0 and 100.'),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, '1 to 10 letters, digits or hyphens.'),
});
type Values = z.input<typeof schema>;

export function HospitalSettings() {
  const hospitalId = useAuth((s) => s.me?.user.hospitalId)!;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['hospital', hospitalId],
    queryFn: () => hospitalsApi.get(hospitalId),
  });
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    values: q.data
      ? {
          ...q.data,
          taxRatePercent: q.data.taxRatePercent,
          defaultSlotMinutes: q.data.defaultSlotMinutes,
        }
      : undefined,
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const submit = form.handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    setFailure(null);
    try {
      await hospitalsApi.update(hospitalId, v);
      toast.success('Hospital settings saved.');
      void qc.invalidateQueries({ queryKey: ['hospital', hospitalId] });
    } catch (e) {
      if (!applyServerFieldErrors(e, form.setError, Object.keys(schema.shape)))
        setFailure(errorMessage(e));
    }
  });

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load the hospital">
        {errorMessage(q.error)}
      </Alert>
    );
  const h = q.data;
  const F = (
    name: keyof Values,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    hint?: string,
  ) => (
    <Field label={label} hint={hint} error={errors[name]?.message} required>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          {...props}
          {...form.register(name)}
        />
      )}
    </Field>
  );
  return (
    <>
      <PageHeader
        title="Hospital settings"
        description="Profile, scheduling defaults and billing configuration."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Details">
          <form onSubmit={submit} noValidate className="flex flex-col gap-5 p-5">
            {failure && <Alert tone="error">{failure}</Alert>}
            <div className="grid gap-5 sm:grid-cols-2">
              {F('name', 'Hospital name')}
              {F('licenseNumber', 'Licence number')}
              {F('email', 'Contact email', { type: 'email' })}
              {F('phone', 'Contact phone', { type: 'tel' })}
              {F(
                'timezone',
                'Time zone',
                h.timezoneLocked ? { readOnly: true, className: 'bg-surface-muted' } : {},
                h.timezoneLocked
                  ? 'Locked: tax dates already use this time zone, so it cannot be changed here.'
                  : 'Used for appointment times and tax dates. It locks once tax settings are recorded.',
              )}
              {F('defaultSlotMinutes', 'Default appointment length (minutes)', {
                type: 'number',
                inputMode: 'numeric',
              })}
            </div>
            <fieldset className="grid gap-5 rounded-md border border-border p-4 sm:grid-cols-3">
              <legend className="px-1 text-label font-medium">Billing</legend>
              {F('currency', 'Currency', { className: 'uppercase' })}
              {F('taxRatePercent', 'Tax rate (%)', {
                type: 'number',
                step: '0.01',
                inputMode: 'decimal',
              })}
              {F('invoicePrefix', 'Invoice prefix', { className: 'uppercase' })}
            </fieldset>
            <div>
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                Save settings
              </Button>
            </div>
          </form>
        </Panel>
        <Panel title="Patient registration">
          <div className="flex flex-col gap-3 p-5 text-body-sm">
            <p className="text-ink-secondary">Patients create their own account with this code.</p>
            <p className="font-mono text-h2 tracking-wide">{h.code}</p>
            <p>
              Status:{' '}
              <Badge
                tone={
                  h.status === 'VERIFIED' ? 'success' : h.status === 'PENDING' ? 'warning' : 'error'
                }
              >
                {h.status === 'VERIFIED'
                  ? 'Verified'
                  : h.status === 'PENDING'
                    ? 'Pending verification'
                    : 'Suspended'}
              </Badge>
            </p>
            {h.status !== 'VERIFIED' && (
              <p className="text-ink-secondary">
                Patients can register once MedCore has verified the hospital.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
