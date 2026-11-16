'use client';

import {
  isLowStock,
  DOSE_FREQUENCIES,
  FREQUENCY_LABEL,
  suggestedQuantity,
  type AllergyConflict,
  type DoseFrequency,
  type Medicine,
  type MedicalRecord,
} from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Picker } from '@/components/appointments/pickers';
import { textareaClass } from '@/components/emr/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FieldGroup, Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/forms';
import { medicinesApi, prescriptionsApi } from '@/services/prescriptions';

export function StockBadge({ m }: { m: Pick<Medicine, 'available' | 'reorderLevel'> }) {
  if (m.available <= 0) return <Badge tone="error">Out of stock</Badge>;
  // PHARM-003 (owner decision): low means strictly below the reorder level, as on the server.
  if (isLowStock(m.available, m.reorderLevel))
    return <Badge tone="warning">Low stock: {m.available}</Badge>;
  return <Badge tone="success">In stock: {m.available}</Badge>;
}

interface Line {
  medicine: Medicine;
  dosage: string;
  frequency: DoseFrequency;
  durationDays: string;
  quantity: string;
  quantityEdited: boolean;
  instructions: string;
}

/** Issue a prescription (RX-001..006): catalogue search, dose, frequency, days, quantity, instructions. */
export function PrescriptionForm({
  record,
  onClose,
}: {
  record: MedicalRecord;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [conflicts, setConflicts] = useState<AllergyConflict[] | null>(null);
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = (m: Medicine | null) => {
    if (!m) return;
    if (lines.some((l) => l.medicine.id === m.id))
      return toast.error(`${m.name} ${m.strength} is already on this prescription.`);
    setLines([
      ...lines,
      {
        medicine: m,
        dosage: m.strength,
        frequency: 'BD',
        durationDays: '5',
        quantity: String(suggestedQuantity('BD', 5)),
        quantityEdited: false,
        instructions: '',
      },
    ]);
  };
  const update = (i: number, patch: Partial<Line>) =>
    setLines(
      lines.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        if (!next.quantityEdited && (patch.frequency || patch.durationDays !== undefined)) {
          const q = suggestedQuantity(next.frequency, Number(next.durationDays));
          next.quantity = q ? String(q) : '';
        }
        return next;
      }),
    );

  const submit = async () => {
    setError(null);
    if (lines.length === 0) return setError('Add at least one medicine.');
    for (const l of lines) {
      const days = Number(l.durationDays),
        qty = Number(l.quantity);
      if (!l.dosage.trim()) return setError(`Enter the dose for ${l.medicine.name}.`);
      if (!Number.isInteger(days) || days < 1 || days > 365)
        return setError(`Days for ${l.medicine.name} must be 1 to 365.`);
      if (!Number.isInteger(qty) || qty < 1 || qty > 10000)
        return setError(`Quantity for ${l.medicine.name} must be a whole number from 1 to 10,000.`);
    }
    if (conflicts && override.trim().length < 3)
      return setError('Give a reason for prescribing despite the allergy.');
    setSaving(true);
    try {
      await prescriptionsApi.issue({
        medicalRecordId: record.id,
        items: lines.map((l) => ({
          medicineId: l.medicine.id,
          dosage: l.dosage.trim(),
          frequency: l.frequency,
          durationDays: Number(l.durationDays),
          quantity: Number(l.quantity),
          ...(l.instructions.trim() ? { instructions: l.instructions.trim() } : {}),
        })),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(conflicts ? { allergyOverrideReason: override.trim() } : {}),
      });
      toast.success('Prescription issued. The PDF is being prepared.');
      void qc.invalidateQueries({ queryKey: ['prescriptions'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'ALLERGY_CONFLICT') {
        setConflicts((e.details as { conflicts?: AllergyConflict[] } | undefined)?.conflicts ?? []);
        setError(null);
      } else setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="New prescription"
      description={`${record.patient.firstName} ${record.patient.lastName} · ${record.patient.mrn}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={conflicts ? 'accent' : 'primary'}
            loading={saving}
            onClick={() => void submit()}
          >
            {conflicts ? 'Prescribe despite allergy' : 'Issue prescription'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {conflicts && (
          <Alert tone="warning" title="Recorded allergy or reaction">
            <ul className="mt-1 list-disc pl-5">
              {conflicts.map((c) => (
                <li key={`${c.allergyId}-${c.medicineId}`}>
                  {c.medicineName} matches the recorded allergy to{' '}
                  <span className="font-medium">{c.substance}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2">
              To continue, record why. The reason is printed on the prescription and shown to the
              pharmacist.
            </p>
          </Alert>
        )}
        {conflicts && (
          <Field label="Reason for prescribing despite the allergy" required>
            {(p) => (
              <textarea
                id={p.id}
                className={textareaClass}
                maxLength={500}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            )}
          </Field>
        )}
        <FieldGroup label="Add a medicine">
          <Picker<Medicine>
            label="Medicine"
            queryKey="medicines"
            placeholder="Name or generic name"
            fetcher={(search) => medicinesApi.list({ limit: 8, ...(search ? { search } : {}) })}
            render={(m) => ({
              title: `${m.name} ${m.strength}`,
              detail: `${m.form.toLowerCase()}${m.genericName ? ` · ${m.genericName}` : ''} · ${m.available > 0 ? `${m.available} in stock` : 'out of stock'}`,
            })}
            selected={null}
            onSelect={add}
          />
        </FieldGroup>
        {lines.length > 0 && (
          <ol className="space-y-3" aria-label="Medicines on this prescription">
            {lines.map((l, i) => (
              <li key={l.medicine.id} className="rounded-md border border-border p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {l.medicine.name} {l.medicine.strength}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {l.medicine.form.toLowerCase()}
                  </span>
                  <StockBadge m={l.medicine} />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Remove ${l.medicine.name}`}
                    onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Dose" required>
                    {(p) => (
                      <Input
                        id={p.id}
                        maxLength={40}
                        value={l.dosage}
                        onChange={(e) => update(i, { dosage: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Frequency" required>
                    {(p) => (
                      <Select
                        id={p.id}
                        value={l.frequency}
                        onChange={(e) => update(i, { frequency: e.target.value as DoseFrequency })}
                      >
                        {DOSE_FREQUENCIES.map((f) => (
                          <option key={f} value={f}>
                            {f}: {FREQUENCY_LABEL[f]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Days" required>
                    {(p) => (
                      <Input
                        id={p.id}
                        type="number"
                        min={1}
                        max={365}
                        value={l.durationDays}
                        onChange={(e) => update(i, { durationDays: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label="Quantity"
                    required
                    hint={
                      l.frequency === 'SOS'
                        ? 'Enter the units to supply.'
                        : 'Suggested from frequency and days.'
                    }
                  >
                    {(p) => (
                      <Input
                        id={p.id}
                        aria-describedby={p.describedBy}
                        type="number"
                        min={1}
                        max={10000}
                        value={l.quantity}
                        onChange={(e) =>
                          update(i, { quantity: e.target.value, quantityEdited: true })
                        }
                      />
                    )}
                  </Field>
                  <Field label="Instructions" className="sm:col-span-4">
                    {(p) => (
                      <Input
                        id={p.id}
                        maxLength={300}
                        placeholder="For example: after food, avoid sunlight"
                        value={l.instructions}
                        onChange={(e) => update(i, { instructions: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              </li>
            ))}
          </ol>
        )}
        <Field label="Notes for the patient and pharmacy">
          {(p) => (
            <textarea
              id={p.id}
              className={textareaClass}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
        {conflicts === null && lines.length > 0 && (
          <p className="flex items-center gap-1 text-caption text-ink-muted">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            The patient's recorded allergies are checked when you issue.
          </p>
        )}
      </div>
    </Dialog>
  );
}
