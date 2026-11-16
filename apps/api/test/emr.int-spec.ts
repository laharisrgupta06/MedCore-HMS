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

/**
 * Phase 4 on real PostgreSQL (T-EMR-INT-001): pgcrypto encryption at rest, the append-only and
 * closed-record triggers, and patient isolation. Rows are prefixed "int-".
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'i'.repeat(43);

describe('Phase 4 integration: medical records on PostgreSQL', () => {
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

  it('encrypts clinical text, enforces append-only rules and patient isolation', async () => {
    const hospital = await prisma.hospital.create({
      data: {
        name: `int-emr-${run}`,
        code: `INTE-${run}`.toUpperCase(),
        email: `int-emr-${run}@example.com`,
        phone: '+914400000001',
        licenseNumber: `E-${run}`,
        status: 'VERIFIED',
      },
    });
    const dept = await prisma.department.create({
      data: { hospitalId: hospital.id, name: 'General' },
    });
    const user = (role: 'DOCTOR' | 'PATIENT', n: number) => ({
      hospitalId: hospital.id,
      email: `int-emr-${role.toLowerCase()}-${n}-${run}@example.com`,
      passwordHash: 'x',
      role,
      firstName: 'Int',
      lastName: `${role}${n}`,
      emailVerifiedAt: new Date(),
    });
    const doctor = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: user('DOCTOR', 1) });
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
      return { ...d, user: u };
    });
    const patients = [];
    for (const i of [1, 2])
      patients.push(
        await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: user('PATIENT', i) });
          const p = await tx.patient.create({
            data: {
              hospitalId: hospital.id,
              userId: u.id,
              mrn: `INTE-${run}-${i}`,
              dateOfBirth: new Date('1990-01-01'),
              gender: 'OTHER',
            },
          });
          return { ...p, user: u };
        }),
      );
    const start = new Date(Date.now() + 86_400_000);
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: hospital.id,
        doctorId: doctor.id,
        patientId: patients[0]!.id,
        departmentId: dept.id,
        scheduledAt: start,
        endAt: new Date(start.getTime() + 1_800_000),
        status: 'CONFIRMED',
        createdById: patients[0]!.userId,
      },
    });
    await prisma.icd10Code.upsert({
      where: { code: 'J06.9' },
      create: { code: 'J06.9', title: 'Acute upper respiratory infection, unspecified' },
      update: {},
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const client = async (u: { id: string; role: 'DOCTOR' | 'PATIENT' }) => {
      const sid = randomUUID();
      await sessions.create(u.id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: u.id, sid, role: u.role, hid: hospital.id })}`;
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
    const doc = await client({ id: doctor.userId, role: 'DOCTOR' });
    const rec = (
      await doc
        .post('/api/medical-records', { appointmentId: appt.id, chiefComplaint: 'Sore throat' })
        .expect(201)
    ).body.data;
    const secret = `Tonsils enlarged ${run}`;
    await doc.post(`/api/medical-records/record/${rec.id}/entries`, { body: secret }).expect(201);
    await doc
      .patch(`/api/medical-records/record/${rec.id}`, { treatmentPlan: `Plan ${run}` })
      .expect(200);
    const view = (
      await doc
        .post(`/api/medical-records/record/${rec.id}/diagnoses`, {
          icd10Code: 'J06.9',
          description: `Pharyngitis ${run}`,
          type: 'CONFIRMED',
        })
        .expect(201)
    ).body.data;
    expect(view.entries[0].body).toBe(secret);
    expect(view.treatmentPlan).toBe(`Plan ${run}`);

    // SEC-014: the raw columns hold pgcrypto ciphertext, not the text.
    const raw = await prisma.$queryRaw<
      { body: string }[]
    >`SELECT encode("bodyEnc", 'escape') AS body FROM record_entries WHERE "medicalRecordId" = ${rec.id}::uuid`;
    expect(raw).toHaveLength(1);
    expect(raw[0]!.body).not.toContain('Tonsils');
    await expect(
      prisma.$queryRaw`SELECT pgp_sym_decrypt("bodyEnc", 'wrong-key') FROM record_entries WHERE "medicalRecordId" = ${rec.id}::uuid`,
    ).rejects.toThrow();

    // EMR-002: the database refuses edits and deletes of clinical rows.
    const entry = await prisma.recordEntry.findFirstOrThrow({ where: { medicalRecordId: rec.id } });
    await expect(
      prisma.recordEntry.update({ where: { id: entry.id }, data: { correctionReason: 'x' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.recordEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );

    // Completing closes the record; the closed row is locked, an addendum is still possible.
    await doc.patch(`/api/appointments/${appt.id}/status`, { status: 'COMPLETED' }).expect(200);
    await expect(
      prisma.medicalRecord.update({ where: { id: rec.id }, data: { chiefComplaint: 'changed' } }),
    ).rejects.toThrow(/closed/);
    const after = (
      await doc
        .post(`/api/medical-records/record/${rec.id}/entries`, { body: 'Addendum after close' })
        .expect(201)
    ).body.data;
    expect(after.entries.map((e: { kind: string }) => e.kind)).toEqual(['NOTE', 'ADDENDUM']);

    // TEST-011 with real queries: the patient reads their own chart; another patient gets 404.
    const own = await client({ id: patients[0]!.userId, role: 'PATIENT' });
    expect(
      (await own.get(`/api/medical-records/${patients[0]!.id}`).expect(200)).body.data[0].entries[0]
        .body,
    ).toBe(secret);
    const other = await client({ id: patients[1]!.userId, role: 'PATIENT' });
    await other.get(`/api/medical-records/record/${rec.id}`).expect(404);
    await other.get(`/api/medical-records/${patients[0]!.id}`).expect(404);
    expect(
      await prisma.auditLog.count({
        where: { action: 'medical_record.chart_view', actorId: patients[0]!.userId },
      }),
    ).toBe(1);
  });
});
