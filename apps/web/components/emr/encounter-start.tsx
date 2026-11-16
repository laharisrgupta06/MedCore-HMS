'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Panel, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { fmtTime, useHospitalTz } from '@/lib/time';
import { appointmentsApi } from '@/services/appointments';
import { emrApi } from '@/services/emr';
import { textareaClass } from './shared';

/** EMR-001: the doctor records the chief complaint, which starts the consultation and opens its record. */
export function EncounterStart({ appointmentId }: { appointmentId: string }) {
  const tz = useHospitalTz();
  const router = useRouter();
  const q = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => appointmentsApi.get(appointmentId),
  });
  const [complaint, setComplaint] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const recordId = q.data?.medicalRecordId;
  useEffect(() => {
    if (recordId) router.replace(`/dashboard/records/${recordId}`);
  }, [recordId, router]);
  if (q.error)
    return (
      <Alert tone="error" title="Could not open the appointment">
        {errorMessage(q.error)}
      </Alert>
    );
  if (q.isPending || recordId) return <Skeleton className="h-64" />;
  const a = q.data;
  const submit = async () => {
    if (!complaint.trim()) return setError('Enter the chief complaint.');
    setSaving(true);
    setError(null);
    try {
      const r = await emrApi.start({
        appointmentId,
        chiefComplaint: complaint.trim(),
        ...(symptoms.trim() ? { presentingSymptoms: symptoms.trim() } : {}),
      });
      router.replace(`/dashboard/records/${r.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };
  return (
    <>
      <PageHeader
        title={`Start consultation: ${a.patient.firstName} ${a.patient.lastName}`}
        description={
          <span>
            <span className="font-mono">{a.patient.mrn}</span> · {fmtTime(a.scheduledAt, tz)} ·{' '}
            {a.department.name}
            {a.reason ? ` · Booked for: ${a.reason}` : ''}
          </span>
        }
      />
      <Panel className="max-w-2xl">
        <form
          noValidate
          className="grid gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {a.status !== 'CONFIRMED' && (
            <Alert tone="warning">
              This appointment is {a.status.toLowerCase().replace('_', ' ')}. Only confirmed
              appointments can be started.
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Chief complaint" required>
            {(p) => (
              <Input
                id={p.id}
                maxLength={500}
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
              />
            )}
          </Field>
          <Field label="Presenting symptoms">
            {(p) => (
              <textarea
                id={p.id}
                className={textareaClass}
                maxLength={4000}
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={a.status !== 'CONFIRMED'}>
              Start consultation
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
