'use client';

import {
  APPOINTMENT_TRANSITIONS,
  type Appointment,
  type AppointmentStatus,
  type Slot,
} from '@medcore/types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { fmtDate, fmtTime, localDate } from '@/lib/time';
import { appointmentsApi } from '@/services/appointments';
import { useAuth } from '@/store/auth';
import { SlotPicker } from './slot-picker';

const LABEL: Partial<Record<AppointmentStatus, string>> = {
  CONFIRMED: 'Confirm',
  IN_PROGRESS: 'Start consultation',
  COMPLETED: 'Complete',
  NO_SHOW: 'Did not attend',
};

/** Which status changes this role may make; mirrors the API rules, which still decide (APPT-003). */
export function allowedActions(
  a: Appointment,
  role: string,
  now = Date.now(),
): AppointmentStatus[] {
  const started = new Date(a.scheduledAt).getTime() <= now;
  return APPOINTMENT_TRANSITIONS[a.status].filter((s) => {
    if (role === 'PATIENT') return s === 'CANCELLED' && !started;
    if (s === 'IN_PROGRESS' || s === 'COMPLETED') return role === 'DOCTOR';
    if (s === 'NO_SHOW')
      return started && ['DOCTOR', 'RECEPTIONIST', 'HOSPITAL_ADMIN'].includes(role);
    return ['DOCTOR', 'RECEPTIONIST', 'HOSPITAL_ADMIN'].includes(role);
  });
}

export function canReschedule(a: Appointment, role: string, now = Date.now()) {
  return (
    ['RECEPTIONIST', 'PATIENT'].includes(role) &&
    ['PENDING', 'CONFIRMED'].includes(a.status) &&
    a.type !== 'EMERGENCY' &&
    new Date(a.scheduledAt).getTime() > now
  );
}

export function AppointmentActions({ appt, tz }: { appt: Appointment; tz: string }) {
  const role = useAuth((s) => s.me?.user.role) ?? '';
  const qc = useQueryClient();
  const [busy, setBusy] = useState<AppointmentStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [moving, setMoving] = useState(false);
  const actions = allowedActions(appt, role);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['slots', appt.doctor.id] });
  };
  const change = async (s: AppointmentStatus) => {
    setBusy(s);
    try {
      await appointmentsApi.setStatus(appt.id, s);
      toast.success(`Appointment for ${appt.patient.firstName} ${appt.patient.lastName} updated.`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {actions
        .filter((s) => s !== 'CANCELLED')
        .map((s) => (
          <Button
            key={s}
            size="compact"
            variant={s === 'NO_SHOW' ? 'secondary' : 'primary'}
            loading={busy === s}
            onClick={() => void change(s)}
          >
            {LABEL[s]}
          </Button>
        ))}
      {canReschedule(appt, role) && (
        <Button size="compact" variant="secondary" onClick={() => setMoving(true)}>
          Reschedule
        </Button>
      )}
      {actions.includes('CANCELLED') && (
        <Button size="compact" variant="ghost" onClick={() => setCancelling(true)}>
          Cancel
        </Button>
      )}
      {cancelling && (
        <CancelDialog appt={appt} tz={tz} onClose={() => setCancelling(false)} onDone={refresh} />
      )}
      {moving && (
        <RescheduleDialog appt={appt} tz={tz} onClose={() => setMoving(false)} onDone={refresh} />
      )}
    </div>
  );
}

function CancelDialog({
  appt,
  tz,
  onClose,
  onDone,
}: {
  appt: Appointment;
  tz: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return setError('Give a reason for the cancellation.');
    setSaving(true);
    try {
      await appointmentsApi.setStatus(appt.id, 'CANCELLED', reason.trim());
      toast.success('Appointment cancelled. The time is free for others to book.');
      onDone();
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
      onOpenChange={(o) => !o && onClose()}
      title="Cancel this appointment?"
      description={`${fmtDate(appt.scheduledAt, tz)} at ${fmtTime(appt.scheduledAt, tz)} with Dr ${appt.doctor.firstName} ${appt.doctor.lastName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep appointment
          </Button>
          <Button variant="destructive" loading={saving} onClick={() => void submit()}>
            Cancel appointment
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <Field label="Reason" required>
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
    </Dialog>
  );
}

function RescheduleDialog({
  appt,
  tz,
  onClose,
  onDone,
}: {
  appt: Appointment;
  tz: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(localDate(new Date(appt.scheduledAt), tz));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!slot) return setError('Choose a new time.');
    setSaving(true);
    try {
      await appointmentsApi.reschedule(appt.id, slot.start);
      toast.success(`Moved to ${fmtDate(slot.start, tz)} at ${fmtTime(slot.start, tz)}.`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSlot(null);
      onDone();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Choose a new time"
      description={`Currently ${fmtDate(appt.scheduledAt, tz)} at ${fmtTime(appt.scheduledAt, tz)} with Dr ${appt.doctor.firstName} ${appt.doctor.lastName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button loading={saving} disabled={!slot} onClick={() => void submit()}>
            Move appointment
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <SlotPicker
        doctorId={appt.doctor.id}
        date={date}
        onDateChange={(d) => {
          setDate(d);
          setSlot(null);
        }}
        value={slot?.start ?? null}
        onChange={setSlot}
        tz={tz}
        exclude={appt.scheduledAt}
      />
    </Dialog>
  );
}
