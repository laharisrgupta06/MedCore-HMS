'use client';

import { WEEKDAYS, type Doctor, type ScheduleExceptionType, type Weekday } from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FieldGroup, Input, Select } from '@/components/ui/field';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { fmtDateLong, localDate, useHospitalTz } from '@/lib/time';
import { availabilityApi } from '@/services/appointments';
import { doctorsApi } from '@/services/org';
import { useAuth } from '@/store/auth';
import { DoctorPicker } from './pickers';

const DAY: Record<Weekday, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};
const EXC: Record<ScheduleExceptionType, string> = {
  LEAVE: 'On leave (whole day)',
  BLOCKED: 'Blocked time',
  EXTRA_HOURS: 'Extra hours',
};

/** Weekly working hours and date exceptions (SCOPE-007, SCOPE-008). Doctors manage their own; admins any doctor's. */
export function AvailabilityView() {
  const role = useAuth((s) => s.me?.user.role);
  const tz = useHospitalTz();
  const self = useQuery({
    queryKey: ['doctor', 'me'],
    queryFn: doctorsApi.me,
    enabled: role === 'DOCTOR',
  });
  const [picked, setPicked] = useState<Doctor | null>(null);
  const doctor = role === 'DOCTOR' ? (self.data ?? null) : picked;
  return (
    <>
      <PageHeader
        title={role === 'DOCTOR' ? 'My availability' : 'Doctor availability'}
        description={`Patients can book only inside these hours. Times are in the hospital's time zone (${tz}).`}
      />
      {role !== 'DOCTOR' && (
        <div className="mb-6 sm:max-w-md">
          <FieldGroup label="Doctor">
            <DoctorPicker selected={picked} onSelect={setPicked} />
          </FieldGroup>
        </div>
      )}
      {self.error && (
        <Alert tone="error" title="Could not load your doctor profile">
          {errorMessage(self.error)}
        </Alert>
      )}
      {doctor ? (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <WeeklyHours doctor={doctor} />
          <Exceptions doctor={doctor} tz={tz} />
        </div>
      ) : role === 'DOCTOR' && self.isPending ? (
        <Skeleton className="h-64" />
      ) : role !== 'DOCTOR' ? (
        <Panel>
          <EmptyState icon={CalendarClock} title="Choose a doctor">
            Search above to see and change their working hours.
          </EmptyState>
        </Panel>
      ) : null}
    </>
  );
}

