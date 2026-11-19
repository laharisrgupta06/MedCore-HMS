import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PharmacyErrorCode,
  allocateFifo,
  isExpired,
  type Prescription as PrescriptionView,
  type PrescriptionStatus,
} from '@medcore/types';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { DomainEvents } from '../../common/events/domain-events';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { CHARGE_RECORDER, type ChargeRecorder } from '../billing/charges';
import { localDate } from '../../common/time/zoned';
import { dateText, dateValue, LowStock } from '../medicines/low-stock';
import { MedicinesService, StockLevels } from '../medicines/medicines.module';
import { prescriptionInclude, toView } from '../prescriptions/prescriptions.service';
import type { DispenseDto, QueueQuery } from './pharmacy.dto';

const WAITING: PrescriptionStatus[] = ['ISSUED', 'PARTIALLY_DISPENSED'];

/**
 * Verification and dispensing (PHARM-002, PHARM-004, PHARM-006, TEST-014). Pharmacy owns the
 * READY_FOR_PICKUP, PARTIALLY_DISPENSED and DISPENSED statuses (approved plan, section 7).
 * Every query names the actor's hospital in addition to the tenant-scoped client.
 */
@Injectable()
export class DispensingService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly medicines: MedicinesService,
    private readonly stock: StockLevels,
    private readonly lowStock: LowStock,
    private readonly events: DomainEvents,
    @Inject(CHARGE_RECORDER) private readonly charges: ChargeRecorder,
  ) {}

  async queue(actor: AuthPrincipal, q: QueueQuery): Promise<PaginatedResult<PrescriptionView>> {
    const where = {
      hospitalId: actor.hospitalId!,
      status: q.status ? q.status : { in: WAITING },
    };
    const [rows, total] = await Promise.all([
      this.db.client.prescription.findMany({
        where,
        include: prescriptionInclude,
        orderBy: { issuedAt: 'asc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.prescription.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toView), total, q.page, q.limit);
  }

  private async view(hospitalId: string, id: string): Promise<PrescriptionView> {
    const p = await this.db.client.prescription.findFirst({
      where: { id, hospitalId },
      include: prescriptionInclude,
    });
    if (!p) throw notFound('prescription');
    return toView(p);
  }

  /** Explains a refused status move: 404 for other hospitals' or unknown ids, else 409. */
  private async refuse(hospitalId: string, id: string, message: string): Promise<never> {
    const p = await this.db.client.prescription.findFirst({ where: { id, hospitalId } });
    if (!p) throw notFound('prescription');
    throw new ConflictException({ code: PharmacyErrorCode.INVALID_TRANSITION, message });
  }

  async verify(actor: AuthPrincipal, id: string): Promise<PrescriptionView> {
    const hospitalId = actor.hospitalId!;
    // M-10: the verification and its VERIFIED event commit together (or not at all).
    const changed = await this.db.client.$transaction(async (tx) => {
      const u = await tx.prescription.updateMany({
        where: { id, hospitalId, status: 'ISSUED', verifiedAt: null },
        data: { verifiedAt: new Date(), verifiedById: actor.userId },
      });
      if (u.count === 1)
        await tx.prescriptionEvent.create({
          data: {
            hospitalId,
            prescriptionId: id,
            kind: 'VERIFIED',
            status: 'ISSUED',
            actorId: actor.userId,
          },
        });
      return u.count;
    });
    if (changed === 0)
      await this.refuse(
        hospitalId,
        id,
        'Only an issued prescription that is not yet verified can be verified.',
      );
    return this.view(hospitalId, id);
  }

  async dispense(actor: AuthPrincipal, id: string, dto: DispenseDto): Promise<PrescriptionView> {
    const hospitalId = actor.hospitalId!;
    const ids = dto.items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Each item may appear once.',
      });
    const today = localDate(new Date(), await this.medicines.timezone(hospitalId));
    const { status, medicineIds } = await this.db.client.$transaction(async (tx) => {
      // Lock the prescription first: a concurrent cancel or dispense waits, then sees the result.
      const locked = await tx.prescription.updateMany({
        where: { id, hospitalId, status: { in: WAITING } },
        data: { updatedAt: new Date() },
      });
      if (locked.count === 0)
        await this.refuse(hospitalId, id, 'This prescription is not waiting to be dispensed.');
      const p = await tx.prescription.findFirstOrThrow({
        where: { id, hospitalId },
        include: { items: { include: { dispenses: true } } },
      });
      if (!p.verifiedAt)
        throw new ConflictException({
          code: PharmacyErrorCode.NOT_VERIFIED,
          message: 'Verify the prescription before dispensing it.',
        });
      const visit = await tx.medicalRecord.findFirstOrThrow({
        where: { id: p.medicalRecordId },
        select: { appointmentId: true },
      });
      const medicineName = new Map(
        (
          await tx.medicine.findMany({
            where: { id: { in: p.items.map((i) => i.medicineId) } },
            select: { id: true, name: true, strength: true },
          })
        ).map((m) => [m.id, `${m.name} ${m.strength}`]),
      );
      const touched = new Set<string>();
      for (const req of dto.items) {
        const item = p.items.find((i) => i.id === req.itemId);
        if (!item)
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'An item is not part of this prescription.',
          });
        const remaining = item.quantity - item.dispenses.reduce((s, d) => s + d.quantity, 0);
        if (req.quantity > remaining)
          throw new BadRequestException({
            code: PharmacyErrorCode.EXCEEDS_PRESCRIBED,
            message: `Only ${remaining} more can be given for this item.`,
            details: { itemId: item.id, remaining },
          });
        const batches = await tx.medicineBatch.findMany({
          where: { hospitalId, medicineId: item.medicineId, quantity: { gt: 0 } },
        });
        const plan = allocateFifo(
          batches.map((b) => ({
            id: b.id,
            quantity: b.quantity,
            status: b.status,
            expiresOn: dateText(b.expiresOn),
            receivedAt: b.receivedAt.toISOString(),
          })),
          req.quantity,
          today,
        );
        if (plan.short > 0) {
          const usable = req.quantity - plan.short;
          const expiredLeft = batches.some(
            (b) => b.status !== 'DEPLETED' && isExpired(dateText(b.expiresOn), today),
          );
          // TEST-014: only expired stock remains for this medicine.
          if (usable === 0 && expiredLeft)
            throw new UnprocessableEntityException({
              code: PharmacyErrorCode.MEDICINE_EXPIRED,
              message: 'The remaining stock of this medicine has expired and cannot be dispensed.',
              details: { medicineId: item.medicineId },
            });
          throw new UnprocessableEntityException({
            code: PharmacyErrorCode.INSUFFICIENT_STOCK,
            message: `Only ${usable} units can be dispensed from current stock.`,
            details: { medicineId: item.medicineId, available: usable },
          });
        }
        for (const a of plan.allocations) {
          // Conditional decrement: refuses if another dispense took the units meanwhile.
          const dec = await tx.medicineBatch.updateMany({
            where: {
              id: a.batchId,
              hospitalId,
              status: 'ACTIVE',
              quantity: { gte: a.quantity },
              expiresOn: { gt: dateValue(today) },
            },
            data: { quantity: { decrement: a.quantity } },
          });
          if (dec.count === 0)
            throw new UnprocessableEntityException({
              code: PharmacyErrorCode.INSUFFICIENT_STOCK,
              message: 'The stock changed while dispensing. Check the batches and try again.',
              details: { medicineId: item.medicineId },
            });
          const d = await tx.dispense.create({
            data: {
              hospitalId,
              prescriptionItemId: item.id,
              batchId: a.batchId,
              quantity: a.quantity,
              dispensedById: actor.userId,
            },
          });
          await tx.stockMovement.create({
            data: {
              hospitalId,
              batchId: a.batchId,
              type: 'DISPENSE',
              quantity: -a.quantity,
              dispenseId: d.id,
              performedById: actor.userId,
            },
          });
          // Q4 A: each dispense is charged at its batch's MRP, in the same transaction (outpatient
          // sale, DEC-046 Q1e).
          await this.charges.charge(tx, actor, {
            kind: 'PHARMACY',
            appointmentId: visit.appointmentId,
            dispenseId: d.id,
            description: `${medicineName.get(item.medicineId) ?? 'Medicine'} x ${a.quantity}`,
          });
          await tx.medicineBatch.updateMany({
            where: { id: a.batchId, hospitalId, status: 'ACTIVE', quantity: 0 },
            data: { status: 'DEPLETED' },
          });
        }
        touched.add(item.medicineId);
      }
      const after = await tx.prescriptionItem.findMany({
        where: { prescriptionId: id, hospitalId },
        include: { dispenses: true },
      });
      const complete = after.every(
        (i) => i.dispenses.reduce((s, d) => s + d.quantity, 0) >= i.quantity,
      );
      const next: PrescriptionStatus = complete ? 'READY_FOR_PICKUP' : 'PARTIALLY_DISPENSED';
      await tx.prescription.updateMany({ where: { id, hospitalId }, data: { status: next } });
      // M-10: one DISPENSED event per dispensing action, recording the status it led to.
      await tx.prescriptionEvent.create({
        data: {
          hospitalId,
          prescriptionId: id,
          kind: 'DISPENSED',
          status: next,
          actorId: actor.userId,
        },
      });
      return { status: next, medicineIds: [...touched] };
    });
    await this.stock.invalidate(medicineIds);
    await this.lowStock.evaluate(hospitalId, medicineIds);
    if (status === 'READY_FOR_PICKUP')
      await this.events.publish({ type: 'prescription.ready', hospitalId, prescriptionId: id });
    return this.view(hospitalId, id);
  }

  async handover(actor: AuthPrincipal, id: string): Promise<PrescriptionView> {
    const hospitalId = actor.hospitalId!;
    const changed = await this.db.client.$transaction(async (tx) => {
      const u = await tx.prescription.updateMany({
        where: { id, hospitalId, status: 'READY_FOR_PICKUP' },
        data: { status: 'DISPENSED' },
      });
      if (u.count === 1)
        await tx.prescriptionEvent.create({
          data: {
            hospitalId,
            prescriptionId: id,
            kind: 'HANDED_OVER',
            status: 'DISPENSED',
            actorId: actor.userId,
          },
        });
      return u.count;
    });
    if (changed === 0)
      await this.refuse(
        hospitalId,
        id,
        'Only a prescription that is ready for collection can be handed over.',
      );
    return this.view(hospitalId, id);
  }
}
