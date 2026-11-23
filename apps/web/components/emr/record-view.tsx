'use client';

import {
  bmi,
  DIAGNOSIS_TYPES,
  type Diagnosis,
  type Icd10Code,
  type MedicalRecord,
  type RecordEntry,
  type Vitals,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, Paperclip, Plus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { appointmentsApi } from '@/services/appointments';
import { emrApi, type VitalsInput } from '@/services/emr';
import { useAuth } from '@/store/auth';
import { HistoryPanel } from './history-panel';
import { PrescriptionsPanel } from '@/components/prescriptions/prescriptions-panel';
import { LabOrdersPanel } from '@/components/lab/lab-orders-panel';
import { age, CorrectedBadge, EntryDialog, Provenance, textareaClass, when } from './shared';

const GENDER: Record<string, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
  UNDISCLOSED: 'Not stated',
};
const TYPE: Record<string, string> = { DIFFERENTIAL: 'Differential', CONFIRMED: 'Confirmed' };

/** What the signed-in user may do on this record; the API enforces the same rules. */
export function recordPermissions(
  r: MedicalRecord,
  role: string | undefined,
  userId: string | undefined,
) {
  const treating = role === 'DOCTOR' && r.doctor.userId === userId;
  const open = r.status === 'OPEN';
  return {
    treating,
    editSummary: treating && open,
    addNote: treating,
    addVitals: (treating || role === 'NURSE') && open,
    correctVitals: treating || role === 'NURSE',
    diagnose: treating && open,
    correctDiagnosis: treating,
    attach: treating || role === 'NURSE',
    complete: treating && open && r.appointment.status === 'IN_PROGRESS',
    history: role === 'DOCTOR' || role === 'NURSE',
  };
}

