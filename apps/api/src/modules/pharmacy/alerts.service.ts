import { Injectable } from '@nestjs/common';
import {
  EXPIRY_WINDOW_DAYS,
  addDays,
  type ExpiryReport as ExpiryReportView,
  type ExpiryReportItem,
  type PharmacyAlerts,
  type StockMovementView,
} from '@medcore/types';
import type { ExpiryReport, Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { PaginatedResult } from '../../common/http/paginated-result';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { localDate, zonedToUtc } from '../../common/time/zoned';
import { dateText, dateValue } from '../medicines/low-stock';
import { MedicinesService, StockLevels } from '../medicines/medicines.module';
import type { LedgerQuery } from './pharmacy.dto';

export const reportView = (r: ExpiryReport): ExpiryReportView => ({
  id: r.id,
  runDate: dateText(r.runDate),
  createdAt: r.createdAt.toISOString(),
  items: r.items as unknown as ExpiryReportItem[],
});

/**
 * Alerts (PHARM-003, PHARM-005) and the stock ledger. There is no route that takes a report id:
 * the latest report is read for the actor's own hospital only. Every query names that hospital.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly medicines: MedicinesService,
    private readonly stock: StockLevels,
  ) {}

  async alerts(actor: AuthPrincipal): Promise<PharmacyAlerts> {
    const hospitalId = actor.hospitalId!;
    const tz = await this.medicines.timezone(hospitalId);
    const today = localDate(new Date(), tz);
    const [low, expiring, report] = await Promise.all([
      this.db.client.medicine.findMany({
        where: { hospitalId, isActive: true, lowStockSince: { not: null } },
        orderBy: { lowStockSince: 'asc' },
        take: 100,
      }),
      this.db.client.medicineBatch.findMany({
        where: {
          hospitalId,
          status: 'ACTIVE',
          quantity: { gt: 0 },
          expiresOn: { gt: dateValue(today), lte: dateValue(addDays(today, EXPIRY_WINDOW_DAYS)) },
        },
        include: { medicine: true },
        orderBy: { expiresOn: 'asc' },
        take: 200,
      }),
      this.db.client.expiryReport.findFirst({
        where: { hospitalId },
        orderBy: { runDate: 'desc' },
      }),
    ]);
    const avail = await this.stock.available(
      low.map((m) => m.id),
      tz,
    );
    return {
      lowStock: low.map((m) => ({
        id: m.id,
        name: m.name,
        strength: m.strength,
        form: m.form,
        reorderLevel: m.reorderLevel,
        available: avail.get(m.id) ?? 0,
        lowStockSince: m.lowStockSince!.toISOString(),
      })),
      expiringSoon: expiring.map((b) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiresOn: dateText(b.expiresOn),
        quantity: b.quantity,
        medicine: { id: b.medicine.id, name: b.medicine.name, strength: b.medicine.strength },
      })),
      latestReport: report ? reportView(report) : null,
    };
  }

  async ledger(actor: AuthPrincipal, q: LedgerQuery): Promise<PaginatedResult<StockMovementView>> {
    const hospitalId = actor.hospitalId!;
    const tz = await this.medicines.timezone(hospitalId);
    const createdAt = {
      ...(q.from ? { gte: zonedToUtc(q.from, 0, tz) } : {}),
      ...(q.to ? { lt: zonedToUtc(addDays(q.to, 1), 0, tz) } : {}),
    };
    const where: Prisma.StockMovementWhereInput = {
      hospitalId,
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.medicineId ? { batch: { medicineId: q.medicineId, hospitalId } } : {}),
      ...(q.from || q.to ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.stockMovement.findMany({
        where,
        include: { batch: { include: { medicine: true } }, performedBy: true },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.stockMovement.count({ where }),
    ]);
    return PaginatedResult.of(
      rows.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        createdAt: m.createdAt.toISOString(),
        batch: {
          id: m.batch.id,
          batchNumber: m.batch.batchNumber,
          expiresOn: dateText(m.batch.expiresOn),
        },
        medicine: {
          id: m.batch.medicine.id,
          name: m.batch.medicine.name,
          strength: m.batch.medicine.strength,
        },
        performedBy: m.performedBy
          ? {
              id: m.performedBy.id,
              firstName: m.performedBy.firstName,
              lastName: m.performedBy.lastName,
            }
          : null,
        dispenseId: m.dispenseId,
      })),
      total,
      q.page,
      q.limit,
    );
  }
}
