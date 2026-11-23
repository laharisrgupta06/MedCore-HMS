import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { DepartmentsModule } from '../departments/departments.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { FacilitiesModule } from '../facilities/facilities.module';
import { HospitalsModule } from '../hospitals/hospitals.module';
import { PatientsModule } from '../patients/patients.module';
import { StaffModule } from '../staff/staff.module';

const CSRF = 'o'.repeat(43);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

describe('Phase 2: hospital management (in-memory Prisma)', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let root: User;
  let hA: Hospital;
  let hB: Hospital;
  let adminA: User;
  let adminB: User;

  beforeEach(async () => {
    t = await createAuthTestApp(
      {},
      {
        modules: [
          HospitalsModule,
          DepartmentsModule,
          StaffModule,
          DoctorsModule,
          PatientsModule,
          FacilitiesModule,
        ],
      },
    );
    app = t.app;
    root = t.prisma.addUser({ role: 'SUPER_ADMIN' });
    hA = t.prisma.addHospital({ code: 'HOSPA', name: 'Hospital A' });
    hB = t.prisma.addHospital({ code: 'HOSPB', name: 'Hospital B' });
    adminA = t.prisma.addUser({ role: 'HOSPITAL_ADMIN', hospitalId: hA.id, firstName: 'Ada' });
    adminB = t.prisma.addUser({ role: 'HOSPITAL_ADMIN', hospitalId: hB.id, firstName: 'Bo' });
  });
  afterEach(() => app.close());

  const as = async (u: Pick<User, 'id' | 'role' | 'hospitalId'>) => {
    const token = await t.tokenFor(u);
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${token}` };
    const write = { ...auth, Cookie: `${AUTH_COOKIES.csrf}=${CSRF}`, [CSRF_HEADER]: CSRF };
    return {
      get: (url: string) => request(server).get(url).set(auth),
      post: (url: string, body: object = {}) => request(server).post(url).set(write).send(body),
      patch: (url: string, body: object) => request(server).patch(url).set(write).send(body),
      del: (url: string) => request(server).delete(url).set(write),
      upload: (url: string, buf: Buffer, name: string, type: string) =>
        request(server)
          .post(url)
          .set(write)
          .attach('file', buf, { filename: name, contentType: type }),
    };
  };
  const tokenFromLastEmail = () => /token=([A-Za-z0-9_-]{43})/.exec(t.emails.at(-1)!.text)![1]!;

  describe('hospital onboarding', () => {
    const body = {
      name: 'City Care',
      code: 'citycare',
      email: 'office@citycare.test',
      phone: '+914400000000',
      licenseNumber: 'KA-123',
      admin: { firstName: 'Hema', lastName: 'Admin', email: 'hema@citycare.test' },
    };

    it('creates a PENDING hospital and its admin, who sets a password from the emailed link and signs in', async () => {
      const sa = await as(root);
      const res = await sa.post('/api/hospitals', body).expect(201);
      expect(res.body.data).toMatchObject({ code: 'CITYCARE', status: 'PENDING' });
      const admin = t.prisma.users.find((u) => u.email === 'hema@citycare.test')!;
      expect(admin).toMatchObject({
        role: 'HOSPITAL_ADMIN',
        hospitalId: res.body.data.id,
        emailVerifiedAt: null,
      });
      expect(t.prisma.rows('StaffProfile').some((s) => s.userId === admin.id)).toBe(true);
      expect(t.emails.at(-1)).toMatchObject({
        to: 'hema@citycare.test',
        subject: 'Your MedCore account is ready',
      });

      const csrf = (await request(app.getHttpServer()).get('/api/auth/csrf')).body.data
        .csrfToken as string;
      const anon = () => request(app.getHttpServer());
      await anon()
        .post('/api/auth/reset-password')
        .set('Cookie', `${AUTH_COOKIES.csrf}=${csrf}`)
        .set(CSRF_HEADER, csrf)
        .send({ token: tokenFromLastEmail(), password: 'Admin-password-1' })
        .expect(200);
      const login = await anon()
        .post('/api/auth/login')
        .set('Cookie', `${AUTH_COOKIES.csrf}=${csrf}`)
        .set(CSRF_HEADER, csrf)
        .send({ email: 'hema@citycare.test', password: 'Admin-password-1' })
        .expect(200);
      expect(login.body.data.user.role).toBe('HOSPITAL_ADMIN');
    });

    it('rejects a duplicate code or admin email and is Super Admin only', async () => {
      const sa = await as(root);
      await sa.post('/api/hospitals', body).expect(201);
      expect(
        (
          await sa
            .post('/api/hospitals', { ...body, admin: { ...body.admin, email: 'x@citycare.test' } })
            .expect(409)
        ).body.error.code,
      ).toBe('CONFLICT');
      expect(
        (await sa.post('/api/hospitals', { ...body, code: 'OTHER' }).expect(409)).body.error.code,
      ).toBe('EMAIL_IN_USE');
      await (await as(adminA)).post('/api/hospitals', body).expect(403);
    });

    it('verify enables registration; suspend signs every user of the hospital out', async () => {
      const sa = await as(root);
      t.prisma.hospitals.find((h) => h.id === hA.id)!.status = 'PENDING';
      expect((await sa.post(`/api/hospitals/${hA.id}/verify`).expect(200)).body.data.status).toBe(
        'VERIFIED',
      );
      const admin = await as(adminA);
      await admin.get(`/api/hospitals/${hA.id}`).expect(200);
      expect((await sa.post(`/api/hospitals/${hA.id}/suspend`).expect(200)).body.data.status).toBe(
        'SUSPENDED',
      );
      await admin.get(`/api/hospitals/${hA.id}`).expect(401);
      expect(t.prisma.actions()).toEqual(
        expect.arrayContaining(['hospital.verify', 'hospital.suspend']),
      );
    });

    it('a Hospital Admin edits only their own hospital and billing configuration', async () => {
      const admin = await as(adminA);
      const res = await admin
        .patch(`/api/hospitals/${hA.id}`, { taxRatePercent: 18, invoicePrefix: 'ccx' })
        .expect(200);
      expect(res.body.data).toMatchObject({ taxRatePercent: '18', invoicePrefix: 'CCX' });
      await admin.patch(`/api/hospitals/${hB.id}`, { name: 'Taken over' }).expect(404);
      await admin.get(`/api/hospitals/${hB.id}`).expect(404);
      await admin.patch(`/api/hospitals/${hA.id}`, { taxRatePercent: 150 }).expect(400);
    });
  });

  describe('departments', () => {
    it('create, list, rename; duplicates and in-use deletes are refused', async () => {
      const admin = await as(adminA);
      const d = (
        await admin.post(`/api/hospitals/${hA.id}/departments`, { name: 'Cardiology' }).expect(201)
      ).body.data;
      await admin.post(`/api/hospitals/${hA.id}/departments`, { name: 'Cardiology' }).expect(409);
      await admin.post(`/api/hospitals/${hB.id}/departments`, { name: 'Sneaky' }).expect(404);
      expect(
        (await admin.get(`/api/hospitals/${hA.id}/departments`).expect(200)).body.data,
      ).toHaveLength(1);
      await admin.patch(`/api/departments/${d.id}`, { name: 'Cardiac Care' }).expect(200);
      await admin
        .post('/api/staff', {
          role: 'NURSE',
          firstName: 'N',
          lastName: 'One',
          email: 'n1@a.test',
          departmentId: d.id,
        })
        .expect(201);
      expect((await admin.del(`/api/departments/${d.id}`).expect(409)).body.error.code).toBe(
        'IN_USE',
      );
      await (await as(adminB)).patch(`/api/departments/${d.id}`, { name: 'x' }).expect(404);
    });
  });

  describe('staff', () => {
    it('creates staff with a welcome email; validates role and senior flag; filters; isolates hospitals', async () => {
      const admin = await as(adminA);
      const res = await admin
        .post('/api/staff', {
          role: 'LAB_TECHNICIAN',
          firstName: 'Lee',
          lastName: 'Lab',
          email: 'lee@a.test',
          isSeniorLabTechnician: true,
          employeeCode: 'E1',
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        isSeniorLabTechnician: true,
        user: { role: 'LAB_TECHNICIAN', email: 'lee@a.test' },
      });
      expect(t.emails.at(-1)!.to).toBe('lee@a.test');
      await admin
        .post('/api/staff', { role: 'DOCTOR', firstName: 'D', lastName: 'X', email: 'd@a.test' })
        .expect(400);
      await admin
        .post('/api/staff', {
          role: 'NURSE',
          firstName: 'N',
          lastName: 'X',
          email: 'n@a.test',
          isSeniorLabTechnician: true,
        })
        .expect(400);
      await admin
        .post('/api/staff', {
          role: 'NURSE',
          firstName: 'N',
          lastName: 'X',
          email: 'n2@a.test',
          employeeCode: 'E1',
        })
        .expect(409);
      expect(
        (await admin.get('/api/staff?role=LAB_TECHNICIAN').expect(200)).body.data,
      ).toHaveLength(1);
      const id = res.body.data.user.id;
      await (await as(adminB)).get(`/api/staff/${id}`).expect(404);
      await admin.post(`/api/staff/${id}/invite`).expect(200);
    });
  });

  describe('doctors', () => {
    it('admin creates a doctor with departments; anyone in the hospital can list; the doctor edits only own bio', async () => {
      const admin = await as(adminA);
      const dept = (await admin.post(`/api/hospitals/${hA.id}/departments`, { name: 'Cardiology' }))
        .body.data;
      await admin
        .post('/api/doctors', {
          firstName: 'Dee',
          lastName: 'Doc',
          email: 'dee@a.test',
          registrationNumber: 'MCI-1',
          specialisation: 'Cardiology',
          consultationFee: 700,
          departmentIds: ['11111111-1111-4111-8111-111111111111'],
        })
        .expect(400);
      const doc = (
        await admin
          .post('/api/doctors', {
            firstName: 'Dee',
            lastName: 'Doc',
            email: 'dee@a.test',
            registrationNumber: 'MCI-1',
            specialisation: 'Cardiology',
            consultationFee: 700,
            departmentIds: [dept.id],
          })
          .expect(201)
      ).body.data;
      expect(doc).toMatchObject({
        consultationFee: '700',
        departments: [{ id: dept.id, name: 'Cardiology' }],
        hasSignature: false,
      });

      const patientUser = t.prisma.addUser({ role: 'PATIENT', hospitalId: hA.id });
      const list = await (
        await as(patientUser)
      )
        .get('/api/doctors?specialisation=cardio')
        .expect(200);
      expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([doc.id]);
      expect((await (await as(adminB)).get('/api/doctors').expect(200)).body.data).toHaveLength(0);

      const doctorUser = t.prisma.users.find((u) => u.email === 'dee@a.test')!;
      const self = await as(doctorUser);
      expect(
        (
          await self
            .patch(`/api/doctors/${doc.id}`, { bio: 'Twenty years in cardiology.' })
            .expect(200)
        ).body.data.bio,
      ).toBe('Twenty years in cardiology.');
      await self.patch(`/api/doctors/${doc.id}`, { consultationFee: 1 }).expect(403);
    });

    it('signature upload checks the actual file content', async () => {
      const admin = await as(adminA);
      const doc = (
        await admin
          .post('/api/doctors', {
            firstName: 'Sig',
            lastName: 'Doc',
            email: 'sig@a.test',
            registrationNumber: 'MCI-2',
            specialisation: 'General',
            consultationFee: 300,
            departmentIds: [],
          })
          .expect(201)
      ).body.data;
      await admin
        .upload(
          `/api/doctors/${doc.id}/signature`,
          Buffer.from('MZ not an image'),
          'sig.png',
          'image/png',
        )
        .expect(400);
      await admin
        .upload(`/api/doctors/${doc.id}/signature`, PNG, 'sig.png', 'image/jpeg')
        .expect(400);
      const ok = await admin
        .upload(`/api/doctors/${doc.id}/signature`, PNG, 'sig.png', 'image/png')
        .expect(201);
      expect(ok.body.data.hasSignature).toBe(true);
      const img = await admin.get(`/api/doctors/${doc.id}/signature`).expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    });
  });

  describe('patients', () => {
    it('reception registers a patient with an MRN; search; patients see only themselves', async () => {
      const reception = t.prisma.addUser({ role: 'RECEPTIONIST', hospitalId: hA.id });
      const r = await as(reception);
      const p = (
        await r
          .post('/api/patients', {
            firstName: 'Pat',
            lastName: 'One',
            email: 'pat1@a.test',
            dateOfBirth: '1980-02-03',
            gender: 'FEMALE',
            bloodGroup: 'O_POSITIVE',
          })
          .expect(201)
      ).body.data;
      expect(p.mrn).toMatch(/^MRN-\d{4}-000001$/);
      expect(t.emails.at(-1)!.to).toBe('pat1@a.test');
      await r
        .post('/api/patients', {
          firstName: 'Pat',
          lastName: 'Two',
          email: 'pat1@a.test',
          dateOfBirth: '1980-02-03',
          gender: 'MALE',
        })
        .expect(409);
      await r
        .post('/api/patients', {
          firstName: 'Pat',
          lastName: 'Two',
          email: 'pat2@a.test',
          dateOfBirth: '2999-02-03',
          gender: 'MALE',
        })
        .expect(400);
      const p2 = (
        await r
          .post('/api/patients', {
            firstName: 'Ravi',
            lastName: 'Two',
            email: 'pat2@a.test',
            dateOfBirth: '1975-01-01',
            gender: 'MALE',
          })
          .expect(201)
      ).body.data;
      expect(
        (await r.get(`/api/patients?search=${p.mrn}`).expect(200)).body.data.map(
          (x: { id: string }) => x.id,
        ),
      ).toEqual([p.id]);
      await r
        .patch(`/api/patients/${p.id}`, {
          emergencyContactName: 'Sam',
          emergencyContactPhone: '+919999999999',
        })
        .expect(200);

      const patient1 = t.prisma.users.find((u) => u.email === 'pat1@a.test')!;
      const me = await as(patient1);
      expect((await me.get('/api/patients/me').expect(200)).body.data.id).toBe(p.id);
      await me.get(`/api/patients/${p.id}`).expect(200);
      await me.get(`/api/patients/${p2.id}`).expect(404);
      await me.get('/api/patients').expect(403);
      await (await as(adminB)).get(`/api/patients/${p.id}`).expect(404);
    });
  });

  describe('rooms and beds', () => {
    it('admin structures rooms and beds; nurses update occupancy only; guards on deletes', async () => {
      const admin = await as(adminA);
      const room = (
        await admin
          .post('/api/rooms', { number: '204', type: 'WARD', floor: '2', dailyCharge: 1500 })
          .expect(201)
      ).body.data;
      await admin.post('/api/rooms', { number: '204', type: 'ICU' }).expect(409);
      const bed = (await admin.post(`/api/rooms/${room.id}/beds`, { label: 'A' }).expect(201)).body
        .data;
      await admin.post(`/api/rooms/${room.id}/beds`, { label: 'A' }).expect(409);
      const nurse = await as(t.prisma.addUser({ role: 'NURSE', hospitalId: hA.id }));
      expect(
        (await nurse.patch(`/api/beds/${bed.id}`, { status: 'OCCUPIED' }).expect(200)).body.data
          .status,
      ).toBe('OCCUPIED');
      await nurse.patch(`/api/beds/${bed.id}`, { label: 'Z' }).expect(403);
      expect((await admin.del(`/api/beds/${bed.id}`).expect(400)).body.error.code).toBe(
        'BED_OCCUPIED',
      );
      expect((await admin.del(`/api/rooms/${room.id}`).expect(409)).body.error.code).toBe('IN_USE');
      const rooms = (await nurse.get('/api/rooms').expect(200)).body.data;
      expect(rooms[0]).toMatchObject({
        number: '204',
        dailyCharge: '1500',
        beds: [{ label: 'A', status: 'OCCUPIED' }],
      });
      await (await as(adminB)).get(`/api/rooms/${room.id}`).expect(404);
    });
  });
});
