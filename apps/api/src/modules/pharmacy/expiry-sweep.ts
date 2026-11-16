import { Injectable, Logger } from '@nestjs/common';
import { EXPIRY_WINDOW_DAYS, addDays, type ExpiryReportItem } from '@medcore/types';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { DomainEvents } from '../../common/events/domain-events';
import { localDate, zonedToUtc } from '../../common/time/zoned';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { dateText, dateValue, LowStock } from '../medicines/low-stock';
import { StockLevels } from '../medicines/medicines.module';

export const PHARMACY_QUEUE = 'pharmacy';
/** Hospital-local start of the nightly run (owner decision 23:17): 02:00. */
export const EXPIRY_RUN_MINUTES = 2 * 60;

export type SweepOutcome = { hospitalId: string; outcome: 'ran' | 'not-due' | 'done' | 'failed' };

/**
 * PHARM-004/005 nightly expiry run. It runs without a signed-in user, so it uses the base client
 * and names the hospital being processed in every query, inside one transaction per hospital.
 * One hospital failing never stops the others; it is retried on the next hourly tick.
 */
@Injectable()
export class ExpirySweep {
  private readonly log = new Logger(ExpirySweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockLevels,
    private readonly lowStock: LowStock,
    private readonly events: DomainEvents,
  ) {}

  /** Hourly tick: every VERIFIED hospital past 02:00 local time without today's report. */
  async runDue(now = new Date()): Promise<SweepOutcome[]> {
    const hospitals = await this.prisma.hospital.findMany({
      where: { status: 'VERIFIED' },
      select: { id: true, timezone: true },
    });
    const out: SweepOutcome[] = [];
    for (const h of hospitals) {
      try {
        const today = localDate(now, h.timezone);
        if (now < zonedToUtc(today, EXPIRY_RUN_MINUTES, h.timezone)) {
          out.push({ hospitalId: h.id, outcome: 'not-due' });
          continue;
        }
        const done = await this.prisma.expiryReport.findFirst({
          where: { hospitalId: h.id, runDate: dateValue(today) },
          select: { id: true },
        });
        if (done) {
          out.push({ hospitalId: h.id, outcome: 'done' });
          continue;
        }
        const r = await this.runHospital(h.id, h.timezone, now);
        out.push({ hospitalId: h.id, outcome: r ? 'ran' : 'done' });
      } catch (e) {
        // Logged (and captured by Sentry when configured); the next hourly tick retries.
        this.log.error(`Expiry run failed for hospital ${h.id}: ${(e as Error).message}`);
        Sentry.captureException(e, { tags: { job: 'expiry-sweep', hospitalId: h.id } });
        out.push({ hospitalId: h.id, outcome: 'failed' });
      }
    }
    return out;
  }

  /** One hospital's run. Returns null when the day's report already exists (another run won). */
  async runHospital(
    hospitalId: string,
    timezone: string,
    now = new Date(),
  ): Promise<{ id: string } | null> {
    const today = localDate(now, timezone);
    const result = await this.prisma
      .$transaction(async (tx) => {
        const items: ExpiryReportItem[] = [];
        const medicineIds = new Set<string>();
        // A batch expiring today is already expired (approved plan, section 6).
        const expired = await tx.medicineBatch.findMany({
          where: { hospitalId, status: 'ACTIVE', expiresOn: { lte: dateValue(today) } },
          include: { medicine: true },
        });
        for (const b of expired) {
          medicineIds.add(b.medicineId);
          const u = await tx.medicineBatch.updateMany({
            where: { id: b.id, hospitalId, status: 'ACTIVE' },
            data: { status: b.quantity > 0 ? 'QUARANTINED' : 'DEPLETED' },
          });
          if (u.count === 0) continue;
          const cur = await tx.medicineBatch.findFirstOrThrow({ where: { id: b.id, hospitalId } });
          if (cur.status !== 'QUARANTINED' || cur.quantity === 0) continue;
          // The quantity is unchanged (owner decision 23:17); the row records the units set aside.
          await tx.stockMovement.create({
            data: {
              hospitalId,
              batchId: b.id,
              type: 'QUARANTINE',
              quantity: cur.quantity,
              reason: `Expired on ${dateText(b.expiresOn)}; quarantined by the nightly expiry run`,
              performedById: null,
            },
          });
          items.push({
            batchId: b.id,
            medicineId: b.medicineId,
            medicineName: b.medicine.name,
            strength: b.medicine.strength,
            batchNumber: b.batchNumber,
            expiresOn: dateText(b.expiresOn),
            quantity: cur.quantity,
            kind: 'QUARANTINED',
          });
        }
        const expiring = await tx.medicineBatch.findMany({
          where: {
            hospitalId,
            status: 'ACTIVE',
            quantity: { gt: 0 },
            expiresOn: { gt: dateValue(today), lte: dateValue(addDays(today, EXPIRY_WINDOW_DAYS)) },
          },
          include: { medicine: true },
          orderBy: { expiresOn: 'asc' },
        });
        for (const b of expiring)
          items.push({
            batchId: b.id,
            medicineId: b.medicineId,
            medicineName: b.medicine.name,
            strength: b.medicine.strength,
            batchNumber: b.batchNumber,
            expiresOn: dateText(b.expiresOn),
            quantity: b.quantity,
            kind: 'EXPIRING',
          });
        // Unique per hospital and day: a concurrent run fails here and rolls back entirely.
        const report = await tx.expiryReport.create({
          data: {
            hospitalId,
            runDate: dateValue(today),
            items: items as unknown as Prisma.InputJsonValue,
          },
        });
        return { report, medicineIds: [...medicineIds] };
      })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
        throw e;
      });
    if (!result) return null;
    await this.stock.invalidate(result.medicineIds);
    // Re-check every medicine: expiry lowers availability, and medicines that were already low
    // before M-07 get their state on the first run.
    await this.lowStock.evaluate(hospitalId, undefined, now);
    await this.events.publish({ type: 'stock.expiring', hospitalId, reportId: result.report.id });
    return { id: result.report.id };
  }
}
