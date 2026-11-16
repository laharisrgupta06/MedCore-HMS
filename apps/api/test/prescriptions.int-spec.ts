import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';
import { StorageService } from '../src/infra/storage/storage.service';

/**
 * Phase 5 on real PostgreSQL (T-RX-INT-001): migration M-05 constraints, issuing with an allergy
 * acknowledgement, the PDF rendered and stored, patient isolation, cancellation. Rows prefixed "int-".
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'i'.repeat(43);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Phase 5 integration: prescriptions on PostgreSQL', () => {
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

  it('issues, stores the PDF, isolates patients and enforces the cancel constraint', async () => {
    const hospital = await prisma.hospital.create({
      data: {
        name: `int-rx-${run}`,
        code: `INTR-${run}`.toUpperCase(),
        email: `int-rx-${run}@example.com`,
        phone: '+914400000002',
        licenseNumber: `R-${run}`,
        status: 'VERIFIED',
      },
    });
    const dept = await prisma.department.create({
      data: { hospitalId: hospital.id, name: 'General' },
    });
    const user = (role: 'DOCTOR' | 'PATIENT', n: number) => ({
      hospitalId: hospital.id,
      email: `int-rx-${role.toLowerCase()}-${n}-${run}@example.com`,
      passwordHash: 'x',
      role,
      firstName: 'Int',
      lastName: `${role}${n}`,
      emailVerifiedAt: new Date(),
    });
    const storage = app.get(StorageService);
    const doctor = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: user('DOCTOR', 1) });
      const key = `${hospital.id}/signatures/int-${run}.png`;
      await storage.put(key, PNG);
      const sig = await tx.fileAttachment.create({
        data: {
          hospitalId: hospital.id,
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
          hospitalId: hospital.id,
          userId: u.id,
          registrationNumber: 'KMC-9',
          specialisation: 'General',
          consultationFee: 300,
          signatureFileId: sig.id,
        },
      });
      await tx.doctorDepartment.create({
        data: { hospitalId: hospital.id, doctorId: d.id, departmentId: dept.id },
      });
      return d;
    });
    const patients = [];
    for (const i of [1, 2])
      patients.push(
        await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: user('PATIENT', i) });
          return tx.patient.create({
            data: {
              hospitalId: hospital.id,
              userId: u.id,
              mrn: `INTR-${run}-${i}`,
              dateOfBirth: new Date('1990-01-01'),
              gender: 'FEMALE',
            },
          });
        }),
      );
    const start = new Date();
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: hospital.id,
        doctorId: doctor.id,
        patientId: patients[0]!.id,
        departmentId: dept.id,
        scheduledAt: start,
        endAt: new Date(start.getTime() + 1_800_000),
        status: 'IN_PROGRESS',
        createdById: patients[0]!.userId,
      },
    });
    const record = await prisma.medicalRecord.create({
      data: { hospitalId: hospital.id, appointmentId: appt.id, chiefComplaint: 'Fever' },
    });
    const med = await prisma.medicine.create({
      data: {
        hospitalId: hospital.id,
        name: `Augmentin ${run}`,
        genericName: 'Amoxicillin',
        form: 'TABLET',
        strength: '625 mg',
        reorderLevel: 10,
      },
    });
    await prisma.allergy.create({
      data: {
        hospitalId: hospital.id,
        patientId: patients[0]!.id,
        kind: 'ALLERGY',
        substance: 'Amoxicillin',
        recordedById: doctor.userId,
      },
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const client = async (id: string, role: 'DOCTOR' | 'PATIENT') => {
      const sid = randomUUID();
      await sessions.create(id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: id, sid, role, hid: hospital.id })}`;
      const s = app.getHttpServer();
      return {
        get: (url: string) => request(s).get(url).set('Authorization', auth),
        post: (url: string, body: object) =>
          request(s)
            .post(url)
            .set('Authorization', auth)
            .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
            .set(CSRF_HEADER, CSRF)
            .send(body),
        patch: (url: string, body: object) =>
          request(s)
            .patch(url)
            .set('Authorization', auth)
            .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
            .set(CSRF_HEADER, CSRF)
            .send(body),
      };
    };
    const doc = await client(doctor.userId, 'DOCTOR');
    const body = {
      medicalRecordId: record.id,
      items: [
        { medicineId: med.id, dosage: '625 mg', frequency: 'BD', durationDays: 5, quantity: 10 },
      ],
    };
    expect((await doc.post('/api/prescriptions', body).expect(409)).body.error.code).toBe(
      'ALLERGY_CONFLICT',
    );
    const rx = (
      await doc
        .post('/api/prescriptions', {
          ...body,
          allergyOverrideReason: 'Previous reaction was mild; monitored',
        })
        .expect(201)
    ).body.data;

    // Issuing queued the render on the real BullMQ queue; the app's worker builds and stores it.
    // (Regression: the queue once refused every job id, which a direct renderer call never noticed.)
    const deadline = Date.now() + 30_000;
    while (!(await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } })).pdfFileId) {
      if (Date.now() > deadline)
        throw new Error('The PDF worker did not store the prescription PDF within 30 s');
      await new Promise((r) => setTimeout(r, 250));
    }
    expect((await doc.get(`/api/prescriptions/${rx.id}`).expect(200)).body.data.pdfReady).toBe(
      true,
    );
    const stored = await prisma.prescription.findUniqueOrThrow({
      where: { id: rx.id },
      include: { pdfFile: true },
    });
    expect(stored.pdfFile).toMatchObject({
      purpose: 'PRESCRIPTION_PDF',
      mimeType: 'application/pdf',
      patientId: patients[0]!.id,
    });
    expect((await storage.get(stored.pdfFile!.storageKey)).subarray(0, 5).toString()).toBe('%PDF-');

    const own = await client(patients[0]!.userId, 'PATIENT');
    await own.get(`/api/prescriptions/${rx.id}/pdf`).expect(200);
    const other = await client(patients[1]!.userId, 'PATIENT');
    await other.get(`/api/prescriptions/${rx.id}`).expect(404);
    await other.get(`/api/prescriptions/${rx.id}/pdf`).expect(404);

    // M-05: CANCELLED needs who, when and a reason, enforced by the database too.
    await expect(
      prisma.prescription.update({ where: { id: rx.id }, data: { status: 'CANCELLED' } }),
    ).rejects.toThrow(/prescriptions_cancel_chk/);
    const c = (
      await doc
        .patch(`/api/prescriptions/${rx.id}/cancel`, {
          reason: 'Switched to a different antibiotic',
        })
        .expect(200)
    ).body.data;
    expect(c.status).toBe('CANCELLED');
    expect(
      await prisma.auditLog.count({
        where: { action: 'prescription.cancel', actorId: doctor.userId },
      }),
    ).toBe(1);
  }, 60_000);
});
