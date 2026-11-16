import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CSRF_HEADER } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Phase 1B against real PostgreSQL, Redis and Mailpit (T-AUTH-INT). Requires the initial migration
 * (P1A-04); fails with an explicit message until the users table exists. Creates rows prefixed "int-" in the
 * local development database; audit rows are append-only by design and are not removed.
 */
const MAILPIT = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

async function mailpitCode(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as {
      messages?: { ID: string }[];
    };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        Text: string;
      };
      const code = /\b(\d{6})\b/.exec(msg.Text)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No verification email for ${to} in Mailpit`);
}

const prisma = new PrismaClient();
let migrated = false;

beforeAll(async () => {
  const rows = await prisma.$queryRaw<
    { t: string | null }[]
  >`SELECT to_regclass('public.users')::text AS t`;
  migrated = rows[0]?.t !== null && rows[0]?.t !== undefined;
});
afterAll(() => prisma.$disconnect());

describe('Phase 1B integration: auth with PostgreSQL, Redis and Mailpit', () => {
  let app: INestApplication;
  const run = randomBytes(4).toString('hex');
  const email = `int-${run}@example.com`;
  const password = 'Integration-pass-1';

  beforeAll(async () => {
    if (!migrated) return;
    await prisma.hospital.create({
      data: {
        // Explicit id: hospitals.id is also a foreign-key column (DEC-031), so Prisma does not
        // apply @default(uuid()) to it (DEC-032).
        id: randomUUID(),
        name: `Integration Hospital ${run}`,
        code: `INT-${run.toUpperCase()}`,
        email: `int-hospital-${run}@example.com`,
        phone: '+910000000000',
        licenseNumber: `INT-${run}`,
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('registers, verifies by Mailpit OTP, signs in, refreshes and logs out', async () => {
    if (!migrated)
      throw new Error('Initial migration not applied (P1A-04): the users table does not exist.');
    const agent = request.agent(app.getHttpServer());
    let csrf = (await agent.get('/api/auth/csrf').expect(200)).body.data.csrfToken as string;

    await agent
      .post('/api/auth/register')
      .set(CSRF_HEADER, csrf)
      .send({
        hospitalCode: `INT-${run.toUpperCase()}`,
        firstName: 'Int',
        lastName: 'Patient',
        email,
        password,
        dateOfBirth: '1992-02-02',
        gender: 'UNDISCLOSED',
      })
      .expect(201);
    // The deferred role/profile trigger accepted the user + patient transaction.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { patient: true },
    });
    expect(user.patient?.mrn).toMatch(/^MRN-\d{4}-\d{6}$/);

    await agent
      .post('/api/auth/verify-email')
      .set(CSRF_HEADER, csrf)
      .send({ email, otp: await mailpitCode(email) })
      .expect(200);

    const login = await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, csrf)
      .send({ email, password })
      .expect(200);
    csrf = login.body.data.csrfToken;
    const me = await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data.user.role).toBe('PATIENT');

    const refreshed = await agent.post('/api/auth/refresh').set(CSRF_HEADER, csrf).expect(200);
    csrf = refreshed.body.data.csrfToken;
    await agent.post('/api/auth/logout').set(CSRF_HEADER, csrf).send({}).expect(200);
    await agent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`)
      .expect(401);

    const audit = await prisma.auditLog.findMany({
      where: { actorId: user.id },
      select: { action: true },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.register', 'auth.email_verified', 'auth.login', 'auth.logout']),
    );
  });
});
