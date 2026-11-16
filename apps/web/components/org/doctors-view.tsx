'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Doctor } from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PenLine, Plus, Stethoscope, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, Panel } from '@/components/ui/misc';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from '@/components/ui/toast';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { useList } from '@/lib/use-list';
import { email, personName, phone } from '@/lib/validation';
import { departmentsApi, doctorsApi } from '@/services/org';
import { useAuth } from '@/store/auth';

const money = (v: string, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(v));

export function DoctorsView() {
  const me = useAuth((s) => s.me)!;
  const isAdmin = me.user.role === 'HOSPITAL_ADMIN';
  const [departmentId, setDepartmentId] = useState('');
  const list = useList<Doctor>('doctors', doctorsApi.list, {
    departmentId: departmentId || undefined,
  });
  const departments = useQuery({
    queryKey: ['departments', me.user.hospitalId],
    queryFn: () => departmentsApi.list(me.user.hospitalId!),
    enabled: Boolean(me.user.hospitalId),
  });
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Doctors"
        description={
          isAdmin
            ? 'Doctor accounts, departments, fees and signatures.'
            : 'Doctors at your hospital.'
        }
        actions={
          isAdmin && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              Add doctor
            </Button>
          )
        }
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row">
          <SearchInput label="Search doctors" placeholder="Doctor name" onSearch={list.setSearch} />
          <Select
            aria-label="Filter by department"
            className="sm:w-56"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <option value="">All departments</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <DataTable<Doctor>
          caption="Doctors"
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(d) => d.id}
          empty={{
            icon: Stethoscope,
            title: 'No doctors found',
            text: isAdmin ? 'Add the first doctor to start scheduling.' : undefined,
          }}
          columns={[
            {
              key: 'name',
              header: 'Doctor',
              primary: true,
              cell: (d) => (
                <span className="font-medium">
                  Dr {d.firstName} {d.lastName}
                </span>
              ),
            },
            { key: 'spec', header: 'Specialisation', cell: (d) => d.specialisation },
            {
              key: 'dept',
              header: 'Departments',
              cell: (d) =>
                d.departments.map((x) => x.name).join(', ') || (
                  <span className="text-ink-muted">None</span>
                ),
            },
            {
              key: 'fee',
              header: 'Consultation fee',
              cell: (d) => <span className="tabular-nums">{money(d.consultationFee)}</span>,
            },
            ...(isAdmin
              ? [
                  {
                    key: 'status',
                    header: 'Status',
                    cell: (d: Doctor) =>
                      !d.isActive ? (
                        <Badge tone="error">Deactivated</Badge>
                      ) : d.hasSignature ? (
                        <Badge tone="success">Signature on file</Badge>
                      ) : (
                        <Badge tone="warning">No signature</Badge>
                      ),
                  },
                ]
              : []),
          ]}
          actions={(d) =>
            isAdmin || d.userId === me.user.id ? (
              <Button size="compact" variant="ghost" onClick={() => setEditing(d)}>
                <PenLine aria-hidden="true" />
                {d.userId === me.user.id ? 'Edit my profile' : 'Edit'}
              </Button>
            ) : null
          }
        />
        <Pagination meta={list.meta} onPage={list.setPage} />
      </Panel>
      {editing && (
        <DoctorDialog
          doctor={editing === 'new' ? null : editing}
          isAdmin={isAdmin}
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
  registrationNumber: z.string().trim().min(2, 'Enter the registration number.').max(40),
  specialisation: z.string().trim().min(2, 'Enter the specialisation.').max(80),
  qualification: z.string().trim().max(200),
  consultationFee: z.coerce.number().min(0, 'Cannot be negative.').max(1_000_000),
  bio: z.string().trim().max(2000),
  departmentIds: z.array(z.string()),
});
type Values = z.input<typeof schema>;

