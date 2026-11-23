import { randomUUID } from 'node:crypto';
import { localDate } from '../common/time/zoned';
import { FakePrisma } from './fake-prisma';

type Row = Record<string, unknown>;

/**
 * The in-memory database mirrors the M-09 and M-10 triggers (validated against PostgreSQL 16 in
 * T-MIG-PH-002), so unit tests exercise the same rules: a failed transaction restores everything,
 * and commit-time checks run when the transaction ends.
 */
describe('FakePrisma: M-09 and M-10 rules', () => {
  let db: FakePrisma;
  let H: string, doc: string, ph: string, rx: string, item: string, batch: string, expired: string;
  const add = (model: string, row: Row) => {
    const r = {
      id: randomUUID(),
      hospitalId: H,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...row,
    };
    db.rows(model).push(r);
    return r.id;
  };
  const today = () => localDate(new Date(), 'Asia/Kolkata');
  const D = (d: string) => new Date(`${d}T00:00:00Z`);
  const p = () => db.rows('Prescription').find((x) => x.id === rx)!;
  const event = (
    kind: string,
    status: string,
    actorId: string | null = ph,
    reason: string | null = null,
  ) =>
    db.prescriptionEvent.create!({
      data: { hospitalId: H, prescriptionId: rx, kind, status, actorId, reason },
    });

  beforeEach(() => {
    db = new FakePrisma();
    H = db.addHospital({ timezone: 'Asia/Kolkata' }).id;
    doc = db.addUser({ role: 'DOCTOR', hospitalId: H }).id;
    ph = db.addUser({ role: 'PHARMACIST', hospitalId: H }).id;
    const med = add('Medicine', {
      name: 'Para',
      form: 'TABLET',
      strength: '1',
      reorderLevel: 1,
      isActive: true,
      genericName: null,
      lowStockSince: null,
    });
    const b = {
      medicineId: med,
      manufacturedOn: D('2020-01-01'),
      unitCost: 1,
      mrp: 2,
      supplierId: null,
      receivedAt: new Date(),
    };
    batch = add('MedicineBatch', {
      ...b,
      batchNumber: 'OK',
      expiresOn: D('2035-01-01'),
      quantity: 100,
      status: 'ACTIVE',
    });
    expired = add('MedicineBatch', {
      ...b,
      batchNumber: 'EXP',
      expiresOn: D('2021-01-01'),
      quantity: 9,
      status: 'ACTIVE',
    });
    rx = add('Prescription', {
      medicalRecordId: randomUUID(),
      status: 'ISSUED',
      notes: null,
      pdfFileId: null,
      issuedAt: new Date(),
      verifiedAt: null,
      verifiedById: null,
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      allergyOverrideReason: null,
    });
    item = add('PrescriptionItem', {
      prescriptionId: rx,
      medicineId: med,
      dosage: '1',
      frequency: 'OD',
      durationDays: 6,
      quantity: 6,
      instructions: null,
    });
  });
  const verify = (at = new Date()) =>
    db.$transaction(async (tx) => {
      await tx.prescription.updateMany!({
        where: { id: rx },
        data: { verifiedAt: at, verifiedById: ph },
      });
      await event('VERIFIED', 'ISSUED');
    });
  const dispense = (n: number, status: string) =>
    db.$transaction(async (tx) => {
      await tx.prescription.updateMany!({ where: { id: rx }, data: { updatedAt: new Date() } });
      await tx.dispense.create!({
        data: {
          hospitalId: H,
          prescriptionItemId: item,
          batchId: batch,
          quantity: n,
          dispensedById: ph,
        },
      });
      await tx.prescription.updateMany!({ where: { id: rx }, data: { status } });
      await event('DISPENSED', status);
    });

  it('a status change without its event is refused at commit and fully rolled back', async () => {
    await verify();
    await expect(
      db.$transaction(async (tx) => {
        await tx.dispense.create!({
          data: {
            hospitalId: H,
            prescriptionItemId: item,
            batchId: batch,
            quantity: 2,
            dispensedById: ph,
          },
        });
        await tx.prescription.updateMany!({
          where: { id: rx },
          data: { status: 'PARTIALLY_DISPENSED' },
        });
      }),
    ).rejects.toThrow(/needs its history event/);
    expect(p().status).toBe('ISSUED');
    expect(db.rows('Dispense')).toHaveLength(0);
  });

  it('accepts the real workflow and refuses what breaks it', async () => {
    await expect(
      db.prescription.updateMany!({
        where: { id: rx },
        data: { verifiedAt: new Date(), verifiedById: ph },
      }),
    ).rejects.toThrow(/VERIFIED event/);
    await expect(
      db.dispense.create!({
        data: {
          hospitalId: H,
          prescriptionItemId: item,
          batchId: batch,
          quantity: 1,
          dispensedById: ph,
        },
      }),
    ).rejects.toThrow(/verified prescription/);
    await verify();
    await expect(verify(new Date(Date.now() + 60_000))).rejects.toThrow(/cannot change/);
    await expect(dispense(2, 'READY_FOR_PICKUP')).rejects.toThrow(/fully dispensed/);
    await dispense(2, 'PARTIALLY_DISPENSED');
    await dispense(2, 'PARTIALLY_DISPENSED');
    await expect(dispense(3, 'READY_FOR_PICKUP')).rejects.toThrow(/prescribed quantity/);
    await dispense(2, 'READY_FOR_PICKUP');
    await expect(event('CANCELLED', 'CANCELLED', doc, 'x')).rejects.toThrow(
      /with the change it records/,
    );
    await db.$transaction(async (tx) => {
      await tx.prescription.updateMany!({
        where: { id: rx, status: 'READY_FOR_PICKUP' },
        data: { status: 'DISPENSED' },
      });
      await event('HANDED_OVER', 'DISPENSED');
    });
    await expect(
      db.prescription.update!({ where: { id: rx }, data: { notes: 'edited' } }),
    ).rejects.toThrow(/never edited/);
    await expect(
      db.prescriptionEvent.deleteMany!({ where: { prescriptionId: rx } }),
    ).rejects.toThrow(/append-only/);
    expect(db.rows('PrescriptionEvent').map((e) => e.kind)).toEqual([
      'VERIFIED',
      'DISPENSED',
      'DISPENSED',
      'DISPENSED',
      'HANDED_OVER',
    ]);
  });

  it('a dispense written without its status change is refused at commit', async () => {
    await verify();
    await expect(
      db.dispense.create!({
        data: {
          hospitalId: H,
          prescriptionItemId: item,
          batchId: batch,
          quantity: 1,
          dispensedById: ph,
        },
      }),
    ).rejects.toThrow(/status update in the same transaction/);
    expect(db.rows('Dispense')).toHaveLength(0);
  });

  it('system quarantine rows must be exactly what the nightly run writes', async () => {
    const run = (o: { list?: string; qty?: number; date?: string; reportOutside?: boolean } = {}) =>
      db.$transaction(async (tx) => {
        const report = await tx.expiryReport.create!({
          data: {
            hospitalId: H,
            runDate: D(o.date ?? today()),
            items: [{ batchId: o.list ?? expired, kind: 'QUARANTINED' }],
          },
        });
        await tx.medicineBatch.updateMany!({
          where: { id: expired },
          data: { status: 'QUARANTINED' },
        });
        await tx.stockMovement.create!({
          data: {
            hospitalId: H,
            batchId: expired,
            type: 'QUARANTINE',
            quantity: o.qty ?? 9,
            reason: 'Expired',
            expiryReportId: (report as Row).id,
          },
        });
      });
    await expect(
      db.stockMovement.create!({
        data: {
          hospitalId: H,
          batchId: expired,
          type: 'QUARANTINE',
          quantity: 9,
          reason: 'Expired',
        },
      }),
    ).rejects.toThrow(/system_chk/);
    await expect(run({ qty: 5 })).rejects.toThrow(/physical quantity/);
    await expect(run({ list: batch })).rejects.toThrow(/does not list this batch/);
    await expect(run({ date: '2026-01-01' })).rejects.toThrow(/dated today/);
    expect(db.rows('ExpiryReport')).toHaveLength(0); // each refusal rolled back its report too
    await run();
    const report = db.rows('ExpiryReport')[0]!;
    await expect(
      db.stockMovement.create!({
        data: {
          hospitalId: H,
          batchId: expired,
          type: 'QUARANTINE',
          quantity: 9,
          reason: 'Expired',
          expiryReportId: report.id,
        },
      }),
    ).rejects.toThrow(/same transaction/);
    // Manual quarantine without its ledger row is refused at commit; a quarantined batch stays so.
    await expect(
      db.medicineBatch.updateMany!({ where: { id: batch }, data: { status: 'QUARANTINED' } }),
    ).rejects.toThrow(/ledger row/);
    expect(db.rows('MedicineBatch').find((b) => b.id === batch)!.status).toBe('ACTIVE');
    await expect(
      db.medicineBatch.updateMany!({ where: { id: expired }, data: { status: 'ACTIVE' } }),
    ).rejects.toThrow(/stays quarantined/);
  });
});
