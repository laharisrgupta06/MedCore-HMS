'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  isValidGstin,
  type TaxClassificationView,
  type TaxClassificationVersionView,
} from '@medcore/types';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { taxApi } from '@/services/tax';

/** Dialogs for the tax settings screen (8-B2). The API and database enforce every rule again. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAME_DAY =
  'Choose today or a later date. Dates use the hospital time zone; changes for today are accepted until ten minutes before midnight.';

function useSubmit<T extends Record<string, unknown>>(
  fields: readonly string[],
  setError: Parameters<typeof applyServerFieldErrors>[1],
  action: (v: T) => Promise<unknown>,
  done: string,
  onDone: () => void,
) {
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (v: T) => {
    setFailure(null);
    try {
      await action(v);
      toast.success(done);
      onDone();
    } catch (e) {
      if (!applyServerFieldErrors(e, setError as never, fields)) setFailure(errorMessage(e));
    }
  };
  return { failure, run, clear: () => setFailure(null) };
}

// ---------------------------------------------------------------- classification

const classificationSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120, 'At most 120 characters.'),
    supplyType: z.enum(['GOODS', 'SERVICE']),
    hsnSac: z
      .string()
      .trim()
      .regex(/^(\d{4}|\d{6}|\d{8})$/, 'Use 4, 6 or 8 digits.'),
  })
  .refine((v) => v.hsnSac.startsWith('99') === (v.supplyType === 'SERVICE'), {
    path: ['hsnSac'],
    message: 'Service codes (SAC) start with 99; goods codes (HSN) never do.',
  });
type ClassificationValues = z.infer<typeof classificationSchema>;

export function ClassificationDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: TaxClassificationView;
  onSaved: () => void;
}) {
  const form = useForm<ClassificationValues>({
    resolver: zodResolver(classificationSchema),
    values: existing
      ? { name: existing.name, supplyType: existing.supplyType, hsnSac: existing.hsnSac }
      : { name: '', supplyType: 'SERVICE', hsnSac: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const s = useSubmit<ClassificationValues>(
    ['name', 'supplyType', 'hsnSac'],
    form.setError as never,
    (v) =>
      existing
        ? taxApi.updateClassification(existing.id, { name: v.name })
        : taxApi.createClassification(v),
    existing ? 'Classification renamed.' : 'Classification created.',
    () => {
      onOpenChange(false);
      form.reset();
      onSaved();
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (s.clear(), onOpenChange(o))}
      title={existing ? 'Rename classification' : 'New tax classification'}
      description={
        existing
          ? 'Only the name can change. The supply type and code stay as recorded.'
          : 'A classification groups items taxed the same way. Add a dated rate version after creating it.'
      }
    >
      <form onSubmit={form.handleSubmit(s.run)} noValidate className="flex flex-col gap-4">
        {s.failure && <Alert tone="error">{s.failure}</Alert>}
        <Field label="Name" error={errors.name?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('name')}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supply type" error={errors.supplyType?.message} required>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                disabled={!!existing}
                {...form.register('supplyType')}
              >
                <option value="SERVICE">Service</option>
                <option value="GOODS">Goods</option>
              </Select>
            )}
          </Field>
          <Field
            label="HSN or SAC code"
            hint="SAC for services (starts with 99), HSN for goods."
            error={errors.hsnSac?.message}
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                inputMode="numeric"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                readOnly={!!existing}
                {...form.register('hsnSac')}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {existing ? 'Save name' : 'Create classification'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- version

const versionSchema = z
  .object({
    treatment: z.enum(['EXEMPT', 'NIL_RATED', 'TAXABLE']),
    ratePercent: z.string().trim(),
    priceIncludesTax: z.boolean(),
    effectiveFrom: z.string().regex(DATE, 'Choose a date.'),
  })
  .superRefine((v, ctx) => {
    if (v.treatment !== 'TAXABLE') return;
    const r = Number(v.ratePercent);
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(v.ratePercent) || !(r > 0 && r <= 40))
      ctx.addIssue({
        code: 'custom',
        path: ['ratePercent'],
        message: 'Enter a rate above 0 and at most 40, with up to two decimals.',
      });
  });
type VersionValues = z.infer<typeof versionSchema>;

export function VersionDialog({
  open,
  onOpenChange,
  classification,
  version,
  minDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classification: TaxClassificationView;
  version?: TaxClassificationVersionView;
  minDate: string;
  onSaved: () => void;
}) {
  const form = useForm<VersionValues>({
    resolver: zodResolver(versionSchema),
    values: version
      ? {
          treatment: version.treatment,
          ratePercent: version.treatment === 'TAXABLE' ? String(Number(version.ratePercent)) : '',
          priceIncludesTax: version.priceIncludesTax,
          effectiveFrom: version.effectiveFrom,
        }
      : { treatment: 'TAXABLE', ratePercent: '', priceIncludesTax: false, effectiveFrom: minDate },
  });
  const treatment = useWatch({ control: form.control, name: 'treatment' });
  const { errors, isSubmitting } = form.formState;
  const s = useSubmit<VersionValues>(
    ['treatment', 'ratePercent', 'priceIncludesTax', 'effectiveFrom'],
    form.setError as never,
    (v) => {
      const taxable = v.treatment === 'TAXABLE';
      const body = {
        treatment: v.treatment,
        ratePercent: taxable ? v.ratePercent : '0',
        priceIncludesTax: taxable && v.priceIncludesTax,
        effectiveFrom: v.effectiveFrom,
      };
      return version
        ? taxApi.updateVersion(version.id, body)
        : taxApi.addVersion(classification.id, body);
    },
    version ? 'Future version updated.' : 'Rate version added.',
    () => {
      onOpenChange(false);
      onSaved();
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (s.clear(), onOpenChange(o))}
      title={version ? 'Correct future version' : `New rate version: ${classification.name}`}
      description="A version applies from its start date until the next version starts. Versions already in force never change, so past bills stay as issued."
    >
      <form onSubmit={form.handleSubmit(s.run)} noValidate className="flex flex-col gap-4">
        {s.failure && <Alert tone="error">{s.failure}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Treatment" required>
            {({ id }) => (
              <Select id={id} {...form.register('treatment')}>
                <option value="TAXABLE">Taxable</option>
                <option value="EXEMPT">Exempt</option>
                <option value="NIL_RATED">Nil rated</option>
              </Select>
            )}
          </Field>
          {treatment === 'TAXABLE' && (
            <Field label="GST rate (%)" error={errors.ratePercent?.message} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('ratePercent')}
                />
              )}
            </Field>
          )}
        </div>
        {treatment === 'TAXABLE' && (
          <label className="flex items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              className="size-4 accent-sage-600"
              {...form.register('priceIncludesTax')}
            />
            Item prices already include this tax
          </label>
        )}
        <Field label="In force from" hint={SAME_DAY} error={errors.effectiveFrom?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              min={minDate}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('effectiveFrom')}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {version ? 'Save correction' : 'Add version'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- registration

const registrationSchema = z
  .object({
    registrationType: z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED']),
    gstin: z.string().trim().toUpperCase(),
    legalName: z.string().trim().max(200, 'At most 200 characters.'),
    effectiveFrom: z.string().regex(DATE, 'Choose a date.'),
    attest: z.boolean().refine((v) => v, 'Confirm the details match the GST certificate.'),
  })
  .superRefine((v, ctx) => {
    if (v.registrationType === 'UNREGISTERED') return;
    if (!isValidGstin(v.gstin))
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'Enter a valid 15-character GSTIN.',
      });
    if (!v.legalName)
      ctx.addIssue({
        code: 'custom',
        path: ['legalName'],
        message: 'Enter the legal name on the certificate.',
      });
  });
type RegistrationValues = z.input<typeof registrationSchema>;

export function RegistrationDialog({
  open,
  onOpenChange,
  minDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  minDate: string;
  onSaved: () => void;
}) {
  const form = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      registrationType: 'REGULAR',
      gstin: '',
      legalName: '',
      effectiveFrom: minDate,
      attest: false,
    },
  });
  const type = useWatch({ control: form.control, name: 'registrationType' });
  const { errors, isSubmitting } = form.formState;
  const s = useSubmit<RegistrationValues>(
    ['registrationType', 'gstin', 'legalName', 'effectiveFrom'],
    form.setError as never,
    (v) =>
      taxApi.addRegistration(
        v.registrationType === 'UNREGISTERED'
          ? { registrationType: v.registrationType, effectiveFrom: v.effectiveFrom }
          : {
              registrationType: v.registrationType,
              gstin: v.gstin.trim().toUpperCase(),
              legalName: v.legalName.trim(),
              effectiveFrom: v.effectiveFrom,
            },
      ),
    'GST registration recorded.',
    () => {
      onOpenChange(false);
      form.reset();
      onSaved();
    },
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (s.clear(), onOpenChange(o))}
      title="Record GST registration"
      description="Registrations are never edited. To change one that is in force, record a new registration from a later date."
    >
      <form onSubmit={form.handleSubmit(s.run)} noValidate className="flex flex-col gap-4">
        {s.failure && <Alert tone="error">{s.failure}</Alert>}
        <Field label="Registration" required>
          {({ id }) => (
            <Select id={id} {...form.register('registrationType')}>
              <option value="REGULAR">Regular (collects GST)</option>
              <option value="COMPOSITION">Composition scheme (no GST on bills)</option>
              <option value="UNREGISTERED">Not registered (no GST on bills)</option>
            </Select>
          )}
        </Field>
        {type !== 'UNREGISTERED' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN" error={errors.gstin?.message} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  className="font-mono uppercase"
                  maxLength={15}
                  autoComplete="off"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('gstin')}
                />
              )}
            </Field>
            <Field label="Legal name" error={errors.legalName?.message} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  {...form.register('legalName')}
                />
              )}
            </Field>
          </div>
        )}
        <Field label="In force from" hint={SAME_DAY} error={errors.effectiveFrom?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              min={minDate}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...form.register('effectiveFrom')}
            />
          )}
        </Field>
        <label className="flex items-start gap-2 text-body-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-sage-600"
            {...form.register('attest')}
          />
          <span>
            I confirm these details match the hospital&apos;s GST registration certificate.
          </span>
        </label>
        {errors.attest?.message && (
          <p className="text-caption text-error">{errors.attest.message}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Record registration
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
