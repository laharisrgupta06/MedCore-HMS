import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PharmacyErrorCode, fifoOrder, isExpired, type StockBatch } from '@medcore/types';
import type { MedicineBatch } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { localDate } from '../../common/time/zoned';
import { dateText, dateValue, LowStock } from '../medicines/low-stock';
import { MedicinesService, StockLevels } from '../medicines/medicines.module';
import type { AdjustmentDto, ReceiveBatchDto } from './pharmacy.dto';

export const batchView = (b: MedicineBatch, today: string): StockBatch => ({
  id: b.id,
  medicineId: b.medicineId,
  batchNumber: b.batchNumber,
  manufacturedOn: dateText(b.manufacturedOn),
  expiresOn: dateText(b.expiresOn),
  quantity: b.quantity,
  unitCost: b.unitCost.toFixed(2),
  mrp: b.mrp.toFixed(2),
  status: b.status,
  receivedAt: b.receivedAt.toISOString(),
  expired: isExpired(dateText(b.expiresOn), today),
});

/**
 * Batches and their ledger (PHARM-001, PHARM-004). Every query names the actor's hospital as well
 * as going through the tenant-scoped client. Each change writes its ledger row in the same
 * transaction; caches and low-stock state are refreshed after commit.
 */
@Injectable()
export class BatchesService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly medicines: MedicinesService,
    private readonly stock: StockLevels,
    private readonly lowStock: LowStock,
  ) {}

  async today(actor: AuthPrincipal): Promise<string> {
    return localDate(new Date(), await this.medicines.timezone(actor.hospitalId));
  }

  private async afterChange(actor: AuthPrincipal, medicineId: string): Promise<void> {
    await this.stock.invalidate([medicineId]);
    await this.lowStock.evaluate(actor.hospitalId!, [medicineId]);
  }

  async list(actor: AuthPrincipal, medicineId: string): Promise<StockBatch[]> {
    const hospitalId = actor.hospitalId!;
    const m = await this.db.client.medicine.findFirst({ where: { id: medicineId, hospitalId } });
    if (!m) throw notFound('medicine');
    const rows = await this.db.client.medicineBatch.findMany({ where: { medicineId, hospitalId } });
    const today = await this.today(actor);
    return fifoOrder(rows.map((b) => batchView(b, today)));
  }

  async receive(
    actor: AuthPrincipal,
    medicineId: string,
    dto: ReceiveBatchDto,
  ): Promise<StockBatch> {
    const hospitalId = actor.hospitalId!;
    const m = await this.db.client.medicine.findFirst({ where: { id: medicineId, hospitalId } });
    if (!m) throw notFound('medicine');
    const today = await this.today(actor);
    if (isExpired(dto.expiresOn, today))
      throw new BadRequestException({
        code: PharmacyErrorCode.EXPIRY_IN_PAST,
        message: 'This batch has expired or expires today, so it cannot be received.',
      });
    if (dto.manufacturedOn > today)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The manufacturing date cannot be in the future.',
      });
    if (dto.expiresOn <= dto.manufacturedOn)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The expiry date must be after the manufacturing date.',
      });
    const batch = await this.db.client
      .$transaction(async (tx) => {
        const b = await tx.medicineBatch.create({
          data: {
            hospitalId,
            medicineId,
            batchNumber: dto.batchNumber,
            manufacturedOn: dateValue(dto.manufacturedOn),
            expiresOn: dateValue(dto.expiresOn),
            quantity: dto.quantity,
            unitCost: dto.unitCost,
            mrp: dto.mrp,
          },
        });
        await tx.stockMovement.create({
          data: {
            hospitalId,
            batchId: b.id,
            type: 'RECEIPT',
            quantity: dto.quantity,
            performedById: actor.userId,
          },
        });
        return b;
      })
      .catch((e) =>
        mapPrismaError(e, { conflict: 'This batch number is already recorded for this medicine.' }),
      );
    await this.afterChange(actor, medicineId);
    return batchView(batch, today);
  }

  private async load(hospitalId: string, id: string): Promise<MedicineBatch> {
    const b = await this.db.client.medicineBatch.findFirst({ where: { id, hospitalId } });
    if (!b) throw notFound('batch');
    return b;
  }

  /** PHARM-004: damaged or recalled stock. The quantity stays; the units are set aside. */
  async quarantine(actor: AuthPrincipal, id: string, reason: string): Promise<StockBatch> {
    const hospitalId = actor.hospitalId!;
    const before = await this.load(hospitalId, id);
    const b = await this.db.client.$transaction(async (tx) => {
      const u = await tx.medicineBatch.updateMany({
        where: { id, hospitalId, status: 'ACTIVE' },
        data: { status: 'QUARANTINED' },
      });
      if (u.count === 0)
        throw new ConflictException({
          code: PharmacyErrorCode.INVALID_TRANSITION,
          message: 'Only an active batch can be quarantined.',
        });
      // Read again under the row lock taken by the update, so the quantity is current.
      const now = await tx.medicineBatch.findFirstOrThrow({ where: { id, hospitalId } });
      if (now.quantity > 0)
        await tx.stockMovement.create({
          data: {
            hospitalId,
            batchId: id,
            type: 'QUARANTINE',
            quantity: now.quantity,
            reason,
            performedById: actor.userId,
          },
        });
      return now;
    });
    await this.afterChange(actor, before.medicineId);
    return batchView(b, await this.today(actor));
  }

  /** A count correction with a reason; never takes a batch below zero. */
  async adjust(actor: AuthPrincipal, id: string, dto: AdjustmentDto): Promise<StockBatch> {
    const hospitalId = actor.hospitalId!;
    const before = await this.load(hospitalId, id);
    const b = await this.db.client.$transaction(async (tx) => {
      // Refilling an empty (DEPLETED) batch reactivates it in the same statement: M-09 refuses a
      // DEPLETED batch that holds units.
      let u =
        dto.quantity > 0
          ? await tx.medicineBatch.updateMany({
              where: { id, hospitalId, status: 'DEPLETED' },
              data: { quantity: { increment: dto.quantity }, status: 'ACTIVE' },
            })
          : { count: 0 };
      if (u.count === 0)
        u = await tx.medicineBatch.updateMany({
          where: {
            id,
            hospitalId,
            ...(dto.quantity < 0 ? { quantity: { gte: -dto.quantity } } : {}),
          },
          data: { quantity: { increment: dto.quantity } },
        });
      if (u.count === 0) {
        const cur = await tx.medicineBatch.findFirstOrThrow({ where: { id, hospitalId } });
        throw new BadRequestException({
          code: PharmacyErrorCode.NEGATIVE_STOCK,
          message: `Only ${cur.quantity} units are in this batch, so ${-dto.quantity} cannot be removed.`,
          details: { quantity: cur.quantity },
        });
      }
      await tx.stockMovement.create({
        data: {
          hospitalId,
          batchId: id,
          type: 'ADJUSTMENT',
          quantity: dto.quantity,
          reason: dto.reason,
          performedById: actor.userId,
        },
      });
      // An active batch adjusted to zero becomes DEPLETED.
      await tx.medicineBatch.updateMany({
        where: { id, hospitalId, status: 'ACTIVE', quantity: 0 },
        data: { status: 'DEPLETED' },
      });
      return tx.medicineBatch.findFirstOrThrow({ where: { id, hospitalId } });
    });
    await this.afterChange(actor, before.medicineId);
    return batchView(b, await this.today(actor));
  }
}
