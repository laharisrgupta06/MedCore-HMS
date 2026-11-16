import { Controller, Get, INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER, ROLE_PERMISSIONS } from '@medcore/types';
import request from 'supertest';
import { Roles } from '../../common/auth/decorators';
import { createAuthTestApp, lastCode, type AuthTestApp } from '../../testing/auth-test-app';

@Controller('probe-roles')
class ProbeRolesController {
  @Get('admin-only')
  @Roles('SUPER_ADMIN')
  adminOnly() {
    return { ok: true };
  }
  @Get('any')
  any() {
    return { ok: true };
  }
}

const PASSWORD = 'Correct-horse-42';
const registration = {
  hospitalCode: 'citycare',
  firstName: 'Asha',
  lastName: 'Rao',
  email: 'Asha@Example.com',
  phone: '+919876543210',
  password: PASSWORD,
  dateOfBirth: '1990-04-21',
  gender: 'FEMALE',
};

type Agent = ReturnType<typeof request.agent>;

/** A browser-like client: keeps cookies and echoes the CSRF cookie in the header. */
async function client(app: INestApplication): Promise<{ agent: Agent; csrf: string }> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.get('/api/auth/csrf').expect(200);
  return { agent, csrf: (res.body as { data: { csrfToken: string } }).data.csrfToken };
}

function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

