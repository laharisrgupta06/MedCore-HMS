'use client';

import type { LabPriority, LabTest, MedicalRecord } from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Picker } from '@/components/appointments/pickers';
import { textareaClass } from '@/components/emr/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FieldGroup, Select } from '@/components/ui/field';
import { EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { labApi } from '@/services/lab';
import { LabOrderCard } from './lab-order-card';

/** Lab and radiology orders of one consultation (LAB-001, LAB-007). */
export function LabOrdersPanel({
  record,
  canOrder,
  tz,
}: {
  record: MedicalRecord;
  canOrder: boolean;
  tz: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['lab-orders', 'record', record.id],
    queryFn: () => labApi.orders({ medicalRecordId: record.id, limit: 50 }),
  });
  return (
    <Panel
      title="Lab and radiology"
      actions={
        canOrder && (
          <Button size="compact" variant="secondary" onClick={() => setOpen(true)}>
            <Plus />
            Order tests
          </Button>
        )
      }
    >
      <div className="space-y-3 p-4">
        {q.error ? (
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        ) : q.isPending ? (
          <Skeleton className="h-24" />
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={FlaskConical} title="No tests ordered">
            {canOrder
              ? 'Order laboratory or radiology tests from the hospital catalogue.'
              : undefined}
          </EmptyState>
        ) : (
          q.data.items.map((o) => <LabOrderCard key={o.id} order={o} tz={tz} />)
        )}
      </div>
      {open && <LabOrderForm record={record} onClose={() => setOpen(false)} />}
    </Panel>
  );
}

function LabOrderForm({ record, onClose }: { record: MedicalRecord; onClose: () => void }) {
  const qc = useQueryClient();
  const [tests, setTests] = useState<LabTest[]>([]);
  const [priority, setPriority] = useState<LabPriority>('ROUTINE');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (tests.length === 0) return setError('Choose at least one test.');
    setSaving(true);
    try {
      await labApi.create({
        medicalRecordId: record.id,
        testIds: tests.map((t) => t.id),
        priority,
        ...(notes.trim() ? { clinicalNotes: notes.trim() } : {}),
      });
      toast.success('Tests ordered. Reception or the lab records the sample next.');
      void qc.invalidateQueries({ queryKey: ['lab-orders'] });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Order tests"
      description={`${record.patient.firstName} ${record.patient.lastName} · ${record.patient.mrn}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Place order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <FieldGroup label="Add a test">
          <Picker<LabTest>
            label="Test"
            queryKey="lab-tests"
            placeholder="Name or code"
            fetcher={(search) => labApi.tests({ limit: 8, ...(search ? { search } : {}) })}
            render={(t) => ({
              title: `${t.name} (${t.code})`,
              detail: `${t.category === 'RADIOLOGY' ? 'Radiology' : 'Laboratory'}${t.sampleType ? ` · ${t.sampleType}` : ''}`,
            })}
            selected={null}
            onSelect={(t) => t && !tests.some((x) => x.id === t.id) && setTests([...tests, t])}
          />
        </FieldGroup>
        {tests.length > 0 && (
          <ul aria-label="Tests on this order" className="flex flex-wrap gap-2">
            {tests.map((t) => (
              <li
                key={t.id}
                className="inline-flex items-center gap-1 rounded-sm border border-border bg-sage-50 px-2 py-1 text-body-sm"
              >
                {t.name}
                <button
                  type="button"
                  aria-label={`Remove ${t.name}`}
                  className="text-ink-secondary hover:text-ink"
                  onClick={() => setTests(tests.filter((x) => x.id !== t.id))}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Priority">
            {(p) => (
              <Select
                id={p.id}
                value={priority}
                onChange={(e) => setPriority(e.target.value as LabPriority)}
              >
                <option value="ROUTINE">Routine</option>
                <option value="URGENT">Urgent</option>
              </Select>
            )}
          </Field>
          <Field label="Note to the lab" hint="Optional clinical context.">
            {(p) => (
              <textarea
                id={p.id}
                aria-describedby={p.describedBy}
                className={textareaClass}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** A patient's approved and pending orders across consultations (chart and portal). */
export function LabHistory({ patientId, tz }: { patientId?: string; tz: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['lab-orders', 'patient', patientId ?? 'me', page],
    queryFn: () => labApi.orders({ ...(patientId ? { patientId } : {}), page, limit: 10 }),
  });
  if (q.error)
    return (
      <Alert tone="error" title="Could not load lab results">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.data.items.length === 0)
    return <EmptyState icon={FlaskConical} title="No lab reports yet" />;
  return (
    <div className="space-y-3">
      {q.data.items.map((o) => (
        <LabOrderCard key={o.id} order={o} tz={tz} />
      ))}
      {q.data.meta.totalPages > 1 && (
        <div className="flex justify-between">
          <Button
            size="compact"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Newer
          </Button>
          <Button
            size="compact"
            variant="secondary"
            disabled={page >= q.data.meta.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
