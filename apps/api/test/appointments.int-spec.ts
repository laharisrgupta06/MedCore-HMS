import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CSRF_HEADER, AUTH_COOKIES } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';

/**
 * Phase 3 on real PostgreSQL and Redis (T-APPT-INT-001): slots, booking, and TEST-012 with the
 * doctor row lock plus the exclusion constraints. Rows are prefixed "int-".
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'i'.repeat(43);

describe('Phase 3 integration: booking engine on PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<
      { t: string | null }[]
    >`SELECT to_regclass('public.users')::text AS t`;
    if (!rows[0]?.t) throw new Error('Initial migration not applied (P1A-04).');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('only one of many simultaneous bookings for a slot succeeds; a patient cannot double-book', async () => {
    const hospital = await prisma.hospital.create({
      data: {
        name: `int-appt-${run}`,
        code: `INTA-${run}`.toUpperCase(),
        email: `int-appt-${run}@example.com`,
        phone: '+914400000000',
        licenseNumber: `A-${run}`,
        status: 'VERIFIED',
        timezone: 'Asia/Kolkata',
      },
    });
    const dept = await prisma.department.create({
      data: { hospitalId: hospital.id, name: 'General' },
    });
    const mkUser = (role: 'DOCTOR' | 'PATIENT', n: number) => ({
      hospitalId: hospital.id,
      email: `int-${role.toLowerCase()}-${n}-${run}@example.com`,
      passwordHash: 'x',
      role,
      firstName: 'Int',
      lastName: `${role}${n}`,
      emailVerifiedAt: new Date(),
    });
    const doctor = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: mkUser('DOCTOR', 1) });
      const d = await tx.doctor.create({
        data: {
          hospitalId: hospital.id,
          userId: u.id,
          registrationNumber: 'R',
          specialisation: 'General',
          consultationFee: 300,
        },
      });
      await tx.doctorDepartment.create({
        data: { hospitalId: hospital.id, doctorId: d.id, departmentId: dept.id },
      });
      return d;
    });
    const patients = [];
    for (let i = 0; i < 5; i++) {
      patients.push(
        await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: mkUser('PATIENT', i) });
          await tx.patient.create({
            data: {
              hospitalId: hospital.id,
              userId: u.id,
              mrn: `INT-${run}-${i}`,
              dateOfBirth: new Date('1990-01-01'),
              gender: 'OTHER',
            },
          });
          return u;
        }),
      );
    }
    await prisma.doctorSchedule.create({
      data: {
        hospitalId: hospital.id,
        doctorId: doctor.id,
        departmentId: dept.id,
        weekday: 'MONDAY',
        startTime: new Date('1970-01-01T09:00:00Z'),
        endTime: new Date('1970-01-01T10:00:00Z'),
        slotMinutes: 30,
        validFrom: new Date('2020-01-01'),
      },
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const tokenFor = async (u: { id: string }) => {
      const sid = randomUUID();
      await sessions.create(u.id, sid, randomUUID(), 60_000);
      return tokens.signAccess({ sub: u.id, sid, role: 'PATIENT', hid: hospital.id });
    };
    const d = new Date(Date.now() + 3 * 86_400_000);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    const slot = new Date(`${date}T03:30:00.000Z`).toISOString(); // 09:00 Asia/Kolkata

    const first = await tokenFor(patients[0]!);
    const slots = await request(app.getHttpServer())
      .get(`/api/doctors/${doctor.id}/slots?date=${date}`)
      .set('Authorization', `Bearer ${first}`)
      .expect(200);
    expect(slots.body.data.map((s: { start: string }) => s.start)).toEqual([
      slot,
      new Date(`${date}T04:00:00.000Z`).toISOString(),
    ]);

    const book = async (u: { id: string }) =>
      request(app.getHttpServer())
        .post('/api/appointments')
        .set('Authorization', `Bearer ${await tokenFor(u)}`)
        .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
        .set(CSRF_HEADER, CSRF)
        .send({ doctorId: doctor.id, scheduledAt: slot });
    const results = await Promise.all(patients.map(book));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(
      results
        .filter((r) => r.status === 409)
        .every((r) => r.body.error.code === 'SLOT_UNAVAILABLE'),
    ).toBe(true);
    expect(
      await prisma.appointment.count({
        where: { doctorId: doctor.id, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
      }),
    ).toBe(1);
  });
});