function WeeklyHours({ doctor }: { doctor: Doctor }) {
  const qc = useQueryClient();
  const key = ['schedules', doctor.id];
  const q = useQuery({ queryKey: key, queryFn: () => availabilityApi.schedules(doctor.id) });
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['slots', doctor.id] });
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Panel
      title="Weekly hours"
      actions={
        <Button size="compact" onClick={() => setAdding(true)}>
          <Plus />
          Add hours
        </Button>
      }
    >
      {q.error ? (
        <div className="p-5">
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        </div>
      ) : q.isPending ? (
        <div className="p-5">
          <Skeleton className="h-40" />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No working hours yet">
          Add the hours this doctor sees patients. Patients cannot book until there are some.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {WEEKDAYS.filter((d) => q.data.some((s) => s.weekday === d)).map((day) => (
            <li key={day} className="grid gap-2 px-5 py-3 sm:grid-cols-[8rem_1fr]">
              <span className="font-medium">{DAY[day]}</span>
              <ul className="space-y-2">
                {q.data
                  .filter((s) => s.weekday === day)
                  .sort((a, b) => a.startTime.localeCompare(b.startTime))
                  .map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">
                        {s.startTime} to {s.endTime}
                      </span>
                      <span className="text-body-sm text-ink-secondary">
                        {s.slotMinutes} min slots ·{' '}
                        {doctor.departments.find((d) => d.id === s.departmentId)?.name ??
                          'Department removed'}
                      </span>
                      {!s.isActive && <Badge>Paused</Badge>}
                      {s.validTo && <Badge tone="info">Until {s.validTo}</Badge>}
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() =>
                            void act(
                              () => availabilityApi.updateSchedule(s.id, { isActive: !s.isActive }),
                              s.isActive ? 'Hours paused.' : 'Hours resumed.',
                            )
                          }
                        >
                          {s.isActive ? 'Pause' : 'Resume'}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${DAY[day]} ${s.startTime} to ${s.endTime}`}
                          onClick={() =>
                            void act(
                              () => availabilityApi.removeSchedule(s.id),
                              'Hours removed. Booked appointments are kept.',
                            )
                          }
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddHours doctor={doctor} onClose={() => setAdding(false)} onDone={refresh} />}
    </Panel>
  );
}

function AddHours({
  doctor,
  onClose,
  onDone,
}: {
  doctor: Doctor;
  onClose: () => void;
  onDone: () => void;
}) {
  const tz = useHospitalTz();
  const [f, setF] = useState({
    weekday: 'MONDAY' as Weekday,
    startTime: '09:00',
    endTime: '13:00',
    slotMinutes: '15',
    departmentId: doctor.departments[0]?.id ?? '',
    validFrom: localDate(new Date(), tz),
    validTo: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (!f.departmentId)
      return setError('This doctor has no department. Add one on the Doctors page first.');
    if (f.endTime <= f.startTime) return setError('The end time must be after the start time.');
    setSaving(true);
    try {
      await availabilityApi.addSchedule(doctor.id, {
        ...f,
        slotMinutes: Number(f.slotMinutes),
        validTo: f.validTo || null,
      });
      toast.success(`${DAY[f.weekday]} ${f.startTime} to ${f.endTime} added.`);
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
      title="Add working hours"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Add hours
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Day" required>
          {(p) => (
            <Select
              id={p.id}
              aria-describedby={p.describedBy}
              value={f.weekday}
              onChange={set('weekday')}
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {DAY[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Department" required>
          {(p) => (
            <Select
              id={p.id}
              aria-describedby={p.describedBy}
              value={f.departmentId}
              onChange={set('departmentId')}
            >
              {doctor.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From" required>
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              type="time"
              value={f.startTime}
              onChange={set('startTime')}
            />
          )}
        </Field>
        <Field label="To" required>
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              type="time"
              value={f.endTime}
              onChange={set('endTime')}
            />
          )}
        </Field>
        <Field label="Slot length" required>
          {(p) => (
            <Select
              id={p.id}
              aria-describedby={p.describedBy}
              value={f.slotMinutes}
              onChange={set('slotMinutes')}
            >
              {[10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Starting" required>
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              type="date"
              value={f.validFrom}
              onChange={set('validFrom')}
            />
          )}
        </Field>
        <Field label="Ending" hint="Leave empty to repeat every week.">
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              type="date"
              value={f.validTo}
              min={f.validFrom}
              onChange={set('validTo')}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function Exceptions({ doctor, tz }: { doctor: Doctor; tz: string }) {
  const qc = useQueryClient();
  const today = localDate(new Date(), tz);
  const key = ['exceptions', doctor.id, today];
  const q = useQuery({
    queryKey: key,
    queryFn: () => availabilityApi.exceptions(doctor.id, today),
  });
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['exceptions', doctor.id] });
    void qc.invalidateQueries({ queryKey: ['slots', doctor.id] });
  };
  return (
    <Panel
      title="Leave and changes"
      actions={
        <Button size="compact" variant="secondary" onClick={() => setAdding(true)}>
          <Plus />
          Add
        </Button>
      }
    >
      {q.error ? (
        <div className="p-5">
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        </div>
      ) : q.isPending ? (
        <div className="p-5">
          <Skeleton className="h-32" />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No upcoming changes">
          Add leave, blocked time or extra hours for specific dates.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((x) => (
            <li key={x.id} className="flex items-start gap-3 px-5 py-3">
              <div className="flex-1">
                <p className="font-medium">{fmtDateLong(x.date, tz)}</p>
                <p className="text-body-sm text-ink-secondary">
                  {EXC[x.type]}
                  {x.startTime ? `, ${x.startTime} to ${x.endTime}` : ''}
                  {x.reason ? `. ${x.reason}` : ''}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${EXC[x.type].toLowerCase()} on ${x.date}`}
                onClick={async () => {
                  try {
                    await availabilityApi.removeException(x.id);
                    toast.success('Removed.');
                    refresh();
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddException
          doctor={doctor}
          today={today}
          onClose={() => setAdding(false)}
          onDone={refresh}
        />
      )}
    </Panel>
  );
}

function AddException({
  doctor,
  today,
  onClose,
  onDone,
}: {
  doctor: Doctor;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    date: today,
    type: 'LEAVE' as ScheduleExceptionType,
    startTime: '',
    endTime: '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const timed = f.type !== 'LEAVE';
  const submit = async () => {
    if (timed && (!f.startTime || !f.endTime)) return setError('Enter the start and end times.');
    if (timed && f.endTime <= f.startTime)
      return setError('The end time must be after the start time.');
    setSaving(true);
    try {
      await availabilityApi.addException(doctor.id, {
        date: f.date,
        type: f.type,
        ...(timed ? { startTime: f.startTime, endTime: f.endTime } : {}),
        reason: f.reason.trim() || null,
      });
      toast.success(
        'Saved. Existing bookings in that time are not cancelled automatically; check the appointments list.',
      );
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
      title="Add leave or a change"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" required>
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              type="date"
              min={today}
              value={f.date}
              onChange={set('date')}
            />
          )}
        </Field>
        <Field label="Type" required>
          {(p) => (
            <Select
              id={p.id}
              aria-describedby={p.describedBy}
              value={f.type}
              onChange={set('type')}
            >
              {(Object.keys(EXC) as ScheduleExceptionType[]).map((t) => (
                <option key={t} value={t}>
                  {EXC[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {timed && (
          <>
            <Field label="From" required>
              {(p) => (
                <Input
                  id={p.id}
                  aria-describedby={p.describedBy}
                  type="time"
                  value={f.startTime}
                  onChange={set('startTime')}
                />
              )}
            </Field>
            <Field label="To" required>
              {(p) => (
                <Input
                  id={p.id}
                  aria-describedby={p.describedBy}
                  type="time"
                  value={f.endTime}
                  onChange={set('endTime')}
                />
              )}
            </Field>
          </>
        )}
        <Field label="Note" hint="Optional." className="sm:col-span-2">
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              maxLength={200}
              value={f.reason}
              onChange={set('reason')}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
