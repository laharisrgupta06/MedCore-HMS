'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { STAFF_ROLES, type StaffMember, type StaffRole } from '@medcore/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, UserCog, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { ROLE_LABEL } from '@/constants/navigation';
import { applyServerFieldErrors, errorMessage } from '@/lib/forms';
import { useList } from '@/lib/use-list';
import { email, personName, phone } from '@/lib/validation';
import { departmentsApi, staffApi } from '@/services/org';
import { usersApi } from '@/services/users';
import { useAuth } from '@/store/auth';
import { EmailLink } from '@/components/ui/contact';

const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters.`);

export function StaffView() {
  const me = useAuth((s) => s.me)!;
  const [role, setRole] = useState('');
  const list = useList<StaffMember>('staff', staffApi.list, { role: role || undefined });
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (s: StaffMember) => usersApi.update(s.user.id, { isActive: !s.user.isActive }),
    onSuccess: (u) => {
      toast.success(
        u.isActive ? 'Account reactivated.' : 'Account deactivated and signed out everywhere.',
      );
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const invite = useMutation({
    mutationFn: (s: StaffMember) => staffApi.invite(s.user.id),
    onSuccess: () => toast.success('A new set-password link was emailed.'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title="Staff"
        description="Accounts for administrators, nurses, reception, laboratory, pharmacy and accounts. Doctors are managed under Doctors."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            Add staff member
          </Button>
        }
      />
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row">
          <SearchInput label="Search staff" placeholder="Name or email" onSearch={list.setSearch} />
          <Select
            aria-label="Filter by role"
            className="sm:w-52"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="">All roles</option>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <DataTable<StaffMember>
          caption="Staff"
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(s) => s.user.id}
          empty={{
            icon: Users,
            title: 'No staff found',
            text: 'Add your team so they can sign in.',
          }}
          columns={[
            {
              key: 'name',
              header: 'Name',
              primary: true,
              cell: (s) => (
                <span className="font-medium">
                  {s.user.firstName} {s.user.lastName}
                </span>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              cell: (s) => (
                <>
                  {ROLE_LABEL[s.user.role]}
                  {s.isSeniorLabTechnician && (
                    <>
                      {' '}
                      <Badge tone="sage">Senior</Badge>
                    </>
                  )}
                </>
              ),
            },
            {
              key: 'dept',
              header: 'Department',
              cell: (s) => s.department?.name ?? <span className="text-ink-muted">None</span>,
            },
            {
              key: 'email',
              header: 'Email',
              cell: (s) => <EmailLink value={s.user.email} />,
              hideOnMobile: true,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (s) =>
                !s.user.isActive ? (
                  <Badge tone="error">Deactivated</Badge>
                ) : s.user.emailVerified ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <Badge tone="warning">Invited</Badge>
                ),
            },
          ]}
          actions={(s) => (
            <>
              <Button size="compact" variant="ghost" onClick={() => setEditing(s)}>
                <UserCog aria-hidden="true" />
                Edit
              </Button>
              {!s.user.emailVerified && s.user.isActive && (
                <Button
                  size="compact"
                  variant="ghost"
                  loading={invite.isPending && invite.variables?.user.id === s.user.id}
                  onClick={() => invite.mutate(s)}
                >
                  <Mail aria-hidden="true" />
                  Resend invite
                </Button>
              )}
              {s.user.id !== me.user.id && (
                <Button
                  size="compact"
                  variant={s.user.isActive ? 'danger' : 'ghost'}
                  loading={toggle.isPending && toggle.variables?.user.id === s.user.id}
                  onClick={() => toggle.mutate(s)}
                >
                  {s.user.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              )}
            </>
          )}
        />
        <Pagination meta={list.meta} onPage={list.setPage} />
      </Panel>
      {editing && (
        <StaffDialog member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

const schema = z.object({
  role: z.enum(STAFF_ROLES as unknown as [StaffRole, ...StaffRole[]]),
  firstName: personName('the first name'),
  lastName: personName('the last name'),
  email,
  phone: z.union([z.literal(''), phone]),
  departmentId: z.string(),
  employeeCode: optionalText(30),
  designation: optionalText(80),
  isSeniorLabTechnician: z.boolean(),
});
type Values = z.input<typeof schema>;

function StaffDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const hospitalId = useAuth((s) => s.me?.user.hospitalId)!;
  const departments = useQuery({
    queryKey: ['departments', hospitalId],
    queryFn: () => departmentsApi.list(hospitalId),
  });
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: member
      ? {
          role: member.user.role as StaffRole,
          firstName: member.user.firstName,
          lastName: member.user.lastName,
          email: member.user.email,
          phone: member.user.phone ?? '',
          departmentId: member.department?.id ?? '',
          employeeCode: member.employeeCode ?? '',
          designation: member.designation ?? '',
          isSeniorLabTechnician: member.isSeniorLabTechnician,
        }
      : {
          role: 'NURSE',
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          departmentId: '',
          employeeCode: '',
          designation: '',
          isSeniorLabTechnician: false,
        },
  });
  const role = useWatch({ control: form.control, name: 'role' });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    setFailure(null);
    const profile = {
      departmentId: v.departmentId || null,
      employeeCode: v.employeeCode?.trim() || null,
      designation: v.designation?.trim() || null,
      isSeniorLabTechnician: v.role === 'LAB_TECHNICIAN' ? v.isSeniorLabTechnician : false,
    };
    try {
      if (member) await staffApi.update(member.user.id, profile);
      else
        await staffApi.create({
          role: v.role,
          firstName: v.firstName,
          lastName: v.lastName,
          email: v.email,
          phone: v.phone || null,
          ...profile,
        });
      toast.success(
        member
          ? 'Staff member updated.'
          : `${v.firstName} was added and emailed a link to set their password.`,
      );
      void qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    } catch (e) {
      if (
        !applyServerFieldErrors(e, form.setError, [
          'firstName',
          'lastName',
          'email',
          'phone',
          'departmentId',
          'employeeCode',
          'designation',
          'isSeniorLabTechnician',
        ])
      )
        setFailure(errorMessage(e));
    }
  });
  const reg = form.register;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={member ? `Edit ${member.user.firstName} ${member.user.lastName}` : 'Add staff member'}
      description={
        member
          ? 'Name and contact details are edited by the staff member in their account.'
          : 'They receive an email with a link to set their own password.'
      }
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={isSubmitting} onClick={() => void submit()}>
            {member ? 'Save changes' : 'Add staff member'}
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
        <Field label="Role" error={errors.role?.message} required>
          {({ id, describedBy }) => (
            <Select
              id={id}
              disabled={Boolean(member)}
              aria-describedby={describedBy}
              {...reg('role')}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Department" error={errors.departmentId?.message}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...reg('departmentId')}>
              <option value="">No department</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {(['firstName', 'lastName', 'email', 'phone'] as const).map((n) => (
          <Field
            key={n}
            label={
              {
                firstName: 'First name',
                lastName: 'Last name',
                email: 'Email',
                phone: 'Mobile number',
              }[n]
            }
            error={errors[n]?.message}
            required={n !== 'phone'}
            hint={n === 'phone' ? 'Optional, international format.' : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                disabled={Boolean(member)}
                type={n === 'email' ? 'email' : n === 'phone' ? 'tel' : 'text'}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                {...reg(n)}
              />
            )}
          </Field>
        ))}
        <Field
          label="Employee code"
          error={errors.employeeCode?.message}
          hint="Optional; unique within the hospital."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...reg('employeeCode')}
            />
          )}
        </Field>
        <Field
          label="Designation"
          error={errors.designation?.message}
          hint="Optional, for example Ward Sister."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...reg('designation')}
            />
          )}
        </Field>
        {role === 'LAB_TECHNICIAN' && (
          <label className="flex items-start gap-3 text-body-sm sm:col-span-2">
            <input type="checkbox" className="mt-1 size-4" {...reg('isSeniorLabTechnician')} />
            <span>
              <span className="font-medium">Senior lab technician</span>
              <span className="block text-ink-secondary">Can approve laboratory reports.</span>
            </span>
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
