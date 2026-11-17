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
import { ExpirySweep } from '../src/modules/pharmacy/expiry-sweep';
import {
  ExpirySweepProcessor,
  ExpirySweepScheduler,
} from '../src/modules/pharmacy/pharmacy-jobs.module';

/**
 * Phase 7 on real PostgreSQL (T-PHARM-INT-001): M-07/M-08/M-09 constraints and triggers, FIFO
 * dispensing, TEST-014, concurrent dispensing, ledger balance, the nightly run, and two-hospital
 * isolation with real queries. The nightly run is called only for this test's hospitals, never for
 * every hospital in the database. Rows prefixed "int-".
 */
const prisma = new PrismaClient();
const run = randomBytes(3).toString('hex');
const CSRF = 'p'.repeat(43);
const TZ = 'Asia/Kolkata';
const D = (d: string) => new Date(`${d}T00:00:00Z`);

describe('Phase 7 integration: pharmacy on PostgreSQL', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('dispenses FIFO safely, keeps the ledger, runs the nightly job and isolates hospitals', async () => {
    let n = 0;
    const hospital = (tag: string) =>
      prisma.hospital.create({
        data: {
          name: `int-ph-${tag}-${run}`,
          code: `INTP${tag}-${run}`.toUpperCase(),
          email: `int-ph-${tag}-${run}@example.com`,
          phone: '+914400000007',
          licenseNumber: `LP-${tag}-${run}`,
          status: 'VERIFIED',
          timezone: TZ,
        },
      });
    const A = await hospital('a');
    const B = await hospital('b');

    // ---- DEC-043: no timed job can run inside this test app ---------------------------------
    expect(process.env.SCHEDULED_JOBS).toBe('off');
    expect(() => app.get(ExpirySweepProcessor, { strict: false })).toThrow();
    expect(() => app.get(ExpirySweepScheduler, { strict: false })).toThrow();
    expect(app.get(ExpirySweep)).toBeDefined(); // explicit runs only
    // A bystander hospital with expired stock that nothing in this test may touch. Its time zone
    // puts it before 02:00 local, so even a separately running `pnpm dev` worker leaves it alone.
    const h0 = (24 - new Date().getUTCHours()) % 24;
    const bystanderTz = h0 === 0 ? 'Etc/GMT' : h0 <= 14 ? `Etc/GMT-${h0}` : `Etc/GMT+${24 - h0}`;
    const C = await prisma.hospital.create({
      data: {
        name: `int-ph-c-${run}`,
        code: `INTPC-${run}`.toUpperCase(),
        email: `int-ph-c-${run}@example.com`,
        phone: '+914400000008',
        licenseNumber: `LP-c-${run}`,
        status: 'VERIFIED',
        timezone: bystanderTz,
      },
    });
    const cMed = await prisma.medicine.create({
      data: {
        hospitalId: C.id,
        name: `int-c-${run}`,
        form: 'TABLET',
        strength: '1 mg',
        reorderLevel: 1,
      },
    });
    const cBatch = await prisma.medicineBatch.create({
      data: {
        hospitalId: C.id,
        medicineId: cMed.id,
        batchNumber: 'C1',
        manufacturedOn: D('2020-01-01'),
        expiresOn: D('2021-01-01'),
        quantity: 7,
        unitCost: 1,
        mrp: 2,
      },
    });
    const base = (hid: string, role: Role) => ({
      hospitalId: hid,
      email: `int-ph-${role.toLowerCase()}-${++n}-${run}@example.com`,
      passwordHash: 'x',
      role,
      firstName: 'Int',
      lastName: `${role}${n}`,
      emailVerifiedAt: new Date(),
    });
    const staff = (hid: string, role: Role) =>
      prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: base(hid, role) });
        await tx.staffProfile.create({ data: { hospitalId: hid, userId: u.id } });
        return u;
      });
    const phA = await staff(A.id, 'PHARMACIST');
    const phB = await staff(B.id, 'PHARMACIST');
    const dept = await prisma.department.create({ data: { hospitalId: A.id, name: 'General' } });
    const doctor = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: base(A.id, 'DOCTOR') });
      return tx.doctor.create({
        data: {
          hospitalId: A.id,
          userId: u.id,
          registrationNumber: 'K',
          specialisation: 'General',
          consultationFee: 1,
        },
      });
    });
    const patient = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: base(A.id, 'PATIENT') });
      return tx.patient.create({
        data: {
          hospitalId: A.id,
          userId: u.id,
          mrn: `INTP-${run}`,
          dateOfBirth: new Date('1990-01-01'),
          gender: 'FEMALE',
        },
      });
    });
    const appt = await prisma.appointment.create({
      data: {
        hospitalId: A.id,
        doctorId: doctor.id,
        patientId: patient.id,
        departmentId: dept.id,
        scheduledAt: new Date(),
        endAt: new Date(Date.now() + 1_800_000),
        status: 'IN_PROGRESS',
        createdById: patient.userId,
      },
    });
    const record = await prisma.medicalRecord.create({
      data: { hospitalId: A.id, appointmentId: appt.id, chiefComplaint: 'Fever' },
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
    const a = await client(phA.id, 'PHARMACIST', A.id);
    const b = await client(phB.id, 'PHARMACIST', B.id);
    const today = localDate(new Date(), TZ);

    // ---- M-07: the column exists and starts empty -------------------------------------------
    const med = async (name: string, reorderLevel: number) =>
      (
        await a
          .post('/api/medicines', {
            name: `int-${name}-${run}`,
            form: 'TABLET',
            strength: '500 mg',
            reorderLevel,
          })
          .expect(201)
      ).body.data;
    const crocin = await med('crocin', 5);
    expect(
      (await prisma.medicine.findUniqueOrThrow({ where: { id: crocin.id } })).lowStockSince,
    ).toBeNull();

    // ---- Receiving and FIFO ------------------------------------------------------------------
    const receive = (medicineId: string, batchNumber: string, quantity: number, days: number) =>
      a.post(`/api/medicines/${medicineId}/batches`, {
        batchNumber,
        manufacturedOn: addDays(today, -30),
        expiresOn: addDays(today, days),
        quantity,
        unitCost: 2,
        mrp: 3,
      });
    const later = (await receive(crocin.id, 'LATER', 30, 300).expect(201)).body.data;
    const soon = (await receive(crocin.id, 'SOON', 6, 20).expect(201)).body.data;
    expect((await receive(crocin.id, 'PAST', 1, 0).expect(400)).body.error.code).toBe(
      'EXPIRY_IN_PAST',
    );
    // Expired stock can only exist from before; written directly with its RECEIPT entry.
    const old = await prisma.medicineBatch.create({
      data: {
        hospitalId: A.id,
        medicineId: crocin.id,
        batchNumber: 'OLD',
        manufacturedOn: D(addDays(today, -400)),
        expiresOn: D(addDays(today, -1)),
        quantity: 9,
        unitCost: 1,
        mrp: 2,
      },
    });
    await prisma.stockMovement.create({
      data: {
        hospitalId: A.id,
        batchId: old.id,
        type: 'RECEIPT',
        quantity: 9,
        performedById: phA.id,
      },
    });

    // Issuing is Phase 5's job; written directly here, with its ISSUED event in the same
    // transaction as M-10 requires.
    const prescription = async (medicineId: string, quantity: number) => {
      const p = await prisma.$transaction(async (tx) => {
        const created = await tx.prescription.create({
          data: {
            hospitalId: A.id,
            medicalRecordId: record.id,
            items: {
              create: [
                { medicineId, dosage: '500 mg', frequency: 'TDS', durationDays: 5, quantity },
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
            actorId: doctor.userId,
          },
        });
        return created;
      });
      return { id: p.id, itemId: p.items[0]!.id };
    };
    const rx = await prescription(crocin.id, 10);
    await a.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`).expect(200);
    const res = (
      await a
        .post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
          items: [{ itemId: rx.itemId, quantity: 10 }],
        })
        .expect(201)
    ).body.data;
    expect(res.status).toBe('READY_FOR_PICKUP');
    const refusedNow = (q: Promise<unknown>) => expect(q).rejects.toThrow();
    const qty = async (id: string) =>
      (await prisma.medicineBatch.findUniqueOrThrow({ where: { id } })).quantity;
    expect([await qty(soon.id), await qty(later.id), await qty(old.id)]).toEqual([0, 26, 9]);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: soon.id } })).status).toBe(
      'DEPLETED',
    );
    await a.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`).expect(200);
    // M-10 history, from the database: one event per step, in order, each with its user.
    const events = await prisma.prescriptionEvent.findMany({
      where: { prescriptionId: rx.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => [e.kind, e.status])).toEqual([
      ['ISSUED', 'ISSUED'],
      ['VERIFIED', 'ISSUED'],
      ['DISPENSED', 'READY_FOR_PICKUP'],
      ['HANDED_OVER', 'DISPENSED'],
    ]);
    expect(events.slice(1).every((e) => e.actorId === phA.id)).toBe(true);
    // The database refuses an edit, a deletion, an orphan event, and a status change without its event.
    await refusedNow(
      prisma.$executeRaw`UPDATE prescription_events SET reason = 'x' WHERE "prescriptionId" = ${rx.id}::uuid`,
    );
    await refusedNow(
      prisma.$executeRaw`DELETE FROM prescription_events WHERE "prescriptionId" = ${rx.id}::uuid`,
    );
    await refusedNow(
      prisma.prescriptionEvent.create({
        data: {
          hospitalId: A.id,
          prescriptionId: rx.id,
          kind: 'CANCELLED',
          status: 'CANCELLED',
          actorId: doctor.userId,
          reason: 'x',
        },
      }),
    );
    await refusedNow(
      prisma.prescription.update({ where: { id: rx.id }, data: { status: 'READY_FOR_PICKUP' } }),
    );
    expect(
      await prisma.auditLog.count({ where: { action: 'prescription.dispense', entityId: rx.id } }),
    ).toBe(1);

    // ---- TEST-014: only expired stock left ---------------------------------------------------
    const amox = await med('amox', 1);
    await prisma.medicineBatch.create({
      data: {
        hospitalId: A.id,
        medicineId: amox.id,
        batchNumber: 'X',
        manufacturedOn: D(addDays(today, -400)),
        expiresOn: D(today),
        quantity: 50,
        unitCost: 1,
        mrp: 2,
      },
    });
    const rx2 = await prescription(amox.id, 5);
    await a.patch(`/api/pharmacy/prescriptions/${rx2.id}/verify`).expect(200);
    expect(
      (
        await a
          .post(`/api/pharmacy/prescriptions/${rx2.id}/dispense`, {
            items: [{ itemId: rx2.itemId, quantity: 5 }],
          })
          .expect(422)
      ).body.error.code,
    ).toBe('MEDICINE_EXPIRED');
    expect(await prisma.dispense.count({ where: { prescriptionItemId: rx2.itemId } })).toBe(0);

    // ---- Two pharmacists dispense the last 5 units at once: exactly one succeeds ---------------
    const zinc = await med('zinc', 3);
    const last = (await receive(zinc.id, 'Z', 5, 100).expect(201)).body.data;
    const r1 = await prescription(zinc.id, 5);
    const r2 = await prescription(zinc.id, 5);
    for (const r of [r1, r2])
      await a.patch(`/api/pharmacy/prescriptions/${r.id}/verify`).expect(200);
    const a2 = await client(phA.id, 'PHARMACIST', A.id);
    const both = await Promise.all([
      a.post(`/api/pharmacy/prescriptions/${r1.id}/dispense`, {
        items: [{ itemId: r1.itemId, quantity: 5 }],
      }),
      a2.post(`/api/pharmacy/prescriptions/${r2.id}/dispense`, {
        items: [{ itemId: r2.itemId, quantity: 5 }],
      }),
    ]);
    expect(both.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(await qty(last.id)).toBe(0);
    // Low stock raised once (0 < 3).
    expect(
      (await prisma.medicine.findUniqueOrThrow({ where: { id: zinc.id } })).lowStockSince,
    ).not.toBeNull();

    // ---- Ledger balance for every batch of hospital A -----------------------------------------
    const balance = await prisma.$queryRaw<
      { id: string; quantity: number; ledger: bigint | null }[]
    >`
      SELECT b.id, b.quantity,
             (SELECT sum(m.quantity) FROM stock_movements m WHERE m."batchId" = b.id AND m.type <> 'QUARANTINE') AS ledger
      FROM medicine_batches b WHERE b."hospitalId" = ${A.id}::uuid AND b."batchNumber" <> 'X'`;
    for (const row of balance) expect(Number(row.ledger)).toBe(row.quantity);

    // ---- M-09 in the database ---------------------------------------------------------------
    const refused = (q: Promise<unknown>) => expect(q).rejects.toThrow();
    await refused(
      prisma.$executeRaw`UPDATE stock_movements SET quantity = 1 WHERE "batchId" = ${later.id}::uuid`,
    );
    await refused(
      prisma.$executeRaw`DELETE FROM stock_movements WHERE "batchId" = ${later.id}::uuid`,
    );
    await refused(prisma.$executeRaw`DELETE FROM dispenses WHERE "batchId" = ${later.id}::uuid`);
    await refused(
      prisma.stockMovement.create({
        data: { hospitalId: A.id, batchId: later.id, type: 'RECEIPT', quantity: 1 },
      }),
    );
    await refused(
      prisma.stockMovement.create({
        data: { hospitalId: A.id, batchId: later.id, type: 'QUARANTINE', quantity: 1 },
      }),
    );
    await refused(
      prisma.stockMovement.create({
        data: {
          hospitalId: A.id,
          batchId: later.id,
          type: 'DISPENSE',
          quantity: -1,
          performedById: phA.id,
        },
      }),
    );
    // A performer from another hospital is refused by the composite key.
    await refused(
      prisma.stockMovement.create({
        data: {
          hospitalId: A.id,
          batchId: later.id,
          type: 'ADJUSTMENT',
          quantity: 1,
          reason: 'x',
          performedById: phB.id,
        },
      }),
    );

    // ---- Nightly run for this test's hospitals ----------------------------------------------
    const lowB = await (
      await b
        .post('/api/medicines', {
          name: `int-b-${run}`,
          form: 'TABLET',
          strength: '1 mg',
          reorderLevel: 1,
        })
        .expect(201)
    ).body.data;
    await prisma.medicineBatch.create({
      data: {
        hospitalId: B.id,
        medicineId: lowB.id,
        batchNumber: 'B1',
        manufacturedOn: D(addDays(today, -10)),
        expiresOn: D(addDays(today, 5)),
        quantity: 4,
        unitCost: 1,
        mrp: 2,
      },
    });
    // ---- DEC-043 accounting before the nightly run (crocin: SOON 0, LATER 26, OLD 9 expired) --
    const account = async () => {
      const rowsA = await prisma.$queryRaw<
        {
          id: string;
          status: string;
          quantity: number;
          balance: bigint | null;
          quarantined: bigint | null;
        }[]
      >`
        SELECT b.id, b.status::text AS status, b.quantity,
               (SELECT sum(m.quantity) FROM stock_movements m WHERE m."batchId" = b.id AND m.type <> 'QUARANTINE') AS balance,
               (SELECT sum(m.quantity) FROM stock_movements m WHERE m."batchId" = b.id AND m.type = 'QUARANTINE') AS quarantined
        FROM medicine_batches b WHERE b."medicineId" = ${crocin.id}::uuid ORDER BY b."batchNumber"`;
      const search = (await a.get(`/api/medicines?search=int-crocin-${run}`).expect(200)).body
        .data[0];
      return {
        physical: rowsA.reduce((s2, r) => s2 + r.quantity, 0),
        balanced: rowsA.every((r) => Number(r.balance ?? 0) === r.quantity),
        quarantined: rowsA.map((r) => Number(r.quarantined ?? 0)),
        available: search.available as number,
      };
    };
    const beforeRun = await account();
    expect(beforeRun).toEqual({
      physical: 35,
      balanced: true,
      quarantined: [0, 0, 0],
      available: 26,
    });

    const sweep = app.get(ExpirySweep);
    const repA = await sweep.runHospital(A.id, TZ);
    expect(repA).not.toBeNull();
    expect(await sweep.runHospital(A.id, TZ)).toBeNull(); // once per day
    await sweep.runHospital(B.id, TZ);
    const oldNow = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldNow).toMatchObject({ status: 'QUARANTINED', quantity: 9 });
    // M-09 Layer A: the system row is linked to that run's report; a later transaction cannot add one.
    expect(
      await prisma.stockMovement.findFirst({ where: { batchId: old.id, type: 'QUARANTINE' } }),
    ).toMatchObject({
      expiryReportId: repA!.id,
      performedById: null,
    });
    await refusedNow(
      prisma.stockMovement.create({
        data: {
          hospitalId: A.id,
          batchId: later.id,
          type: 'QUARANTINE',
          quantity: 26,
          reason: 'Expired',
          expiryReportId: repA!.id,
        },
      }),
    );
    await refusedNow(
      prisma.medicineBatch.create({
        data: {
          hospitalId: A.id,
          medicineId: crocin.id,
          batchNumber: 'NQ',
          manufacturedOn: D('2026-01-01'),
          expiresOn: D('2030-01-01'),
          quantity: 1,
          unitCost: 1,
          mrp: 1,
          status: 'QUARANTINED',
        },
      }),
    );
    await refusedNow(
      prisma.medicineBatch.update({ where: { id: old.id }, data: { status: 'ACTIVE' } }),
    );
    // Quarantine neither reduced nor double-counted anything: same physical units and balances,
    // same available stock; the 9 expired units are recorded once as set aside (LATER, OLD, SOON).
    expect(await account()).toEqual({ ...beforeRun, quarantined: [0, 9, 0] });
    expect(
      await prisma.stockMovement.findFirst({ where: { batchId: old.id, type: 'QUARANTINE' } }),
    ).toMatchObject({ quantity: 9, performedById: null });
    const reports = await prisma.expiryReport.findMany({
      where: { hospitalId: { in: [A.id, B.id] } },
    });
    expect(reports).toHaveLength(2);
    const itemsOf = (hid: string) =>
      reports.find((r) => r.hospitalId === hid)!.items as { batchId: string }[];
    const aBatches = (
      await prisma.medicineBatch.findMany({ where: { hospitalId: A.id }, select: { id: true } })
    ).map((x) => x.id);
    expect(itemsOf(B.id).every((i) => !aBatches.includes(i.batchId))).toBe(true);
    expect(itemsOf(A.id).map((i) => i.batchId)).toContain(old.id);
    // M-08 in the database: one report per hospital and day; items must be a list.
    await refused(
      prisma.expiryReport.create({ data: { hospitalId: A.id, runDate: D(today), items: [] } }),
    );
    await refused(
      prisma.$executeRaw`INSERT INTO expiry_reports (id, "hospitalId", "runDate", items) VALUES (gen_random_uuid(), ${A.id}::uuid, ${D(addDays(today, 1))}::date, '{}'::jsonb)`,
    );

    // ---- Two hospitals through the API -------------------------------------------------------
    await b.get(`/api/medicines/${crocin.id}/batches`).expect(404);
    await b.patch(`/api/batches/${later.id}/quarantine`, { reason: 'Not mine' }).expect(404);
    await b
      .post(`/api/batches/${later.id}/adjustments`, { quantity: -1, reason: 'Not mine' })
      .expect(404);
    await b.patch(`/api/pharmacy/prescriptions/${rx2.id}/verify`).expect(404);
    await b
      .post(`/api/pharmacy/prescriptions/${rx2.id}/dispense`, {
        items: [{ itemId: rx2.itemId, quantity: 1 }],
      })
      .expect(404);
    await b.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`).expect(404);
    expect((await b.get('/api/pharmacy/prescriptions').expect(200)).body.data).toEqual([]);
    expect((await b.get(`/api/pharmacy/ledger?batchId=${later.id}`).expect(200)).body.data).toEqual(
      [],
    );
    const alertsB = (await b.get('/api/pharmacy/alerts').expect(200)).body.data;
    expect(alertsB.latestReport.id).toBe(reports.find((r) => r.hospitalId === B.id)!.id);
    expect(alertsB.lowStock.map((m: { id: string }) => m.id)).not.toContain(zinc.id);
    expect(
      alertsB.expiringSoon.every((x: { medicine: { id: string } }) => x.medicine.id === lowB.id),
    ).toBe(true);
    const alertsA = (await a.get('/api/pharmacy/alerts').expect(200)).body.data;
    expect(alertsA.latestReport.id).toBe(repA!.id);
    expect(await qty(later.id)).toBe(26); // B's attempts changed nothing

    // ---- The bystander hospital was never processed --------------------------------------------
    expect(
      await prisma.medicineBatch.findUniqueOrThrow({ where: { id: cBatch.id } }),
    ).toMatchObject({ status: 'ACTIVE', quantity: 7 });
    expect(await prisma.stockMovement.count({ where: { hospitalId: C.id } })).toBe(0);
    expect(await prisma.expiryReport.count({ where: { hospitalId: C.id } })).toBe(0);
  }, 60_000);
});
