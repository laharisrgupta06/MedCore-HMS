import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { zonedToUtc } from '../../common/time/zoned';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { EmrModule } from '../emr/emr.module';
import { SchedulingModule } from './appointments.module';

const CSRF = 'a'.repeat(43);
const TZ = 'Asia/Kolkata';

/** A Monday at least three days ahead, as a hospital-local date. */
function nextMonday(): string {
  const d = new Date(Date.now() + 3 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return zonedToUtc(date, h * 60 + m, TZ).toISOString();
};

describe('Phase 3: availability and appointments (in-memory Prisma)', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let h: Hospital;
  let dept: string;
  let otherDept: string;
  let doctorUser: User;
  let doctor2User: User;
  let doctorId: string;
  let doctor2Id: string;
  let reception: User;
  let patientUser: User;
  let patient2User: User;
  let patientId: string;
  let patient2Id: string;
  const monday = nextMonday();

  beforeEach(async () => {
    t = await createAuthTestApp({}, { modules: [SchedulingModule, EmrModule] });
    app = t.app;
    h = t.prisma.addHospital({ timezone: TZ, defaultSlotMinutes: 20 });
    const push = (model: string, row: Record<string, unknown>) => {
      const r = {
        id: crypto.randomUUID(),
        hospitalId: h.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      };
      t.prisma.rows(model).push(r);
      return r.id as string;
    };
    dept = push('Department', { name: 'General', description: null });
    otherDept = push('Department', { name: 'Other', description: null });
    doctorUser = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dee' });
    doctor2User = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dan' });
    doctorId = push('Doctor', {
      userId: doctorUser.id,
      registrationNumber: 'R1',
      specialisation: 'General',
      qualification: null,
      consultationFee: 500,
      bio: null,
      signatureFileId: null,
      deletedAt: null,
    });
    doctor2Id = push('Doctor', {
      userId: doctor2User.id,
      registrationNumber: 'R2',
      specialisation: 'General',
      qualification: null,
      consultationFee: 500,
      bio: null,
      signatureFileId: null,
      deletedAt: null,
    });
    push('DoctorDepartment', { doctorId, departmentId: dept });
    push('DoctorDepartment', { doctorId: doctor2Id, departmentId: dept });
    reception = t.prisma.addUser({ role: 'RECEPTIONIST', hospitalId: h.id });
    patientUser = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pat' });
    patient2User = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pia' });
    patientId = push('Patient', {
      userId: patientUser.id,
      mrn: 'MRN-1',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'OTHER',
      deletedAt: null,
    });
    patient2Id = push('Patient', {
      userId: patient2User.id,
      mrn: 'MRN-2',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'OTHER',
      deletedAt: null,
    });
  });
  afterEach(() => app.close());

  const as = async (u: User) => {
    const token = await t.tokenFor(u);
    const auth = { Authorization: `Bearer ${token}` };
    const write = { ...auth, Cookie: `${AUTH_COOKIES.csrf}=${CSRF}`, [CSRF_HEADER]: CSRF };
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set(auth),
      post: (url: string, body: object = {}) => request(server).post(url).set(write).send(body),
      patch: (url: string, body: object) => request(server).patch(url).set(write).send(body),
      del: (url: string) => request(server).delete(url).set(write),
    };
  };
  const morning = (d: Awaited<ReturnType<typeof as>>, id = doctorId) =>
    d.post(`/api/doctors/${id}/schedules`, {
      departmentId: dept,
      weekday: 'MONDAY',
      startTime: '09:00',
      endTime: '11:00',
      slotMinutes: 30,
      validFrom: '2020-01-01',
    });

  it('doctors manage their own weekly windows; overlapping windows and foreign departments are refused', async () => {
    const doc = await as(doctorUser);
    const s = (await morning(doc).expect(201)).body.data;
    expect(s).toMatchObject({
      weekday: 'MONDAY',
      startTime: '09:00',
      endTime: '11:00',
      slotMinutes: 30,
    });
    expect(
      (
        await doc
          .post(`/api/doctors/${doctorId}/schedules`, {
            departmentId: dept,
            weekday: 'MONDAY',
            startTime: '10:30',
            endTime: '12:00',
            slotMinutes: 30,
            validFrom: '2020-01-01',
          })
          .expect(409)
      ).body.error.code,
    ).toBe('SCHEDULE_OVERLAP');
    await doc
      .post(`/api/doctors/${doctorId}/schedules`, {
        departmentId: otherDept,
        weekday: 'TUESDAY',
        startTime: '09:00',
        endTime: '10:00',
        slotMinutes: 30,
        validFrom: '2020-01-01',
      })
      .expect(400);
    await doc
      .post(`/api/doctors/${doctorId}/schedules`, {
        departmentId: dept,
        weekday: 'TUESDAY',
        startTime: '10:00',
        endTime: '09:00',
        slotMinutes: 30,
        validFrom: '2020-01-01',
      })
      .expect(400);
    await morning(doc, doctor2Id).expect(403);
  });

  it('builds slots in hospital-local time, honouring leave, blocks and extra hours', async () => {
    await morning(await as(doctorUser)).expect(201);
    const pat = await as(patientUser);
    const slots = (await pat.get(`/api/doctors/${doctorId}/slots?date=${monday}`).expect(200)).body
      .data;
    expect(slots.map((s: { start: string }) => s.start)).toEqual(
      ['09:00', '09:30', '10:00', '10:30'].map((x) => at(monday, x)),
    );
    expect(
      slots.every(
        (s: { available: boolean; departmentId: string }) => s.available && s.departmentId === dept,
      ),
    ).toBe(true);

    const doc = await as(doctorUser);
    await doc
      .post(`/api/doctors/${doctorId}/exceptions`, {
        date: monday,
        type: 'BLOCKED',
        startTime: '09:30',
        endTime: '10:30',
      })
      .expect(201);
    await doc
      .post(`/api/doctors/${doctorId}/exceptions`, {
        date: monday,
        type: 'EXTRA_HOURS',
        startTime: '16:00',
        endTime: '16:40',
      })
      .expect(201);
    const after = (
      await pat.get(`/api/doctors/${doctorId}/slots?date=${monday}`).expect(200)
    ).body.data.map((s: { start: string }) => s.start);
    expect(after).toEqual(['09:00', '10:30', '16:00', '16:20'].map((x) => at(monday, x)));

    await doc
      .post(`/api/doctors/${doctorId}/exceptions`, { date: monday, type: 'LEAVE' })
      .expect(201);
    expect(
      (await pat.get(`/api/doctors/${doctorId}/slots?date=${monday}`).expect(200)).body.data,
    ).toEqual([]);
  });

  describe('booking', () => {
    beforeEach(async () => {
      await morning(await as(doctorUser)).expect(201);
      await morning(await as(doctor2User), doctor2Id).expect(201);
    });

    it('a patient books a slot; it becomes unavailable and reminders are scheduled', async () => {
      const pat = await as(patientUser);
      const res = await pat
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:30'), reason: 'Cough' })
        .expect(201);
      expect(res.body.data).toMatchObject({
        status: 'PENDING',
        type: 'REGULAR',
        department: { id: dept },
        patient: { id: patientId },
        scheduledAt: at(monday, '09:30'),
        endAt: at(monday, '10:00'),
      });
      expect(t.reminders).toEqual([{ id: res.body.data.id, at: at(monday, '09:30') }]);
      const slots = (await pat.get(`/api/doctors/${doctorId}/slots?date=${monday}`)).body.data;
      expect(slots.find((s: { start: string }) => s.start === at(monday, '09:30')).available).toBe(
        false,
      );
    });

    it('refuses times that are not slots, past times and taken slots (SLOT_UNAVAILABLE)', async () => {
      const pat = await as(patientUser);
      expect(
        (
          await pat
            .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:10') })
            .expect(400)
        ).body.error.code,
      ).toBe('NOT_A_SLOT');
      expect(
        (
          await pat
            .post('/api/appointments', {
              doctorId,
              scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
            })
            .expect(400)
        ).body.error.code,
      ).toBe('IN_THE_PAST');
      await pat
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:00') })
        .expect(201);
      const taken = await (
        await as(patient2User)
      )
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:00') })
        .expect(409);
      expect(taken.body.error).toEqual({
        code: 'SLOT_UNAVAILABLE',
        message: 'This slot was just booked by another patient.',
      });
    });

    it('a patient cannot hold two appointments at the same time across doctors (APPT-002)', async () => {
      const pat = await as(patientUser);
      await pat
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '10:00') })
        .expect(201);
      expect(
        (
          await pat
            .post('/api/appointments', { doctorId: doctor2Id, scheduledAt: at(monday, '10:00') })
            .expect(409)
        ).body.error.code,
      ).toBe('PATIENT_DOUBLE_BOOKED');
    });

    it('of two simultaneous bookings for one slot exactly one succeeds (TEST-012)', async () => {
      const [a, b] = await Promise.all([as(patientUser), as(patient2User)]);
      const results = await Promise.all([
        a.post('/api/appointments', { doctorId, scheduledAt: at(monday, '10:30') }),
        b.post('/api/appointments', { doctorId, scheduledAt: at(monday, '10:30') }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(t.prisma.rows('Appointment').filter((r) => r.doctorId === doctorId)).toHaveLength(1);
    });

    it('reception books for a patient and books emergencies outside slots (APPT-004)', async () => {
      const rec = await as(reception);
      await rec
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:00') })
        .expect(400);
      await rec
        .post('/api/appointments', { doctorId, patientId, scheduledAt: at(monday, '09:00') })
        .expect(201);
      const soon = new Date(Date.now() + 5 * 60_000).toISOString();
      const em = await rec
        .post('/api/appointments', {
          doctorId,
          patientId: patient2Id,
          scheduledAt: soon,
          type: 'EMERGENCY',
          departmentId: dept,
        })
        .expect(201);
      expect(em.body.data).toMatchObject({ type: 'EMERGENCY', status: 'CONFIRMED' });
      expect(new Date(em.body.data.endAt).getTime() - new Date(soon).getTime()).toBe(20 * 60_000);
      expect(t.reminders.some((r) => r.id === em.body.data.id)).toBe(false);
      await (
        await as(patientUser)
      )
        .post('/api/appointments', { doctorId, scheduledAt: soon, type: 'EMERGENCY' })
        .expect(403);
    });
  });

  describe('status lifecycle and rescheduling', () => {
    let apptId: string;
    beforeEach(async () => {
      await morning(await as(doctorUser)).expect(201);
      apptId = (
        await (
          await as(patientUser)
        )
          .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:00') })
          .expect(201)
      ).body.data.id;
    });

    it('follows PENDING → CONFIRMED → IN_PROGRESS → COMPLETED with the right roles', async () => {
      const rec = await as(reception);
      const doc = await as(doctorUser);
      expect(
        (
          await rec
            .patch(`/api/appointments/${apptId}/status`, { status: 'IN_PROGRESS' })
            .expect(400)
        ).body.error.code,
      ).toBe('INVALID_TRANSITION');
      await rec.patch(`/api/appointments/${apptId}/status`, { status: 'CONFIRMED' }).expect(200);
      await rec.patch(`/api/appointments/${apptId}/status`, { status: 'IN_PROGRESS' }).expect(403);
      await (
        await as(doctor2User)
      )
        .patch(`/api/appointments/${apptId}/status`, { status: 'IN_PROGRESS' })
        .expect(404);
      // Phase 4 (EMR-001): the consultation starts through the encounter, which creates the record.
      expect(
        (
          await doc
            .patch(`/api/appointments/${apptId}/status`, { status: 'IN_PROGRESS' })
            .expect(400)
        ).body.error.code,
      ).toBe('START_FROM_ENCOUNTER');
      const rec0 = await doc
        .post('/api/medical-records', { appointmentId: apptId, chiefComplaint: 'Cough' })
        .expect(201);
      expect(rec0.body.data.appointment.status).toBe('IN_PROGRESS');
      const done = await doc
        .patch(`/api/appointments/${apptId}/status`, { status: 'COMPLETED' })
        .expect(200);
      expect(done.body.data).toMatchObject({
        status: 'COMPLETED',
        medicalRecordId: rec0.body.data.id,
      });
      expect(t.prisma.rows('MedicalRecord')[0]).toMatchObject({ status: 'CLOSED' });
      await rec
        .patch(`/api/appointments/${apptId}/status`, { status: 'CANCELLED', reason: 'x' })
        .expect(400);
    });

    it('patients cancel their own upcoming appointments with a reason; reminders are cancelled and the slot frees', async () => {
      const pat = await as(patientUser);
      await pat.patch(`/api/appointments/${apptId}/status`, { status: 'CONFIRMED' }).expect(403);
      await pat.patch(`/api/appointments/${apptId}/status`, { status: 'CANCELLED' }).expect(400);
      await (
        await as(patient2User)
      )
        .patch(`/api/appointments/${apptId}/status`, { status: 'CANCELLED', reason: 'x' })
        .expect(404);
      const res = await pat
        .patch(`/api/appointments/${apptId}/status`, {
          status: 'CANCELLED',
          reason: 'Feeling better',
        })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Feeling better',
      });
      expect(t.reminders.at(-1)).toEqual({ id: apptId, at: 'cancelled' });
      await (
        await as(patient2User)
      )
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '09:00') })
        .expect(201);
    });

    it('patients cannot cancel online within 2 hours of the start; reception still can (DEC-038)', async () => {
      const soon = new Date(Date.now() + 90 * 60_000).toISOString();
      const rec = await as(reception);
      const em = await rec
        .post('/api/appointments', {
          doctorId,
          patientId,
          scheduledAt: soon,
          type: 'EMERGENCY',
          departmentId: dept,
        })
        .expect(201);
      const late = await (
        await as(patientUser)
      )
        .patch(`/api/appointments/${em.body.data.id}/status`, {
          status: 'CANCELLED',
          reason: 'Running late',
        })
        .expect(400);
      expect(late.body.error.code).toBe('CANCELLATION_TOO_LATE');
      await rec
        .patch(`/api/appointments/${em.body.data.id}/status`, {
          status: 'CANCELLED',
          reason: 'Patient called',
        })
        .expect(200);
    });

    it('no-show only after the appointment time; reschedule moves to a free slot only', async () => {
      const rec = await as(reception);
      await rec.patch(`/api/appointments/${apptId}/status`, { status: 'CONFIRMED' }).expect(200);
      await rec.patch(`/api/appointments/${apptId}/status`, { status: 'NO_SHOW' }).expect(400);
      await (
        await as(patient2User)
      )
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '10:00') })
        .expect(201);
      const pat = await as(patientUser);
      await pat
        .post(`/api/appointments/${apptId}/reschedule`, { scheduledAt: at(monday, '10:00') })
        .expect(409);
      const moved = await pat
        .post(`/api/appointments/${apptId}/reschedule`, { scheduledAt: at(monday, '10:30') })
        .expect(200);
      expect(moved.body.data).toMatchObject({
        scheduledAt: at(monday, '10:30'),
        status: 'PENDING',
      });
      expect(t.reminders.at(-1)).toEqual({ id: apptId, at: at(monday, '10:30') });
    });

    it('patients and doctors list only their own appointments', async () => {
      await (
        await as(patient2User)
      )
        .post('/api/appointments', { doctorId, scheduledAt: at(monday, '10:00') })
        .expect(201);
      expect(
        (await (await as(patientUser)).get('/api/appointments').expect(200)).body.meta.total,
      ).toBe(1);
      expect(
        (await (await as(doctorUser)).get('/api/appointments').expect(200)).body.meta.total,
      ).toBe(2);
      expect(
        (await (await as(doctor2User)).get('/api/appointments').expect(200)).body.meta.total,
      ).toBe(0);
      expect(
        (await (await as(reception)).get(`/api/appointments?patientId=${patient2Id}`).expect(200))
          .body.meta.total,
      ).toBe(1);
      await (await as(patient2User)).get(`/api/appointments/${apptId}`).expect(404);
    });
  });
});
