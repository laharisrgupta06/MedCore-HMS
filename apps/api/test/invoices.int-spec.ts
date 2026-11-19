import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_COOKIES, CSRF_HEADER, addDays, type Role } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SessionStore } from '../src/common/auth/session.store';
import { TokenService } from '../src/common/auth/token.service';
import { localDate } from '../src/common/time/zoned';

/**
 * Invoices through the API on PostgreSQL with M-11b (T-BILL-INT-001; tasks 8-B3, 8-B4, DEC-066).
 * A real visit is charged by the clinical actions themselves (lab order, dispense, completing the
 * consultation), then discounted, voided, replaced (re-billing all three charges), finalised with a
 * gap-free number, followed by a late-charge invoice, a correction request and an accountant note;
 * patient, role and hospital isolation are checked. Run before 23:50 India time (tax data starts
 * today). Invoices are never deleted (DEC-053): rows stay in this test's own hospitals ("int-inv-").
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'i'.repeat(43);
const TZ = 'Asia/Kolkata';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gstin(): string {
  const r = randomBytes(8);
  const letter = (b: number) => ALPHABET[10 + (b % 26)]!;
  const serial = String(1 + (r.readUInt16BE(6) % 9999)).padStart(4, '0');
  const first14 = `27${letter(r[0]!)}${letter(r[1]!)}${letter(r[2]!)}${'ABCFGHJLPT'[r[3]! % 10]}${letter(r[4]!)}${serial}${letter(r[5]!)}1Z`;
  let s = 0;
  for (let i = 0; i < 14; i++) {
    const p = ALPHABET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    s += Math.floor(p / 36) + (p % 36);
  }
  return first14 + ALPHABET[(36 - (s % 36)) % 36];
}

describe('Phase 8 integration: invoices through the API on PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const rows = await prisma.$queryRaw<
      { t: string | null }[]
    >`SELECT to_regclass('public.document_number_series')::text AS t`;
    if (!rows[0]?.t)
      throw new Error('M-11b not applied: the document_number_series table does not exist.');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('bills a visit, voids and replaces the draft, issues it, adds late charges and isolates it', async () => {
    let n = 0;
    const hospital = (tag: string) =>
      prisma.hospital.create({
        data: {
          name: `int-inv-${tag}-${run}`,
          code: `INTI${tag}-${run}`.toUpperCase(),
          email: `int-inv-${tag}-${run}@example.com`,
          phone: '+918000000002',
          licenseNumber: `LI-${tag}-${run}`,
          status: 'VERIFIED',
          timezone: TZ,
        },
      });
    const A = await hospital('a');
    const B = await hospital('b');
    const user = (hid: string, role: Role) =>
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            hospitalId: hid,
            email: `int-inv-${role.toLowerCase()}-${++n}-${run}@example.com`,
            passwordHash: 'x',
            role,
            firstName: 'Int',
            lastName: `${role}${n}`,
            emailVerifiedAt: new Date(),
          },
        });
        if (role !== 'PATIENT')
          await tx.staffProfile.create({ data: { hospitalId: hid, userId: u.id } });
        return u;
      });
    const [admin, rcU, acU, drU, phU, ptU, rcB] = await Promise.all([
      user(A.id, 'HOSPITAL_ADMIN'),
      user(A.id, 'RECEPTIONIST'),
      user(A.id, 'ACCOUNTANT'),
      user(A.id, 'DOCTOR'),
      user(A.id, 'PHARMACIST'),
      user(A.id, 'PATIENT'),
      user(B.id, 'RECEPTIONIST'),
    ]);

    // ---- Tax set-up of hospital A, through the M-11a rules (first version and registration today).
    const [taxRow] = await prisma.$queryRaw<
      { d: Date }[]
    >`SELECT medcore_tax_date(${A.id}::uuid) AS d`;
    const taxDate = taxRow!.d;
    const today = taxDate.toISOString().slice(0, 10);
    expect(today).toBe(localDate(new Date(), TZ)); // run before 23:50 India time
    const cls = (name: string, supplyType: 'GOODS' | 'SERVICE', hsnSac: string) =>
      prisma.taxClassification.create({
        data: {
          hospitalId: A.id,
          name: `${name} ${run}`,
          supplyType,
          hsnSac,
          createdById: admin.id,
        },
      });
    const svc = await cls('Healthcare services', 'SERVICE', '999312');
    const meds = await cls('Medicaments', 'GOODS', '3004');
    const day = new Date(`${today}T00:00:00Z`);
    await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: A.id,
        classificationId: svc.id,
        treatment: 'EXEMPT',
        ratePercent: 0,
        priceIncludesTax: false,
        effectiveFrom: day,
        createdById: admin.id,
      },
    });
    await prisma.taxClassificationVersion.create({
      data: {
        hospitalId: A.id,
        classificationId: meds.id,
        treatment: 'TAXABLE',
        ratePercent: 5,
        priceIncludesTax: true,
        effectiveFrom: day,
        createdById: admin.id,
      },
    });
    for (const kind of ['CONSULTATION', 'LAB'] as const)
      await prisma.hospitalTaxDefault.create({
        data: {
          hospitalId: A.id,
          kind,
          classificationId: svc.id,
          updatedById: admin.id,
          updatedAt: new Date(),
        },
      });
    const g = gstin();
    await prisma.hospitalGstRegistration.create({
      data: {
        hospitalId: A.id,
        registrationType: 'REGULAR',
        gstin: g,
        legalName: `Int Hospital ${run}`,
        stateCode: '27',
        effectiveFrom: day,
        attestedById: admin.id,
      },
    });
    await prisma.hospital.update({
      where: { id: A.id },
      data: { taxSetupConfirmedAt: new Date(), taxSetupConfirmedById: admin.id },
    });

    // ---- A visit in progress, with a lab test, a classified medicine in stock and a room.
    const dept = await prisma.department.create({
      data: { hospitalId: A.id, name: `General ${run}` },
    });
    const doctor = await prisma.doctor.create({
      data: {
        hospitalId: A.id,
        userId: drU.id,
        registrationNumber: `R-${run}`,
        specialisation: 'General',
        consultationFee: 500,
      },
    });
    const patient = await prisma.patient.create({
      data: {
        hospitalId: A.id,
        userId: ptU.id,
        mrn: `INTI-${run}`,
        dateOfBirth: new Date('1990-01-01'),
        gender: 'FEMALE',
      },
    });
    const start = new Date();
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: A.id,
        doctorId: doctor.id,
        patientId: patient.id,
        departmentId: dept.id,
        scheduledAt: start,
        endAt: new Date(start.getTime() + 900_000),
        status: 'IN_PROGRESS',
        createdById: rcU.id,
      },
    });
    const record = await prisma.medicalRecord.create({
      data: { hospitalId: A.id, appointmentId: appt.id, chiefComplaint: 'Fever' },
    });
    const cbc = await prisma.labTest.create({
      data: {
        hospitalId: A.id,
        code: `CBC${run}`.toUpperCase(),
        name: 'Complete blood count',
        price: 350,
      },
    });
    const med = await prisma.medicine.create({
      data: {
        hospitalId: A.id,
        name: `Paracetamol ${run}`,
        form: 'TABLET',
        strength: '500 mg',
        reorderLevel: 5,
        taxClassificationId: meds.id,
      },
    });
    const room = await prisma.room.create({
      data: { hospitalId: A.id, number: `R${run}`, type: 'PRIVATE', dailyCharge: 6000 },
    });

    const tokens = app.get(TokenService);
    const sessions = app.get(SessionStore);
    const client = async (id: string, role: Role, hid: string) => {
      const sid = randomUUID();
      await sessions.create(id, sid, randomUUID(), 60_000);
      const auth = `Bearer ${await tokens.signAccess({ sub: id, sid, role, hid })}`;
      const s = app.getHttpServer();
      const w = (r: request.Test) =>
        r
          .set('Authorization', auth)
          .set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`)
          .set(CSRF_HEADER, CSRF);
      return {
        get: (url: string) => request(s).get(url).set('Authorization', auth),
        post: (url: string, body: object = {}) => w(request(s).post(url)).send(body),
        patch: (url: string, body: object = {}) => w(request(s).patch(url)).send(body),
      };
    };
    const rc = await client(rcU.id, 'RECEPTIONIST', A.id);
    const ac = await client(acU.id, 'ACCOUNTANT', A.id);
    const dr = await client(drU.id, 'DOCTOR', A.id);
    const ph = await client(phU.id, 'PHARMACIST', A.id);
    const pt = await client(ptU.id, 'PATIENT', A.id);
    const rB = await client(rcB.id, 'RECEPTIONIST', B.id);

    // ---- Clinical actions charge the visit (Q4 A, Q6 A).
    await ph
      .post(`/api/medicines/${med.id}/batches`, {
        batchNumber: `P${run}`,
        manufacturedOn: addDays(today, -30),
        expiresOn: addDays(today, 300),
        quantity: 50,
        unitCost: 8,
        mrp: 12,
      })
      .expect(201);
    await dr.post('/api/lab-orders', { medicalRecordId: record.id, testIds: [cbc.id] }).expect(201);
    const rx = await prisma.$transaction(async (tx) => {
      const created = await tx.prescription.create({
        data: {
          hospitalId: A.id,
          medicalRecordId: record.id,
          items: {
            create: [
              {
                medicineId: med.id,
                dosage: '500 mg',
                frequency: 'BD',
                durationDays: 5,
                quantity: 10,
              },
            ],
          },
        },
        include: { items: true },
      });
      await tx.prescriptionEvent.create({
        data: {
          hospitalId: A.id,
          prescriptionId: created.id,
          kind: 'ISSUED',
          status: 'ISSUED',
          actorId: drU.id,
        },
      });
      return created;
    });
    await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`).expect(200);
    await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.items[0]!.id, quantity: 10 }],
      })
      .expect(201);
    await dr.patch(`/api/appointments/${appt.id}/status`, { status: 'COMPLETED' }).expect(200);

    // ---- T-BILL-INT-001a: one draft with the three charges and their tax snapshots.
    const list = (await rc.get(`/api/invoices?patientId=${patient.id}`).expect(200)).body.data;
    expect(list).toHaveLength(1);
    const d1 = (await rc.get(`/api/invoices/${list[0].id}`).expect(200)).body.data;
    expect(d1).toMatchObject({
      status: 'DRAFT',
      subtotal: '964.29',
      taxAmount: '5.71',
      total: '970.00',
      finaliseBlockers: [],
    });
    expect(
      d1.lines.map((l: { kind: string; lineTotal: string }) => `${l.kind} ${l.lineTotal}`).sort(),
    ).toEqual(['CONSULTATION 500.00', 'LAB 350.00', 'PHARMACY 120.00']);

    // ---- b: discount by the accountant only.
    await rc
      .patch(`/api/invoices/${d1.id}/discount`, {
        amount: '62.00',
        reason: 'Senior citizen concession',
      })
      .expect(403);
    const disc = (
      await ac
        .patch(`/api/invoices/${d1.id}/discount`, {
          amount: '62.00',
          reason: 'Senior citizen concession',
        })
        .expect(200)
    ).body.data;
    expect(disc).toMatchObject({ discountAmount: '62.00', total: '908.00' });

    // ---- c: void and replacement re-bill all three charges (DEC-066).
    const v = (
      await rc.patch(`/api/invoices/${d1.id}/void`, { reason: 'Voided by mistake' }).expect(200)
    ).body.data;
    expect(v.status).toBe('VOID');
    expect(v.lines.every((l: { releasedAt: string | null }) => l.releasedAt !== null)).toBe(true);
    const d2 = (await rc.post('/api/invoices', { appointmentId: appt.id }).expect(201)).body.data;
    expect(d2).toMatchObject({ sequence: 2, total: '970.00', discountAmount: '0.00' });
    expect(d2.lines.map((l: { kind: string }) => l.kind).sort()).toEqual([
      'CONSULTATION',
      'LAB',
      'PHARMACY',
    ]);
    expect(
      (await rc.post('/api/invoices', { appointmentId: appt.id }).expect(409)).body.error.code,
    ).toBe('INVOICE_EXISTS');

    // ---- d: finalise: document type, gap-free number, seller; then immutable.
    const f = (await rc.patch(`/api/invoices/${d2.id}/finalise`).expect(200)).body.data;
    expect(f).toMatchObject({
      status: 'FINALISED',
      documentType: 'INVOICE_CUM_BILL_OF_SUPPLY',
      seller: { gstin: g, stateCode: '27' },
    });
    expect(f.invoiceNumber).toMatch(/^ICB\/\d\d-\d\d\/00001$/);
    expect(
      (await rc.patch(`/api/invoices/${d2.id}/void`, { reason: 'Wrong patient' }).expect(409)).body
        .error.code,
    ).toBe('DOCUMENT_ISSUED');

    // ---- e: late charges get their own number; the original never changes.
    const late = (await rc.post(`/api/invoices/${d2.id}/late-charges`).expect(201)).body.data;
    await rc
      .post(`/api/invoices/${late.id}/items`, {
        kind: 'ROOM',
        roomId: room.id,
        days: 2,
        serviceDate: today,
      })
      .expect(201);
    const lateF = (await rc.patch(`/api/invoices/${late.id}/finalise`).expect(200)).body.data;
    expect(lateF).toMatchObject({
      total: '12600.00',
      taxAmount: '600.00',
      documentType: 'TAX_INVOICE',
    });
    expect(lateF.invoiceNumber).toMatch(/^TI\/\d\d-\d\d\/00001$/);
    expect((await rc.get(`/api/invoices/${d2.id}`).expect(200)).body.data).toMatchObject({
      total: '970.00',
      invoiceNumber: f.invoiceNumber,
      lateChargeInvoiceIds: [late.id],
    });

    // ---- f: correction request and accountant note; the document is unchanged.
    const cr = (
      await rc
        .post(`/api/invoices/${d2.id}/correction-requests`, {
          kind: 'WRONG_DETAILS',
          description: 'Address printed incorrectly',
        })
        .expect(201)
    ).body.data;
    expect(cr.message).toMatch(/outside MedCore/);
    await rc
      .post(
        `/api/invoices/${d2.id}/correction-requests/${cr.invoice.correctionRequests[0].id}/notes`,
        { note: 'Handled' },
      )
      .expect(403);
    const noted = (
      await ac
        .post(
          `/api/invoices/${d2.id}/correction-requests/${cr.invoice.correctionRequests[0].id}/notes`,
          { note: 'Credit note issued outside MedCore', externalReference: 'CN-1' },
        )
        .expect(201)
    ).body.data;
    expect(noted).toMatchObject({
      status: 'FINALISED',
      total: '970.00',
      invoiceNumber: f.invoiceNumber,
    });

    // ---- g: isolation: patient sees own issued documents only; doctors no access; hospital B 404.
    const mine = (await pt.get('/api/invoices').expect(200)).body.data;
    expect(mine.map((i: { invoiceNumber: string }) => i.invoiceNumber).sort()).toEqual(
      [f.invoiceNumber, lateF.invoiceNumber].sort(),
    );
    await pt.get(`/api/invoices/${d1.id}`).expect(404);
    expect(
      (await pt.get(`/api/invoices/${d2.id}`).expect(200)).body.data.correctionRequests,
    ).toEqual([]);
    await dr.get('/api/invoices').expect(403);
    await rB.get(`/api/invoices/${d2.id}`).expect(404);

    // ---- h: audited.
    const audits = await prisma.auditLog.findMany({
      where: { hospitalId: A.id, action: { startsWith: 'invoice.' } },
      select: { action: true },
    });
    for (const a of [
      'invoice.discount',
      'invoice.void',
      'invoice.create',
      'invoice.finalise',
      'invoice.correction-request',
      'invoice.correction-note',
    ])
      expect(audits.map((x) => x.action)).toContain(a);
  });
});
