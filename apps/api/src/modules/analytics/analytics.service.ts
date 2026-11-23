import { BadRequestException, Injectable } from '@nestjs/common';
import type { CountRow, DayPoint, OperationsAnalytics, OverviewAnalytics } from '@medcore/types';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { nextDay, todayIn, zonedMidnight } from '../payments/zoned-time';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const money = (d: Prisma.Decimal | string | number | null | undefined) =>
  new Prisma.Decimal(d ?? 0).toFixed(2);
const ISSUED = ['FINALISED', 'PARTIALLY_PAID', 'PAID'] as const;

interface Range {
  from: string;
  to: string;
  tz: string;
  hospitalId: string;
  start: Date;
  end: Date;
}

/**
 * Hospital analytics (Phase 11, DASH-006..011). Read-only aggregates over MedCore's own tables for
 * the caller's hospital. Raw SQL is used for day buckets in the hospital's time zone; raw queries are
 * not scoped by the tenant client, so every one filters "hospitalId" explicitly. Nothing is cached or
 * estimated: an empty range returns zeros.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly db: TenantPrismaService) {}

  private async range(actor: AuthPrincipal, from: string, to: string): Promise<Range> {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!DAY.test(from) || !DAY.test(to) || !(days >= 0 && days < MAX_DAYS))
      throw new BadRequestException({
        code: 'RANGE_INVALID',
        message: 'Choose a range of up to a year, ending on or after its start.',
      });
    const hospitalId = actor.hospitalId!;
    const h = await this.db.client.hospital.findFirst({
      where: { id: hospitalId },
      select: { timezone: true },
    });
    const tz = h?.timezone ?? 'Asia/Kolkata';
    return {
      from,
      to,
      tz,
      hospitalId,
      start: zonedMidnight(from, tz),
      end: zonedMidnight(nextDay(to), tz),
    };
  }

  /**
   * One value per day in the range (zero-filled), bucketed in the hospital time zone. The table and
   * column come from this fixed list, written as SQL text in the code; nothing from the request is
   * ever placed in the query except bound parameters (SEC-008: no Prisma.raw).
   */
  private static readonly SERIES = {
    registrations: {
      count: true,
      from: Prisma.sql`patients t`,
      at: Prisma.sql`t."createdAt"`,
      where: Prisma.sql`AND t."deletedAt" IS NULL`,
    },
    appointments: {
      count: true,
      from: Prisma.sql`appointments t`,
      at: Prisma.sql`t."scheduledAt"`,
      where: Prisma.sql`AND t."deletedAt" IS NULL`,
    },
    labOrders: {
      count: true,
      from: Prisma.sql`lab_orders t`,
      at: Prisma.sql`t."createdAt"`,
      where: Prisma.empty,
    },
    unitsDispensed: {
      count: false,
      value: Prisma.sql`SUM(t.quantity)`,
      from: Prisma.sql`dispenses t`,
      at: Prisma.sql`t."dispensedAt"`,
      where: Prisma.empty,
    },
    invoiced: {
      count: false,
      value: Prisma.sql`SUM(t.total)`,
      from: Prisma.sql`invoices t`,
      at: Prisma.sql`t."finalisedAt"`,
      where: Prisma.sql`AND t.status::text IN ('FINALISED', 'PARTIALLY_PAID', 'PAID')`,
    },
  } as const;

  private async daily(r: Range, series: keyof typeof AnalyticsService.SERIES): Promise<DayPoint[]> {
    const s = AnalyticsService.SERIES[series];
    const value = 'value' in s ? s.value : Prisma.sql`COUNT(t.id)`;
    const rows = await this.db.client.$queryRaw<{ day: string; value: number }[]>`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(${value}, 0)::float8 AS value
      FROM generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d
      LEFT JOIN ${s.from}
        ON t."hospitalId" = ${r.hospitalId}::uuid
       AND (${s.at} AT TIME ZONE ${r.tz})::date = d::date
       ${s.where}
      GROUP BY d ORDER BY d`;
    return rows.map((x) => ({ day: x.day, value: Number(x.value) }));
  }

  async overview(actor: AuthPrincipal, from: string, to: string): Promise<OverviewAnalytics> {
    const r = await this.range(actor, from, to);
    const c = this.db.client;
    const today = todayIn(r.tz);
    const dayStart = zonedMidnight(today, r.tz);
    const dayEnd = zonedMidnight(nextDay(today), r.tz);
    const inRange = { gte: r.start, lt: r.end };

    const [
      patientsTotal,
      patientsNew,
      appointmentsToday,
      activeDoctors,
      beds,
      received,
      status,
      registrations,
      appointments,
      departments,
      doctors,
    ] = await Promise.all([
      c.patient.count({ where: { deletedAt: null } }),
      c.patient.count({ where: { deletedAt: null, createdAt: inRange } }),
      c.appointment.count({
        where: {
          deletedAt: null,
          scheduledAt: { gte: dayStart, lt: dayEnd },
          status: { not: 'CANCELLED' },
        },
      }),
      c.doctor.count({ where: { deletedAt: null, user: { isActive: true } } }),
      c.bed.groupBy({ by: ['status'], _count: { _all: true } }),
      c.payment.aggregate({
        where: { status: 'SUCCEEDED', paidAt: { gte: dayStart, lt: dayEnd } },
        _sum: { amount: true },
      }),
      c.appointment.groupBy({
        by: ['status'],
        where: { deletedAt: null, scheduledAt: inRange },
        _count: { _all: true },
      }),
      this.daily(r, 'registrations'),
      this.daily(r, 'appointments'),
      c.$queryRaw<
        { id: string; name: string; appointments: number; completed: number; cancelled: number }[]
      >`
          SELECT dep.id, dep.name,
                 COUNT(a.id)::int AS appointments,
                 COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
                 COUNT(a.id) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled
          FROM departments dep
          LEFT JOIN appointments a ON a."departmentId" = dep.id AND a."hospitalId" = dep."hospitalId"
           AND a."deletedAt" IS NULL AND a."scheduledAt" >= ${r.start} AND a."scheduledAt" < ${r.end}
          WHERE dep."hospitalId" = ${r.hospitalId}::uuid
          GROUP BY dep.id, dep.name ORDER BY appointments DESC, dep.name`,
      c.$queryRaw<
        {
          id: string;
          name: string;
          department: string | null;
          appointments: number;
          completed: number;
          cancelled: number;
          noShow: number;
        }[]
      >`
          SELECT d.id, concat_ws(' ', u."firstName", u."lastName") AS name,
                 (SELECT dep.name FROM appointments a2 JOIN departments dep ON dep.id = a2."departmentId"
                   WHERE a2."doctorId" = d.id GROUP BY dep.name ORDER BY COUNT(*) DESC LIMIT 1) AS department,
                 COUNT(a.id)::int AS appointments,
                 COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
                 COUNT(a.id) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
                 COUNT(a.id) FILTER (WHERE a.status = 'NO_SHOW')::int AS "noShow"
          FROM doctors d JOIN users u ON u.id = d."userId"
          LEFT JOIN appointments a ON a."doctorId" = d.id AND a."deletedAt" IS NULL
           AND a."scheduledAt" >= ${r.start} AND a."scheduledAt" < ${r.end}
          WHERE d."hospitalId" = ${r.hospitalId}::uuid AND d."deletedAt" IS NULL
          GROUP BY d.id, u."firstName", u."lastName" ORDER BY appointments DESC, name LIMIT 15`,
    ]);
    const bedCount = (s: string) => beds.find((b) => b.status === s)?._count._all ?? 0;
    return {
      from: r.from,
      to: r.to,
      timezone: r.tz,
      kpis: {
        patientsTotal,
        patientsNew,
        appointmentsToday,
        activeDoctors,
        beds: {
          occupied: bedCount('OCCUPIED'),
          maintenance: bedCount('MAINTENANCE'),
          total: beds.reduce((n, b) => n + b._count._all, 0),
        },
        receivedToday: money(received._sum.amount),
      },
      registrations,
      appointments,
      appointmentStatus: status
        .map((s): CountRow => ({ key: s.status, label: s.status, count: s._count._all }))
        .sort((a, b) => b.count - a.count),
      departments,
      doctors,
    };
  }

  async operations(actor: AuthPrincipal, from: string, to: string): Promise<OperationsAnalytics> {
    const r = await this.range(actor, from, to);
    const c = this.db.client;
    const inRange = { gte: r.start, lt: r.end };
    const today = todayIn(r.tz);
    const in30 = new Date(Date.parse(today) + 30 * 86_400_000);

    const [
      cancellations,
      labStatus,
      labOrders,
      labApproved,
      turnaround,
      dispensed,
      dispenseAgg,
      lowStock,
      expiring,
      activeMedicines,
      issued,
      invoiced,
      receivedBy,
      openInvoices,
      openPaid,
    ] = await Promise.all([
      c.$queryRaw<{ day: string; total: number; cancelled: number; noShow: number }[]>`
          SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COUNT(a.id)::int AS total,
                 COUNT(a.id) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
                 COUNT(a.id) FILTER (WHERE a.status = 'NO_SHOW')::int AS "noShow"
          FROM generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d
          LEFT JOIN appointments a ON a."hospitalId" = ${r.hospitalId}::uuid AND a."deletedAt" IS NULL
           AND (a."scheduledAt" AT TIME ZONE ${r.tz})::date = d::date
          GROUP BY d ORDER BY d`,
      c.labOrder.groupBy({ by: ['status'], where: { createdAt: inRange }, _count: { _all: true } }),
      this.daily(r, 'labOrders'),
      c.labOrder.count({ where: { status: 'APPROVED', approvedAt: inRange } }),
      c.$queryRaw<{ median: number | null; p90: number | null }[]>`
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("approvedAt" - "createdAt")) / 3600) AS median,
                 percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("approvedAt" - "createdAt")) / 3600) AS p90
          FROM lab_orders WHERE "hospitalId" = ${r.hospitalId}::uuid AND status = 'APPROVED'
           AND "approvedAt" >= ${r.start} AND "approvedAt" < ${r.end}`,
      this.daily(r, 'unitsDispensed'),
      c.dispense.aggregate({
        where: { dispensedAt: inRange },
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      c.medicine.count({ where: { isActive: true, lowStockSince: { not: null } } }),
      c.medicineBatch.count({
        where: {
          status: 'ACTIVE',
          quantity: { gt: 0 },
          expiresOn: { gt: new Date(today), lte: in30 },
        },
      }),
      c.medicine.count({ where: { isActive: true } }),
      c.invoice.aggregate({
        where: { status: { in: [...ISSUED] }, finalisedAt: inRange },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.daily(r, 'invoiced'),
      c.payment.groupBy({
        by: ['method'],
        where: { status: 'SUCCEEDED', paidAt: inRange },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      c.invoice.aggregate({
        where: { status: { in: ['FINALISED', 'PARTIALLY_PAID'] } },
        _sum: { total: true },
      }),
      c.payment.aggregate({
        where: {
          status: 'SUCCEEDED',
          invoice: { status: { in: ['FINALISED', 'PARTIALLY_PAID'] } },
        },
        _sum: { amount: true },
      }),
    ]);

    const received = receivedBy.reduce((s, g) => s.plus(g._sum.amount ?? 0), new Prisma.Decimal(0));
    const t = turnaround[0];
    const round = (v: number | null | undefined) =>
      v == null ? null : Math.round(Number(v) * 10) / 10;
    return {
      from: r.from,
      to: r.to,
      timezone: r.tz,
      cancellations,
      lab: {
        ordered: labStatus.reduce((n, g) => n + g._count._all, 0),
        byStatus: labStatus
          .map((g) => ({ key: g.status, label: g.status, count: g._count._all }))
          .sort((a, b) => b.count - a.count),
        approved: labApproved,
        turnaroundMedianHours: round(t?.median),
        turnaroundP90Hours: round(t?.p90),
        orders: labOrders,
      },
      pharmacy: {
        dispenses: dispenseAgg._count._all,
        unitsDispensed: dispenseAgg._sum.quantity ?? 0,
        dispensed,
        lowStock,
        expiringIn30Days: expiring,
        activeMedicines,
      },
      billing: {
        invoicesIssued: issued._count._all,
        invoicedTotal: money(issued._sum.total),
        received: money(received),
        receivedByMethod: receivedBy.map((g) => ({
          method: g.method,
          amount: money(g._sum.amount),
          count: g._count._all,
        })),
        outstanding: money(
          Prisma.Decimal.max(
            new Prisma.Decimal(openInvoices._sum.total ?? 0).minus(openPaid._sum.amount ?? 0),
            0,
          ),
        ),
        invoiced,
      },
    };
  }
}
