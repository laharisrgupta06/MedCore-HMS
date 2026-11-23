'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Hospital, HospitalStatus } from '@medcore/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
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
import { hospitalsApi } from '@/services/org';
import { EmailLink } from '@/components/ui/contact';

const STATUS: Record<HospitalStatus, { label: string; tone: 'warning' | 'success' | 'error' }> = {
  PENDING: { label: 'Pending verification', tone: 'warning' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'error' },
};

export function HospitalsView() {
  const [status, setStatus] = useState<string>('');
  const list = useList<Hospital>('hospitals', hospitalsApi.list, { status: status || undefined });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{
    h: Hospital;
    action: 'verify' | 'suspend' | 'reactivate';
  } | null>(null);
  const act = useMutation({
    mutationFn: (c: { h: Hospital; action: 'verify' | 'suspend' | 'reactivate' }) =>
      hospitalsApi.action(c.h.id, c.action),
    onSuccess: (h) => {
      toast.success(`${h.name} is now ${STATUS[h.status].label.toLowerCase()}.`);
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['hospitals'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Hospitals"
        description="Onboard hospitals, verify them so patients can register, and suspend access when needed."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Onboard hospital
          </Button>
        }
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center">
          <SearchInput
            label="Search hospitals"
            placeholder="Name, code or email"
            onSearch={list.setSearch}
          />
          <Select
            aria-label="Filter by status"
            className="sm:w-52"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending verification</option>
            <option value="VERIFIED">Verified</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
        <DataTable<Hospital>
          caption="Hospitals"
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(h) => h.id}
          empty={{
            icon: Building2,
            title: 'No hospitals found',
            text: 'Onboard the first hospital to get started.',
          }}
          columns={[
            {
              key: 'name',
              header: 'Hospital',
              primary: true,
              cell: (h) => <span className="font-medium">{h.name}</span>,
            },
            {
              key: 'code',
              header: 'Code',
              cell: (h) => <span className="font-mono">{h.code}</span>,
            },
            {
              key: 'email',
              header: 'Contact',
              cell: (h) => <EmailLink value={h.email} />,
              hideOnMobile: true,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (h) => <Badge tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Badge>,
            },
          ]}
          actions={(h) =>
            h.status === 'PENDING' ? (
              <Button size="compact" onClick={() => setConfirm({ h, action: 'verify' })}>
                Verify
              </Button>
            ) : h.status === 'VERIFIED' ? (
              <Button
                size="compact"
                variant="secondary"
                onClick={() => setConfirm({ h, action: 'suspend' })}
              >
                Suspend
              </Button>
            ) : (
              <Button
                size="compact"
                variant="secondary"
                onClick={() => setConfirm({ h, action: 'reactivate' })}
              >
                Reactivate
              </Button>
            )
          }
        />
        <Pagination meta={list.meta} onPage={list.setPage} />
      </Panel>

      {confirm && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`${confirm.action === 'verify' ? 'Verify' : confirm.action === 'suspend' ? 'Suspend' : 'Reactivate'} ${confirm.h.name}?`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={confirm.action === 'suspend' ? 'destructive' : 'primary'}
                loading={act.isPending}
                onClick={() => act.mutate(confirm)}
              >
                {confirm.action === 'verify'
                  ? 'Verify hospital'
                  : confirm.action === 'suspend'
                    ? 'Suspend hospital'
                    : 'Reactivate hospital'}
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-ink-secondary">
            {confirm.action === 'verify' &&
              `Patients will be able to register with the code ${confirm.h.code}.`}
            {confirm.action === 'suspend' &&
              'Every user of this hospital is signed out immediately and cannot sign in until the hospital is reactivated. No data is deleted.'}
            {confirm.action === 'reactivate' && 'Users of this hospital can sign in again.'}
          </p>
        </Dialog>
      )}
      <CreateHospitalDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Enter the hospital name.').max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,20}$/, '3 to 20 letters, digits or hyphens.'),
  email,
  phone,
  licenseNumber: z.string().trim().min(2, 'Enter the licence number.').max(60),
  adminFirstName: personName('the first name'),
  adminLastName: personName('the last name'),
  adminEmail: email,
});
type CreateValues = z.input<typeof createSchema>;

function CreateHospitalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema), mode: 'onBlur' });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (raw) => {
    const v = createSchema.parse(raw);
    setFailure(null);
    try {
      const h = await hospitalsApi.create({
        name: v.name,
        code: v.code,
        email: v.email,
        phone: v.phone,
        licenseNumber: v.licenseNumber,
        admin: { firstName: v.adminFirstName, lastName: v.adminLastName, email: v.adminEmail },
      });
      toast.success(
        `${h.name} was created. The administrator has been emailed a link to set their password.`,
      );
      void qc.invalidateQueries({ queryKey: ['hospitals'] });
      form.reset();
      onClose();
    } catch (e) {
      if (
        !applyServerFieldErrors(e, form.setError, [
          'name',
          'code',
          'email',
          'phone',
          'licenseNumber',
        ])
      )
        setFailure(errorMessage(e));
    }
  });
  const F = (
    name: keyof CreateValues,
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
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Onboard a hospital"
      description="The hospital starts as pending. Verify it when its details are confirmed."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isSubmitting} onClick={() => void submit()}>
            Create hospital
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {failure && <Alert tone="error">{failure}</Alert>}
        <div className="grid gap-5 sm:grid-cols-2">
          {F('name', 'Hospital name')}
          {F(
            'code',
            'Registration code',
            { className: 'uppercase' },
            'Patients use this code to register. It cannot be changed later.',
          )}
          {F('email', 'Contact email', { type: 'email' })}
          {F('phone', 'Contact phone', { type: 'tel' }, 'For example +914400000000')}
          {F('licenseNumber', 'Licence number')}
        </div>
        <fieldset className="grid gap-5 rounded-md border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-label font-medium">Hospital administrator</legend>
          {F('adminFirstName', 'First name')}
          {F('adminLastName', 'Last name')}
          <div className="sm:col-span-2">
            {F(
              'adminEmail',
              'Email',
              { type: 'email' },
              'They receive a link to set their own password.',
            )}
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
