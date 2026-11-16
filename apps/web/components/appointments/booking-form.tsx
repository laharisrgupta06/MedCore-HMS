'use client';

import type { AppointmentType, Doctor, PatientSummary, Slot } from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import { Siren } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, Input, Select } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/forms';
import { addDays, fmtDate, fmtTime, localDate, zonedToUtc } from '@/lib/time';
import { appointmentsApi } from '@/services/appointments';
import { DoctorPicker, PatientPicker } from './pickers';
import { SlotPicker } from './slot-picker';

/**
 * Booking (APPT-001, APPT-004). Reception picks the patient and may book an emergency outside the
 * slots; patients book for themselves. The server re-checks every slot under a lock, so a slot
 * taken a moment ago comes back as a clear conflict and the times refresh.
 */
export function BookingForm({
  mode,
  tz,
  onBooked,
}: {
  mode: 'staff' | 'patient';
  tz: string;
  onBooked: () => void;
}) {
  const qc = useQueryClient();
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [type, setType] = useState<AppointmentType>('REGULAR');
  const [date, setDate] = useState(() => addDays(localDate(new Date(), tz), 1));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [emergencyTime, setEmergencyTime] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const emergency = type === 'EMERGENCY';

  const submit = async () => {
    setError(null);
    if (mode === 'staff' && !patient) return setError('Choose the patient.');
    if (!doctor) return setError('Choose a doctor.');
    let scheduledAt: string;
    if (emergency) {
      if (!emergencyTime) return setError('Enter the time the patient will be seen.');
      const dept = departmentId || doctor.departments[0]?.id;
      if (!dept)
        return setError('This doctor has no department. Add one on the Doctors page first.');
      const [h, m] = emergencyTime.split(':').map(Number) as [number, number];
      scheduledAt = zonedToUtc(localDate(new Date(), tz), h * 60 + m, tz).toISOString();
    } else {
      if (!slot) return setError('Choose a time.');
      scheduledAt = slot.start;
    }
    setSaving(true);
    try {
      const a = await appointmentsApi.book({
        doctorId: doctor.id,
        scheduledAt,
        ...(mode === 'staff' ? { patientId: patient!.id, type } : {}),
        ...(emergency ? { departmentId: departmentId || doctor.departments[0]!.id } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(
        `Booked ${fmtDate(a.scheduledAt, tz)} at ${fmtTime(a.scheduledAt, tz)} with Dr ${a.doctor.firstName} ${a.doctor.lastName}.`,
      );
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['slots', doctor.id] });
      onBooked();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiClientError && e.code === 'SLOT_UNAVAILABLE') {
        setSlot(null);
        void qc.invalidateQueries({ queryKey: ['slots', doctor.id] });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      {error && (
        <Alert tone="error" title="Could not book">
          {error}
        </Alert>
      )}
      {mode === 'staff' && (
        <>
          <FieldGroup label="Patient" required>
            <PatientPicker selected={patient} onSelect={setPatient} />
          </FieldGroup>
          <Field label="Appointment type">
            {(p) => (
              <Select
                id={p.id}
                aria-describedby={p.describedBy}
                value={type}
                onChange={(e) => setType(e.target.value as AppointmentType)}
              >
                <option value="REGULAR">Regular consultation</option>
                <option value="FOLLOW_UP">Follow-up</option>
                <option value="EMERGENCY">Emergency (seen today, outside the booking slots)</option>
              </Select>
            )}
          </Field>
        </>
      )}
      <FieldGroup label="Doctor" required>
        <DoctorPicker
          selected={doctor}
          onSelect={(d) => {
            setDoctor(d);
            setSlot(null);
            setDepartmentId('');
          }}
        />
      </FieldGroup>
      {doctor && emergency && (
        <div className="space-y-4 rounded-md border border-tomato-100 bg-tomato-50 p-4">
          <p className="flex items-center gap-2 font-medium text-tomato-700">
            <Siren className="size-4" aria-hidden="true" />
            Emergency booking
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Time today" required>
              {(p) => (
                <Input
                  id={p.id}
                  aria-describedby={p.describedBy}
                  type="time"
                  value={emergencyTime}
                  onChange={(e) => setEmergencyTime(e.target.value)}
                />
              )}
            </Field>
            {doctor.departments.length > 1 && (
              <Field label="Department">
                {(p) => (
                  <Select
                    id={p.id}
                    aria-describedby={p.describedBy}
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                  >
                    {doctor.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        </div>
      )}
      {doctor && !emergency && (
        <FieldGroup label="Time" required>
          <SlotPicker
            doctorId={doctor.id}
            date={date}
            onDateChange={(d) => {
              setDate(d);
              setSlot(null);
            }}
            value={slot?.start ?? null}
            onChange={setSlot}
            tz={tz}
          />
        </FieldGroup>
      )}
      <Field label="Reason for visit" hint="Optional. Helps the doctor prepare.">
        {(p) => (
          <textarea
            id={p.id}
            aria-describedby={p.describedBy}
            className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-body-sm"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant={emergency ? 'accent' : 'primary'} loading={saving}>
          {emergency
            ? 'Book emergency'
            : slot
              ? `Book ${fmtTime(slot.start, tz)}`
              : 'Book appointment'}
        </Button>
      </div>
    </form>
  );
}
