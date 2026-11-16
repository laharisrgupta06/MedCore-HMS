'use client';

import type { Department } from '@medcore/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Panel } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { departmentsApi } from '@/services/org';
import { useAuth } from '@/store/auth';

export function DepartmentsView() {
  const hospitalId = useAuth((s) => s.me?.user.hospitalId)!;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['departments', hospitalId],
    queryFn: () => departmentsApi.list(hospitalId),
  });
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const remove = useMutation({
    mutationFn: (d: Department) => departmentsApi.remove(d.id),
    onSuccess: () => {
      toast.success('Department deleted.');
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title="Departments"
        description="Departments group doctors, staff and rooms."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            Add department
          </Button>
        }
      />
      <Panel>
        <DataTable<Department>
          caption="Departments"
          rows={q.data}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          rowKey={(d) => d.id}
          empty={{
            icon: Layers,
            title: 'No departments yet',
            text: 'Add departments before creating doctors and rooms.',
            action: <Button onClick={() => setEditing('new')}>Add department</Button>,
          }}
          columns={[
            {
              key: 'name',
              header: 'Department',
              primary: true,
              cell: (d) => <span className="font-medium">{d.name}</span>,
            },
            {
              key: 'description',
              header: 'Description',
              cell: (d) => d.description ?? <span className="text-ink-muted">None</span>,
            },
          ]}
          actions={(d) => (
            <>
              <Button
                size="compact"
                variant="ghost"
                onClick={() => setEditing(d)}
                aria-label={`Edit ${d.name}`}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <Button
                size="compact"
                variant="ghost"
                onClick={() => setDeleting(d)}
                aria-label={`Delete ${d.name}`}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </>
          )}
        />
      </Panel>
      {editing && (
        <DepartmentDialog
          hospitalId={hospitalId}
          department={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={remove.isPending}
                onClick={() => remove.mutate(deleting)}
              >
                Delete department
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-ink-secondary">
            Departments that have staff, doctors, rooms or appointments cannot be deleted.
          </p>
        </Dialog>
      )}
    </>
  );
}

function DepartmentDialog({
  hospitalId,
  department,
  onClose,
}: {
  hospitalId: string;
  department: Department | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      department
        ? departmentsApi.update(department.id, {
            name: name.trim(),
            description: description.trim() || null,
          })
        : departmentsApi.create(hospitalId, {
            name: name.trim(),
            description: description.trim() || null,
          }),
    onSuccess: () => {
      toast.success(department ? 'Department updated.' : 'Department added.');
      void qc.invalidateQueries({ queryKey: ['departments'] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const nameError =
    name.trim().length === 0
      ? 'Enter a name.'
      : name.trim().length > 80
        ? 'At most 80 characters.'
        : undefined;
  const [touched, setTouched] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={department ? 'Edit department' : 'Add department'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!nameError) save.mutate();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!nameError) save.mutate();
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name" error={touched ? nameError : undefined} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional, up to 500 characters.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