function DoctorDialog({
  doctor,
  isAdmin,
  onClose,
}: {
  doctor: Doctor | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const hospitalId = useAuth((s) => s.me?.user.hospitalId)!;
  const departments = useQuery({
    queryKey: ['departments', hospitalId],
    queryFn: () => departmentsApi.list(hospitalId),
  });
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [current, setCurrent] = useState(doctor);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: doctor
      ? {
          firstName: doctor.firstName,
          lastName: doctor.lastName,
          email: doctor.email,
          phone: doctor.phone ?? '',
          registrationNumber: doctor.registrationNumber,
          specialisation: doctor.specialisation,
          qualification: doctor.qualification ?? '',
          consultationFee: doctor.consultationFee,
          bio: doctor.bio ?? '',
          departmentIds: doctor.departments.map((d) => d.id),
        }
      : {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          registrationNumber: '',
          specialisation: '',
          qualification: '',
          consultationFee: '',
          bio: '',
          departmentIds: [],
        },
  });
  const { errors, isSubmitting } = form.formState;
  const adminFields = isAdmin;
  const submit = form.handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    setFailure(null);
    try {
      if (!doctor)
        await doctorsApi.create({
          ...v,
          phone: v.phone || null,
          qualification: v.qualification || null,
          bio: v.bio || null,
        });
      else
        await doctorsApi.update(
          doctor.id,
          adminFields
            ? {
                registrationNumber: v.registrationNumber,
                specialisation: v.specialisation,
                consultationFee: v.consultationFee,
                departmentIds: v.departmentIds,
                qualification: v.qualification || null,
                bio: v.bio || null,
              }
            : { qualification: v.qualification || null, bio: v.bio || null },
        );
      toast.success(
        doctor
          ? 'Profile saved.'
          : `Dr ${v.firstName} ${v.lastName} was added and emailed a link to set a password.`,
      );
      void qc.invalidateQueries({ queryKey: ['doctors'] });
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
    opts: { disabled?: boolean; required?: boolean; hint?: string; type?: string } = {},
  ) => (
    <Field
      label={label}
      error={errors[n]?.message as string | undefined}
      required={opts.required}
      hint={opts.hint}
    >
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={opts.type ?? 'text'}
          disabled={opts.disabled}
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
      title={doctor ? `Dr ${doctor.firstName} ${doctor.lastName}` : 'Add doctor'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isSubmitting} onClick={() => void submit()}>
            {doctor ? 'Save profile' : 'Add doctor'}
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
        {text('firstName', 'First name', { disabled: Boolean(doctor), required: true })}
        {text('lastName', 'Last name', { disabled: Boolean(doctor), required: true })}
        {text('email', 'Email', { disabled: Boolean(doctor), required: true, type: 'email' })}
        {text('phone', 'Mobile number', {
          disabled: Boolean(doctor),
          type: 'tel',
          hint: 'Optional.',
        })}
        {text('registrationNumber', 'Registration number', {
          disabled: !adminFields,
          required: true,
        })}
        {text('specialisation', 'Specialisation', { disabled: !adminFields, required: true })}
        {text('consultationFee', 'Consultation fee', {
          disabled: !adminFields,
          required: true,
          type: 'number',
        })}
        {text('qualification', 'Qualification', { hint: 'Optional, for example MBBS, MD.' })}
        <fieldset className="sm:col-span-2" disabled={!adminFields}>
          <legend className="text-label font-medium">Departments</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {departments.data?.length === 0 && (
              <p className="text-body-sm text-ink-muted">Create departments first.</p>
            )}
            {departments.data?.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  value={d.id}
                  className="size-4 accent-[#52714D]"
                  {...reg('departmentIds')}
                />
                {d.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label="Profile"
          error={errors.bio?.message}
          hint="Shown to patients when they book. Up to 2000 characters."
          className="sm:col-span-2"
        >
          {({ id, describedBy }) => (
            <textarea
              id={id}
              rows={3}
              aria-describedby={describedBy}
              className="w-full rounded-sm border border-border-strong bg-surface px-3 py-2 text-body"
              {...reg('bio')}
            />
          )}
        </Field>
        {current && <SignatureField doctor={current} onChange={setCurrent} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function SignatureField({ doctor, onChange }: { doctor: Doctor; onChange: (d: Doctor) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-4 sm:col-span-2">
      <p className="text-label font-medium">Signature</p>
      <p className="text-body-sm text-ink-secondary">
        {doctor.hasSignature
          ? 'A signature is on file and is printed on prescriptions.'
          : 'No signature yet. Upload a PNG or JPEG image, at most 512 KB.'}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        aria-label="Signature image"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError(null);
          if (f.size > 512 * 1024) return setError('The image must be 512 KB or smaller.');
          setBusy(true);
          try {
            onChange(await doctorsApi.uploadSignature(doctor.id, f));
            toast.success('Signature uploaded.');
            void qc.invalidateQueries({ queryKey: ['doctors'] });
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <div>
        <Button
          variant="secondary"
          size="compact"
          loading={busy}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden="true" />
          {doctor.hasSignature ? 'Replace signature' : 'Upload signature'}
        </Button>
      </div>
    </div>
  );
}