/** One encounter: summary, vitals, diagnoses, notes, plan, files, and the patient's history (EMR-001..011). */
export function RecordView({ recordId, backHref }: { recordId: string; backHref: string }) {
  const tz = useHospitalTz();
  const me = useAuth((s) => s.me?.user);
  const qc = useQueryClient();
  const key = ['record', recordId];
  const q = useQuery({ queryKey: key, queryFn: () => emrApi.get(recordId) });
  const saved = (r: MedicalRecord) => {
    qc.setQueryData(key, r);
    void qc.invalidateQueries({ queryKey: ['chart'] });
  };
  if (q.error)
    return (
      <Alert tone="error" title="Could not open the record">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending) return <Skeleton className="h-96" />;
  const r = q.data;
  const can = recordPermissions(r, me?.role, me?.id);
  const p = r.patient;
  return (
    <>
      <PageHeader
        crumbs={[
          backHref.startsWith('/portal')
            ? { label: 'My health record', href: backHref }
            : { label: 'Appointments', href: backHref },
        ]}
        title={`${p.firstName} ${p.lastName}`}
        description={
          <span>
            <span className="font-mono">{p.mrn}</span> · {age(p.dateOfBirth)} years ·{' '}
            {GENDER[p.gender] ?? p.gender} · Dr {r.doctor.firstName} {r.doctor.lastName},{' '}
            {r.department.name} · {when(r.appointment.scheduledAt, tz)}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {r.status === 'CLOSED' ? (
              <Badge tone="neutral" icon={Lock}>
                Completed {r.closedAt ? when(r.closedAt, tz) : ''}
              </Badge>
            ) : (
              <Badge tone="info">Consultation in progress</Badge>
            )}
            {can.complete && <CompleteButton record={r} onDone={() => void q.refetch()} />}
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Summary record={r} can={can.editSummary} onSaved={saved} />
          <VitalsSection
            record={r}
            canAdd={can.addVitals}
            canCorrect={can.correctVitals}
            tz={tz}
            onSaved={saved}
          />
          <DiagnosesSection
            record={r}
            canAdd={can.diagnose}
            canCorrect={can.correctDiagnosis}
            tz={tz}
            onSaved={saved}
          />
          <PrescriptionsPanel record={r} canIssue={can.editSummary} tz={tz} />
          <LabOrdersPanel record={r} canOrder={can.editSummary} tz={tz} />
          <NotesSection record={r} can={can.addNote} tz={tz} onSaved={saved} />
          <FilesSection record={r} can={can.attach} tz={tz} onSaved={saved} />
        </div>
        <HistoryPanel patientId={p.id} canEdit={can.history} tz={tz} />
      </div>
    </>
  );
}

function CompleteButton({ record, onDone }: { record: MedicalRecord; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const complete = async () => {
    setBusy(true);
    try {
      await appointmentsApi.setStatus(record.appointment.id, 'COMPLETED');
      toast.success(
        'Consultation completed. The record is now locked; add an addendum for anything later.',
      );
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      onDone();
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Complete consultation</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Complete this consultation?"
        description="The record will be locked. Later changes are added as addenda, and the original stays visible."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep working
            </Button>
            <Button loading={busy} onClick={() => void complete()}>
              Complete consultation
            </Button>
          </>
        }
      >
        {!record.treatmentPlan && (
          <Alert tone="warning">No treatment plan has been written yet.</Alert>
        )}
        {record.diagnoses.length === 0 && (
          <Alert tone="warning" className="mt-2">
            No diagnosis has been recorded yet.
          </Alert>
        )}
      </Dialog>
    </>
  );
}

function Summary({
  record,
  can,
  onSaved,
}: {
  record: MedicalRecord;
  can: boolean;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [f, setF] = useState({
    chiefComplaint: record.chiefComplaint,
    presentingSymptoms: record.presentingSymptoms ?? '',
    treatmentPlan: record.treatmentPlan ?? '',
  });
  const [saving, setSaving] = useState(false);
  const dirty =
    f.chiefComplaint !== record.chiefComplaint ||
    f.presentingSymptoms !== (record.presentingSymptoms ?? '') ||
    f.treatmentPlan !== (record.treatmentPlan ?? '');
  const save = async () => {
    if (!f.chiefComplaint.trim()) return toast.error('Enter the chief complaint.');
    setSaving(true);
    try {
      onSaved(
        await emrApi.update(record.id, {
          chiefComplaint: f.chiefComplaint,
          presentingSymptoms: f.presentingSymptoms,
          treatmentPlan: f.treatmentPlan,
        }),
      );
      toast.success('Saved.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  if (!can)
    return (
      <Panel title="Consultation">
        <dl className="grid gap-4 px-5 py-4">
          <div>
            <dt className="text-label font-medium text-ink-secondary">Chief complaint</dt>
            <dd>{record.chiefComplaint}</dd>
          </div>
          <div>
            <dt className="text-label font-medium text-ink-secondary">Presenting symptoms</dt>
            <dd className="whitespace-pre-wrap">
              {record.presentingSymptoms ?? <span className="text-ink-muted">Not recorded</span>}
            </dd>
          </div>
          <div>
            <dt className="text-label font-medium text-ink-secondary">Treatment plan</dt>
            <dd className="whitespace-pre-wrap">
              {record.treatmentPlan ?? <span className="text-ink-muted">Not recorded</span>}
            </dd>
          </div>
        </dl>
      </Panel>
    );
  return (
    <Panel
      title="Consultation"
      actions={
        <Button size="compact" loading={saving} disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <div className="grid gap-4 px-5 py-4">
        <Field label="Chief complaint" required>
          {(p) => (
            <Input
              id={p.id}
              maxLength={500}
              value={f.chiefComplaint}
              onChange={(e) => setF({ ...f, chiefComplaint: e.target.value })}
            />
          )}
        </Field>
        <Field label="Presenting symptoms">
          {(p) => (
            <textarea
              id={p.id}
              className={textareaClass}
              maxLength={4000}
              value={f.presentingSymptoms}
              onChange={(e) => setF({ ...f, presentingSymptoms: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Treatment plan and instructions"
          hint="Stored encrypted. Locked when the consultation is completed."
        >
          {(p) => (
            <textarea
              id={p.id}
              aria-describedby={p.describedBy}
              className={`${textareaClass} min-h-28`}
              maxLength={8000}
              value={f.treatmentPlan}
              onChange={(e) => setF({ ...f, treatmentPlan: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Panel>
  );
}

const VITAL_FIELDS: { key: keyof VitalsInput; label: string; unit: string; step?: string }[] = [
  { key: 'systolicBp', label: 'Systolic', unit: 'mmHg' },
  { key: 'diastolicBp', label: 'Diastolic', unit: 'mmHg' },
  { key: 'pulse', label: 'Pulse', unit: '/min' },
  { key: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1' },
  { key: 'spo2', label: 'SpO2', unit: '%' },
  { key: 'heightCm', label: 'Height', unit: 'cm', step: '0.1' },
  { key: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1' },
];

function VitalsSection({
  record,
  canAdd,
  canCorrect,
  tz,
  onSaved,
}: {
  record: MedicalRecord;
  canAdd: boolean;
  canCorrect: boolean;
  tz: string;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [editing, setEditing] = useState<Vitals | 'new' | null>(null);
  return (
    <Panel
      title="Vitals"
      actions={
        canAdd && (
          <Button size="compact" variant="secondary" onClick={() => setEditing('new')}>
            <Plus />
            Record vitals
          </Button>
        )
      }
    >
      {record.vitals.length === 0 ? (
        <p className="px-5 py-4 text-body-sm text-ink-muted">No vitals recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <caption className="sr-only">Vitals</caption>
            <thead className="text-left text-caption text-ink-secondary">
              <tr>
                <th className="px-5 py-2 font-medium">Recorded</th>
                <th className="px-2 py-2 font-medium">BP</th>
                <th className="px-2 py-2 font-medium">Pulse</th>
                <th className="px-2 py-2 font-medium">Temp</th>
                <th className="px-2 py-2 font-medium">SpO2</th>
                <th className="px-2 py-2 font-medium">Height</th>
                <th className="px-2 py-2 font-medium">Weight</th>
                <th className="px-2 py-2 font-medium">BMI</th>
                <th className="px-5 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {record.vitals.map((v) => (
                <tr
                  key={v.id}
                  className={`border-t border-border ${v.corrected ? 'text-ink-muted line-through decoration-ink-muted/60' : ''}`}
                >
                  <td className="px-5 py-2 font-sans no-underline">
                    <Provenance row={v} tz={tz} />
                  </td>
                  <td className="px-2 py-2">
                    {v.systolicBp ?? '–'}/{v.diastolicBp ?? '–'}
                  </td>
                  <td className="px-2 py-2">{v.pulse ?? '–'}</td>
                  <td className="px-2 py-2">{v.temperatureC ?? '–'}</td>
                  <td className="px-2 py-2">{v.spo2 ?? '–'}</td>
                  <td className="px-2 py-2">{v.heightCm ?? '–'}</td>
                  <td className="px-2 py-2">{v.weightKg ?? '–'}</td>
                  <td className="px-2 py-2">{v.bmi ?? '–'}</td>
                  <td className="px-5 py-2 text-right font-sans">
                    {canCorrect && !v.corrected && (
                      <Button size="compact" variant="ghost" onClick={() => setEditing(v)}>
                        Correct
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <VitalsDialog
          record={record}
          original={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </Panel>
  );
}

function VitalsDialog({
  record,
  original,
  onClose,
  onSaved,
}: {
  record: MedicalRecord;
  original?: Vitals;
  onClose: () => void;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      VITAL_FIELDS.map((x) => [
        x.key,
        original?.[x.key as keyof Vitals] != null ? String(original[x.key as keyof Vitals]) : '',
      ]),
    ),
  );
  const num = (k: string) => (f[k] ? Number(f[k]) : undefined);
  const preview = bmi(num('heightCm') ?? null, num('weightKg') ?? null);
  return (
    <EntryDialog
      title={original ? 'Correct vitals' : 'Record vitals'}
      correcting={Boolean(original)}
      onClose={onClose}
      onSave={async (reason) => {
        const body: VitalsInput = Object.fromEntries(
          VITAL_FIELDS.filter((x) => f[x.key]).map((x) => [x.key, Number(f[x.key])]),
        );
        onSaved(
          await emrApi.addVitals(record.id, {
            ...body,
            ...(original ? { supersedesId: original.id, correctionReason: reason } : {}),
          }),
        );
      }}
    >
      {VITAL_FIELDS.map((x) => (
        <Field key={x.key} label={`${x.label} (${x.unit})`}>
          {(p) => (
            <Input
              id={p.id}
              type="number"
              inputMode="decimal"
              step={x.step ?? '1'}
              value={f[x.key] ?? ''}
              onChange={(e) => setF({ ...f, [x.key]: e.target.value })}
            />
          )}
        </Field>
      ))}
      <p className="self-end text-body-sm text-ink-secondary" aria-live="polite">
        BMI: <span className="font-mono">{preview ?? 'enter height and weight'}</span>
      </p>
    </EntryDialog>
  );
}

function DiagnosesSection({
  record,
  canAdd,
  canCorrect,
  tz,
  onSaved,
}: {
  record: MedicalRecord;
  canAdd: boolean;
  canCorrect: boolean;
  tz: string;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [editing, setEditing] = useState<Diagnosis | 'new' | null>(null);
  return (
    <Panel
      title="Diagnoses"
      actions={
        canAdd && (
          <Button size="compact" variant="secondary" onClick={() => setEditing('new')}>
            <Plus />
            Add diagnosis
          </Button>
        )
      }
    >
      {record.diagnoses.length === 0 ? (
        <p className="px-5 py-4 text-body-sm text-ink-muted">No diagnosis recorded.</p>
      ) : (
        <ul className="divide-y divide-border">
          {record.diagnoses.map((d) => (
            <li
              key={d.id}
              className={`flex flex-wrap items-start gap-3 px-5 py-3 ${d.corrected ? 'opacity-70' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{d.description}</p>
                <p className="text-body-sm text-ink-secondary">
                  {TYPE[d.type]}
                  {d.icd10 ? (
                    <>
                      {' '}
                      · <span className="font-mono">{d.icd10.code}</span> {d.icd10.title}
                    </>
                  ) : (
                    ' · no ICD-10 code'
                  )}
                </p>
                <CorrectedBadge row={d} />
                <Provenance row={d} tz={tz} />
              </div>
              {canCorrect && !d.corrected && (
                <Button size="compact" variant="ghost" onClick={() => setEditing(d)}>
                  Correct
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <DiagnosisDialog
          record={record}
          original={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </Panel>
  );
}

function DiagnosisDialog({
  record,
  original,
  onClose,
  onSaved,
}: {
  record: MedicalRecord;
  original?: Diagnosis;
  onClose: () => void;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [description, setDescription] = useState(original?.description ?? '');
  const [type, setType] = useState(original?.type ?? 'DIFFERENTIAL');
  const [code, setCode] = useState<Icd10Code | null>(original?.icd10 ?? null);
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['icd10', search],
    queryFn: () => emrApi.icd10(search),
    enabled: search.trim().length >= 2 && !code,
  });
  return (
    <EntryDialog
      title={original ? 'Correct diagnosis' : 'Add diagnosis'}
      correcting={Boolean(original)}
      onClose={onClose}
      onSave={async (reason) => {
        if (!description.trim()) throw new Error('Describe the diagnosis.');
        onSaved(
          await emrApi.addDiagnosis(record.id, {
            description,
            type,
            ...(code ? { icd10Code: code.code } : {}),
            ...(original ? { supersedesId: original.id, correctionReason: reason } : {}),
          }),
        );
      }}
    >
      <Field label="Diagnosis" required className="sm:col-span-2">
        {(p) => (
          <textarea
            id={p.id}
            className={textareaClass}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Field label="Type" required>
        {(p) => (
          <Select id={p.id} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {DIAGNOSIS_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE[t]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div>
        {code ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium">ICD-10 code</span>
            <p className="text-body-sm">
              <span className="font-mono">{code.code}</span> {code.title}{' '}
              <Button variant="link" onClick={() => setCode(null)}>
                Change
              </Button>
            </p>
          </div>
        ) : (
          <Field label="ICD-10 code" hint="Optional. Search by code or words.">
            {(p) => (
              <Input
                id={p.id}
                aria-describedby={p.describedBy}
                value={search}
                placeholder="e.g. J06 or pharyngitis"
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </Field>
        )}
        {!code && q.data && (
          <ul
            aria-label="ICD-10 results"
            className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border"
          >
            {q.data.length === 0 ? (
              <li className="px-3 py-2 text-body-sm text-ink-muted">
                No codes match. You can save without one.
              </li>
            ) : (
              q.data.map((c) => (
                <li key={c.code} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-body-sm transition-colors duration-150 hover:bg-sage-50 max-sm:py-3"
                    onClick={() => setCode(c)}
                  >
                    <span className="font-mono">{c.code}</span> {c.title}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </EntryDialog>
  );
}

function NotesSection({
  record,
  can,
  tz,
  onSaved,
}: {
  record: MedicalRecord;
  can: boolean;
  tz: string;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [editing, setEditing] = useState<RecordEntry | 'new' | null>(null);
  const closed = record.status === 'CLOSED';
  return (
    <Panel
      title="Notes"
      actions={
        can && (
          <Button size="compact" variant="secondary" onClick={() => setEditing('new')}>
            <Plus />
            {closed ? 'Add addendum' : 'Add note'}
          </Button>
        )
      }
    >
      {record.entries.length === 0 ? (
        <p className="px-5 py-4 text-body-sm text-ink-muted">No notes yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {record.entries.map((e) => (
            <li key={e.id} className={`px-5 py-3 ${e.corrected ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap gap-1">
                    {e.kind === 'ADDENDUM' && <Badge tone="info">Addendum</Badge>}
                    <CorrectedBadge row={e} />
                  </div>
                  <p className="whitespace-pre-wrap">{e.body}</p>
                  <Provenance row={e} tz={tz} />
                </div>
                {can && !e.corrected && (
                  <Button size="compact" variant="ghost" onClick={() => setEditing(e)}>
                    Correct
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <NoteDialog
          record={record}
          original={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </Panel>
  );
}

function NoteDialog({
  record,
  original,
  onClose,
  onSaved,
}: {
  record: MedicalRecord;
  original?: RecordEntry;
  onClose: () => void;
  onSaved: (r: MedicalRecord) => void;
}) {
  const [body, setBody] = useState(original?.body ?? '');
  return (
    <EntryDialog
      title={original ? 'Correct note' : record.status === 'CLOSED' ? 'Add addendum' : 'Add note'}
      correcting={Boolean(original)}
      onClose={onClose}
      onSave={async (reason) => {
        if (!body.trim()) throw new Error('Write the note.');
        onSaved(
          await emrApi.addEntry(record.id, {
            body,
            ...(original ? { amendsEntryId: original.id, correctionReason: reason } : {}),
          }),
        );
      }}
    >
      <Field label="Note" required className="sm:col-span-2">
        {(p) => (
          <textarea
            id={p.id}
            className={`${textareaClass} min-h-32`}
            maxLength={8000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
    </EntryDialog>
  );
}

function FilesSection({
  record,
  can,
  tz,
  onSaved,
}: {
  record: MedicalRecord;
  can: boolean;
  tz: string;
  onSaved: (r: MedicalRecord) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast.error('Files must be 20 MB or smaller.');
    setBusy(true);
    try {
      onSaved(await emrApi.upload(record.id, file));
      toast.success(`${file.name} attached.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const download = async (id: string, name: string) => {
    try {
      const url = URL.createObjectURL(await emrApi.download(id));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Panel
      title="Attachments"
      actions={
        can && (
          <>
            <input
              ref={input}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Choose a file to attach"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <Button
              size="compact"
              variant="secondary"
              loading={busy}
              onClick={() => input.current?.click()}
            >
              <Upload />
              Attach file
            </Button>
          </>
        )
      }
    >
      {record.files.length === 0 ? (
        <EmptyState icon={Paperclip} title="No attachments">
          {can ? 'PDF, PNG, JPEG or WebP, up to 20 MB.' : undefined}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {record.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="size-4 text-ink-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.originalName}</p>
                <p className="text-caption text-ink-muted">
                  {(f.sizeBytes / 1024 / 1024).toFixed(2)} MB · {f.uploadedBy.firstName}{' '}
                  {f.uploadedBy.lastName} · {when(f.createdAt, tz)}
                </p>
              </div>
              <Button
                size="compact"
                variant="ghost"
                onClick={() => void download(f.id, f.originalName)}
              >
                Download<span className="sr-only"> {f.originalName}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
