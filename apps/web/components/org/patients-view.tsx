'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BLOOD_GROUPS, Gender, type PatientSummary } from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import { PenLine, Plus, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Panel } from '@/components/ui/misc';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from '@/components/ui/toast';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { useList } from '@/lib/use-list';
import { email, personName, phone } from '@/lib/validation';
import { patientsApi } from '@/services/org';
import { useAuth } from '@/store/auth';
import { PhoneLink } from '@/components/ui/contact';

export const BLOOD_LABEL: Record<string, string> = {
  A_POSITIVE: 'A+',
  A_NEGATIVE: 'A-',
  B_POSITIVE: 'B+',
  B_NEGATIVE: 'B-',
  AB_POSITIVE: 'AB+',
  AB_NEGATIVE: 'AB-',
  O_POSITIVE: 'O+',
  O_NEGATIVE: 'O-',
};
const GENDER_LABEL: Record<string, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
  UNDISCLOSED: 'Not stated',
};

function age(dob: string): number {
  const d = new Date(dob);
  const n = new Date();
  return (
    n.getFullYear() -
    d.getFullYear() -
    (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0)
  );
}

export function PatientsView() {
  const role = useAuth((s) => s.me?.user.role);
  const canEdit = role === 'HOSPITAL_ADMIN' || role === 'RECEPTIONIST';
  // API-019: only doctors and nurses open clinical charts.
  const clinical = role === 'DOCTOR' || role === 'NURSE';
  const list = useList<PatientSummary>('patients', patientsApi.list);
  const [editing, setEditing] = useState<PatientSummary | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Patients"
        description="Search by name, medical record number, email or phone."
        actions={
          canEdit && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              Register patient
            </Button>
          )
        }
      />
      <Panel>
        <div className="border-b border-border px-5 py-3">
          <SearchInput
            label="Search patients"
            placeholder="Name, MRN, email or phone"
            onSearch={list.setSearch}
          />
        </div>
        <DataTable<PatientSummary>
          caption="Patients"
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(p) => p.id}
          empty={{
            icon: UserRound,
            title: 'No patients found',
            text: canEdit
              ? 'Register a patient at reception, or patients can register themselves with the hospital code.'
              : undefined,
          }}
          columns={[
            {
              key: 'name',
              header: 'Patient',
              primary: true,
              cell: (p) => (
                <span className="font-medium">
                  {p.firstName} {p.lastName}
                </span>
              ),
            },
            {
              key: 'mrn',
              header: 'MRN',
              cell: (p) => <span className="font-mono text-body-sm">{p.mrn}</span>,
            },
            {
              key: 'age',
              header: 'Age and sex',
              cell: (p) => `${age(p.dateOfBirth)} y, ${GENDER_LABEL[p.gender]}`,
            },
            {
              key: 'phone',
              header: 'Phone',
              cell: (p) =>
                p.phone ? (
                  <PhoneLink value={p.phone} />
                ) : (
                  <span className="text-ink-muted">None</span>
                ),
              hideOnMobile: true,
            },
            {
              key: 'blood',
              header: 'Blood group',
              cell: (p) =>
                p.bloodGroup ? (
                  BLOOD_LABEL[p.bloodGroup]
                ) : (
                  <span className="text-ink-muted">Unknown</span>
                ),
              hideOnMobile: true,
            },
          ]}
          actions={
            canEdit || clinical
              ? (p) => (
                  <>
                    {clinical && (
                      <Link
                        href={`/dashboard/patients/${p.id}`}
                        className={buttonVariants({
                          variant: 'ghost',
                          size: 'compact',
                          className: 'text-sage-700',
                        })}
                      >
                        Chart
                        <span className="sr-only">
                          {' '}
                          for {p.firstName} {p.lastName}
                        </span>
                      </Link>
                    )}
                    {canEdit && (
                      <Button size="compact" variant="ghost" onClick={() => setEditing(p)}>
                        <PenLine aria-hidden="true" />
                        Edit
                      </Button>
                    )}
                  </>
                )
              : undefined
          }
        />
        <Pagination meta={list.meta} onPage={list.setPage} />
      </Panel>
      {editing && (
        <PatientDialog
          patient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

const schema = z.object({
  firstName: personName('the first name'),
  lastName: personName('the last name'),
  email,
  phone: z.union([z.literal(''), phone]),
  dateOfBirth: z
    .string()
    .min(1, 'Enter the date of birth.')
    .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(), 'Enter a past date.'),
  gender: z.enum(Object.values(Gender) as [Gender, ...Gender[]], { message: 'Select an option.' }),
  bloodGroup: z.string(),
  emergencyContactName: z.string().trim().max(120),
  emergencyContactPhone: z.union([z.literal(''), phone]),
});
type Values = z.input<typeof schema>;

function PatientDialog({
  patient,
  onClose,
}: {
  patient: PatientSummary | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: patient
      ? {
          ...patient,
          phone: patient.phone ?? '',
          bloodGroup: patient.bloodGroup ?? '',
          emergencyContactName: patient.emergencyContactName ?? '',
          emergencyContactPhone: patient.emergencyContactPhone ?? '',
        }
      : {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          dateOfBirth: '',
          gender: undefined,
          bloodGroup: '',
          emergencyContactName: '',
          emergencyContactPhone: '',
        },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    setFailure(null);
    const body = {
      firstName: v.firstName,
      lastName: v.lastName,
      phone: v.phone || null,
      dateOfBirth: v.dateOfBirth,
      gender: v.gender,
      bloodGroup: (v.bloodGroup || null) as PatientSummary['bloodGroup'],
      emergencyContactName: v.emergencyContactName || null,
      emergencyContactPhone: v.emergencyContactPhone || null,
    };
    try {
      if (patient) await patientsApi.update(patient.id, body);
      else {
        const p = await patientsApi.create({ ...body, email: v.email });
        toast.success(
          `Registered with MRN ${p.mrn}. ${p.firstName} was emailed a link to access the patient portal.`,
        );
      }
      if (patient) toast.success('Patient details saved.');
      void qc.invalidateQueries({ queryKey: ['patients'] });
      onClose();
    } catch (e) {
      if (!applyServerFieldErrors(e, form.setError, Object.keys(schema.shape)))
        setFailure(errorMessage(e));
    }
  });
  const reg = form.register;
  const text = (
    n: keyof Values,
    label: string,
    o: { type?: string; required?: boolean; hint?: string; disabled?: boolean } = {},
  ) => (
    <Field label={label} error={errors[n]?.message} required={o.required} hint={o.hint}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={o.type ?? 'text'}
          disabled={o.disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          {...reg(n)}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={patient ? `${patient.firstName} ${patient.lastName}` : 'Register a patient'}
      description={
        patient
          ? `MRN ${patient.mrn}`
          : 'The patient receives an email to set a password for the patient portal.'
      }
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isSubmitting} onClick={() => void submit()}>
            {patient ? 'Save changes' : 'Register patient'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        {failure && (
          <Alert tone="error" className="sm:col-span-2">
            {failure}
          </Alert>
        )}
        {text('firstName', 'First name', { required: true })}
        {text('lastName', 'Last name', { required: true })}
        {text('email', 'Email', { type: 'email', required: true, disabled: Boolean(patient) })}
        {text('phone', 'Mobile number', { type: 'tel', hint: 'Optional.' })}
        {text('dateOfBirth', 'Date of birth', { type: 'date', required: true })}
        <Field label="Gender" error={errors.gender?.message} required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...reg('gender')}
            >
              <option value="">Select</option>
              {Object.values(Gender).map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABEL[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Blood group" error={errors.bloodGroup?.message}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...reg('bloodGroup')}>
              <option value="">Unknown</option>
              {BLOOD_GROUPS.map((b) => (
                <option key={b} value={b}>
                  {BLOOD_LABEL[b]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="hidden sm:block" />
        {text('emergencyContactName', 'Emergency contact', { hint: 'Optional.' })}
        {text('emergencyContactPhone', 'Emergency contact phone', {
          type: 'tel',
          hint: 'Optional.',
        })}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
