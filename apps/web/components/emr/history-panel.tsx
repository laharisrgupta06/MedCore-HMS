'use client';

import {
  ALLERGY_KINDS,
  FAMILY_CONDITIONS,
  SEVERITIES,
  type Allergy,
  type FamilyHistoryEntry,
  type HistoryEntry,
  type MedicationHistoryEntry,
  type PatientHistory,
  type Vaccination,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { emrApi, type HistoryInput, type HistoryList } from '@/services/emr';
import { CorrectedBadge, EntryDialog, Provenance, textareaClass } from './shared';

const KIND: Record<string, string> = {
  ALLERGY: 'Allergy',
  ADVERSE_DRUG_REACTION: 'Adverse drug reaction',
};
const SEV: Record<string, string> = { MILD: 'Mild', MODERATE: 'Moderate', SEVERE: 'Severe' };
const COND: Record<string, string> = {
  DIABETES: 'Diabetes',
  HYPERTENSION: 'Hypertension',
  CANCER: 'Cancer',
  CARDIAC: 'Heart disease',
};
const STATUS: Record<string, string> = {
  RESOLVED: 'Resolved',
  ENTERED_IN_ERROR: 'Entered in error',
};

type Editing = { list: HistoryList; entry?: HistoryEntry } | null;

/** Allergies and reactions, medications, vaccinations and family history (EMR-007..009, EMR-011). */
export function HistoryPanel({
  patientId,
  canEdit,
  tz,
}: {
  patientId: string;
  canEdit: boolean;
  tz: string;
}) {
  const qc = useQueryClient();
  const key = ['history', patientId];
  const q = useQuery({ queryKey: key, queryFn: () => emrApi.history(patientId) });
  const [editing, setEditing] = useState<Editing>(null);
  const [marking, setMarking] = useState<{ list: HistoryList; entry: HistoryEntry } | null>(null);
  const saved = (h: PatientHistory) => qc.setQueryData(key, h);
  if (q.error)
    return (
      <Alert tone="error" title="Could not load the history">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending) return <Skeleton className="h-64" />;
  const h = q.data;
  const activeAllergies = h.allergies.filter((a) => a.status === 'ACTIVE' && !a.corrected);
  const section = <T extends HistoryEntry>(
    list: HistoryList,
    title: string,
    rows: T[],
    render: (r: T) => ReactNode,
  ) => (
    <section aria-label={title} className="border-b border-border px-5 py-4 last:border-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {canEdit && (
          <Button size="compact" variant="ghost" onClick={() => setEditing({ list })}>
            <Plus />
            Add<span className="sr-only"> to {title.toLowerCase()}</span>
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-body-sm text-ink-muted">None recorded.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className={r.status !== 'ACTIVE' || r.corrected ? 'opacity-70' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {render(r)}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <CorrectedBadge row={r} />
                    {r.status !== 'ACTIVE' && (
                      <Badge tone={r.status === 'ENTERED_IN_ERROR' ? 'error' : 'neutral'}>
                        {STATUS[r.status]}
                      </Badge>
                    )}
                  </div>
                  {r.statusReason && (
                    <p className="text-caption text-ink-secondary">Reason: {r.statusReason}</p>
                  )}
                  <Provenance row={r} tz={tz} />
                </div>
                {canEdit && r.status !== 'ENTERED_IN_ERROR' && !r.corrected && (
                  <div className="flex gap-1">
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => setEditing({ list, entry: r })}
                    >
                      Correct
                    </Button>
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => setMarking({ list, entry: r })}
                    >
                      Status
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <Panel title="Patient history">
      {activeAllergies.length > 0 && (
        <div className="px-5 pt-4">
          <Alert tone="warning" title="Allergies and reactions">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {activeAllergies.map((a) => a.substance).join(', ')}
            </span>
          </Alert>
        </div>
      )}
      {section<Allergy>('allergies', 'Allergies and reactions', h.allergies, (a) => (
        <p>
          <span className="font-medium">{a.substance}</span>{' '}
          <span className="text-body-sm text-ink-secondary">
            {KIND[a.kind]}
            {a.severity ? `, ${SEV[a.severity]}` : ''}
            {a.reaction ? `: ${a.reaction}` : ''}
          </span>
        </p>
      ))}
      {section<MedicationHistoryEntry>('medications', 'Medications', h.medications, (m) => (
        <p>
          <span className="font-medium">{m.medicineName}</span>{' '}
          <span className="text-body-sm text-ink-secondary">
            {[
              m.dosage,
              m.frequency,
              m.startedOn && `since ${m.startedOn}`,
              m.endedOn && `until ${m.endedOn}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </p>
      ))}
      {section<Vaccination>('vaccinations', 'Vaccinations', h.vaccinations, (v) => (
        <p>
          <span className="font-medium">{v.vaccineName}</span>{' '}
          <span className="text-body-sm text-ink-secondary">
            {v.administeredOn} · batch <span className="font-mono">{v.batchNumber}</span>
            {v.nextDueOn ? ` · next due ${v.nextDueOn}` : ''}
          </span>
        </p>
      ))}
      {section<FamilyHistoryEntry>('family-history', 'Family history', h.familyHistory, (f) => (
        <p>
          <span className="font-medium">{COND[f.condition]}</span>{' '}
          <span className="text-body-sm text-ink-secondary">
            {f.present ? 'Present' : 'Not present'}
            {f.relation ? ` (${f.relation})` : ''}
            {f.notes ? `. ${f.notes}` : ''}
          </span>
        </p>
      ))}
      {editing && (
        <HistoryDialog
          patientId={patientId}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {marking && (
        <StatusDialog
          patientId={patientId}
          target={marking}
          onClose={() => setMarking(null)}
          onSaved={saved}
        />
      )}
    </Panel>
  );
}

const TITLES: Record<HistoryList, string> = {
  allergies: 'allergy or reaction',
  medications: 'medication',
  vaccinations: 'vaccination',
  'family-history': 'family history',
};

function HistoryDialog({
  patientId,
  editing,
  onClose,
  onSaved,
}: {
  patientId: string;
  editing: NonNullable<Editing>;
  onClose: () => void;
  onSaved: (h: PatientHistory) => void;
}) {
  const e = editing.entry as Record<string, unknown> | undefined;
  const [f, setF] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (e)
      for (const [k, v] of Object.entries(e))
        if (typeof v === 'string' || typeof v === 'boolean') init[k] = String(v);
    return { kind: 'ALLERGY', condition: 'DIABETES', present: 'true', ...init };
  });
  const set = (k: string) => (ev: { target: { value: string } }) =>
    setF({ ...f, [k]: ev.target.value });
  const opt = (k: string) => (f[k]?.trim() ? f[k]!.trim() : undefined);
  const input = (k: string, label: string, required = false, type = 'text') => (
    <Field label={label} required={required}>
      {(p) => (
        <Input
          id={p.id}
          aria-describedby={p.describedBy}
          type={type}
          value={f[k] ?? ''}
          onChange={set(k)}
        />
      )}
    </Field>
  );
  const body = (): HistoryInput => {
    switch (editing.list) {
      case 'allergies':
        return {
          kind: f.kind as Allergy['kind'],
          substance: f.substance ?? '',
          reaction: opt('reaction'),
          severity: (opt('severity') as Allergy['severity']) ?? undefined,
        };
      case 'medications':
        return {
          medicineName: f.medicineName ?? '',
          dosage: opt('dosage'),
          frequency: opt('frequency'),
          startedOn: opt('startedOn'),
          endedOn: opt('endedOn'),
          notes: opt('notes'),
        };
      case 'vaccinations':
        return {
          vaccineName: f.vaccineName ?? '',
          administeredOn: f.administeredOn ?? '',
          batchNumber: f.batchNumber ?? '',
          nextDueOn: opt('nextDueOn'),
        };
      default:
        return {
          condition: f.condition as FamilyHistoryEntry['condition'],
          present: f.present === 'true',
          relation: opt('relation'),
          notes: opt('notes'),
        };
    }
  };
  return (
    <EntryDialog
      title={`${e ? 'Correct' : 'Add'} ${TITLES[editing.list]}`}
      correcting={Boolean(e)}
      onClose={onClose}
      onSave={async (reason) =>
        onSaved(
          await emrApi.addHistory(patientId, editing.list, {
            ...body(),
            ...(e ? { supersedesId: e.id as string, correctionReason: reason } : {}),
          }),
        )
      }
    >
      {editing.list === 'allergies' && (
        <>
          <Field label="Type" required>
            {(p) => (
              <Select id={p.id} value={f.kind} onChange={set('kind')}>
                {ALLERGY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {input('substance', 'Substance or medicine', true)}
          {input('reaction', 'Reaction')}
          <Field label="Severity">
            {(p) => (
              <Select id={p.id} value={f.severity ?? ''} onChange={set('severity')}>
                <option value="">Not stated</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEV[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
      {editing.list === 'medications' && (
        <>
          {input('medicineName', 'Medicine', true)}
          {input('dosage', 'Dosage')}
          {input('frequency', 'Frequency')}
          {input('startedOn', 'Started', false, 'date')}
          {input('endedOn', 'Stopped', false, 'date')}
          <Field label="Notes" className="sm:col-span-2">
            {(p) => (
              <textarea
                id={p.id}
                className={textareaClass}
                maxLength={1000}
                value={f.notes ?? ''}
                onChange={set('notes')}
              />
            )}
          </Field>
        </>
      )}
      {editing.list === 'vaccinations' && (
        <>
          {input('vaccineName', 'Vaccine', true)}
          {input('administeredOn', 'Date given', true, 'date')}
          {input('batchNumber', 'Batch number', true)}
          {input('nextDueOn', 'Next due', false, 'date')}
        </>
      )}
      {editing.list === 'family-history' && (
        <>
          <Field label="Condition" required>
            {(p) => (
              <Select
                id={p.id}
                value={f.condition}
                disabled={Boolean(e)}
                onChange={set('condition')}
              >
                {FAMILY_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {COND[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="In the family" required>
            {(p) => (
              <Select id={p.id} value={f.present} onChange={set('present')}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            )}
          </Field>
          {input('relation', 'Relation, for example mother')}
          {input('notes', 'Notes')}
        </>
      )}
    </EntryDialog>
  );
}

function StatusDialog({
  patientId,
  target,
  onClose,
  onSaved,
}: {
  patientId: string;
  target: { list: HistoryList; entry: HistoryEntry };
  onClose: () => void;
  onSaved: (h: PatientHistory) => void;
}) {
  const [status, setStatus] = useState<'RESOLVED' | 'ENTERED_IN_ERROR'>(
    target.entry.status === 'RESOLVED' ? 'ENTERED_IN_ERROR' : 'RESOLVED',
  );
  const [reason, setReason] = useState('');
  return (
    <EntryDialog
      title="Change status"
      onClose={onClose}
      submitLabel="Save status"
      onSave={async () => {
        if (status === 'ENTERED_IN_ERROR' && reason.trim().length < 3)
          throw new Error('Say why this entry was a mistake.');
        onSaved(
          await emrApi.setHistoryStatus(
            patientId,
            target.list,
            target.entry.id,
            status,
            reason.trim() || undefined,
          ),
        );
      }}
    >
      <Field label="Status" required>
        {(p) => (
          <Select
            id={p.id}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {target.entry.status !== 'RESOLVED' && (
              <option value="RESOLVED">Resolved (no longer current)</option>
            )}
            <option value="ENTERED_IN_ERROR">Entered in error (cannot be undone)</option>
          </Select>
        )}
      </Field>
      <Field label="Reason" required={status === 'ENTERED_IN_ERROR'}>
        {(p) => (
          <textarea
            id={p.id}
            className={textareaClass}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </EntryDialog>
  );
}