describe('Auth HTTP flows (in-memory Prisma and Redis)', () => {
  let t: AuthTestApp;
  let app: INestApplication;

  beforeEach(async () => {
    t = await createAuthTestApp({}, { controllers: [ProbeRolesController] });
    app = t.app;
    t.prisma.addHospital();
  });
  afterEach(() => app.close());

  async function registerAndVerify(body: Record<string, unknown> = registration) {
    const { agent, csrf } = await client(app);
    await agent.post('/api/auth/register').set(CSRF_HEADER, csrf).send(body).expect(201);
    await agent
      .post('/api/auth/verify-email')
      .set(CSRF_HEADER, csrf)
      .send({ email: body.email, otp: lastCode(t.emails) })
      .expect(200);
    return { agent, csrf };
  }

  async function login(email = 'asha@example.com', password = PASSWORD) {
    const { agent, csrf } = await client(app);
    const res = await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, csrf)
      .send({ email, password });
    const data = (res.body as { data?: { accessToken?: string; csrfToken?: string } }).data;
    // Login rotates the CSRF token; a browser client reads the new value.
    return { agent, csrf: data?.csrfToken ?? csrf, res, token: data?.accessToken };
  }

  describe('CSRF (SEC-010)', () => {
    it('rejects a state-changing request without the CSRF header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'a@b.co', password: 'x' })
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });

    it('rejects a header that does not match the cookie', async () => {
      const { agent } = await client(app);
      const res = await agent
        .post('/api/auth/login')
        .set(CSRF_HEADER, 'x'.repeat(43))
        .send({ email: 'a@b.co', password: 'x' })
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });
  });

  describe('register (AUTH-001)', () => {
    it('creates a PATIENT with a patient profile and MRN, hashes the password and emails an OTP', async () => {
      const { agent, csrf } = await client(app);
      const res = await agent
        .post('/api/auth/register')
        .set(CSRF_HEADER, csrf)
        .send(registration)
        .expect(201);
      expect(res.body).toEqual({
        success: true,
        message: 'OK',
        data: {
          userId: expect.any(String),
          email: 'asha@example.com',
          emailVerificationRequired: true,
        },
      });
      const user = t.prisma.users[0]!;
      expect(user.role).toBe('PATIENT');
      expect(user.hospitalId).toBe(t.prisma.hospitals[0]!.id);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(t.prisma.patients[0]).toMatchObject({
        userId: user.id,
        hospitalId: user.hospitalId,
        mrn: `MRN-${new Date().getUTCFullYear()}-000001`,
        gender: 'FEMALE',
      });
      expect(t.emails).toHaveLength(1);
      expect(t.emails[0]!.to).toBe('asha@example.com');
      expect(JSON.stringify(res.body)).not.toContain(lastCode(t.emails));
      expect(t.prisma.actions()).toContain('auth.register');
      // Auth routes write specific entries only; the generic write audit is skipped (@SkipAudit).
      expect(t.prisma.actions().filter((x) => x.startsWith('http.'))).toEqual([]);
    });

    it('rejects an unknown or unverified hospital code with the same error', async () => {
      t.prisma.addHospital({ code: 'PENDINGH', status: 'PENDING' });
      for (const code of ['NOPE', 'PENDINGH']) {
        const { agent, csrf } = await client(app);
        const res = await agent
          .post('/api/auth/register')
          .set(CSRF_HEADER, csrf)
          .send({ ...registration, hospitalCode: code })
          .expect(400);
        expect(res.body.error.code).toBe('INVALID_HOSPITAL_CODE');
      }
      expect(t.prisma.users).toHaveLength(0);
    });

    it('rejects a duplicate email with EMAIL_IN_USE', async () => {
      await registerAndVerify();
      const { agent, csrf } = await client(app);
      const res = await agent
        .post('/api/auth/register')
        .set(CSRF_HEADER, csrf)
        .send(registration)
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_IN_USE');
    });

    it('enforces the password policy (DEC-012)', async () => {
      const { agent, csrf } = await client(app);
      const short = await agent
        .post('/api/auth/register')
        .set(CSRF_HEADER, csrf)
        .send({ ...registration, password: 'short1' })
        .expect(400);
      expect(short.body.error.code).toBe('VALIDATION_ERROR');
      const noDigit = await agent
        .post('/api/auth/register')
        .set(CSRF_HEADER, csrf)
        .send({ ...registration, password: 'lettersonlypassword' })
        .expect(400);
      expect(noDigit.body.error.code).toBe('VALIDATION_ERROR');
      const sameAsEmail = await agent
        .post('/api/auth/register')
        .set(CSRF_HEADER, csrf)
        .send({
          ...registration,
          email: 'pat1ent99@example.com',
          password: 'pat1ent99@example.com',
        })
        .expect(400);
      expect(sameAsEmail.body.error.code).toBe('PASSWORD_POLICY');
    });

    it('rejects a future date of birth', async () => {
      const { agent, csrf } = await client(app);
      const res = await agent
        .post('/api/auth/register')
        .set(CSRF_HEADER, csrf)
        .send({ ...registration, dateOfBirth: '2999-01-01' })
        .expect(400);
      expect(res.body.error.details[0].field).toBe('dateOfBirth');
    });

    it('retries with the next MRN when a concurrent registration took the number', async () => {
      t.prisma.mrnCollisions = 1;
      const { agent, csrf } = await client(app);
      await agent.post('/api/auth/register').set(CSRF_HEADER, csrf).send(registration).expect(201);
      expect(t.prisma.users).toHaveLength(1);
      expect(t.prisma.patients[0]!.mrn).toMatch(/-000002$/);
    });
  });

  describe('email verification (AUTH-006)', () => {
    it('blocks login until the email is verified', async () => {
      const { agent, csrf } = await client(app);
      await agent.post('/api/auth/register').set(CSRF_HEADER, csrf).send(registration).expect(201);
      const { res } = await login();
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('rejects a wrong code, then accepts the right one once', async () => {
      const { agent, csrf } = await client(app);
      await agent.post('/api/auth/register').set(CSRF_HEADER, csrf).send(registration).expect(201);
      const code = lastCode(t.emails);
      const wrong = code === '000000' ? '111111' : '000000';
      const bad = await agent
        .post('/api/auth/verify-email')
        .set(CSRF_HEADER, csrf)
        .send({ email: registration.email, otp: wrong })
        .expect(400);
      expect(bad.body.error.code).toBe('OTP_INVALID');
      await agent
        .post('/api/auth/verify-email')
        .set(CSRF_HEADER, csrf)
        .send({ email: registration.email, otp: code })
        .expect(200);
      expect(t.prisma.users[0]!.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('locks the code after five wrong attempts', async () => {
      const { agent, csrf } = await client(app);
      await agent.post('/api/auth/register').set(CSRF_HEADER, csrf).send(registration).expect(201);
      const code = lastCode(t.emails);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/auth/verify-email')
          .set(CSRF_HEADER, csrf)
          .send({ email: registration.email, otp: wrong })
          .expect(400);
      }
      const locked = await agent
        .post('/api/auth/verify-email')
        .set(CSRF_HEADER, csrf)
        .send({ email: registration.email, otp: code })
        .expect(429);
      expect(locked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    });

    it('resend answers identically for unknown accounts and during the cooldown', async () => {
      const { agent, csrf } = await client(app);
      await agent.post('/api/auth/register').set(CSRF_HEADER, csrf).send(registration).expect(201);
      const known = await agent
        .post('/api/auth/verify-email/resend')
        .set(CSRF_HEADER, csrf)
        .send({ email: registration.email })
        .expect(200);
      const unknown = await agent
        .post('/api/auth/verify-email/resend')
        .set(CSRF_HEADER, csrf)
        .send({ email: 'nobody@example.com' })
        .expect(200);
      expect(known.body).toEqual(unknown.body);
      expect(t.emails).toHaveLength(1); // still within the 60 s cooldown
    });
  });

  describe('login, me, refresh and logout (AUTH-002/003/008/009/010)', () => {
    it('rejects bad credentials with one generic error', async () => {
      await registerAndVerify();
      const wrong = await login('asha@example.com', 'Wrong-password-1');
      const unknown = await login('ghost@example.com', PASSWORD);
      for (const { res } of [wrong, unknown]) {
        expect(res.status).toBe(401);
        expect(res.body.error).toEqual({
          code: 'INVALID_CREDENTIALS',
          message: 'Email or password is incorrect.',
        });
      }
      expect(t.prisma.actions().filter((a) => a === 'auth.login_failed')).toHaveLength(2);
    });

    it('issues an access token and secure cookies, and /me returns role permissions', async () => {
      await registerAndVerify();
      const { res, token } = await login();
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        expiresIn: 900,
        user: { email: 'asha@example.com', role: 'PATIENT', emailVerified: true },
        hospital: { code: 'CITYCARE' },
        permissions: [...ROLE_PERMISSIONS.PATIENT],
      });
      expect(res.body.data.refreshToken).toBeUndefined();
      expect(res.body.data.csrfToken).toEqual(expect.any(String));
      const rt = cookieHeader(res, AUTH_COOKIES.refresh);
      expect(rt).toMatch(/HttpOnly/);
      expect(rt).toMatch(/SameSite=Strict/);
      expect(rt).toMatch(/Path=\/api\/auth/);
      expect(cookieHeader(res, AUTH_COOKIES.csrf)).toBeDefined();

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.data.user.email).toBe('asha@example.com');
      expect(me.body.data.permissions).toEqual([...ROLE_PERMISSIONS.PATIENT]);
      expect(t.prisma.users[0]!.lastLoginAt).toBeInstanceOf(Date);
    });

    it('requires a valid access token', async () => {
      const none = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
      expect(none.body.error.code).toBe('UNAUTHENTICATED');
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('rotates the refresh token; replaying an old one revokes every session (TEST-013)', async () => {
      await registerAndVerify();
      const other = await login();
      const { agent, csrf, res, token } = await login();
      const oldCookie = cookieHeader(res, AUTH_COOKIES.refresh)!.split(';')[0]!;

      const refreshed = await agent.post('/api/auth/refresh').set(CSRF_HEADER, csrf).expect(200);
      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
      expect(cookieHeader(refreshed, AUTH_COOKIES.refresh)!.split(';')[0]).not.toBe(oldCookie);

      // Attacker replays the first refresh token.
      const replay = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [oldCookie, `${AUTH_COOKIES.csrf}=${csrf}`])
        .set(CSRF_HEADER, csrf)
        .expect(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      expect(t.prisma.actions()).toContain('auth.refresh_reuse_detected');

      // Every session is gone: the legitimate holder must sign in again on every device.
      const legit = await agent
        .post('/api/auth/refresh')
        .set(CSRF_HEADER, refreshed.body.data.csrfToken)
        .expect(401);
      expect(legit.body.error.code).toBe('REFRESH_TOKEN_INVALID');
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${other.token}`)
        .expect(401);
    });

    it('refresh without a cookie is rejected', async () => {
      const { agent, csrf } = await client(app);
      const res = await agent.post('/api/auth/refresh').set(CSRF_HEADER, csrf).expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('logout revokes only this device; logout with allDevices revokes every device', async () => {
      await registerAndVerify();
      const a = await login();
      const b = await login();
      const c = await login();
      await a.agent.post('/api/auth/logout').set(CSRF_HEADER, a.csrf).send({}).expect(200);
      const me = (token?: string) =>
        request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      await me(a.token).expect(401);
      await me(b.token).expect(200);
      await b.agent
        .post('/api/auth/logout')
        .set(CSRF_HEADER, b.csrf)
        .send({ allDevices: true })
        .expect(200);
      await me(b.token).expect(401);
      await me(c.token).expect(401);
      expect(t.prisma.actions()).toEqual(
        expect.arrayContaining(['auth.logout', 'auth.logout_all']),
      );
    });

    it('refuses disabled accounts and suspended hospitals', async () => {
      await registerAndVerify();
      t.prisma.users[0]!.isActive = false;
      expect((await login()).res.body.error.code).toBe('ACCOUNT_DISABLED');
      t.prisma.users[0]!.isActive = true;
      t.prisma.hospitals[0]!.status = 'SUSPENDED';
      expect((await login()).res.body.error.code).toBe('HOSPITAL_SUSPENDED');
    });
  });

  describe('password reset (AUTH-004/005)', () => {
    it('answers identically for unknown emails and sends nothing', async () => {
      const { agent, csrf } = await client(app);
      const res = await agent
        .post('/api/auth/forgot-password')
        .set(CSRF_HEADER, csrf)
        .send({ email: 'ghost@example.com' })
        .expect(200);
      expect(res.body.data.message).toMatch(/If an account exists/);
      expect(t.emails).toHaveLength(0);
    });

    it('resets with a single-use link and signs out every device', async () => {
      await registerAndVerify();
      const session = await login();
      const { agent, csrf } = await client(app);
      await agent
        .post('/api/auth/forgot-password')
        .set(CSRF_HEADER, csrf)
        .send({ email: 'asha@example.com' })
        .expect(200);
      const link = /http:\/\/localhost:3000\/reset-password\?token=([A-Za-z0-9_-]{43})/.exec(
        t.emails.at(-1)!.text,
      );
      expect(link).not.toBeNull();
      const token = link![1];

      const weak = await agent
        .post('/api/auth/reset-password')
        .set(CSRF_HEADER, csrf)
        .send({ token, password: 'short1' })
        .expect(400);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');

      await agent
        .post('/api/auth/reset-password')
        .set(CSRF_HEADER, csrf)
        .send({ token, password: 'Brand-new-pass-7' })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(401);

      const again = await agent
        .post('/api/auth/reset-password')
        .set(CSRF_HEADER, csrf)
        .send({ token, password: 'Another-pass-8' })
        .expect(400);
      expect(again.body.error.code).toBe('RESET_TOKEN_INVALID');

      expect((await login('asha@example.com', PASSWORD)).res.status).toBe(401);
      expect((await login('asha@example.com', 'Brand-new-pass-7')).res.status).toBe(200);
      expect(t.prisma.actions()).toContain('auth.password_reset');
    });
  });

  describe('phone verification (AUTH-007)', () => {
    it('sends an SMS OTP to the signed-in user and verifies it', async () => {
      await registerAndVerify();
      const { agent, csrf, token } = await login();
      const sent = await agent
        .post('/api/auth/verify-phone/send')
        .set('Authorization', `Bearer ${token}`)
        .set(CSRF_HEADER, csrf)
        .expect(200);
      expect(sent.body.data.sentTo).toBe('*********3210');
      expect(t.sms).toHaveLength(1);
      expect(t.sms[0]!.to).toBe('+919876543210');
      await agent
        .post('/api/auth/verify-phone')
        .set('Authorization', `Bearer ${token}`)
        .set(CSRF_HEADER, csrf)
        .send({ otp: lastCode(t.sms) })
        .expect(200);
      expect(t.prisma.users[0]!.phoneVerifiedAt).toBeInstanceOf(Date);
    });

    it('requires authentication', async () => {
      const { agent, csrf } = await client(app);
      await agent.post('/api/auth/verify-phone/send').set(CSRF_HEADER, csrf).expect(401);
    });
  });

  describe('RBAC guard (ROLE-010)', () => {
    it('returns 403 for a role not listed in @Roles() and 200 for routes without @Roles()', async () => {
      await registerAndVerify();
      const { token } = await login();
      const res = await request(app.getHttpServer())
        .get('/api/probe-roles/admin-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await request(app.getHttpServer())
        .get('/api/probe-roles/any')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});

describe('Auth rate limit (SEC-005)', () => {
  it('limits auth endpoints per IP without affecting other routes', async () => {
    const t = await createAuthTestApp(
      { AUTH_THROTTLE_LIMIT: '3' },
      { controllers: [ProbeRolesController] },
    );
    try {
      const server = t.app.getHttpServer();
      for (let i = 0; i < 3; i++) await request(server).get('/api/auth/csrf').expect(200);
      const limited = await request(server).get('/api/auth/csrf').expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      // A non-auth route is still governed only by the general limit (here it needs a token).
      for (let i = 0; i < 5; i++) await request(server).get('/api/probe-roles/any').expect(401);
    } finally {
      await t.app.close();
    }
  });
});
