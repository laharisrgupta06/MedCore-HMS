import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { DomainEvents } from '../../common/events/domain-events';
import { StorageService } from '../../infra/storage/storage.service';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { MedicinesModule, StockLevels } from '../medicines/medicines.module';
import { PrescriptionsModule } from './prescriptions.module';

const CSRF = 'a'.repeat(43);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Phase 5: medicine catalogue and prescriptions (in-memory Prisma)', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let h: Hospital;
  let doctorUser: User,
    doctor2User: User,
    nurse: User,
    pharmacist: User,
    reception: User,
    admin: User;
  let patientUser: User, patient2User: User;
  let patientId: string, recordId: string, closedRecordId: string, doctorId: string;
  let push: (model: string, row: Record<string, unknown>) => string;

  beforeEach(async () => {
    t = await createAuthTestApp({}, { modules: [MedicinesModule, PrescriptionsModule] });
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
    doctorUser = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dee' });
    doctor2User = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dan' });
    nurse = t.prisma.addUser({ role: 'NURSE', hospitalId: h.id });
    pharmacist = t.prisma.addUser({ role: 'PHARMACIST', hospitalId: h.id });
    reception = t.prisma.addUser({ role: 'RECEPTIONIST', hospitalId: h.id });
    admin = t.prisma.addUser({ role: 'HOSPITAL_ADMIN', hospitalId: h.id });
    patientUser = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pat' });
    patient2User = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pia' });
    const sigKey = `${h.id}/signatures/test.png`;
    await t.app
      .get(StorageService)
      .put(sigKey, PNG)
      .catch(() => undefined);
    const sig = push('FileAttachment', {
      purpose: 'DOCTOR_SIGNATURE',
      storageKey: sigKey,
      originalName: 's.png',
      mimeType: 'image/png',
      sizeBytes: PNG.length,
      sha256: '0'.repeat(64),
      uploadedById: doctorUser.id,
      patientId: null,
      medicalRecordId: null,
    });
    doctorId = push('Doctor', {
      userId: doctorUser.id,
      registrationNumber: 'KMC-1',
      specialisation: 'General',
      qualification: null,
      consultationFee: 500,
      bio: null,
      signatureFileId: sig,
      deletedAt: null,
    });
    push('Doctor', {
      userId: doctor2User.id,
      registrationNumber: 'KMC-2',
      specialisation: 'General',
      qualification: null,
      consultationFee: 500,
      bio: null,
      signatureFileId: null,
      deletedAt: null,
    });
    patientId = push('Patient', {
      userId: patientUser.id,
      mrn: 'MRN-1',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'FEMALE',
      deletedAt: null,
    });
    push('Patient', {
      userId: patient2User.id,
      mrn: 'MRN-2',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'MALE',
      deletedAt: null,
    });
    const appt = (status: string, hours: number) =>
      push('Appointment', {
        doctorId,
        patientId,
        departmentId: dept,
        scheduledAt: new Date(Date.now() + hours * 3_600_000),
        endAt: new Date(Date.now() + (hours + 0.5) * 3_600_000),
        status,
        type: 'REGULAR',
        reason: null,
        cancellationReason: null,
        createdById: patientUser.id,
        deletedAt: null,
      });
    recordId = push('MedicalRecord', {
      appointmentId: appt('IN_PROGRESS', 0),
      chiefComplaint: 'Fever',
      presentingSymptoms: null,
      treatmentPlanEnc: null,
      status: 'OPEN',
      closedAt: null,
    });
    closedRecordId = push('MedicalRecord', {
      appointmentId: appt('COMPLETED', -48),
      chiefComplaint: 'Cough',
      presentingSymptoms: null,
      treatmentPlanEnc: null,
      status: 'CLOSED',
      closedAt: new Date(),
    });
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
    };
  };
  const medicine = async (name: string, generic: string | null = null, form = 'TABLET') =>
    (
      await (
        await as(pharmacist)
      )
        .post('/api/medicines', {
          name,
          genericName: generic ?? undefined,
          form,
          strength: '500 mg',
          reorderLevel: 10,
        })
        .expect(201)
    ).body.data;
  const item = (medicineId: string, over: object = {}) => ({
    medicineId,
    dosage: '500 mg',
    frequency: 'TDS',
    durationDays: 5,
    quantity: 15,
    instructions: 'After food',
    ...over,
  });

  it('catalogue: pharmacy and admins manage it, doctors search it with available stock from active unexpired batches', async () => {
    const m = await medicine('Crocin', 'Paracetamol');
    await (
      await as(admin)
    )
      .post('/api/medicines', {
        name: 'Crocin',
        form: 'TABLET',
        strength: '500 mg',
        reorderLevel: 1,
      })
      .expect(409);
    await (
      await as(doctorUser)
    )
      .post('/api/medicines', { name: 'X', form: 'TABLET', strength: '1 mg', reorderLevel: 1 })
      .expect(403);
    const day = 86_400_000;
    const batch = (n: string, qty: number, expires: number, status = 'ACTIVE') =>
      push('MedicineBatch', {
        medicineId: m.id,
        batchNumber: n,
        manufacturedOn: new Date(Date.now() - 400 * day),
        expiresOn: new Date(Date.now() + expires * day),
        quantity: qty,
        unitCost: 1,
        mrp: 2,
        status,
        supplierId: null,
        receivedAt: new Date(),
      });
    batch('B1', 40, 100);
    batch('B2', 25, -1);
    batch('B3', 7, 200, 'QUARANTINED');
    // Phase 7 stock writes clear the cache; batches inserted directly here do the same by hand.
    await t.app.get(StockLevels).invalidate([m.id]);
    const found = await (await as(doctorUser)).get('/api/medicines?search=paracet').expect(200);
    expect(found.body.data).toEqual([
      expect.objectContaining({
        id: m.id,
        name: 'Crocin',
        genericName: 'Paracetamol',
        available: 40,
      }),
    ]);
    expect(found.body.data[0]).not.toHaveProperty('unitCost');
    await (await as(pharmacist)).patch(`/api/medicines/${m.id}`, { isActive: false }).expect(200);
    expect(
      (await (await as(doctorUser)).get('/api/medicines?search=crocin').expect(200)).body.data,
    ).toEqual([]);
    await (await as(nurse)).get('/api/medicines').expect(403);
  });

  it('issues a prescription with a signed PDF; the patient downloads only their own (RX-001, RX-002, RX-007)', async () => {
    const m = await medicine('Crocin', 'Paracetamol');
    const res = await (
      await as(doctorUser)
    )
      .post('/api/prescriptions', {
        medicalRecordId: recordId,
        items: [item(m.id)],
        notes: 'Review in 5 days',
      })
      .expect(201);
    const rx = res.body.data;
    expect(rx).toMatchObject({
      status: 'ISSUED',
      medicalRecordId: recordId,
      notes: 'Review in 5 days',
      pdfReady: true,
      patient: { id: patientId },
      doctor: { userId: doctorUser.id },
      items: [
        {
          medicine: { name: 'Crocin', form: 'TABLET' },
          dosage: '500 mg',
          frequency: 'TDS',
          durationDays: 5,
          quantity: 15,
          instructions: 'After food',
          dispensedQuantity: 0,
        },
      ],
    });
    expect(t.app.get(DomainEvents).recent).toContainEqual({
      type: 'prescription.issued',
      hospitalId: h.id,
      prescriptionId: rx.id,
    });
    const pdf = await (
      await as(patientUser)
    )
      .get(`/api/prescriptions/${rx.id}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (d: Buffer) => c.push(d));
        r.on('end', () => cb(null, Buffer.concat(c)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(
      t.prisma
        .rows('FileAttachment')
        .some((f) => f.purpose === 'PRESCRIPTION_PDF' && f.patientId === patientId),
    ).toBe(true);
    await (await as(patient2User)).get(`/api/prescriptions/${rx.id}/pdf`).expect(404);
    await (await as(patient2User)).get(`/api/prescriptions/${rx.id}`).expect(404);
    expect(
      (await (await as(patient2User)).get('/api/prescriptions').expect(200)).body.meta.total,
    ).toBe(0);
    expect(
      (await (await as(patientUser)).get('/api/prescriptions').expect(200)).body.meta.total,
    ).toBe(1);
    await (await as(nurse)).get(`/api/prescriptions/${rx.id}`).expect(200);
    expect(
      (await (await as(pharmacist)).get(`/api/prescriptions?patientId=${patientId}`).expect(200))
        .body.meta.total,
    ).toBe(1);
    await (await as(reception)).get('/api/prescriptions').expect(403);
    await (await as(doctorUser)).post(`/api/prescriptions/${rx.id}/pdf`).expect(409);
    expect(
      t.prisma
        .rows('AuditLog')
        .some((a) => a.action === 'prescription.pdf' && a.actorId === patientUser.id),
    ).toBe(true);
  });

  it('enforces the issuing rules', async () => {
    const m = await medicine('Crocin');
    const off = await medicine('Oldmed');
    await (await as(pharmacist)).patch(`/api/medicines/${off.id}`, { isActive: false }).expect(200);
    const doc = await as(doctorUser);
    expect(
      (
        await (
          await as(doctor2User)
        )
          .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(m.id)] })
          .expect(403)
      ).body.error.code,
    ).toBe('NOT_TREATING_DOCTOR');
    expect(
      (
        await doc
          .post('/api/prescriptions', { medicalRecordId: closedRecordId, items: [item(m.id)] })
          .expect(409)
      ).body.error.code,
    ).toBe('RECORD_CLOSED');
    await doc.post('/api/prescriptions', { medicalRecordId: recordId, items: [] }).expect(400);
    await doc
      .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(m.id), item(m.id)] })
      .expect(400);
    await doc
      .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(off.id)] })
      .expect(400);
    await doc
      .post('/api/prescriptions', {
        medicalRecordId: recordId,
        items: [item(m.id, { frequency: 'XYZ' })],
      })
      .expect(400);
    await doc
      .post('/api/prescriptions', {
        medicalRecordId: recordId,
        items: [item(m.id, { durationDays: 0 })],
      })
      .expect(400);
    t.prisma.rows('Doctor').find((d) => d.id === doctorId)!.signatureFileId = null;
    expect(
      (
        await doc
          .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(m.id)] })
          .expect(400)
      ).body.error.code,
    ).toBe('NO_SIGNATURE');
    expect(t.prisma.rows('Prescription')).toHaveLength(0);
  });

  it('an allergy conflict needs an acknowledged reason, which is stored (DEC-040 D4)', async () => {
    const m = await medicine('Augmentin', 'Amoxicillin');
    const allergy = (substance: string, status = 'ACTIVE') =>
      push('Allergy', {
        patientId,
        kind: 'ALLERGY',
        substance,
        reaction: 'Rash',
        severity: 'SEVERE',
        recordedById: doctorUser.id,
        recordedAt: new Date(),
        supersedesId: null,
        correctionReason: null,
        status,
        statusReason: null,
        statusChangedById: null,
        statusChangedAt: null,
      });
    allergy('Ibuprofen', 'RESOLVED');
    const a = allergy('amoxicillin');
    const doc = await as(doctorUser);
    const refused = await doc
      .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(m.id)] })
      .expect(409);
    expect(refused.body.error).toMatchObject({
      code: 'ALLERGY_CONFLICT',
      details: {
        conflicts: [
          {
            allergyId: a,
            substance: 'amoxicillin',
            medicineId: m.id,
            medicineName: 'Augmentin 500 mg',
          },
        ],
      },
    });
    await doc
      .post('/api/prescriptions', {
        medicalRecordId: recordId,
        items: [item(m.id)],
        allergyOverrideReason: 'x',
      })
      .expect(400);
    const ok = await doc
      .post('/api/prescriptions', {
        medicalRecordId: recordId,
        items: [item(m.id)],
        allergyOverrideReason: 'Mild rash only; benefit outweighs risk, monitored',
      })
      .expect(201);
    expect(ok.body.data.allergyOverrideReason).toBe(
      'Mild rash only; benefit outweighs risk, monitored',
    );
  });

  it('cancels only with a reason, by the prescribing doctor, before any dispensing (DEC-040 D3)', async () => {
    const m = await medicine('Crocin');
    const doc = await as(doctorUser);
    const one = (
      await doc
        .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(m.id)] })
        .expect(201)
    ).body.data;
    const two = (
      await doc
        .post('/api/prescriptions', { medicalRecordId: recordId, items: [item(m.id)] })
        .expect(201)
    ).body.data;
    await doc.patch(`/api/prescriptions/${one.id}/cancel`, { reason: '' }).expect(400);
    await (
      await as(doctor2User)
    )
      .patch(`/api/prescriptions/${one.id}/cancel`, { reason: 'Wrong patient' })
      .expect(403);
    const c = (
      await doc
        .patch(`/api/prescriptions/${one.id}/cancel`, { reason: 'Wrong strength chosen' })
        .expect(200)
    ).body.data;
    expect(c).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Wrong strength chosen' });
    expect(c.cancelledAt).not.toBeNull();
    await doc.patch(`/api/prescriptions/${one.id}/cancel`, { reason: 'Again' }).expect(409);
    const batch = push('MedicineBatch', {
      medicineId: m.id,
      batchNumber: 'B',
      manufacturedOn: new Date('2025-01-01'),
      expiresOn: new Date('2030-01-01'),
      quantity: 10,
      unitCost: 1,
      mrp: 2,
      status: 'ACTIVE',
      supplierId: null,
      receivedAt: new Date(),
    });
    push('Dispense', {
      prescriptionItemId: two.items[0].id,
      batchId: batch,
      quantity: 5,
      dispensedById: pharmacist.id,
      dispensedAt: new Date(),
    });
    expect(
      (
        await doc
          .patch(`/api/prescriptions/${two.id}/cancel`, { reason: 'Changed my mind' })
          .expect(409)
      ).body.error.code,
    ).toBe('ALREADY_DISPENSED');
    expect(
      (await doc.get(`/api/prescriptions/${two.id}`).expect(200)).body.data.items[0]
        .dispensedQuantity,
    ).toBe(5);
  });
});
