import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { DomainEvents } from '../../common/events/domain-events';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { LabModule } from './lab.module';

const CSRF = 'a'.repeat(43);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF');

describe('Phase 6: laboratory (in-memory Prisma)', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let h: Hospital;
  let doctorUser: User,
    doctor2User: User,
    nurse: User,
    reception: User,
    tech: User,
    senior1: User,
    senior2: User,
    admin: User,
    pharmacist: User;
  let patientUser: User, patient2User: User;
  let recordId: string, closedRecordId: string, maleRecordId: string;
  let push: (model: string, row: Record<string, unknown>) => string;

  beforeEach(async () => {
    t = await createAuthTestApp({}, { modules: [LabModule] });
    app = t.app;
    h = t.prisma.addHospital({ timezone: 'Asia/Kolkata' });
    push = (model, row) => {
      const r = {
        id: crypto.randomUUID(),
        hospitalId: h.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      };
      t.prisma.rows(model).push(r);
      return r.id as string;
    };
    const dept = push('Department', { name: 'General', description: null });
    const staff = (role: string, senior = false) => {
      const u = t.prisma.addUser({ role: role as never, hospitalId: h.id });
      push('StaffProfile', {
        userId: u.id,
        departmentId: null,
        employeeCode: null,
        designation: null,
        isSeniorLabTechnician: senior,
      });
      return u;
    };
    doctorUser = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dee' });
    doctor2User = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dan' });
    nurse = staff('NURSE');
    reception = staff('RECEPTIONIST');
    tech = staff('LAB_TECHNICIAN');
    senior1 = staff('LAB_TECHNICIAN', true);
    senior2 = staff('LAB_TECHNICIAN', true);
    admin = staff('HOSPITAL_ADMIN');
    pharmacist = staff('PHARMACIST');
    patientUser = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pat' });
    patient2User = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pia' });
    const doctorId = push('Doctor', {
      userId: doctorUser.id,
      registrationNumber: 'K1',
      specialisation: 'General',
      qualification: null,
      consultationFee: 1,
      bio: null,
      signatureFileId: null,
      deletedAt: null,
    });
    const patientId = push('Patient', {
      userId: patientUser.id,
      mrn: 'MRN-1',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'FEMALE',
      deletedAt: null,
    });
    const malePatient = push('Patient', {
      userId: patient2User.id,
      mrn: 'MRN-2',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'MALE',
      deletedAt: null,
    });
    const record = (pid: string, status: string) => {
      const appt = push('Appointment', {
        doctorId,
        patientId: pid,
        departmentId: dept,
        scheduledAt: new Date(),
        endAt: new Date(Date.now() + 1_800_000),
        status: status === 'OPEN' ? 'IN_PROGRESS' : 'COMPLETED',
        type: 'REGULAR',
        reason: null,
        cancellationReason: null,
        createdById: patientUser.id,
        deletedAt: null,
      });
      return push('MedicalRecord', {
        appointmentId: appt,
        chiefComplaint: 'Tired',
        presentingSymptoms: null,
        treatmentPlanEnc: null,
        status,
        closedAt: status === 'CLOSED' ? new Date() : null,
      });
    };
    recordId = record(patientId, 'OPEN');
    closedRecordId = record(patientId, 'CLOSED');
    maleRecordId = record(malePatient, 'OPEN');
  });
  afterEach(() => app.close());

  const as = async (u: User) => {
    const token = await t.tokenFor(u);
    const auth = { Authorization: `Bearer ${token}` };
    const write = { ...auth, Cookie: `${AUTH_COOKIES.csrf}=${CSRF}`, [CSRF_HEADER]: CSRF };
    const server = app.getHttpServer();
    return {
      get: (url: string) => request(server).get(url).set(auth),
      post: (url: string, body: object = {}) => request(server).post(url).set(write).send(body),
      patch: (url: string, body: object = {}) => request(server).patch(url).set(write).send(body),
      upload: (url: string, data: Buffer, name: string) =>
        request(server)
          .post(url)
          .set(write)
          .attach('file', data, { filename: name, contentType: 'application/pdf' }),
    };
  };
  const catalogue = async () => {
    const adm = await as(admin);
    const hb = (
      await adm
        .post('/api/lab-tests', {
          code: 'hb',
          name: 'Haemoglobin',
          category: 'LABORATORY',
          unit: 'g/dL',
          sampleType: 'Blood',
          price: 150,
          ranges: [
            { low: 12, high: 17 },
            { gender: 'FEMALE', low: 12, high: 15.5 },
            { gender: 'MALE', low: 13.5, high: 17.5 },
          ],
        })
        .expect(201)
    ).body.data;
    const xr = (
      await adm
        .post('/api/lab-tests', {
          code: 'XR-CHEST',
          name: 'Chest X-ray',
          category: 'RADIOLOGY',
          price: 400,
        })
        .expect(201)
    ).body.data;
    return { hb, xr };
  };
  const order = async (testIds: string[], rec = recordId) =>
    (
      await (
        await as(doctorUser)
      )
        .post('/api/lab-orders', {
          medicalRecordId: rec,
          testIds,
          priority: 'URGENT',
          clinicalNotes: 'Pale, fatigue',
        })
        .expect(201)
    ).body.data;
  const toProcessing = async (id: string) => {
    await (await as(reception)).patch(`/api/lab-orders/${id}/sample`).expect(200);
    await (await as(tech)).patch(`/api/lab-orders/${id}/processing`).expect(200);
  };

  it('catalogue: admins keep tests and ranges; radiology has no ranges; codes are unique', async () => {
    const { hb } = await catalogue();
    expect(hb).toMatchObject({
      code: 'HB',
      unit: 'g/dL',
      price: '150.00',
      ranges: expect.arrayContaining([
        { gender: 'FEMALE', ageMinYears: null, ageMaxYears: null, low: 12, high: 15.5 },
      ]),
    });
    const adm = await as(admin);
    await adm
      .post('/api/lab-tests', { code: 'HB', name: 'Dup', category: 'LABORATORY', price: 1 })
      .expect(409);
    await adm
      .post('/api/lab-tests', {
        code: 'CT',
        name: 'CT',
        category: 'RADIOLOGY',
        price: 1,
        ranges: [{ low: 1, high: 2 }],
      })
      .expect(400);
    await adm
      .post('/api/lab-tests', {
        code: 'X1',
        name: 'Bad',
        category: 'LABORATORY',
        price: 1,
        ranges: [{ low: 5, high: 1 }],
      })
      .expect(400);
    expect(
      (await (await as(doctorUser)).get('/api/lab-tests?search=haem').expect(200)).body.data,
    ).toHaveLength(1);
    await (await as(pharmacist)).get('/api/lab-tests').expect(403);
    await (
      await as(doctorUser)
    )
      .post('/api/lab-tests', { code: 'Z', name: 'Z', category: 'LABORATORY', price: 1 })
      .expect(403);
  });

  it('runs order → sample → results → senior approval; values stay hidden until approval (LAB-001..006)', async () => {
    const { hb, xr } = await catalogue();
    const o = await order([hb.id, xr.id]);
    expect(o).toMatchObject({
      status: 'ORDERED',
      priority: 'URGENT',
      clinicalNotes: 'Pale, fatigue',
      orderedBy: { id: doctorUser.id },
    });
    expect((await (await as(patientUser)).get('/api/lab-orders').expect(200)).body.meta.total).toBe(
      0,
    );
    await (await as(patientUser)).get(`/api/lab-orders/${o.id}`).expect(404);
    await (await as(tech)).patch(`/api/lab-orders/${o.id}/processing`).expect(409);
    await toProcessing(o.id);
    const lt = await as(tech);
    const [hbItem, xrItem] = [
      o.items.find((i: { test: { code: string } }) => i.test.code === 'HB'),
      o.items.find((i: { test: { code: string } }) => i.test.code === 'XR-CHEST'),
    ];
    await lt
      .patch(`/api/lab-orders/${o.id}/result`, {
        results: [{ itemId: xrItem.id, valueNumeric: 3 }],
      })
      .expect(400);
    const partial = (
      await lt
        .patch(`/api/lab-orders/${o.id}/result`, {
          results: [{ itemId: hbItem.id, valueNumeric: 11.2 }],
        })
        .expect(200)
    ).body.data;
    expect(partial.items.find((i: { id: string }) => i.id === hbItem.id).result).toMatchObject({
      valueNumeric: 11.2,
      flag: 'LOW',
      unit: 'g/dL',
      referenceLow: 12,
      referenceHigh: 15.5,
      enteredBy: { id: tech.id },
    });
    expect(
      (await lt.patch(`/api/lab-orders/${o.id}/result`, { results: [], submit: true }).expect(400))
        .body.error.code,
    ).toBe('RESULTS_INCOMPLETE');
    await lt
      .patch(`/api/lab-orders/${o.id}/result`, {
        results: [{ itemId: xrItem.id, valueText: 'No consolidation.' }],
        submit: true,
      })
      .expect(200);
    const doctorView = (await (await as(doctorUser)).get(`/api/lab-orders/${o.id}`).expect(200))
      .body.data;
    expect(doctorView).toMatchObject({ status: 'RESULT_UPLOADED', resultsVisible: false });
    expect(doctorView.items.every((i: { result: unknown }) => i.result === null)).toBe(true);
    await (await as(doctorUser)).get(`/api/lab-orders/${o.id}/report`).expect(403);
    expect((await lt.patch(`/api/lab-orders/${o.id}/approve`).expect(403)).body.error.code).toBe(
      'NOT_SENIOR',
    );
    const approved = (
      await (await as(senior1)).patch(`/api/lab-orders/${o.id}/approve`).expect(200)
    ).body.data;
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: { id: senior1.id } });
    expect(t.app.get(DomainEvents).recent).toContainEqual({
      type: 'lab.report.approved',
      hospitalId: h.id,
      labOrderId: o.id,
    });
    const mine = (await (await as(patientUser)).get('/api/lab-orders').expect(200)).body;
    expect(mine.meta.total).toBe(1);
    expect(mine.data[0].items.find((i: { id: string }) => i.id === hbItem.id).result.flag).toBe(
      'LOW',
    );
    const pdf = await (
      await as(patientUser)
    )
      .get(`/api/lab-orders/${o.id}/report`)
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (d: Buffer) => c.push(d));
        r.on('end', () => cb(null, Buffer.concat(c)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await (await as(patient2User)).get(`/api/lab-orders/${o.id}`).expect(404);
    expect(
      (await (await as(nurse)).get(`/api/lab-orders/${o.id}`).expect(200)).body.data.resultsVisible,
    ).toBe(true);
    const rec = (await (await as(reception)).get(`/api/lab-orders/${o.id}`).expect(200)).body.data;
    expect(rec.resultsVisible).toBe(false);
    expect(
      t.prisma
        .rows('AuditLog')
        .some((a) => a.action === 'lab_order.report' && a.actorId === patientUser.id),
    ).toBe(true);
  });

  it('selects the most specific range; values on a limit are NORMAL (LAB-006)', async () => {
    const { hb } = await catalogue();
    const female = await order([hb.id]);
    const male = await order([hb.id], maleRecordId);
    for (const [o, v] of [
      [female, 12],
      [male, 13.4],
    ] as const) {
      await toProcessing(o.id);
      const res = (
        await (
          await as(tech)
        )
          .patch(`/api/lab-orders/${o.id}/result`, {
            results: [{ itemId: o.items[0].id, valueNumeric: v }],
          })
          .expect(200)
      ).body.data;
      expect(res.items[0].result).toMatchObject(
        o === female
          ? { flag: 'NORMAL', referenceLow: 12, referenceHigh: 15.5 }
          : { flag: 'LOW', referenceLow: 13.5, referenceHigh: 17.5 },
      );
    }
  });

  it('sends back on rejection, blocks self-approval, locks approved results, and amends (D7, LAB-004)', async () => {
    const { hb } = await catalogue();
    const o = await order([hb.id]);
    await toProcessing(o.id);
    const s1 = await as(senior1);
    await s1
      .patch(`/api/lab-orders/${o.id}/result`, {
        results: [{ itemId: o.items[0].id, valueNumeric: 20 }],
        submit: true,
      })
      .expect(200);
    expect((await s1.patch(`/api/lab-orders/${o.id}/approve`).expect(403)).body.error.code).toBe(
      'SELF_APPROVAL',
    );
    const s2 = await as(senior2);
    await s2.patch(`/api/lab-orders/${o.id}/reject`, { reason: '' }).expect(400);
    const rej = (
      await s2
        .patch(`/api/lab-orders/${o.id}/reject`, {
          reason: 'Value implausible; recheck the analyser run',
        })
        .expect(200)
    ).body.data;
    expect(rej).toMatchObject({
      status: 'REJECTED',
      rejectedBy: { id: senior2.id },
      rejectionReason: 'Value implausible; recheck the analyser run',
    });
    await (
      await as(tech)
    )
      .patch(`/api/lab-orders/${o.id}/result`, {
        results: [{ itemId: o.items[0].id, valueNumeric: 13.1 }],
        submit: true,
      })
      .expect(200);
    // senior1 entered the first value, which was overwritten by the technician; senior1 may now review.
    await s1.patch(`/api/lab-orders/${o.id}/approve`).expect(200);
    await (
      await as(tech)
    )
      .patch(`/api/lab-orders/${o.id}/result`, {
        results: [{ itemId: o.items[0].id, valueNumeric: 14 }],
      })
      .expect(409);
    await (
      await as(admin)
    )
      .patch(`/api/lab-tests/${hb.id}`, { ranges: [{ low: 1, high: 2 }] })
      .expect(200);
    expect(
      (await (await as(doctorUser)).get(`/api/lab-orders/${o.id}`).expect(200)).body.data.items[0]
        .result,
    ).toMatchObject({ referenceLow: 12, referenceHigh: 15.5, flag: 'NORMAL' });
    await (
      await as(tech)
    )
      .post(`/api/lab-orders/${o.id}/amend`, { reason: 'Wrong patient sample' })
      .expect(403);
    const amended = (
      await s2
        .post(`/api/lab-orders/${o.id}/amend`, { reason: 'Transcription error in value' })
        .expect(201)
    ).body.data;
    expect(amended).toMatchObject({
      status: 'PROCESSING',
      amendsLabOrderId: o.id,
      amendmentReason: 'Transcription error in value',
    });
    await s2.post(`/api/lab-orders/${o.id}/amend`, { reason: 'Again' }).expect(409);
    expect(
      (await (await as(doctorUser)).get(`/api/lab-orders/${o.id}`).expect(200)).body.data.status,
    ).toBe('APPROVED');
  });

  it('enforces ordering and cancellation rules; reports are PDF only', async () => {
    const { hb, xr } = await catalogue();
    const doc = await as(doctorUser);
    expect(
      (
        await (
          await as(doctor2User)
        )
          .post('/api/lab-orders', { medicalRecordId: recordId, testIds: [hb.id] })
          .expect(403)
      ).body.error.code,
    ).toBe('NOT_TREATING_DOCTOR');
    expect(
      (
        await doc
          .post('/api/lab-orders', { medicalRecordId: closedRecordId, testIds: [hb.id] })
          .expect(409)
      ).body.error.code,
    ).toBe('RECORD_CLOSED');
    await doc
      .post('/api/lab-orders', { medicalRecordId: recordId, testIds: [hb.id, hb.id] })
      .expect(400);
    await doc.post('/api/lab-orders', { medicalRecordId: recordId, testIds: [] }).expect(400);
    await (await as(admin)).patch(`/api/lab-tests/${xr.id}`, { isActive: false }).expect(200);
    await doc.post('/api/lab-orders', { medicalRecordId: recordId, testIds: [xr.id] }).expect(400);
    const o = await order([hb.id]);
    await (
      await as(doctor2User)
    )
      .patch(`/api/lab-orders/${o.id}/cancel`, { reason: 'Not needed' })
      .expect(403);
    const c = (
      await doc
        .patch(`/api/lab-orders/${o.id}/cancel`, { reason: 'Ordered by mistake' })
        .expect(200)
    ).body.data;
    expect(c).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Ordered by mistake' });
    // Q4 A, Q6 A: each ordered test was charged; cancelling releases those charges.
    const itemIds = t.prisma
      .rows('LabOrderItem')
      .filter((i) => i.labOrderId === o.id)
      .map((i) => i.id);
    expect(t.charges).toContainEqual(
      expect.objectContaining({ kind: 'LAB', labOrderItemId: itemIds[0], description: hb.name }),
    );
    expect(t.charges).toContainEqual({ kind: 'RELEASE_LAB', labOrderItemIds: itemIds });
    await (await as(reception)).patch(`/api/lab-orders/${o.id}/sample`).expect(409);
    const o2 = await order([hb.id]);
    await toProcessing(o2.id);
    await doc.patch(`/api/lab-orders/${o2.id}/cancel`, { reason: 'Too late' }).expect(409);
    const lt = await as(tech);
    expect(
      (
        await lt
          .upload(`/api/lab-orders/${o2.id}/report-file`, Buffer.from('MZ not a pdf'), 'r.pdf')
          .expect(400)
      ).body.error.code,
    ).toBe('FILE_REJECTED');
    const up = (
      await lt.upload(`/api/lab-orders/${o2.id}/report-file`, PDF, 'analyser.pdf').expect(201)
    ).body.data;
    expect(up.hasReportFile).toBe(true);
    await lt.patch(`/api/lab-orders/${o2.id}/result`, { results: [], submit: true }).expect(200);
    await (await as(doctorUser)).get(`/api/lab-orders/${o2.id}/report-file`).expect(403);
    await lt.get(`/api/lab-orders/${o2.id}/report-file`).expect(200);
  });
});
