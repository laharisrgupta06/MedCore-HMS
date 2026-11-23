import { Injectable } from '@nestjs/common';
import { isLowStock } from '@medcore/types';
import { DomainEvents } from '../../common/events/domain-events';
import { localDate } from '../../common/time/zoned';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationWriter, type StagedDeliveries } from '../notifications/notification.writer';
import { CONTENT } from '../notifications/notification-content';
import { STOCK_ALERT_ROLES, activeStaff } from '../notifications/notification-recipients';

/** A YYYY-MM-DD hospital-local date as the value Prisma stores in a DATE column. */
export const dateValue = (d: string): Date => new Date(`${d}T00:00:00Z`);
/** A DATE column back to YYYY-MM-DD. */
export const dateText = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * PHARM-003 low-stock state (M-07). Runs after every committed stock change and from the nightly
 * expiry run, so it uses the base client and names the hospital in every query (no request
 * tenant in the job; never relies on the tenant extension alone).
 */
@Injectable()
export class LowStock {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationWriter,
  ) {}

  /**
   * Re-evaluates the given medicines (all of the hospital's when omitted). Sets lowStockSince when
   * available stock falls strictly below the reorder level and raises `stock.low` only for the
   * update that changed it from NULL, so concurrent changes raise one alert per crossing. Clears it
   * when stock is back at or above the level, or the medicine is inactive. Returns the alerted ids.
   */
  async evaluate(hospitalId: string, medicineIds?: string[], now = new Date()): Promise<string[]> {
    const h = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { timezone: true },
    });
    if (!h) return [];
    const today = dateValue(localDate(now, h.timezone));
    const meds = await this.prisma.medicine.findMany({
      where: { hospitalId, ...(medicineIds ? { id: { in: medicineIds } } : {}) },
      select: { id: true, reorderLevel: true, isActive: true, lowStockSince: true },
    });
    if (meds.length === 0) return [];
    const batches = await this.prisma.medicineBatch.findMany({
      where: {
        hospitalId,
        medicineId: { in: meds.map((m) => m.id) },
        status: 'ACTIVE',
        expiresOn: { gt: today },
      },
      select: { medicineId: true, quantity: true },
    });
    const available = new Map<string, number>();
    for (const b of batches)
      available.set(b.medicineId, (available.get(b.medicineId) ?? 0) + b.quantity);
    const alerted: string[] = [];
    const staged: StagedDeliveries = [];
    for (const m of meds) {
      const low = m.isActive && isLowStock(available.get(m.id) ?? 0, m.reorderLevel);
      if (low && !m.lowStockSince) {
        // NOTIF-008: the crossing and its staff alert commit together; the conditional update
        // means only one writer wins the crossing.
        await this.prisma.$transaction(async (tx) => {
          const u = await tx.medicine.updateMany({
            where: { id: m.id, hospitalId, lowStockSince: null },
            data: { lowStockSince: now },
          });
          if (u.count !== 1) return;
          alerted.push(m.id);
          staged.push(
            ...(await this.notifications.stage(tx, {
              hospitalId,
              recipientIds: await activeStaff(tx, hospitalId, STOCK_ALERT_ROLES),
              content: CONTENT.stockLow(),
              entityType: 'Medicine',
              entityId: m.id,
            })),
          );
        });
      } else if (!low && m.lowStockSince) {
        await this.prisma.medicine.updateMany({
          where: { id: m.id, hospitalId, lowStockSince: { not: null } },
          data: { lowStockSince: null },
        });
      }
    }
    await this.notifications.dispatch(staged);
    for (const medicineId of alerted)
      await this.events.publish({ type: 'stock.low', hospitalId, medicineId });
    return alerted;
  }
}
