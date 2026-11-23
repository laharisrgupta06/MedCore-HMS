import { CHARGE_RECORDER, type ChargeRecorder } from '../billing/charges';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  APPOINTMENT_TRANSITIONS,
  AppointmentErrorCode,
  type Appointment as AppointmentView,
  type AppointmentStatus,
  type DoctorSchedule as ScheduleView,
  type ScheduleException as ExceptionView,
  type Slot,
  PATIENT_CANCEL_NOTICE_MS,
} from '@medcore/types';
import { Prisma, type DoctorSchedule, type ScheduleException } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import {
  hhmmToTime,
  localDate,
  minutesToHhmm,
  timeToMinutes,
  weekdayOf,
  zonedToUtc,
} from '../../common/time/zoned';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';
import type {
  BookDto,
  ExceptionDto,
  ListAppointmentsQuery,
  RescheduleDto,
  ScheduleDto,
  StatusDto,
  UpdateScheduleDto,
} from './scheduling.dto';
import { REMINDER_SCHEDULER, type ReminderScheduler } from './reminders';
import { DomainEvents } from '../../common/events/domain-events';
import { NotificationWriter, type StagedDeliveries } from '../notifications/notification.writer';
import { CONTENT } from '../notifications/notification-content';
import { appointmentPeople } from '../notifications/notification-recipients';

const SLOT_TTL_SECONDS = 60; // CACHE-002
const ACTIVE: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const bad = (code: string, message: string) => new BadRequestException({ code, message });

const toSchedule = (s: DoctorSchedule): ScheduleView => ({
  id: s.id,
  doctorId: s.doctorId,
  departmentId: s.departmentId,
  weekday: s.weekday,
  startTime: minutesToHhmm(timeToMinutes(s.startTime)),
  endTime: minutesToHhmm(timeToMinutes(s.endTime)),
  slotMinutes: s.slotMinutes,
  validFrom: dateOnly(s.validFrom),
  validTo: s.validTo ? dateOnly(s.validTo) : null,
  isActive: s.isActive,
});

const toException = (e: ScheduleException): ExceptionView => ({
  id: e.id,
  doctorId: e.doctorId,
  date: dateOnly(e.date),
  type: e.type,
  startTime: e.startTime ? minutesToHhmm(timeToMinutes(e.startTime)) : null,
  endTime: e.endTime ? minutesToHhmm(timeToMinutes(e.endTime)) : null,
  reason: e.reason,
});

const include = {
  doctor: { include: { user: true } },
  patient: { include: { user: true } },
  department: true,
  medicalRecord: { select: { id: true } },
} as const;
type Row = Prisma.AppointmentGetPayload<{ include: typeof include }>;

export const toAppointment = (a: Row): AppointmentView => ({
  id: a.id,
  scheduledAt: a.scheduledAt.toISOString(),
  endAt: a.endAt.toISOString(),
  status: a.status,
  type: a.type,
  reason: a.reason,
  cancellationReason: a.cancellationReason,
  doctor: {
    id: a.doctor.id,
    firstName: a.doctor.user.firstName,
    lastName: a.doctor.user.lastName,
    specialisation: a.doctor.specialisation,
  },
  patient: {
    id: a.patient.id,
    firstName: a.patient.user.firstName,
    lastName: a.patient.user.lastName,
    mrn: a.patient.mrn,
  },
  department: { id: a.department.id, name: a.department.name },
  medicalRecordId: a.medicalRecord?.id ?? null,
  createdAt: a.createdAt.toISOString(),
});

