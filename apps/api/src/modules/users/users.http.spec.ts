import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { UsersModule } from './users.module';

const CSRF = 'c'.repeat(43);

describe('Users endpoints (API-012) with tenant scoping', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let a: Hospital;
  let b: Hospital;
  let root: User;
  let adminA: User;
  let nurseA: User;
  let patientA: User;
  let adminB: User;
  let doctorB: User;

  beforeEach(async () => {
    t = await createAuthTestApp({}, { modules: [UsersModule] });
    app = t.app;
    a = t.prisma.addHospital({ code: 'HOSPA', name: 'A' });
    b = t.prisma.addHospital({ code: 'HOSPB', name: 'B' });
    root = t.prisma.addUser({ role: 'SUPER_ADMIN', firstName: 'Root', lastName: 'Admin' });
    adminA = t.prisma.addUser({
      role: 'HOSPITAL_ADMIN',
      hospitalId: a.id,
      firstName: 'Ada',
      lastName: 'Admin',
    });
    nurseA = t.prisma.addUser({
      role: 'NURSE',
      hospitalId: a.id,
      firstName: 'Nina',
      lastName: 'Nurse',
      phone: '+911111111111',
      phoneVerifiedAt: new Date(),
    });
    patientA = t.prisma.addUser({
      role: 'PATIENT',
      hospitalId: a.id,
      firstName: 'Pat',
      lastName: 'Patient',
    });
    adminB = t.prisma.addUser({
      role: 'HOSPITAL_ADMIN',
      hospitalId: b.id,
      firstName: 'Bob',
      lastName: 'Admin',
    });
    doctorB = t.prisma.addUser({
      role: 'DOCTOR',
      hospitalId: b.id,
      firstName: 'Dee',
      lastName: 'Doctor',
    });
  });
  afterEach(() => app.close());

  const as = async (user: User) => {
    const token = await t.tokenFor(user);
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${token}` };
    const write = { ...auth, Cookie: `${AUTH_COOKIES.csrf}=${CSRF}`, [CSRF_HEADER]: CSRF };
    return {
      get: (url: string) => request(server).get(url).set(auth),
      patch: (url: string, body: object) => request(server).patch(url).set(write).send(body),
      del: (url: string) => request(server).delete(url).set(write),
    };
  };

  describe('GET /users', () => {
    it('Hospital Admin sees only their hospital, never credentials', async () => {
      const res = await (await as(adminA)).get('/api/users').expect(200);
      expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
      expect(res.body.data.map((u: { id: string }) => u.id).sort()).toEqual(
        [adminA.id, nurseA.id, patientA.id].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });

    it('supports search, role and active filters and paging', async () => {
      const c = await as(adminA);
      expect(
        (await c.get('/api/users?search=nin').expect(200)).body.data.map(
          (u: { id: string }) => u.id,
        ),
      ).toEqual([nurseA.id]);
      expect((await c.get('/api/users?role=PATIENT').expect(200)).body.data).toHaveLength(1);
      const page = await c.get('/api/users?limit=2&page=2').expect(200);
      expect(page.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
      expect(page.body.data).toHaveLength(1);
      await c.get('/api/users?limit=500').expect(400);
    });

    it('Super Admin sees every hospital and can filter by hospitalId; the read is audited', async () => {
      const c = await as(root);
      expect((await c.get('/api/users').expect(200)).body.meta.total).toBe(6);
      const onlyB = await c.get(`/api/users?hospitalId=${b.id}`).expect(200);
      expect(onlyB.body.data.map((u: { id: string }) => u.id).sort()).toEqual(
        [adminB.id, doctorB.id].sort(),
      );
      const entry = t.prisma.audit.find((x) => x.action === 'super_admin.read');
      expect(entry).toMatchObject({ actorId: root.id, entityType: 'Users' });
    });

    it('a Hospital Admin naming another hospital gets 404 (TEN-003)', async () => {
      const res = await (await as(adminA)).get(`/api/users?hospitalId=${b.id}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('is refused to non-administrators', async () => {
      const res = await (await as(nurseA)).get('/api/users').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /users/:id (self or admin)', () => {
    it('allows self and the hospital admin; refuses another user of the same hospital', async () => {
      await (await as(nurseA)).get(`/api/users/${nurseA.id}`).expect(200);
      await (await as(adminA)).get(`/api/users/${nurseA.id}`).expect(200);
      const res = await (await as(patientA)).get(`/api/users/${nurseA.id}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('validates the id', async () => {
      await (await as(adminA)).get('/api/users/not-a-uuid').expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('lets users change their own name and phone; a new phone needs verifying again', async () => {
      const res = await (
        await as(nurseA)
      )
        .patch(`/api/users/${nurseA.id}`, { firstName: 'Nora', phone: '+912222222222' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        firstName: 'Nora',
        phone: '+912222222222',
        phoneVerified: false,
      });
      const entry = t.prisma.audit.find((x) => x.action === 'user.update');
      expect(entry).toMatchObject({
        actorId: nurseA.id,
        entityType: 'User',
        entityId: nurseA.id,
        hospitalId: a.id,
      });
      expect(entry?.changes).toEqual({
        method: 'PATCH',
        route: '/api/users/:id',
        fields: ['firstName', 'phone'],
      });
      // Personal values (name, phone) are never stored in the audit log (DEC-030).
      expect(JSON.stringify(entry?.changes)).not.toMatch(/Nora|2222222222/);
    });

    it('only administrators change isActive; deactivation signs the user out everywhere', async () => {
      await (await as(nurseA)).patch(`/api/users/${nurseA.id}`, { isActive: false }).expect(403);
      const nurse = await as(nurseA);
      await nurse.get(`/api/users/${nurseA.id}`).expect(200);
      await (await as(adminA)).patch(`/api/users/${nurseA.id}`, { isActive: false }).expect(200);
      await nurse.get(`/api/users/${nurseA.id}`).expect(401);
      await (await as(adminA)).patch(`/api/users/${adminA.id}`, { isActive: false }).expect(403);
    });

    it('rejects unknown fields such as role or email', async () => {
      await (
        await as(adminA)
      )
        .patch(`/api/users/${nurseA.id}`, { role: 'HOSPITAL_ADMIN' })
        .expect(400);
      await (await as(nurseA)).patch(`/api/users/${nurseA.id}`, { email: 'x@y.z' }).expect(400);
    });
  });

  describe('DELETE /users/:id', () => {
    it('soft-deletes, signs out and audits; the user then no longer exists', async () => {
      const nurse = await as(nurseA);
      const admin = await as(adminA);
      const res = await admin.del(`/api/users/${nurseA.id}`).expect(200);
      expect(res.body.data).toEqual({ id: nurseA.id, deleted: true });
      expect(t.prisma.users.find((u) => u.id === nurseA.id)).toMatchObject({
        isActive: false,
        deletedAt: expect.any(Date),
      });
      await nurse.get(`/api/users/${nurseA.id}`).expect(401);
      await admin.get(`/api/users/${nurseA.id}`).expect(404);
      expect(t.prisma.actions()).toContain('user.delete');
    });

    it('cannot delete yourself and is refused to non-administrators', async () => {
      await (await as(adminA)).del(`/api/users/${adminA.id}`).expect(403);
      await (await as(nurseA)).del(`/api/users/${patientA.id}`).expect(403);
    });

    it('requires the CSRF token', async () => {
      const token = await t.tokenFor(adminA);
      const res = await request(app.getHttpServer())
        .delete(`/api/users/${nurseA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    });
  });

  describe('tenant isolation (TEST-010, TEST-016)', () => {
    it('another hospital’s user does not exist for any route, even with a guessed id', async () => {
      const c = await as(adminA);
      for (const target of [adminB, doctorB, root]) {
        await c.get(`/api/users/${target.id}`).expect(404);
        await c.patch(`/api/users/${target.id}`, { firstName: 'Hacked' }).expect(404);
        await c.del(`/api/users/${target.id}`).expect(404);
      }
      expect(t.prisma.users.find((u) => u.id === doctorB.id)).toMatchObject({
        firstName: 'Dee',
        deletedAt: null,
      });
      const patient = await as(patientA);
      await patient.get(`/api/users/${doctorB.id}`).expect(404);
    });

    it('a Super Admin can act across hospitals and is audited', async () => {
      await (await as(root)).patch(`/api/users/${doctorB.id}`, { lastName: 'Fixed' }).expect(200);
      const entry = t.prisma.audit.find((x) => x.action === 'user.update');
      expect(entry).toMatchObject({ actorId: root.id, entityId: doctorB.id });
      expect(entry?.changes).toMatchObject({ crossTenant: true });
    });
  });
});
