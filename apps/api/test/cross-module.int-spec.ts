import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_COOKIES, CSRF_HEADER, addDays, type Role } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';
import { localDate } from '../src/common/time/zoned';
import { StorageService } from '../src/infra/storage/storage.service';

/**
 * Phases 4 to 7 together on real PostgreSQL (T-XMOD-INT-001, approved plan section 14):
 * consultation → prescription → verify → FIFO dispense → ready → handed over, and
 * consultation → lab order → sample → results → senior approval → the patient sees the report.
 * Rows prefixed "int-".
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'x'.repeat(43);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Cross-module integration: consultation to pharmacy and laboratory', () => {
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

  it('runs both clinical flows end to end', async () => {
    const hospital = await prisma.hospital.create({
      data: {
        name: `int-x-${run}`,
        code: `INTX-${run}`.toUpperCase(),
        email: `int-x-${run}@example.com`,
        phone: '+914400000009',
        licenseNumber: `LX-${run}`,
        status: 'VERIFIED',
        timezone: 'Asia/Kolkata',
      },
    });
    const hid = hospital.id;
    const dept = await prisma.department.create({ data: { hospitalId: hid, name: 'General' } });
    let n = 0;
    const base = (role: Role) => ({
      hospitalId: hid,
      email: `int-x-${role.toLowerCase()}-${++n}-${run}@example.com`,
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
          data: { hospitalId: hid, userId: u.id, isSeniorLabTechnician: senior },
        });
        return u;
      });
    const pharmacist = await staff('PHARMACIST');
    const reception = await staff('RECEPTIONIST');
    const tech = await staff('LAB_TECHNICIAN');
    const senior = await staff('LAB_TECHNICIAN', true);
    const admin = await staff('HOSPITAL_ADMIN');
    const storage = app.get(StorageService);
    const doctor = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: base('DOCTOR') });
      const key = `${hid}/signatures/int-x-${run}.png`;
      await storage.put(key, PNG);
      const sig = await tx.fileAttachment.create({
        data: {
          hospitalId: hid,
          purpose: 'DOCTOR_SIGNATURE',
          storageKey: key,
          originalName: 'sig.png',
          mimeType: 'image/png',
          sizeBytes: PNG.length,
          sha256: '0'.repeat(64),
          uploadedById: u.id,
        },
      });
      const d = await tx.doctor.create({
        data: {
          hospitalId: hid,
          userId: u.id,
          registrationNumber: 'KMC-X',
          specialisation: 'General',
          consultationFee: 300,
          signatureFileId: sig.id,
        },
      });
      await tx.doctorDepartment.create({
        data: { hospitalId: hid, doctorId: d.id, departmentId: dept.id },
      });
      return d;
    });
    const patient = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: base('PATIENT') });
      return tx.patient.create({
        data: {
          hospitalId: hid,
          userId: u.id,
          mrn: `INTX-${run}`,
          dateOfBirth: new Date('1990-01-01'),
          gender: 'FEMALE',
        },
      });
    });
    const start = new Date(Date.now() + 86_400_000);
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: hid,
        doctorId: doctor.id,
        patientId: patient.id,
        departmentId: dept.id,
        scheduledAt: start,
        endAt: new Date(start.getTime() + 1_800_000),
        status: 'CONFIRMED',
        createdById: patient.userId,
      },
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const client = async (id: string, role: Role) => {
      const sid = randomUUID();
      await sessions.create(id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: id, sid, role, hid })}`;
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
    const doc = await client(doctor.userId, 'DOCTOR');
    const ph = await client(pharmacist.id, 'PHARMACIST');
    const me = await client(patient.userId, 'PATIENT');

    // Consultation (Phase 4).
    const rec = (
      await doc
        .post('/api/medical-records', {
          appointmentId: appt.id,
          chiefComplaint: 'Fever and fatigue',
        })
        .expect(201)
    ).body.data;

    // Flow 1: prescription → pharmacy (Phases 5 and 7).
    const med = (
      await ph
        .post('/api/medicines', {
          name: `int-x-crocin-${run}`,
          form: 'TABLET',
          strength: '650 mg',
          reorderLevel: 2,
        })
        .expect(201)
    ).body.data;
    const today = localDate(new Date(), 'Asia/Kolkata');
    for (const [batchNumber, quantity, days] of [
      ['X-SOON', 4, 15],
      ['X-LATE', 20, 300],
    ] as const)
      await ph
        .post(`/api/medicines/${med.id}/batches`, {
          batchNumber,
          manufacturedOn: addDays(today, -30),
          expiresOn: addDays(today, days),
          quantity,
          unitCost: 1,
          mrp: 2,
        })
        .expect(201);
    const rx = (
      await doc
        .post('/api/prescriptions', {
          medicalRecordId: rec.id,
          items: [
            {
              medicineId: med.id,
              dosage: '650 mg',
              frequency: 'TDS',
              durationDays: 2,
              quantity: 6,
            },
          ],
        })
        .expect(201)
    ).body.data;
    expect(
      (await ph.get('/api/pharmacy/prescriptions').expect(200)).body.data.map(
        (p: { id: string }) => p.id,
      ),
    ).toContain(rx.id);
    await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`).expect(200);
    const ready = (
      await ph
        .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
          items: [{ itemId: rx.items[0].id, quantity: 6 }],
        })
        .expect(201)
    ).body.data;
    expect(ready.status).toBe('READY_FOR_PICKUP');
    expect((await me.get(`/api/prescriptions/${rx.id}`).expect(200)).body.data.status).toBe(
      'READY_FOR_PICKUP',
    );
    const batches = (await ph.get(`/api/medicines/${med.id}/batches`).expect(200)).body.data;
    expect(
      batches.map((b: { batchNumber: string; quantity: number }) => [b.batchNumber, b.quantity]),
    ).toEqual([
      ['X-SOON', 0],
      ['X-LATE', 18],
    ]);
    await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`).expect(200);
    expect((await me.get(`/api/prescriptions/${rx.id}`).expect(200)).body.data.status).toBe(
      'DISPENSED',
    );
    await doc
      .patch(`/api/prescriptions/${rx.id}/cancel`, { reason: 'Too late to cancel' })
      .expect(409);

    // Flow 2: lab order → approval → patient (Phase 6).
    const test = (
      await (
        await client(admin.id, 'HOSPITAL_ADMIN')
      )
        .post('/api/lab-tests', {
          code: `X${run}`.slice(0, 8).toUpperCase(),
          name: 'Haemoglobin',
          category: 'LABORATORY',
          unit: 'g/dL',
          price: 150,
          ranges: [{ gender: 'FEMALE', low: 12, high: 15.5 }],
        })
        .expect(201)
    ).body.data;
    const order = (
      await doc.post('/api/lab-orders', { medicalRecordId: rec.id, testIds: [test.id] }).expect(201)
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
        results: [{ itemId: order.items[0].id, valueNumeric: 11 }],
        submit: true,
      })
      .expect(200);
    await me.get(`/api/lab-orders/${order.id}`).expect(404);
    await (
      await client(senior.id, 'LAB_TECHNICIAN')
    )
      .patch(`/api/lab-orders/${order.id}/approve`)
      .expect(200);
    const seen = (await me.get(`/api/lab-orders/${order.id}`).expect(200)).body.data;
    expect(seen.items[0].result).toMatchObject({ valueNumeric: 11, flag: 'LOW' });
    const pdf = await me.get(`/api/lab-orders/${order.id}/report`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  }, 60_000);
});