/** PostgreSQL exclusion violations (23P01) raised by the double-booking constraints (DEC-020). */
function overlapKind(e: unknown): 'doctor' | 'patient' | null {
  const text =
    e instanceof Error
      ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? '')}`
      : '';
  if (text.includes('appointments_doctor_no_overlap')) return 'doctor';
  if (text.includes('appointments_patient_no_overlap')) return 'patient';
  return null;
}

/**
 * Availability, slots and the booking engine (SCOPE-007..009, APPT-001..006).
 * Double booking is prevented twice: the booking transaction first takes a row lock on the doctor
 * (an UPDATE of the doctor row, so concurrent bookings for one doctor run one after another) and
 * re-checks overlaps; the database exclusion constraints are the final guarantee (TEST-012).
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly db: TenantPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REMINDER_SCHEDULER) private readonly reminders: ReminderScheduler,
    @Inject(CHARGE_RECORDER) private readonly charges: ChargeRecorder,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationWriter,
  ) {}

  // ------------------------------------------------------------------ access helpers

  private async doctorFor(actor: AuthPrincipal, doctorId: string, write: boolean) {
    const d = await this.db.client.doctor.findFirst({
      where: { id: doctorId, deletedAt: null },
      include: { departments: true, user: true },
    });
    if (!d) throw notFound('doctor');
    if (write && actor.role === 'DOCTOR' && d.userId !== actor.userId)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only manage your own availability.',
      });
    return d;
  }

  /** Hospitals are a global table, so always look the hospital up by id. */
  private async hospitalTz(
    hospitalId: string,
  ): Promise<{ tz: string; defaultSlotMinutes: number }> {
    const h = await this.db.client.hospital.findUnique({
      where: { id: hospitalId },
      select: { timezone: true, defaultSlotMinutes: true },
    });
    return { tz: h?.timezone ?? 'Asia/Kolkata', defaultSlotMinutes: h?.defaultSlotMinutes ?? 30 };
  }

  private async invalidateSlots(doctorId: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `slots:${doctorId}:*`,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  // ------------------------------------------------------------------ weekly schedules (APPT-001)

  async schedules(actor: AuthPrincipal, doctorId: string): Promise<ScheduleView[]> {
    await this.doctorFor(actor, doctorId, false);
    const rows = await this.db.client.doctorSchedule.findMany({
      where: { doctorId },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(toSchedule);
  }

  private checkWindow(start: number, end: number, slot: number) {
    if (end <= start) throw bad('VALIDATION_ERROR', 'The end time must be after the start time.');
    if (end - start < slot) throw bad('VALIDATION_ERROR', 'The window must fit at least one slot.');
  }

  async addSchedule(
    actor: AuthPrincipal,
    doctorId: string,
    dto: ScheduleDto,
  ): Promise<ScheduleView> {
    const d = await this.doctorFor(actor, doctorId, true);
    if (!d.departments.some((x) => x.departmentId === dto.departmentId))
      throw bad('VALIDATION_ERROR', 'The doctor does not work in this department.');
    const start = timeToMinutes(hhmmToTime(dto.startTime));
    const end = timeToMinutes(hhmmToTime(dto.endTime));
    this.checkWindow(start, end, dto.slotMinutes);
    if (dto.validTo && dto.validTo < dto.validFrom)
      throw bad('VALIDATION_ERROR', 'validTo must not be before validFrom.');
    const overlapping = (
      await this.db.client.doctorSchedule.findMany({
        where: { doctorId, weekday: dto.weekday, isActive: true },
      })
    ).filter(
      (s) =>
        timeToMinutes(s.startTime) < end &&
        start < timeToMinutes(s.endTime) &&
        (!s.validTo || dateOnly(s.validTo) >= dto.validFrom) &&
        (!dto.validTo || dateOnly(s.validFrom) <= dto.validTo),
    );
    if (overlapping.length)
      throw new ConflictException({
        code: 'SCHEDULE_OVERLAP',
        message: 'This window overlaps another schedule on the same day.',
      });
    const s = await this.db.client.doctorSchedule.create({
      data: {
        hospitalId: d.hospitalId,
        doctorId,
        departmentId: dto.departmentId,
        weekday: dto.weekday,
        startTime: hhmmToTime(dto.startTime),
        endTime: hhmmToTime(dto.endTime),
        slotMinutes: dto.slotMinutes,
        validFrom: new Date(`${dto.validFrom}T00:00:00Z`),
        validTo: dto.validTo ? new Date(`${dto.validTo}T00:00:00Z`) : null,
      },
    });
    await this.invalidateSlots(doctorId);
    return toSchedule(s);
  }

  async updateSchedule(
    actor: AuthPrincipal,
    id: string,
    dto: UpdateScheduleDto,
  ): Promise<ScheduleView> {
    const s = await this.db.client.doctorSchedule.findFirst({ where: { id } });
    if (!s) throw notFound('schedule');
    await this.doctorFor(actor, s.doctorId, true);
    const u = await this.db.client.doctorSchedule.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.validTo !== undefined
          ? { validTo: dto.validTo ? new Date(`${dto.validTo}T00:00:00Z`) : null }
          : {}),
      },
    });
    await this.invalidateSlots(s.doctorId);
    return toSchedule(u);
  }

  async removeSchedule(actor: AuthPrincipal, id: string): Promise<{ id: string; deleted: true }> {
    const s = await this.db.client.doctorSchedule.findFirst({ where: { id } });
    if (!s) throw notFound('schedule');
    await this.doctorFor(actor, s.doctorId, true);
    await this.db.client.doctorSchedule.delete({ where: { id } });
    await this.invalidateSlots(s.doctorId);
    return { id, deleted: true };
  }

  // ------------------------------------------------------------------ exceptions (leave, blocks, extra hours)

  async exceptions(
    actor: AuthPrincipal,
    doctorId: string,
    from?: string,
  ): Promise<ExceptionView[]> {
    await this.doctorFor(actor, doctorId, false);
    const rows = await this.db.client.scheduleException.findMany({
      where: { doctorId, ...(from ? { date: { gte: new Date(`${from}T00:00:00Z`) } } : {}) },
      orderBy: { date: 'asc' },
    });
    return rows.map(toException);
  }

  async addException(
    actor: AuthPrincipal,
    doctorId: string,
    dto: ExceptionDto,
  ): Promise<ExceptionView> {
    const d = await this.doctorFor(actor, doctorId, true);
    const hasTimes = Boolean(dto.startTime && dto.endTime);
    if (Boolean(dto.startTime) !== Boolean(dto.endTime))
      throw bad('VALIDATION_ERROR', 'Give both start and end time, or neither for the whole day.');
    if (dto.type === 'EXTRA_HOURS' && !hasTimes)
      throw bad('VALIDATION_ERROR', 'Extra hours need a start and end time.');
    if (
      hasTimes &&
      timeToMinutes(hhmmToTime(dto.endTime!)) <= timeToMinutes(hhmmToTime(dto.startTime!))
    )
      throw bad('VALIDATION_ERROR', 'The end time must be after the start time.');
    const e = await this.db.client.scheduleException.create({
      data: {
        hospitalId: d.hospitalId,
        doctorId,
        date: new Date(`${dto.date}T00:00:00Z`),
        type: dto.type,
        startTime: hasTimes ? hhmmToTime(dto.startTime!) : null,
        endTime: hasTimes ? hhmmToTime(dto.endTime!) : null,
        reason: dto.reason ?? null,
      },
    });
    await this.invalidateSlots(doctorId);
    return toException(e);
  }

  async removeException(actor: AuthPrincipal, id: string): Promise<{ id: string; deleted: true }> {
    const e = await this.db.client.scheduleException.findFirst({ where: { id } });
    if (!e) throw notFound('exception');
    await this.doctorFor(actor, e.doctorId, true);
    await this.db.client.scheduleException.delete({ where: { id } });
    await this.invalidateSlots(e.doctorId);
    return { id, deleted: true };
  }

  // ------------------------------------------------------------------ slots (cached 60 s)

  /** Slot templates for one local date, before checking existing appointments. */
  private async template(
    doctorId: string,
    date: string,
  ): Promise<{ start: Date; end: Date; departmentId: string }[]> {
    const doctor = await this.db.client.doctor.findFirst({
      where: { id: doctorId },
      include: { departments: true },
    });
    if (!doctor) return [];
    const { tz, defaultSlotMinutes } = await this.hospitalTz(doctor.hospitalId);
    const day = new Date(`${date}T00:00:00Z`);
    const [schedules, exceptions] = await Promise.all([
      this.db.client.doctorSchedule.findMany({
        where: { doctorId, weekday: weekdayOf(date), isActive: true },
      }),
      this.db.client.scheduleException.findMany({ where: { doctorId, date: day } }),
    ]);
    const windows: { start: number; end: number; slot: number; departmentId: string }[] = schedules
      .filter((s) => dateOnly(s.validFrom) <= date && (!s.validTo || dateOnly(s.validTo) >= date))
      .map((s) => ({
        start: timeToMinutes(s.startTime),
        end: timeToMinutes(s.endTime),
        slot: s.slotMinutes,
        departmentId: s.departmentId,
      }));
    const fallbackDept = schedules[0]?.departmentId ?? doctor.departments[0]?.departmentId;
    for (const e of exceptions.filter(
      (x) => x.type === 'EXTRA_HOURS' && x.startTime && x.endTime,
    )) {
      if (fallbackDept)
        windows.push({
          start: timeToMinutes(e.startTime!),
          end: timeToMinutes(e.endTime!),
          slot: defaultSlotMinutes,
          departmentId: fallbackDept,
        });
    }
    const blocks = exceptions
      .filter((x) => x.type !== 'EXTRA_HOURS')
      .map(
        (x) =>
          (x.startTime && x.endTime
            ? [timeToMinutes(x.startTime), timeToMinutes(x.endTime)]
            : [0, 24 * 60]) as [number, number],
      );
    const out: { start: Date; end: Date; departmentId: string }[] = [];
    for (const w of windows) {
      for (let m = w.start; m + w.slot <= w.end; m += w.slot) {
        if (blocks.some(([bs, be]) => m < be && bs < m + w.slot)) continue;
        out.push({
          start: zonedToUtc(date, m, tz),
          end: zonedToUtc(date, m + w.slot, tz),
          departmentId: w.departmentId,
        });
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async slots(actor: AuthPrincipal, doctorId: string, date: string): Promise<Slot[]> {
    await this.doctorFor(actor, doctorId, false);
    const key = `slots:${doctorId}:${date}`;
    const cached = await this.redis.get(key);
    let slots: Slot[];
    if (cached) slots = JSON.parse(cached) as Slot[];
    else {
      const tmpl = await this.template(doctorId, date);
      const busy = tmpl.length
        ? await this.db.client.appointment.findMany({
            where: {
              doctorId,
              deletedAt: null,
              status: { in: ACTIVE },
              type: { not: 'EMERGENCY' },
              scheduledAt: { lt: tmpl.at(-1)!.end },
              endAt: { gt: tmpl[0]!.start },
            },
            select: { scheduledAt: true, endAt: true },
          })
        : [];
      slots = tmpl.map((t) => ({
        start: t.start.toISOString(),
        end: t.end.toISOString(),
        departmentId: t.departmentId,
        available: !busy.some((b) => b.scheduledAt < t.end && t.start < b.endAt),
      }));
      await this.redis.set(key, JSON.stringify(slots), 'EX', SLOT_TTL_SECONDS);
    }
    const now = Date.now();
    return slots.map((s) => ({
      ...s,
      available: s.available && new Date(s.start).getTime() > now,
    }));
  }

  // ------------------------------------------------------------------ appointments

  private async patientFor(actor: AuthPrincipal, patientId: string | undefined) {
    if (actor.role === 'PATIENT') {
      const p = await this.db.client.patient.findFirst({
        where: { userId: actor.userId, deletedAt: null },
      });
      if (!p) throw notFound('patient');
      if (patientId && patientId !== p.id) throw notFound('patient');
      return p;
    }
    if (!patientId) throw bad('VALIDATION_ERROR', 'Choose the patient.');
    const p = await this.db.client.patient.findFirst({ where: { id: patientId, deletedAt: null } });
    if (!p) throw notFound('patient');
    return p;
  }

  /** Validates that [start, end) is a bookable slot (or an emergency) and returns its department and end. */
  private async resolveSlot(
    doctorId: string,
    start: Date,
    emergency: boolean,
    departmentId?: string,
  ) {
    const doctor = await this.db.client.doctor.findFirst({
      where: { id: doctorId, deletedAt: null },
      include: { departments: true, user: true },
    });
    if (!doctor || !doctor.user.isActive) throw notFound('doctor');
    if (emergency) {
      const dept = departmentId ?? doctor.departments[0]?.departmentId;
      if (!dept || !doctor.departments.some((d) => d.departmentId === dept))
        throw bad('VALIDATION_ERROR', 'Choose one of the doctor’s departments.');
      const { defaultSlotMinutes } = await this.hospitalTz(doctor.hospitalId);
      if (start.getTime() < Date.now() - 15 * 60_000)
        throw bad(AppointmentErrorCode.IN_THE_PAST, 'Emergency appointments start now or later.');
      return { departmentId: dept, end: new Date(start.getTime() + defaultSlotMinutes * 60_000) };
    }
    if (start.getTime() <= Date.now())
      throw bad(
        AppointmentErrorCode.IN_THE_PAST,
        'This time has already passed. Choose a later slot.',
      );
    const { tz } = await this.hospitalTz(doctor.hospitalId);
    const slot = (await this.template(doctorId, localDate(start, tz))).find(
      (s) => s.start.getTime() === start.getTime(),
    );
    if (!slot)
      throw bad(
        AppointmentErrorCode.NOT_A_SLOT,
        'The doctor is not available at this time. Choose one of the listed slots.',
      );
    return { departmentId: slot.departmentId, end: slot.end };
  }

  private overlapError(kind: 'doctor' | 'patient'): ConflictException {
    return kind === 'doctor'
      ? new ConflictException({
          code: AppointmentErrorCode.SLOT_UNAVAILABLE,
          message: 'This slot was just booked by another patient.',
        })
      : new ConflictException({
          code: AppointmentErrorCode.PATIENT_DOUBLE_BOOKED,
          message: 'The patient already has an appointment at this time.',
        });
  }

  /** Locks the doctor row, re-checks overlaps and writes; the exclusion constraints back it up. */
  private async writeLocked<T>(
    doctorId: string,
    window: { start: Date; end: Date; emergency: boolean; patientId: string; ignoreId?: string },
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.client.$transaction(async (tx) => {
        await tx.doctor.update({ where: { id: doctorId }, data: { updatedAt: new Date() } }); // row lock
        const overlap = {
          deletedAt: null,
          status: { in: ACTIVE },
          scheduledAt: { lt: window.end },
          endAt: { gt: window.start },
          ...(window.ignoreId ? { id: { not: window.ignoreId } } : {}),
        };
        if (
          !window.emergency &&
          (await tx.appointment.count({
            where: { ...overlap, doctorId, type: { not: 'EMERGENCY' } },
          }))
        )
          throw this.overlapError('doctor');
        if (await tx.appointment.count({ where: { ...overlap, patientId: window.patientId } }))
          throw this.overlapError('patient');
        return write(tx);
      });
    } catch (e) {
      const kind = overlapKind(e);
      if (kind) throw this.overlapError(kind);
      throw e;
    }
  }

  async book(actor: AuthPrincipal, dto: BookDto): Promise<AppointmentView> {
    let staged: StagedDeliveries | undefined;
    const type = dto.type ?? 'REGULAR';
    if (type === 'EMERGENCY' && actor.role !== 'RECEPTIONIST')
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Emergency appointments are booked by reception.',
      });
    const patient = await this.patientFor(actor, dto.patientId);
    const start = new Date(dto.scheduledAt);
    const { departmentId, end } = await this.resolveSlot(
      dto.doctorId,
      start,
      type === 'EMERGENCY',
      dto.departmentId,
    );
    const created = await this.writeLocked(
      dto.doctorId,
      { start, end, emergency: type === 'EMERGENCY', patientId: patient.id },
      async (tx) => {
        const row = await tx.appointment.create({
          data: {
            hospitalId: patient.hospitalId,
            doctorId: dto.doctorId,
            patientId: patient.id,
            departmentId,
            scheduledAt: start,
            endAt: end,
            type,
            // Emergencies are seen immediately; other bookings wait for confirmation.
            status: type === 'EMERGENCY' ? 'CONFIRMED' : 'PENDING',
            reason: dto.reason ?? null,
            createdById: actor.userId,
          },
        });
        // NOTIF-009: the doctor hears about an emergency booking, in the booking's transaction.
        if (type === 'EMERGENCY') {
          const people = await appointmentPeople(tx, row.id);
          if (people)
            staged = await this.notifications.stage(tx, {
              hospitalId: patient.hospitalId,
              recipientIds: [people.doctor],
              content: CONTENT.appointmentEmergency(),
              entityType: 'Appointment',
              entityId: row.id,
            });
        }
        return row;
      },
    );
    await this.notifications.dispatch(staged);
    await this.invalidateSlots(dto.doctorId);
    if (type !== 'EMERGENCY') await this.reminders.schedule(created.id, start);
    // NOTIF-009: the doctor hears about an emergency booking at once.
    else
      await this.events.publish({
        type: 'appointment.emergency',
        hospitalId: patient.hospitalId,
        appointmentId: created.id,
      });
    return this.get(actor, created.id);
  }

  async list(
    actor: AuthPrincipal,
    q: ListAppointmentsQuery,
  ): Promise<PaginatedResult<AppointmentView>> {
    let patientId = q.patientId;
    let doctorId = q.doctorId;
    if (actor.role === 'PATIENT') patientId = (await this.patientFor(actor, undefined)).id;
    if (actor.role === 'DOCTOR') {
      const own = await this.db.client.doctor.findFirst({ where: { userId: actor.userId } });
      doctorId = own?.id ?? '00000000-0000-4000-8000-000000000000';
    }
    const where: Prisma.AppointmentWhereInput = {
      deletedAt: null,
      ...(patientId ? { patientId } : {}),
      ...(doctorId ? { doctorId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to
        ? {
            scheduledAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.appointment.findMany({
        where,
        include,
        orderBy: [{ scheduledAt: q.order === 'desc' ? 'desc' : 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.appointment.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toAppointment), total, q.page, q.limit);
  }

  async get(actor: AuthPrincipal, id: string): Promise<AppointmentView> {
    const a = await this.db.client.appointment.findFirst({
      where: { id, deletedAt: null },
      include,
    });
    if (!a) throw notFound('appointment');
    if (actor.role === 'PATIENT' && a.patient.userId !== actor.userId)
      throw notFound('appointment');
    if (actor.role === 'DOCTOR' && a.doctor.userId !== actor.userId) throw notFound('appointment');
    return toAppointment(a);
  }

  /** Status lifecycle (APPT-003) with who may make each change. */
  async setStatus(actor: AuthPrincipal, id: string, dto: StatusDto): Promise<AppointmentView> {
    const current = await this.get(actor, id);
    if (!APPOINTMENT_TRANSITIONS[current.status].includes(dto.status))
      throw bad(
        AppointmentErrorCode.INVALID_TRANSITION,
        `An appointment that is ${current.status.toLowerCase().replace('_', ' ')} cannot become ${dto.status.toLowerCase().replace('_', ' ')}.`,
      );
    const clinical = dto.status === 'IN_PROGRESS' || dto.status === 'COMPLETED';
    if (clinical && actor.role !== 'DOCTOR')
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the doctor starts and completes a consultation.',
      });
    if (actor.role === 'PATIENT') {
      if (dto.status !== 'CANCELLED')
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Patients can only cancel their appointments.',
        });
      const left = new Date(current.scheduledAt).getTime() - Date.now();
      if (left <= 0)
        throw bad(
          AppointmentErrorCode.IN_THE_PAST,
          'This appointment has already started. Contact the hospital.',
        );
      if (left < PATIENT_CANCEL_NOTICE_MS)
        throw bad(
          AppointmentErrorCode.CANCELLATION_TOO_LATE,
          'Appointments can be cancelled online up to 2 hours before the start. Please call the hospital.',
        );
    }
    if (dto.status === 'NO_SHOW' && new Date(current.scheduledAt).getTime() > Date.now())
      throw bad(
        AppointmentErrorCode.INVALID_TRANSITION,
        'A patient can be marked as not attending only after the appointment time.',
      );
    if (dto.status === 'CANCELLED' && !dto.reason)
      throw bad('VALIDATION_ERROR', 'Give a reason for the cancellation.');
    // EMR-001: the consultation starts through POST /medical-records, which creates the record.
    if (dto.status === 'IN_PROGRESS')
      throw bad(
        'START_FROM_ENCOUNTER',
        'Start the consultation from the encounter screen so its medical record is created.',
      );
    let staged: StagedDeliveries | undefined;
    await this.db.client.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === 'CANCELLED' ? { cancellationReason: dto.reason } : {}),
        },
      });
      // Completing the consultation closes its record; later changes are addenda (EMR-002).
      if (dto.status === 'COMPLETED' && current.medicalRecordId)
        await tx.medicalRecord.update({
          where: { id: current.medicalRecordId },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      // Q4 A: the consultation is charged when it is completed, in the same transaction.
      if (dto.status === 'COMPLETED')
        await this.charges.charge(tx, actor, { kind: 'CONSULTATION', appointmentId: id });
      // NOTIF-002 and DEC-063: written with the status change, so both commit or neither does.
      if (dto.status === 'CONFIRMED' || dto.status === 'CANCELLED') {
        const people = await appointmentPeople(tx, id);
        if (people)
          staged = await this.notifications.stage(tx, {
            hospitalId: actor.hospitalId!,
            recipientIds: [people.patient],
            content:
              dto.status === 'CONFIRMED'
                ? CONTENT.appointmentConfirmed()
                : CONTENT.appointmentCancelled(),
            entityType: 'Appointment',
            entityId: id,
          });
      }
    });
    await this.notifications.dispatch(staged);
    if (dto.status === 'CANCELLED' || dto.status === 'NO_SHOW') {
      await this.reminders.cancel(id);
      await this.invalidateSlots(current.doctor.id);
    }
    // NOTIF-002 and DEC-063, after the change has committed.
    if (dto.status === 'CONFIRMED' || dto.status === 'CANCELLED')
      await this.events.publish({
        type: dto.status === 'CONFIRMED' ? 'appointment.confirmed' : 'appointment.cancelled',
        hospitalId: actor.hospitalId!,
        appointmentId: id,
      });
    return this.get(actor, id);
  }

  async reschedule(actor: AuthPrincipal, id: string, dto: RescheduleDto): Promise<AppointmentView> {
    let staged: StagedDeliveries | undefined;
    const current = await this.get(actor, id);
    if (!['PENDING', 'CONFIRMED'].includes(current.status))
      throw bad(
        AppointmentErrorCode.INVALID_TRANSITION,
        'Only upcoming appointments can be rescheduled.',
      );
    if (current.type === 'EMERGENCY')
      throw bad(
        AppointmentErrorCode.INVALID_TRANSITION,
        'Emergency appointments are not rescheduled.',
      );
    const start = new Date(dto.scheduledAt);
    const { departmentId, end } = await this.resolveSlot(current.doctor.id, start, false);
    await this.writeLocked(
      current.doctor.id,
      { start, end, emergency: false, patientId: current.patient.id, ignoreId: id },
      async (tx) => {
        await tx.appointment.update({
          where: { id },
          data: { scheduledAt: start, endAt: end, departmentId, status: 'PENDING' },
        });
        // DEC-063, in the same transaction as the move.
        const people = await appointmentPeople(tx, id);
        staged = await this.notifications.stage(tx, {
          hospitalId: actor.hospitalId!,
          recipientIds: people ? [people.patient] : [],
          content: CONTENT.appointmentRescheduled(),
          entityType: 'Appointment',
          entityId: id,
        });
      },
    );
    await this.notifications.dispatch(staged);
    await this.invalidateSlots(current.doctor.id);
    await this.reminders.schedule(id, start);
    await this.events.publish({
      type: 'appointment.rescheduled',
      hospitalId: actor.hospitalId!,
      appointmentId: id,
      scheduledAt: start.toISOString(),
    });
    return this.get(actor, id);
  }
}
