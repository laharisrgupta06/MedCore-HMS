import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CSRF_HEADER } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Phase 2 against real PostgreSQL, Redis and Mailpit (T-ORG-INT-001): onboarding through the API
 * with the real role/profile triggers and composite tenant keys. Rows are prefixed "int-".
 */
const MAILPIT = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');

async function mailToken(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text: string;
      };
      const token = /token=([A-Za-z0-9_-]{43})/.exec(msg.Text)?.[1];
      if (token) return token;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No set-password email for ${to}`);
}

describe('Phase 2 integration: onboarding a hospital end to end', () => {
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

  it('Super Admin onboards; admin activates and builds the hospital; reception registers a patient', async () => {
    const server = () => app.getHttpServer();
    const agent = request.agent(server());
    // One cookie jar: the CSRF cookie rotates at every login, so always send the latest value.
    let csrf = (await agent.get('/api/auth/csrf')).body.data.csrfToken as string;
    const signIn = async (email: string, password: string) => {
      const r = await agent
        .post('/api/auth/login')
        .set(CSRF_HEADER, csrf)
        .send({ email, password })
        .expect(200);
      csrf = r.body.data.csrfToken as string;
      return { token: r.body.data.accessToken as string };
    };
    const call = (s: { token: string }) => ({
      post: (url: string, body: object = {}) =>
        agent.post(url).set('Authorization', `Bearer ${s.token}`).set(CSRF_HEADER, csrf).send(body),
      get: (url: string) => agent.get(url).set('Authorization', `Bearer ${s.token}`),
    });

    const saEmail = `int-sa-${run}@example.com`;
    await prisma.user.create({
      data: {
        email: saEmail,
        passwordHash: await hash('Int-super-admin-1', 12),
        role: 'SUPER_ADMIN',
        firstName: 'Int',
        lastName: 'Root',
        emailVerifiedAt: new Date(),
      },
    });
    const sa = call(await signIn(saEmail, 'Int-super-admin-1'));
    const adminEmail = `int-admin-${run}@example.com`;
    const hospital = (
      await sa
        .post('/api/hospitals', {
          name: `int-hospital-${run}`,
          code: `INT2-${run}`.toUpperCase(),
          email: `int-h2-${run}@example.com`,
          phone: '+914400000000',
          licenseNumber: `INT-${run}`,
          admin: { firstName: 'Int', lastName: 'Admin', email: adminEmail },
        })
        .expect(201)
    ).body.data;
    await sa.post(`/api/hospitals/${hospital.id}/verify`).expect(200);

    await agent
      .post('/api/auth/reset-password')
      .set(CSRF_HEADER, csrf)
      .send({ token: await mailToken(adminEmail), password: 'Int-admin-pass-1' })
      .expect(200);
    const admin = call(await signIn(adminEmail, 'Int-admin-pass-1'));
    const dept = (
      await admin
        .post(`/api/hospitals/${hospital.id}/departments`, { name: 'General Medicine' })
        .expect(201)
    ).body.data;
    await admin
      .post('/api/staff', {
        role: 'RECEPTIONIST',
        firstName: 'Int',
        lastName: 'Reception',
        email: `int-rec-${run}@example.com`,
        departmentId: dept.id,
      })
      .expect(201);
    const doctor = (
      await admin
        .post('/api/doctors', {
          firstName: 'Int',
          lastName: 'Doctor',
          email: `int-doc-${run}@example.com`,
          registrationNumber: `R-${run}`,
          specialisation: 'General',
          consultationFee: 400,
          departmentIds: [dept.id],
        })
        .expect(201)
    ).body.data;
    expect(doctor.departments).toEqual([{ id: dept.id, name: 'General Medicine' }]);
    const room = (
      await admin.post('/api/rooms', { number: `int-${run}`, type: 'WARD' }).expect(201)
    ).body.data;
    await admin.post(`/api/rooms/${room.id}/beds`, { label: 'A' }).expect(201);

    await agent
      .post('/api/auth/reset-password')
      .set(CSRF_HEADER, csrf)
      .send({ token: await mailToken(`int-rec-${run}@example.com`), password: 'Int-recep-pass-1' })
      .expect(200);
    const reception = call(await signIn(`int-rec-${run}@example.com`, 'Int-recep-pass-1'));
    const patient = (
      await reception
        .post('/api/patients', {
          firstName: 'Int',
          lastName: 'Patient',
          email: `int-pat-${run}@example.com`,
          dateOfBirth: '1991-03-04',
          gender: 'OTHER',
        })
        .expect(201)
    ).body.data;
    expect(patient.mrn).toMatch(/^MRN-\d{4}-\d{6}$/);
    expect(
      (await reception.get(`/api/patients?search=${patient.mrn}`).expect(200)).body.data,
    ).toHaveLength(1);
  });
});
