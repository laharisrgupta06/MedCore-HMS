import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { SchedulingModule } from '../appointments/appointments.module';
import { EmrModule } from './emr.module';

const CSRF = 'a'.repeat(43);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 this program cannot be run in DOS mode');

describe('Phase 4: electronic medical records (in-memory Prisma)', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let h: Hospital;
  let doctorUser: User, doctor2User: User, nurse: User, reception: User, admin: User;
  let patientUser: User, patient2User: User;
  let patientId: string;
  let apptId: string;

  beforeEach(async () => {
    t = await createAuthTestApp({}, { modules: [SchedulingModule, EmrModule] });
    app = t.app;
    h = t.prisma.addHospital({ timezone: 'Asia/Kolkata' });
    const push = (model: string, row: Record<string, unknown>) => {
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
    doctorUser = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dee' });
    doctor2User = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dan' });
    nurse = t.prisma.addUser({ role: 'NURSE', hospitalId: h.id });
    reception = t.prisma.addUser({ role: 'RECEPTIONIST', hospitalId: h.id });
    admin = t.prisma.addUser({ role: 'HOSPITAL_ADMIN', hospitalId: h.id });
    patientUser = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pat' });
    patient2User = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pia' });
    const doc = (u: User, reg: string) =>
      push('Doctor', {
        userId: u.id,
        registrationNumber: reg,
        specialisation: 'General',
        qualification: null,
        consultationFee: 500,
        bio: null,
        signatureFileId: null,
        deletedAt: null,
      });
    const d1 = doc(doctorUser, 'R1');
    doc(doctor2User, 'R2');
    const pat = (u: User, mrn: string) =>
      push('Patient', {
        userId: u.id,
        mrn,
        dateOfBirth: new Date('1990-01-01'),
        gender: 'OTHER',
        deletedAt: null,
      });
    patientId = pat(patientUser, 'MRN-1');
    pat(patient2User, 'MRN-2');
    const start = new Date(Date.now() + 86_400_000);
    apptId = push('Appointment', {
      doctorId: d1,
      patientId,
      departmentId: dept,
      scheduledAt: start,
      endAt: new Date(start.getTime() + 1_800_000),
      status: 'CONFIRMED',
      type: 'REGULAR',
      reason: null,
      cancellationReason: null,
      createdById: patientUser.id,
      deletedAt: null,
    });
    t.prisma
      .rows('Icd10Code')
      .push({ code: 'J06.9', title: 'Acute upper respiratory infection, unspecified' });
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
      patch: (url: string, body: object) => request(server).patch(url).set(write).send(body),
      upload: (url: string, data: Buffer, name: string, type?: string) =>
        request(server)
          .post(url)
          .set(write)
          .attach('file', data, {
            filename: name,
            contentType: type ?? 'application/octet-stream',
          }),
    };
  };
  const startRecord = async () =>
    (
      await (
        await as(doctorUser)
      )
        .post('/api/medical-records', { appointmentId: apptId, chiefComplaint: 'Fever for 3 days' })
        .expect(201)
    ).body.data;

  it('starting the consultation creates the record once, only for the treating doctor and a confirmed appointment (EMR-001)', async () => {
    await (
      await as(doctor2User)
    )
      .post('/api/medical-records', { appointmentId: apptId, chiefComplaint: 'x' })
      .expect(404);
    await (
      await as(nurse)
    )
      .post('/api/medical-records', { appointmentId: apptId, chiefComplaint: 'x' })
      .expect(403);
    const r = await startRecord();
    expect(r).toMatchObject({
      status: 'OPEN',
      chiefComplaint: 'Fever for 3 days',
      appointment: { id: apptId, status: 'IN_PROGRESS' },
      patient: { id: patientId },
    });
    const again = await (
      await as(doctorUser)
    )
      .post('/api/medical-records', { appointmentId: apptId, chiefComplaint: 'x' })
      .expect(409);
    expect(again.body.error.code).toBe('RECORD_EXISTS');
    expect(
      (await (await as(doctorUser)).get(`/api/appointments/${apptId}`).expect(200)).body.data
        .medicalRecordId,
    ).toBe(r.id);
  });

  it('stores notes, plan and diagnoses encrypted and returns them decrypted (SEC-014)', async () => {
    const r = await startRecord();
    const doc = await as(doctorUser);
    await doc
      .post(`/api/medical-records/record/${r.id}/entries`, { body: 'Throat inflamed, no rash.' })
      .expect(201);
    await doc
      .patch(`/api/medical-records/record/${r.id}`, {
        treatmentPlan: 'Paracetamol 500 mg; fluids; review in 3 days.',
      })
      .expect(200);
    const res = await doc
      .post(`/api/medical-records/record/${r.id}/diagnoses`, {
        icd10Code: 'j06.9',
        description: 'Viral pharyngitis',
        type: 'CONFIRMED',
      })
      .expect(201);
    expect(res.body.data).toMatchObject({
      treatmentPlan: 'Paracetamol 500 mg; fluids; review in 3 days.',
      entries: [{ kind: 'NOTE', body: 'Throat inflamed, no rash.', by: { id: doctorUser.id } }],
      diagnoses: [
        { icd10: { code: 'J06.9' }, description: 'Viral pharyngitis', type: 'CONFIRMED' },
      ],
    });
    const raw = JSON.stringify([
      ...t.prisma.rows('RecordEntry'),
      ...t.prisma.rows('Diagnosis'),
      ...t.prisma.rows('MedicalRecord'),
    ]);
    for (const plain of ['Throat inflamed', 'Paracetamol', 'Viral pharyngitis'])
      expect(raw).not.toContain(plain);
    expect(
      (
        await doc
          .post(`/api/medical-records/record/${r.id}/diagnoses`, {
            icd10Code: 'Z99.99',
            description: 'x',
            type: 'DIFFERENTIAL',
          })
          .expect(400)
      ).body.error.message,
    ).toContain('not in the code list');
  });

  it('records vitals with BMI; nurses may record; ranges and corrections are enforced (EMR-003)', async () => {
    const r = await startRecord();
    const v = await (
      await as(nurse)
    )
      .post(`/api/medical-records/record/${r.id}/vitals`, {
        systolicBp: 120,
        diastolicBp: 80,
        pulse: 72,
        temperatureC: 37.2,
        spo2: 98,
        heightCm: 170,
        weightKg: 65,
      })
      .expect(201);
    const first = v.body.data.vitals[0];
    expect(first).toMatchObject({ bmi: 22.5, temperatureC: 37.2, by: { id: nurse.id } });
    await (
      await as(nurse)
    )
      .post(`/api/medical-records/record/${r.id}/vitals`, { pulse: 400 })
      .expect(400);
    await (await as(nurse)).post(`/api/medical-records/record/${r.id}/vitals`, {}).expect(400);
    const doc = await as(doctorUser);
    await doc
      .post(`/api/medical-records/record/${r.id}/vitals`, { weightKg: 56, supersedesId: first.id })
      .expect(400);
    const fixed = await doc
      .post(`/api/medical-records/record/${r.id}/vitals`, {
        heightCm: 170,
        weightKg: 56,
        supersedesId: first.id,
        correctionReason: 'Scale was not zeroed',
      })
      .expect(201);
    expect(fixed.body.data.vitals).toEqual([
      expect.objectContaining({ id: first.id, corrected: true, bmi: 22.5 }),
      expect.objectContaining({
        supersedesId: first.id,
        correctionReason: 'Scale was not zeroed',
        bmi: 19.4,
        corrected: false,
      }),
    ]);
    expect(
      (
        await doc
          .post(`/api/medical-records/record/${r.id}/vitals`, {
            weightKg: 57,
            supersedesId: first.id,
            correctionReason: 'Again',
          })
          .expect(409)
      ).body.error.code,
    ).toBe('ALREADY_CORRECTED');
    await (
      await as(doctor2User)
    )
      .post(`/api/medical-records/record/${r.id}/vitals`, { pulse: 70 })
      .expect(403);
  });

  it('is append-only: completion closes the record; later changes are addenda and corrections (EMR-002)', async () => {
    const r = await startRecord();
    const doc = await as(doctorUser);
    const note = (
      await doc
        .post(`/api/medical-records/record/${r.id}/entries`, { body: 'Original note' })
        .expect(201)
    ).body.data.entries[0];
    await doc.post(`/api/medical-records/record/${r.id}/vitals`, { pulse: 70 }).expect(201);
    await doc.patch(`/api/appointments/${apptId}/status`, { status: 'COMPLETED' }).expect(200);
    const closed = (await doc.get(`/api/medical-records/record/${r.id}`).expect(200)).body.data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    expect(
      (
        await doc
          .patch(`/api/medical-records/record/${r.id}`, { treatmentPlan: 'late' })
          .expect(409)
      ).body.error.code,
    ).toBe('RECORD_CLOSED');
    await doc.post(`/api/medical-records/record/${r.id}/vitals`, { pulse: 75 }).expect(409);
    await doc
      .post(`/api/medical-records/record/${r.id}/vitals`, {
        pulse: 74,
        supersedesId: closed.vitals[0].id,
        correctionReason: 'Misread monitor',
      })
      .expect(201);
    const add = (
      await doc
        .post(`/api/medical-records/record/${r.id}/entries`, {
          body: 'Lab result reviewed by phone.',
        })
        .expect(201)
    ).body.data;
    expect(add.entries[1]).toMatchObject({ kind: 'ADDENDUM', supersedesId: null });
    await doc
      .post(`/api/medical-records/record/${r.id}/entries`, {
        body: 'Corrected',
        amendsEntryId: note.id,
      })
      .expect(400);
    const corr = (
      await doc
        .post(`/api/medical-records/record/${r.id}/entries`, {
          body: 'Original note (left ear, not right)',
          amendsEntryId: note.id,
          correctionReason: 'Wrong side',
        })
        .expect(201)
    ).body.data;
    expect(corr.entries[0]).toMatchObject({ id: note.id, body: 'Original note', corrected: true });
    expect(corr.entries[2]).toMatchObject({
      kind: 'ADDENDUM',
      supersedesId: note.id,
      correctionReason: 'Wrong side',
    });
    // Nothing was edited or deleted underneath.
    expect(t.prisma.rows('RecordEntry')).toHaveLength(3);
    expect(t.prisma.rows('Vitals')).toHaveLength(2);
  });

  it('accepts PDF and images up to 20 MB by content, rejects executables and mismatches (EMR-010, SEC-013)', async () => {
    const r = await startRecord();
    const doc = await as(doctorUser);
    const ok = await doc
      .upload(
        `/api/medical-records/record/${r.id}/files`,
        PDF,
        'discharge summary.pdf',
        'application/pdf',
      )
      .expect(201);
    const file = ok.body.data.files[0];
    expect(file).toMatchObject({
      originalName: 'discharge summary.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    for (const [data, name, type] of [
      [EXE, 'report.pdf', 'application/pdf'],
      [EXE, 'setup.exe', 'application/x-msdownload'],
      [PNG, 'scan.pdf', 'application/pdf'],
    ] as const) {
      const res = await doc
        .upload(`/api/medical-records/record/${r.id}/files`, data, name, type)
        .expect(400);
      expect(res.body.error.code).toBe('FILE_REJECTED');
    }
    const big = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024 + 1 - PDF.length)]);
    expect(
      (
        await doc
          .upload(`/api/medical-records/record/${r.id}/files`, big, 'big.pdf', 'application/pdf')
          .expect(400)
      ).body.error.message,
    ).toContain('20 MB');
    const dl = await (await as(patientUser)).get(`/api/files/${file.id}`).expect(200);
    expect(Buffer.from(dl.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect(dl.headers['content-disposition']).toContain('attachment');
    await (await as(patient2User)).get(`/api/files/${file.id}`).expect(404);
  });

  it('patients see only their own records; other roles have no clinical access (TEST-011, API-019); views are audited', async () => {
    const r = await startRecord();
    const own = await (await as(patientUser)).get(`/api/medical-records/${patientId}`).expect(200);
    expect(own.body.meta.total).toBe(1);
    expect(own.body.data[0].id).toBe(r.id);
    await (await as(patient2User)).get(`/api/medical-records/${patientId}`).expect(404);
    await (await as(patient2User)).get(`/api/medical-records/record/${r.id}`).expect(404);
    await (await as(reception)).get(`/api/medical-records/${patientId}`).expect(403);
    await (await as(admin)).get(`/api/medical-records/record/${r.id}`).expect(403);
    await (await as(nurse)).get(`/api/medical-records/record/${r.id}`).expect(200);
    const views = t.prisma.rows('AuditLog').filter((a) => a.action === 'medical_record.view');
    expect(views.map((a) => a.actorId)).toEqual([nurse.id]);
    expect(views[0]).toMatchObject({ entityId: r.id, hospitalId: h.id });
    expect(
      t.prisma
        .rows('AuditLog')
        .filter((a) => a.action === 'medical_record.chart_view')
        .map((a) => a.actorId),
    ).toEqual([patientUser.id]);
  });

  it('keeps patient history with corrections and statuses, never deleting (EMR-007..009, EMR-011)', async () => {
    const doc = await as(doctorUser);
    const base = `/api/patients/${patientId}`;
    const a1 = (
      await doc
        .post(`${base}/allergies`, {
          kind: 'ADVERSE_DRUG_REACTION',
          substance: 'Penicillin',
          reaction: 'Hives',
          severity: 'MODERATE',
        })
        .expect(201)
    ).body.data.allergies[0];
    await (
      await as(nurse)
    )
      .post(`${base}/vaccinations`, {
        vaccineName: 'Tetanus',
        administeredOn: '2024-05-01',
        batchNumber: 'TT-221',
        nextDueOn: '2034-05-01',
      })
      .expect(201);
    await doc
      .post(`${base}/medications`, {
        medicineName: 'Metformin',
        dosage: '500 mg',
        frequency: 'Twice daily',
        startedOn: '2022-01-10',
      })
      .expect(201);
    await doc
      .post(`${base}/family-history`, { condition: 'DIABETES', present: true, relation: 'Mother' })
      .expect(201);
    await doc
      .post(`${base}/vaccinations`, {
        vaccineName: 'X',
        administeredOn: '01-05-2024',
        batchNumber: 'B',
      })
      .expect(400);
    const fixed = (
      await doc
        .post(`${base}/allergies`, {
          kind: 'ADVERSE_DRUG_REACTION',
          substance: 'Amoxicillin',
          reaction: 'Hives',
          severity: 'MODERATE',
          supersedesId: a1.id,
          correctionReason: 'Patient confirmed the drug name',
        })
        .expect(201)
    ).body.data;
    expect(fixed.allergies).toEqual([
      expect.objectContaining({ id: a1.id, substance: 'Penicillin', corrected: true }),
      expect.objectContaining({ substance: 'Amoxicillin', supersedesId: a1.id }),
    ]);
    await doc
      .patch(`${base}/allergies/${a1.id}/status`, { status: 'ENTERED_IN_ERROR' })
      .expect(400);
    const marked = (
      await doc
        .patch(`${base}/allergies/${a1.id}/status`, {
          status: 'ENTERED_IN_ERROR',
          reason: 'Recorded on the wrong patient',
        })
        .expect(200)
    ).body.data;
    expect(marked.allergies[0]).toMatchObject({
      status: 'ENTERED_IN_ERROR',
      statusReason: 'Recorded on the wrong patient',
    });
    await doc.patch(`${base}/allergies/${a1.id}/status`, { status: 'RESOLVED' }).expect(400);
    await doc.patch(`${base}/unknown/${a1.id}/status`, { status: 'RESOLVED' }).expect(400);
    const mine = (await (await as(patientUser)).get(`${base}/history`).expect(200)).body.data;
    expect(mine).toMatchObject({
      vaccinations: [
        {
          vaccineName: 'Tetanus',
          administeredOn: '2024-05-01',
          nextDueOn: '2034-05-01',
          batchNumber: 'TT-221',
        },
      ],
      medications: [{ medicineName: 'Metformin', startedOn: '2022-01-10' }],
      familyHistory: [{ condition: 'DIABETES', present: true, relation: 'Mother' }],
    });
    await (await as(patient2User)).get(`${base}/history`).expect(404);
    await (
      await as(patientUser)
    )
      .post(`${base}/allergies`, { kind: 'ALLERGY', substance: 'Dust' })
      .expect(403);
    expect(t.prisma.rows('Allergy')).toHaveLength(2);
  });

  it('searches the ICD-10 list by code or words', async () => {
    const doc = await as(doctorUser);
    expect((await doc.get('/api/icd10?search=j06').expect(200)).body.data).toEqual([
      { code: 'J06.9', title: 'Acute upper respiratory infection, unspecified' },
    ]);
    expect((await doc.get('/api/icd10?search=respiratory').expect(200)).body.data).toHaveLength(1);
    await doc.get('/api/icd10?search=a').expect(400);
  });
});
