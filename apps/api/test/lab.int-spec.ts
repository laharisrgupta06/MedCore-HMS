import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_COOKIES, CSRF_HEADER, type Role } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';

/**
 * Phase 6 on real PostgreSQL (T-LAB-INT-001): M-06 columns and CHECKs, the approved-result lock
 * trigger, senior approval, patient visibility after approval only. Rows prefixed "int-".
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'i'.repeat(43);

describe('Phase 6 integration: laboratory on PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('runs an order to approval with the database locks and visibility rules', async () => {
    const hospital = await prisma.hospital.create({
      data: {
        name: `int-lab-${run}`,
        code: `INTL-${run}`.toUpperCase(),
        email: `int-lab-${run}@example.com`,
        phone: '+914400000003',
        licenseNumber: `L-${run}`,
        status: 'VERIFIED',
      },
    });
    const dept = await prisma.department.create({
      data: { hospitalId: hospital.id, name: 'General' },
    });
    let n = 0;
    const base = (role: Role) => ({
      hospitalId: hospital.id,
      email: `int-lab-${role.toLowerCase()}-${++n}-${run}@example.com`,
      passwordHash: 'x',
      role,
      firstName: 'Int',
      lastName: `${role}${n}`,
      emailVerifiedAt: new Date(),
    });
    const staff = (role: Role, senior = false) =>
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: base(role) });
        await tx.staffProfile.create({
          data: { hospitalId: hospital.id, userId: u.id, isSeniorLabTechnician: senior },
        });
        return u;
      });
    const admin = await staff('HOSPITAL_ADMIN');
    const reception = await staff('RECEPTIONIST');
    const tech = await staff('LAB_TECHNICIAN');
    const senior = await staff('LAB_TECHNICIAN', true);
    const doctor = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: base('DOCTOR') });
      return tx.doctor.create({
        data: {
          hospitalId: hospital.id,
          userId: u.id,
          registrationNumber: 'K',
          specialisation: 'General',
          consultationFee: 1,
        },
      });
    });
    const patients = [];
    for (const g of ['FEMALE', 'MALE'] as const)
      patients.push(
        await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: base('PATIENT') });
          return tx.patient.create({
            data: {
              hospitalId: hospital.id,
              userId: u.id,
              mrn: `INTL-${run}-${g}`,
              dateOfBirth: new Date('1990-01-01'),
              gender: g,
            },
          });
        }),
      );
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: hospital.id,
        doctorId: doctor.id,
        patientId: patients[0]!.id,
        departmentId: dept.id,
        scheduledAt: new Date(),
        endAt: new Date(Date.now() + 1_800_000),
        status: 'IN_PROGRESS',
        createdById: patients[0]!.userId,
      },
    });
    const record = await prisma.medicalRecord.create({
      data: { hospitalId: hospital.id, appointmentId: appt.id, chiefComplaint: 'Fatigue' },
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const client = async (id: string, role: Role) => {
      const sid = randomUUID();
      await sessions.create(id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: id, sid, role, hid: hospital.id })}`;
      const s = app.getHttpServer();
      const w = (r: request.Test) =>
        r
          .set('Authorization', auth)
          .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
          .set(CSRF_HEADER, CSRF);
      return {
        get: (url: string) => request(s).get(url).set('Authorization', auth),
        post: (url: string, body: object = {}) => w(request(s).post(url)).send(body),
        patch: (url: string, body: object = {}) => w(request(s).patch(url)).send(body),
      };
    };
    const hb = (
      await (
        await client(admin.id, 'HOSPITAL_ADMIN')
      )
        .post('/api/lab-tests', {
          code: `HB${run}`.slice(0, 8),
          name: 'Haemoglobin',
          category: 'LABORATORY',
          unit: 'g/dL',
          price: 150,
          ranges: [{ gender: 'FEMALE', low: 12, high: 15.5 }],
        })
        .expect(201)
    ).body.data;
    const doc = await client(doctor.userId, 'DOCTOR');
    const order = (
      await doc
        .post('/api/lab-orders', { medicalRecordId: record.id, testIds: [hb.id] })
        .expect(201)
    ).body.data;
    await (
      await client(reception.id, 'RECEPTIONIST')
    )
      .patch(`/api/lab-orders/${order.id}/sample`)
      .expect(200);
    const lt = await client(tech.id, 'LAB_TECHNICIAN');
    await lt.patch(`/api/lab-orders/${order.id}/processing`).expect(200);
    await lt
      .patch(`/api/lab-orders/${order.id}/result`, {
        results: [{ itemId: order.items[0].id, valueNumeric: 16 }],
        submit: true,
      })
      .expect(200);
    const stored = await prisma.labResult.findFirstOrThrow({
      where: { labOrderItemId: order.items[0].id },
    });
    expect({
      flag: stored.flag,
      unit: stored.unit,
      low: Number(stored.referenceLow),
      high: Number(stored.referenceHigh),
    }).toEqual({ flag: 'HIGH', unit: 'g/dL', low: 12, high: 15.5 });

    const own = await client(patients[0]!.userId, 'PATIENT');
    await own.get(`/api/lab-orders/${order.id}`).expect(404);
    expect(
      (
        await (
          await client(tech.id, 'LAB_TECHNICIAN')
        )
          .patch(`/api/lab-orders/${order.id}/approve`)
          .expect(403)
      ).body.error.code,
    ).toBe('NOT_SENIOR');
    await (
      await client(senior.id, 'LAB_TECHNICIAN')
    )
      .patch(`/api/lab-orders/${order.id}/approve`)
      .expect(200);

    // Database locks: approved results and orders cannot change.
    await expect(
      prisma.labResult.update({ where: { id: stored.id }, data: { valueNumeric: 14 } }),
    ).rejects.toThrow(/locked/);
    await expect(
      prisma.labOrder.update({ where: { id: order.id }, data: { priority: 'URGENT' } }),
    ).rejects.toThrow(/locked/);

    expect(
      (await own.get(`/api/lab-orders/${order.id}`).expect(200)).body.data.items[0].result.flag,
    ).toBe('HIGH');
    await own.get(`/api/lab-orders/${order.id}/report`).expect(200);
    await (
      await client(patients[1]!.userId, 'PATIENT')
    )
      .get(`/api/lab-orders/${order.id}`)
      .expect(404);

    // M-06: CANCELLED only with who, when and a reason.
    const o2 = (
      await doc
        .post('/api/lab-orders', { medicalRecordId: record.id, testIds: [hb.id] })
        .expect(201)
    ).body.data;
    await expect(
      prisma.$executeRaw`UPDATE lab_orders SET status = 'CANCELLED' WHERE id = ${o2.id}::uuid`,
    ).rejects.toThrow(/lab_orders_cancel_chk/);
    await doc.patch(`/api/lab-orders/${o2.id}/cancel`, { reason: 'Duplicate order' }).expect(200);
    expect(
      await prisma.auditLog.count({ where: { action: 'lab_order.approve', actorId: senior.id } }),
    ).toBe(1);
  });
});
