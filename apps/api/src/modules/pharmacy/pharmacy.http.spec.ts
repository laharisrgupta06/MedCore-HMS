import type { INestApplication } from '@nestjs/common';
import { AUTH_COOKIES, CSRF_HEADER, addDays, availableUnits, ledgerBalance } from '@medcore/types';
import type { Hospital, User } from '@prisma/client';
import request from 'supertest';
import { DomainEvents } from '../../common/events/domain-events';
import { localDate, zonedToUtc } from '../../common/time/zoned';
import { createAuthTestApp, type AuthTestApp } from '../../testing/auth-test-app';
import { dateValue } from '../medicines/low-stock';
import { MedicinesModule } from '../medicines/medicines.module';
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';
import { ExpirySweep } from './expiry-sweep';
import { PharmacyModule } from './pharmacy.module';

const CSRF = 'a'.repeat(43);
const TZ = 'Asia/Kolkata';
type Row = Record<string, unknown>;

/** Phase 7 (PHARM-001..006, TEST-014) on the in-memory database, with two hospitals. */
describe('Phase 7: pharmacy and inventory', () => {
  let t: AuthTestApp;
  let app: INestApplication;
  let h: Hospital, h2: Hospital;
  let pharmacist: User,
    pharmacist2: User,
    admin: User,
    doctorUser: User,
    nurse: User,
    patientUser: User;
  let recordId: string;
  const today = () => localDate(new Date(), TZ);
  let push: (model: string, row: Row, hospitalId?: string) => string;

  beforeEach(async () => {
    t = await createAuthTestApp(
      {},
      { modules: [MedicinesModule, PrescriptionsModule, PharmacyModule] },
    );
    app = t.app;
    h = t.prisma.addHospital({ timezone: TZ });
    h2 = t.prisma.addHospital({ timezone: TZ, code: 'OTHER', name: 'Other Hospital' });
    push = (model, row, hospitalId = h.id) => {
      const r = {
        id: crypto.randomUUID(),
        hospitalId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      };
      t.prisma.rows(model).push(r);
      return r.id as string;
    };
    pharmacist = t.prisma.addUser({ role: 'PHARMACIST', hospitalId: h.id });
    pharmacist2 = t.prisma.addUser({ role: 'PHARMACIST', hospitalId: h2.id });
    admin = t.prisma.addUser({ role: 'HOSPITAL_ADMIN', hospitalId: h.id });
    doctorUser = t.prisma.addUser({ role: 'DOCTOR', hospitalId: h.id, firstName: 'Dee' });
    nurse = t.prisma.addUser({ role: 'NURSE', hospitalId: h.id });
    patientUser = t.prisma.addUser({ role: 'PATIENT', hospitalId: h.id, firstName: 'Pat' });
    const dept = push('Department', { name: 'General', description: null });
    const doctorId = push('Doctor', {
      userId: doctorUser.id,
      registrationNumber: 'KMC-1',
      specialisation: 'General',
      qualification: null,
      consultationFee: 500,
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
    const appt = push('Appointment', {
      doctorId,
      patientId,
      departmentId: dept,
      scheduledAt: new Date(),
      endAt: new Date(Date.now() + 1_800_000),
      status: 'IN_PROGRESS',
      type: 'REGULAR',
      reason: null,
      cancellationReason: null,
      createdById: patientUser.id,
      deletedAt: null,
    });
    recordId = push('MedicalRecord', {
      appointmentId: appt,
      chiefComplaint: 'Fever',
      presentingSymptoms: null,
      treatmentPlanEnc: null,
      status: 'OPEN',
      closedAt: null,
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
      patch: (url: string, body: object = {}) => request(server).patch(url).set(write).send(body),
    };
  };
  const medicine = (name: string, reorderLevel = 10, hospitalId = h.id) =>
    push(
      'Medicine',
      {
        name,
        genericName: null,
        form: 'TABLET',
        strength: '500 mg',
        reorderLevel,
        isActive: true,
        lowStockSince: null,
      },
      hospitalId,
    );
  /** A batch expiring `days` after today's hospital-local date. */
  const batch = (
    medicineId: string,
    n: string,
    quantity: number,
    days: number,
    over: Row = {},
    hospitalId = h.id,
  ) =>
    push(
      'MedicineBatch',
      {
        medicineId,
        batchNumber: n,
        manufacturedOn: dateValue(addDays(today(), -300)),
        expiresOn: dateValue(addDays(today(), days)),
        quantity,
        unitCost: 1.5,
        mrp: 3,
        status: 'ACTIVE',
        supplierId: null,
        receivedAt: new Date(),
        ...over,
      },
      hospitalId,
    );
  /** An issued prescription of the given items (written directly; issuing is Phase 5's job). */
  const prescription = (items: [string, number][], over: Row = {}) => {
    const id = push('Prescription', {
      medicalRecordId: recordId,
      status: 'ISSUED',
      notes: null,
      pdfFileId: null,
      issuedAt: new Date(),
      verifiedById: null,
      verifiedAt: null,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      allergyOverrideReason: null,
      ...over,
    });
    const itemIds = items.map(([medicineId, quantity]) =>
      push('PrescriptionItem', {
        prescriptionId: id,
        medicineId,
        dosage: '500 mg',
        frequency: 'TDS',
        durationDays: 5,
        quantity,
        instructions: null,
      }),
    );
    return { id, itemIds };
  };
  const rows = (model: string) => t.prisma.rows(model) as Row[];
  const batchRow = (id: string) => rows('MedicineBatch').find((b) => b.id === id)!;
  /** PHARM ledger invariant: receipts, dispenses and adjustments sum to the batch quantity. */
  const ledgerMatches = (batchId: string) =>
    rows('StockMovement')
      .filter((m) => m.batchId === batchId && m.type !== 'QUARANTINE')
      .reduce((s, m) => s + (m.quantity as number), 0) === batchRow(batchId).quantity;

  it('receives stock with a RECEIPT entry, refuses expired or impossible dates, lists FIFO, and keeps costs from other roles', async () => {
    const m = medicine('Augmentin');
    const ph = await as(pharmacist);
    const body = {
      batchNumber: 'B-LATE',
      manufacturedOn: addDays(today(), -10),
      expiresOn: addDays(today(), 400),
      quantity: 40,
      unitCost: 12.5,
      mrp: 18,
    };
    const late = (await ph.post(`/api/medicines/${m}/batches`, body).expect(201)).body.data;
    expect(late).toMatchObject({
      batchNumber: 'B-LATE',
      quantity: 40,
      unitCost: '12.50',
      status: 'ACTIVE',
      expired: false,
    });
    expect(rows('StockMovement').filter((x) => x.batchId === late.id)).toEqual([
      expect.objectContaining({
        type: 'RECEIPT',
        quantity: 40,
        performedById: pharmacist.id,
        hospitalId: h.id,
      }),
    ]);
    await ph
      .post(`/api/medicines/${m}/batches`, {
        ...body,
        batchNumber: 'B-SOON',
        expiresOn: addDays(today(), 20),
      })
      .expect(201);
    expect((await ph.post(`/api/medicines/${m}/batches`, body).expect(409)).body.error.code).toBe(
      'CONFLICT',
    );
    expect(
      (
        await ph
          .post(`/api/medicines/${m}/batches`, { ...body, batchNumber: 'X1', expiresOn: today() })
          .expect(400)
      ).body.error.code,
    ).toBe('EXPIRY_IN_PAST');
    await ph
      .post(`/api/medicines/${m}/batches`, {
        ...body,
        batchNumber: 'X2',
        manufacturedOn: addDays(today(), 1),
      })
      .expect(400);
    await ph
      .post(`/api/medicines/${m}/batches`, { ...body, batchNumber: 'X3', quantity: 0 })
      .expect(400);
    // FIFO: earliest expiry first; hospital admins read (with costs), but cannot receive.
    const list = (await (await as(admin)).get(`/api/medicines/${m}/batches`).expect(200)).body.data;
    expect(list.map((b: { batchNumber: string }) => b.batchNumber)).toEqual(['B-SOON', 'B-LATE']);
    await (
      await as(admin)
    )
      .post(`/api/medicines/${m}/batches`, { ...body, batchNumber: 'Y' })
      .expect(403);
    await (await as(doctorUser)).get(`/api/medicines/${m}/batches`).expect(403);
    // Doctors see the new availability (cache cleared on change), never the cost.
    const search = (await (await as(doctorUser)).get('/api/medicines?search=Augmentin').expect(200))
      .body.data[0];
    expect(search.available).toBe(80);
    expect(JSON.stringify(search)).not.toMatch(/unitCost|mrp/);
  });

  it('verifies, then dispenses FIFO across batches skipping expired and quarantined stock, partly then fully, and hands over', async () => {
    const m = medicine('Crocin', 5);
    const expired = batch(m, 'EXP', 50, 0); // expires today: already expired
    const quarantined = batch(m, 'Q', 50, 5, { status: 'QUARANTINED' });
    const soon = batch(m, 'SOON', 6, 10);
    const later = batch(m, 'LATER', 30, 200);
    const rx = prescription([[m, 20]]);
    const ph = await as(pharmacist);
    expect(
      (
        await ph
          .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
            items: [{ itemId: rx.itemIds[0], quantity: 1 }],
          })
          .expect(409)
      ).body.error.code,
    ).toBe('NOT_VERIFIED');
    const queue = (await ph.get('/api/pharmacy/prescriptions').expect(200)).body.data;
    expect(queue.map((p: { id: string }) => p.id)).toEqual([rx.id]);
    const v = (await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`).expect(200)).body.data;
    expect(v.verifiedBy).toMatchObject({ firstName: pharmacist.firstName });
    await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`).expect(409);

    const first = (
      await ph
        .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
          items: [{ itemId: rx.itemIds[0], quantity: 8 }],
        })
        .expect(201)
    ).body.data;
    expect(first.status).toBe('PARTIALLY_DISPENSED');
    expect(first.items[0].dispensedQuantity).toBe(8);
    // FIFO: the 6 of SOON first, then 2 of LATER; expired and quarantined untouched.
    expect(batchRow(soon)).toMatchObject({ quantity: 0, status: 'DEPLETED' });
    expect(batchRow(later).quantity).toBe(28);
    expect(batchRow(expired).quantity).toBe(50);
    expect(batchRow(quarantined).quantity).toBe(50);
    const dispenses = rows('Dispense');
    expect(dispenses.map((d) => [d.batchId, d.quantity])).toEqual([
      [soon, 6],
      [later, 2],
    ]);
    expect(
      rows('StockMovement')
        .filter((x) => x.type === 'DISPENSE')
        .map((x) => [x.dispenseId, x.quantity]),
    ).toEqual([
      [dispenses[0]!.id, -6],
      [dispenses[1]!.id, -2],
    ]);

    expect(
      (
        await ph
          .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
            items: [{ itemId: rx.itemIds[0], quantity: 13 }],
          })
          .expect(400)
      ).body.error,
    ).toMatchObject({ code: 'EXCEEDS_PRESCRIBED', details: { remaining: 12 } });
    // The prescribing doctor can no longer cancel (Phase 5 rule, now with a real dispense).
    await (
      await as(doctorUser)
    )
      .patch(`/api/prescriptions/${rx.id}/cancel`, { reason: 'Changed my mind' })
      .expect(409);

    const events = app.get(DomainEvents);
    const done = (
      await ph
        .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
          items: [{ itemId: rx.itemIds[0], quantity: 12 }],
        })
        .expect(201)
    ).body.data;
    expect(done.status).toBe('READY_FOR_PICKUP');
    expect(events.recent).toContainEqual({
      type: 'prescription.ready',
      hospitalId: h.id,
      prescriptionId: rx.id,
    });
    await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 1 }],
      })
      .expect(409);
    // The patient sees "ready for collection" on their own prescription.
    expect(
      (await (await as(patientUser)).get(`/api/prescriptions/${rx.id}`).expect(200)).body.data
        .status,
    ).toBe('READY_FOR_PICKUP');
    expect(
      (await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`).expect(200)).body.data
        .status,
    ).toBe('DISPENSED');
    await ph.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`).expect(409);
    // M-10 history: one event per step, by the pharmacist, recording the status it led to; the refused
    // attempts above wrote none.
    const history = (await (await as(patientUser)).get(`/api/prescriptions/${rx.id}`).expect(200))
      .body.data.history as { kind: string; status: string; actor: { firstName: string } }[];
    expect(history.map((e) => [e.kind, e.status])).toEqual([
      ['VERIFIED', 'ISSUED'],
      ['DISPENSED', 'PARTIALLY_DISPENSED'],
      ['DISPENSED', 'READY_FOR_PICKUP'],
      ['HANDED_OVER', 'DISPENSED'],
    ]);
    expect(history.every((e) => e.actor.firstName === pharmacist.firstName)).toBe(true);
    for (const b of [expired, quarantined, soon, later])
      push('StockMovement', {
        batchId: b,
        type: 'RECEIPT',
        quantity: 0 + (b === soon ? 6 : b === later ? 30 : 50),
        reason: null,
        dispenseId: null,
        performedById: pharmacist.id,
      });
    for (const b of [expired, quarantined, soon, later]) expect(ledgerMatches(b)).toBe(true);
    // Nurses read prescriptions but cannot dispense.
    await (
      await as(nurse)
    )
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, { items: [] })
      .expect(403);
  });

  it('TEST-014: an expired medicine cannot be dispensed, and nothing changes', async () => {
    const m = medicine('Amox');
    const exp = batch(m, 'OLD', 100, -3);
    const rx = prescription([[m, 10]], { verifiedAt: new Date(), verifiedById: pharmacist.id });
    const ph = await as(pharmacist);
    const res = await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 10 }],
      })
      .expect(422);
    expect(res.body.error.code).toBe('MEDICINE_EXPIRED');
    expect(batchRow(exp).quantity).toBe(100);
    expect(rows('Dispense')).toHaveLength(0);
    expect(rows('Prescription').find((p) => p.id === rx.id)!.status).toBe('ISSUED');
    // Some fresh stock, but not enough: INSUFFICIENT_STOCK with what can be given.
    batch(m, 'NEW', 4, 100);
    const short = await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 10 }],
      })
      .expect(422);
    expect(short.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { available: 4 },
    });
    expect(rows('Dispense')).toHaveLength(0);
  });

  it('cancelled prescriptions cannot be dispensed', async () => {
    const m = medicine('Pan');
    batch(m, 'P1', 10, 100);
    const rx = prescription([[m, 2]], {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledById: doctorUser.id,
      cancellationReason: 'Wrong patient',
      verifiedAt: new Date(),
    });
    await (
      await as(pharmacist)
    )
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 1 }],
      })
      .expect(409);
    expect(rows('Dispense')).toHaveLength(0);
  });

  it('quarantine keeps the quantity and records the units set aside; adjustments need a reason and never go below zero; the ledger is append-only', async () => {
    const m = medicine('Dolo', 1);
    const b = batch(m, 'D1', 12, 100);
    push('StockMovement', {
      batchId: b,
      type: 'RECEIPT',
      quantity: 12,
      reason: null,
      dispenseId: null,
      performedById: pharmacist.id,
    });
    const ph = await as(pharmacist);
    await ph.post(`/api/batches/${b}/adjustments`, { quantity: -2 }).expect(400);
    expect(
      (
        await ph
          .post(`/api/batches/${b}/adjustments`, { quantity: -13, reason: 'Count' })
          .expect(400)
      ).body.error,
    ).toMatchObject({ code: 'NEGATIVE_STOCK', details: { quantity: 12 } });
    expect(
      (
        await ph
          .post(`/api/batches/${b}/adjustments`, { quantity: -2, reason: 'Strip damaged' })
          .expect(201)
      ).body.data.quantity,
    ).toBe(10);
    expect(ledgerMatches(b)).toBe(true);
    await ph.patch(`/api/batches/${b}/quarantine`, { reason: 'x' }).expect(400);
    const q = (
      await ph.patch(`/api/batches/${b}/quarantine`, { reason: 'Supplier recall' }).expect(200)
    ).body.data;
    expect(q).toMatchObject({ status: 'QUARANTINED', quantity: 10 });
    expect(rows('StockMovement').at(-1)).toMatchObject({
      type: 'QUARANTINE',
      quantity: 10,
      reason: 'Supplier recall',
      performedById: pharmacist.id,
    });
    expect(ledgerMatches(b)).toBe(true);
    expect(
      (await ph.patch(`/api/batches/${b}/quarantine`, { reason: 'Again please' }).expect(409)).body
        .error.code,
    ).toBe('INVALID_TRANSITION');
    // Zeroing an active batch depletes it.
    const b2 = batch(m, 'D2', 3, 100);
    expect(
      (
        await ph
          .post(`/api/batches/${b2}/adjustments`, { quantity: -3, reason: 'Count correction' })
          .expect(201)
      ).body.data.status,
    ).toBe('DEPLETED');
    // Refilling it reactivates it in the same update (M-09: a depleted batch holds no units).
    expect(
      (
        await ph
          .post(`/api/batches/${b2}/adjustments`, { quantity: 2, reason: 'Found in store' })
          .expect(201)
      ).body.data,
    ).toMatchObject({ status: 'ACTIVE', quantity: 2 });
    // The API never accepts the fields that mark a system row.
    await ph
      .patch(`/api/batches/${b2}/quarantine`, { reason: 'Damaged', performedById: null })
      .expect(400);
    await ph
      .patch(`/api/batches/${b2}/quarantine`, {
        reason: 'Damaged',
        expiryReportId: crypto.randomUUID(),
      })
      .expect(400);
    // Ledger rows and dispenses cannot be changed or removed (M-09 triggers, emulated).
    await expect(
      t.prisma.stockMovement.updateMany!({ where: { batchId: b }, data: { quantity: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(t.prisma.stockMovement.deleteMany!({ where: { batchId: b } })).rejects.toThrow(
      /append-only/,
    );
    await (
      await as(admin)
    )
      .post(`/api/batches/${b2}/adjustments`, { quantity: 1, reason: 'Found one' })
      .expect(403);
  });

  it('PHARM-003: one low-stock alert per crossing strictly below the reorder level, cleared on restock and when deactivated', async () => {
    const m = medicine('Zin', 5);
    const b = batch(m, 'Z1', 9, 100);
    const ph = await as(pharmacist);
    const events = app.get(DomainEvents);
    const lows = () => events.recent.filter((e) => e.type === 'stock.low');
    const rx = prescription([[m, 9]], { verifiedAt: new Date(), verifiedById: pharmacist.id });
    await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 4 }],
      })
      .expect(201);
    // 5 left equals the reorder level: not low (strictly below, owner decision).
    expect(lows()).toHaveLength(0);
    await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 1 }],
      })
      .expect(201);
    expect(lows()).toEqual([{ type: 'stock.low', hospitalId: h.id, medicineId: m }]);
    await ph
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 2 }],
      })
      .expect(201);
    expect(lows()).toHaveLength(1); // still low: no second alert
    const alerts = (await (await as(admin)).get('/api/pharmacy/alerts').expect(200)).body.data;
    expect(alerts.lowStock).toEqual([
      expect.objectContaining({ id: m, available: 2, reorderLevel: 5 }),
    ]);
    await ph
      .post(`/api/batches/${b}/adjustments`, { quantity: 10, reason: 'Delivery counted' })
      .expect(201);
    expect(rows('Medicine').find((x) => x.id === m)!.lowStockSince).toBeNull();
    expect((await ph.get('/api/pharmacy/alerts').expect(200)).body.data.lowStock).toEqual([]);
    // Raising the reorder level above stock starts a new crossing; deactivating clears it.
    await ph.patch(`/api/medicines/${m}`, { reorderLevel: 50 }).expect(200);
    expect(lows()).toHaveLength(2);
    await ph.patch(`/api/medicines/${m}`, { isActive: false }).expect(200);
    expect(rows('Medicine').find((x) => x.id === m)!.lowStockSince).toBeNull();
  });

  it('nightly run: 02:00 hospital time, quarantines expired stock without changing quantity, reports 30 days ahead, once per day, VERIFIED hospitals only', async () => {
    const day = '2030-03-10';
    const before = zonedToUtc(day, 119, TZ);
    const after = zonedToUtc(day, 125, TZ);
    const m = medicine('Para', 1);
    const at = (n: number) => dateValue(addDays(day, n));
    const expToday = batch(m, 'E0', 7, 0, { expiresOn: at(0) });
    const expOld = batch(m, 'E1', 5, 0, { expiresOn: at(-4) });
    const empty = batch(m, 'E2', 0, 0, { expiresOn: at(-1) });
    const d30 = batch(m, 'S30', 3, 0, { expiresOn: at(30) });
    batch(m, 'S31', 3, 0, { expiresOn: at(31) });
    const m2 = medicine('Other', 1, h2.id);
    const other = batch(m2, 'H2', 4, 0, { expiresOn: at(-1) }, h2.id);
    t.prisma.addHospital({ timezone: TZ, code: 'PEND', status: 'PENDING' });
    const sweep = app.get(ExpirySweep);

    expect((await sweep.runDue(before)).map((o) => o.outcome)).toEqual(['not-due', 'not-due']);
    // The database dates system quarantines by its own clock (M-09); this test's clock is `after`.
    t.prisma.clock = () => after;
    const ran = await sweep.runDue(after);
    expect(ran).toEqual([
      { hospitalId: h.id, outcome: 'ran' },
      { hospitalId: h2.id, outcome: 'ran' },
    ]); // the PENDING hospital is not processed
    expect(batchRow(expToday)).toMatchObject({ status: 'QUARANTINED', quantity: 7 });
    expect(batchRow(expOld)).toMatchObject({ status: 'QUARANTINED', quantity: 5 });
    expect(batchRow(empty).status).toBe('DEPLETED');
    expect(
      rows('StockMovement').filter((x) => x.type === 'QUARANTINE' && x.hospitalId === h.id),
    ).toEqual([
      expect.objectContaining({
        batchId: expToday,
        quantity: 7,
        performedById: null,
        reason: expect.stringContaining('Expired on 2030-03-10'),
      }),
      expect.objectContaining({ batchId: expOld, quantity: 5, performedById: null }),
    ]);
    const report = rows('ExpiryReport').find((r) => r.hospitalId === h.id)!;
    // M-09: every system row is linked to that day's report.
    expect(
      rows('StockMovement')
        .filter((x) => x.type === 'QUARANTINE' && x.hospitalId === h.id)
        .every((x) => x.expiryReportId === report.id),
    ).toBe(true);
    const items = report.items as { batchId: string; kind: string }[];
    expect(items.map((i) => [i.batchId, i.kind])).toEqual([
      [expToday, 'QUARANTINED'],
      [expOld, 'QUARANTINED'],
      [d30, 'EXPIRING'],
    ]);
    // Each hospital's report holds only its own batches.
    const report2 = rows('ExpiryReport').find((r) => r.hospitalId === h2.id)!;
    expect((report2.items as { batchId: string }[]).map((i) => i.batchId)).toEqual([other]);
    expect(events(app)).toContainEqual({
      type: 'stock.expiring',
      hospitalId: h.id,
      reportId: report.id,
    });
    // Later ticks the same day do nothing; a direct second run is refused by the daily key.
    expect((await sweep.runDue(zonedToUtc(day, 600, TZ))).map((o) => o.outcome)).toEqual([
      'done',
      'done',
    ]);
    expect(await sweep.runHospital(h.id, TZ, after)).toBeNull();
    expect(rows('ExpiryReport')).toHaveLength(2);
    expect(rows('StockMovement').filter((x) => x.type === 'QUARANTINE')).toHaveLength(3);
  });

  it('nightly run: a failing hospital is logged and skipped, the others still run; every job query names the hospital', async () => {
    const broken = t.prisma.addHospital({ timezone: 'Not/AZone', code: 'BROKEN' });
    const after = zonedToUtc('2030-03-10', 150, TZ);
    medicine('Para', 1);
    const sweep = app.get(ExpirySweep);
    const calls: { op: string; args: Row }[] = [];
    for (const [delegate, ops] of [
      ['medicineBatch', ['findMany', 'updateMany', 'findFirstOrThrow']],
      ['stockMovement', ['create']],
      ['expiryReport', ['create', 'findFirst']],
      ['medicine', ['findMany', 'updateMany']],
    ] as const) {
      const d = (
        t.prisma as unknown as Record<string, Record<string, (a: Row) => Promise<unknown>>>
      )[delegate]!;
      for (const op of ops) {
        const orig = d[op]!.bind(d);
        d[op] = (a: Row) => (calls.push({ op: `${delegate}.${op}`, args: a }), orig(a));
      }
    }
    const out = await sweep.runDue(after);
    expect(out).toEqual(
      expect.arrayContaining([
        { hospitalId: broken.id, outcome: 'failed' },
        { hospitalId: h.id, outcome: 'ran' },
        { hospitalId: h2.id, outcome: 'ran' },
      ]),
    );
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) {
      const scope =
        (c.args.where as Row | undefined)?.hospitalId ??
        (c.args.data as Row | undefined)?.hospitalId;
      expect([h.id, h2.id]).toContain(scope);
    }
  });

  it('two hospitals: another hospital cannot read, change or dispense anything by id, and sees none of it in lists', async () => {
    const m = medicine('Mine', 50);
    const b = batch(m, 'M1', 10, 100);
    push('StockMovement', {
      batchId: b,
      type: 'RECEIPT',
      quantity: 10,
      reason: null,
      dispenseId: null,
      performedById: pharmacist.id,
    });
    const rx = prescription([[m, 2]]);
    push('ExpiryReport', {
      runDate: dateValue(addDays(today(), -1)),
      items: [{ batchId: b, kind: 'EXPIRING' }],
    });
    await app.get(ExpirySweep).runHospital(h.id, TZ); // own data: low stock flagged for h only
    const other = await as(pharmacist2);
    await other.get(`/api/medicines/${m}/batches`).expect(404);
    await other
      .post(`/api/medicines/${m}/batches`, {
        batchNumber: 'X',
        manufacturedOn: addDays(today(), -1),
        expiresOn: addDays(today(), 100),
        quantity: 1,
        unitCost: 1,
        mrp: 1,
      })
      .expect(404);
    await other.patch(`/api/batches/${b}/quarantine`, { reason: 'Not mine' }).expect(404);
    await other
      .post(`/api/batches/${b}/adjustments`, { quantity: -1, reason: 'Not mine' })
      .expect(404);
    await other.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`).expect(404);
    await other
      .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
        items: [{ itemId: rx.itemIds[0], quantity: 1 }],
      })
      .expect(404);
    await other.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`).expect(404);
    expect((await other.get('/api/pharmacy/prescriptions').expect(200)).body.data).toEqual([]);
    expect((await other.get(`/api/pharmacy/ledger?batchId=${b}`).expect(200)).body.data).toEqual(
      [],
    );
    expect((await other.get(`/api/pharmacy/ledger?medicineId=${m}`).expect(200)).body.data).toEqual(
      [],
    );
    const alerts = (await other.get('/api/pharmacy/alerts').expect(200)).body.data;
    expect(alerts).toEqual({ lowStock: [], expiringSoon: [], latestReport: null });
    // Nothing of hospital A changed.
    expect(batchRow(b)).toMatchObject({ quantity: 10, status: 'ACTIVE' });
    expect(rows('Prescription').find((p) => p.id === rx.id)).toMatchObject({
      status: 'ISSUED',
      verifiedAt: null,
    });
    // The owner sees its own data.
    const own = (await (await as(pharmacist)).get('/api/pharmacy/alerts').expect(200)).body.data;
    expect(own.lowStock.map((x: { id: string }) => x.id)).toEqual([m]);
    expect(own.latestReport).not.toBeNull();
  });

  describe('stock accounting across quarantine (DEC-043)', () => {
    /** Physical units, ledger balance and available units of one medicine, from the stored rows. */
    const account = (medicineId: string) => {
      const bs = rows('MedicineBatch').filter((b) => b.medicineId === medicineId);
      const asText = (b: Row) => ({
        status: b.status as 'ACTIVE',
        quantity: b.quantity as number,
        expiresOn: (b.expiresOn as Date).toISOString().slice(0, 10),
      });
      const moves = (id: string) =>
        rows('StockMovement').filter((m) => m.batchId === id) as {
          type: 'RECEIPT';
          quantity: number;
        }[];
      return {
        physical: bs.reduce((s2, b) => s2 + (b.quantity as number), 0),
        balances: bs.map((b) => [b.batchNumber, ledgerBalance(moves(b.id as string)), b.quantity]),
        available: availableUnits(bs.map(asText), today()),
      };
    };
    /** What doctors and the low-stock check see (through the API and its cache). */
    const apiAvailable = async (name: string) =>
      (await (await as(doctorUser)).get(`/api/medicines?search=${name}`).expect(200)).body.data[0]
        .available as number;

    it('manual quarantine: quantity stays physical, the QUARANTINE row records the remaining units, available drops by exactly those units', async () => {
      const m = medicine('Acct', 3);
      const ph = await as(pharmacist);
      const body = (batchNumber: string, quantity: number, days: number) => ({
        batchNumber,
        manufacturedOn: addDays(today(), -10),
        expiresOn: addDays(today(), days),
        quantity,
        unitCost: 1,
        mrp: 2,
      });
      const b1 = (await ph.post(`/api/medicines/${m}/batches`, body('A1', 10, 50)).expect(201)).body
        .data.id;
      await ph.post(`/api/medicines/${m}/batches`, body('A2', 5, 300)).expect(201);
      const rx = prescription([[m, 3]], { verifiedAt: new Date(), verifiedById: pharmacist.id });
      await ph
        .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
          items: [{ itemId: rx.itemIds[0], quantity: 3 }],
        })
        .expect(201);

      const before = account(m);
      expect(before).toEqual({
        physical: 12,
        balances: [
          ['A1', 7, 7],
          ['A2', 5, 5],
        ],
        available: 12,
      });
      expect(await apiAvailable('Acct')).toBe(12);

      await ph.patch(`/api/batches/${b1}/quarantine`, { reason: 'Damaged carton' }).expect(200);
      const after = account(m);
      // Not silently reduced: still 12 units on hand, and each batch's ledger still equals its quantity.
      expect(after.physical).toBe(12);
      expect(after.balances).toEqual([
        ['A1', 7, 7],
        ['A2', 5, 5],
      ]);
      // Not double-counted: the QUARANTINE row is the 7 remaining units (not the 10 received), outside the balance.
      expect(rows('StockMovement').filter((x) => x.type === 'QUARANTINE')).toEqual([
        expect.objectContaining({ batchId: b1, quantity: 7 }),
      ]);
      // Available drops by exactly the quarantined units, in the stored rows and through the API cache.
      expect(after.available).toBe(5);
      expect(await apiAvailable('Acct')).toBe(5);
      // The ledger view shows the same numbers.
      const ledger = (await ph.get(`/api/pharmacy/ledger?batchId=${b1}`).expect(200)).body.data as {
        type: 'RECEIPT';
        quantity: number;
      }[];
      // Same rows regardless of display order (timestamps can tie within one transaction).
      expect(ledger.map((x) => `${x.type} ${x.quantity}`).sort()).toEqual([
        'DISPENSE -3',
        'QUARANTINE 7',
        'RECEIPT 10',
      ]);
      expect(ledgerBalance(ledger)).toBe(7);

      // Quarantined units are never dispensed: only A2's 5 can be given.
      const rx2 = prescription([[m, 6]], { verifiedAt: new Date(), verifiedById: pharmacist.id });
      expect(
        (
          await ph
            .post(`/api/pharmacy/prescriptions/${rx2.id}/dispense`, {
              items: [{ itemId: rx2.itemIds[0], quantity: 6 }],
            })
            .expect(422)
        ).body.error.details.available,
      ).toBe(5);
      expect(account(m)).toEqual(after);

      // Destroying the quarantined units is an explicit adjustment: physical falls, available does not.
      await ph
        .post(`/api/batches/${b1}/adjustments`, { quantity: -8, reason: 'Destroyed' })
        .expect(400);
      const destroyed = (
        await ph
          .post(`/api/batches/${b1}/adjustments`, {
            quantity: -7,
            reason: 'Destroyed under supervision',
          })
          .expect(201)
      ).body.data;
      expect(destroyed).toMatchObject({ quantity: 0, status: 'QUARANTINED' });
      expect(account(m)).toEqual({
        physical: 5,
        balances: [
          ['A1', 0, 0],
          ['A2', 5, 5],
        ],
        available: 5,
      });
      expect(await apiAvailable('Acct')).toBe(5);
    });

    it('nightly quarantine of expired stock changes neither quantity, balance nor available stock', async () => {
      const day = '2030-03-10';
      const m = medicine('Night', 1);
      const exp = batch(m, 'N1', 4, 0, { expiresOn: dateValue(addDays(day, -2)) });
      const fresh = batch(m, 'N2', 6, 0, { expiresOn: dateValue(addDays(day, 100)) });
      for (const [id, q] of [
        [exp, 4],
        [fresh, 6],
      ] as const)
        push('StockMovement', {
          batchId: id,
          type: 'RECEIPT',
          quantity: q,
          reason: null,
          dispenseId: null,
          performedById: pharmacist.id,
        });
      const at = (b: Row) => ({
        status: b.status as 'ACTIVE',
        quantity: b.quantity as number,
        expiresOn: (b.expiresOn as Date).toISOString().slice(0, 10),
      });
      const snapshot = () => {
        const bs = rows('MedicineBatch').filter((b) => b.medicineId === m);
        return {
          physical: bs.reduce((s2, b) => s2 + (b.quantity as number), 0),
          balance: bs.map(
            (b) =>
              ledgerBalance(
                rows('StockMovement').filter((x) => x.batchId === b.id) as {
                  type: 'RECEIPT';
                  quantity: number;
                }[],
              ) - (b.quantity as number),
          ),
          available: availableUnits(bs.map(at), day),
        };
      };
      const before = snapshot();
      // Expired by date, so already unavailable before the run.
      expect(before).toEqual({ physical: 10, balance: [0, 0], available: 6 });
      t.prisma.clock = () => zonedToUtc(day, 150, TZ);
      await app.get(ExpirySweep).runHospital(h.id, TZ, zonedToUtc(day, 150, TZ));
      expect(batchRow(exp)).toMatchObject({ status: 'QUARANTINED', quantity: 4 });
      expect(
        rows('StockMovement').filter((x) => x.batchId === exp && x.type === 'QUARANTINE'),
      ).toEqual([expect.objectContaining({ quantity: 4, performedById: null })]);
      expect(snapshot()).toEqual(before);
      const report = rows('ExpiryReport').find((r) => r.hospitalId === h.id)!;
      expect(
        (report.items as { batchId: string; quantity: number }[]).find((i) => i.batchId === exp)!
          .quantity,
      ).toBe(4);
    });

    it('an explicit run for one hospital never touches another hospital', async () => {
      const mine = batch(medicine('One', 1), 'H1', 3, -1);
      const theirs = batch(medicine('Two', 1, h2.id), 'H2', 3, -1, {}, h2.id);
      await app.get(ExpirySweep).runHospital(h.id, TZ);
      expect(batchRow(mine).status).toBe('QUARANTINED');
      expect(batchRow(theirs)).toMatchObject({ status: 'ACTIVE', quantity: 3 });
      expect(rows('StockMovement').some((x) => x.hospitalId === h2.id)).toBe(false);
      expect(rows('ExpiryReport').map((r) => r.hospitalId)).toEqual([h.id]);
    });
  });
});

const events = (app: INestApplication) => app.get(DomainEvents).recent;
