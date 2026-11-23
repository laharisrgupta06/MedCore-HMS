import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ONLINE_PAYMENT_METHODS,
  type AccountantSummaryView,
  type InvoiceStatus,
  type PaymentMethod,
  type ReconciliationState,
  type ReconciliationView,
} from '@medcore/types';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { nextDay, todayIn, zonedMidnight } from './zoned-time';

const money = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);
const OPEN_INVOICE: InvoiceStatus[] = ['FINALISED', 'PARTIALLY_PAID'];
const MAX_RANGE_DAYS = 366;
const ROW_LIMIT = 500;

/** Reconciliation and the accountant's day (8-B5). Reads plus marking payments as reconciled. */
@Injectable()
export class AccountingService {
  constructor(private readonly db: TenantPrismaService) {}

  private async timezone(hospitalId: string): Promise<string> {
    const h = await this.db.client.hospital.findFirst({
      where: { id: hospitalId },
      select: { timezone: true },
    });
    return h?.timezone ?? 'Asia/Kolkata';
  }

  async reconciliation(
    actor: AuthPrincipal,
    q: { from: string; to: string; method?: PaymentMethod; state: ReconciliationState },
  ): Promise<ReconciliationView> {
    const hospitalId = actor.hospitalId!;
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    if (!(days >= 0 && days < MAX_RANGE_DAYS))
      throw new BadRequestException({
        code: 'RANGE_INVALID',
        message: 'Choose a range of up to a year, ending on or after its start.',
      });
    const tz = await this.timezone(hospitalId);
    const where: Prisma.PaymentWhereInput = {
      status: 'SUCCEEDED',
      paidAt: { gte: zonedMidnight(q.from, tz), lt: zonedMidnight(nextDay(q.to), tz) },
      ...(q.method ? { method: q.method } : {}),
      ...(q.state === 'open'
        ? { reconciledAt: null }
        : q.state === 'reconciled'
          ? { reconciledAt: { not: null } }
          : {}),
    };
    const name = (u: { firstName: string; lastName: string } | null) =>
      u ? `${u.firstName} ${u.lastName}`.trim() : null;

    const [rows, count, groups, unrec] = await Promise.all([
      this.db.client.payment.findMany({
        where,
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        take: ROW_LIMIT,
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
              patient: {
                select: { mrn: true, user: { select: { firstName: true, lastName: true } } },
              },
            },
          },
          receivedBy: { select: { firstName: true, lastName: true } },
          reconciledBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.db.client.payment.count({ where }),
      this.db.client.payment.groupBy({
        by: ['method'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.db.client.payment.aggregate({
        where: { ...where, reconciledAt: null },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const total = groups.reduce((s, g) => s.plus(g._sum.amount ?? 0), new Prisma.Decimal(0));
    return {
      from: q.from,
      to: q.to,
      timezone: tz,
      totals: groups.map((g) => ({
        method: g.method,
        count: g._count._all,
        amount: money(g._sum.amount ?? 0),
      })),
      total: money(total),
      count,
      unreconciled: { count: unrec._count._all, amount: money(unrec._sum.amount ?? 0) },
      truncated: count > rows.length,
      rows: rows.map((r) => ({
        id: r.id,
        paidAt: (r.paidAt ?? r.createdAt).toISOString(),
        method: r.method,
        amount: money(r.amount),
        invoiceNumber: r.invoice.invoiceNumber,
        patientName: name(r.invoice.patient.user) ?? '',
        patientMrn: r.invoice.patient.mrn,
        receivedByName: name(r.receivedBy),
        reconciledAt: r.reconciledAt?.toISOString() ?? null,
        reconciledByName: name(r.reconciledBy),
      })),
    };
  }

  /** Marks received payments as reconciled. Already reconciled rows are left as they are. */
  async markReconciled(actor: AuthPrincipal, paymentIds: string[]): Promise<{ marked: number }> {
    const r = await this.db.client.payment.updateMany({
      where: {
        id: { in: paymentIds },
        hospitalId: actor.hospitalId!,
        status: 'SUCCEEDED',
        reconciledAt: null,
      },
      data: { reconciledAt: new Date(), reconciledById: actor.userId },
    });
    return { marked: r.count };
  }

  /** The accountant's start-of-day view, in the hospital's time zone. */
  async summary(actor: AuthPrincipal): Promise<AccountantSummaryView> {
    const hospitalId = actor.hospitalId!;
    const tz = await this.timezone(hospitalId);
    const today = todayIn(tz);
    const dayStart = zonedMidnight(today, tz);
    const dayEnd = zonedMidnight(nextDay(today), tz);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const issued = { status: { in: OPEN_INVOICE } };

    const [
      collected,
      invTotal,
      invPaid,
      unrec,
      openCheckouts,
      held,
      claimsSubmitted,
      claimsApproved,
    ] = await Promise.all([
      this.db.client.payment.groupBy({
        by: ['method'],
        where: { status: 'SUCCEEDED', paidAt: { gte: dayStart, lt: dayEnd } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.db.client.invoice.aggregate({
        where: issued,
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.db.client.payment.aggregate({
        where: { status: 'SUCCEEDED', invoice: issued },
        _sum: { amount: true },
      }),
      this.db.client.payment.aggregate({
        where: { status: 'SUCCEEDED', reconciledAt: null },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.db.client.payment.count({
        where: { status: 'PENDING', method: { in: [...ONLINE_PAYMENT_METHODS] } },
      }),
      this.db.client.auditLog.count({
        where: { hospitalId, action: 'payment.webhook.held', createdAt: { gte: since } },
      }),
      this.db.client.insuranceClaim.count({ where: { status: 'SUBMITTED' } }),
      this.db.client.insuranceClaim.aggregate({
        where: { status: 'APPROVED' },
        _count: { _all: true },
        _sum: { claimAmount: true },
      }),
    ]);

    const collectedTotal = collected.reduce(
      (s, g) => s.plus(g._sum.amount ?? 0),
      new Prisma.Decimal(0),
    );
    const outstanding = new Prisma.Decimal(invTotal._sum.total ?? 0).minus(
      invPaid._sum.amount ?? 0,
    );
    return {
      date: today,
      timezone: tz,
      collectedToday: {
        total: money(collectedTotal),
        count: collected.reduce((n, g) => n + g._count._all, 0),
        byMethod: collected.map((g) => ({
          method: g.method,
          count: g._count._all,
          amount: money(g._sum.amount ?? 0),
        })),
      },
      outstanding: { invoices: invTotal._count._all, amount: money(outstanding) },
      unreconciled: { count: unrec._count._all, amount: money(unrec._sum.amount ?? 0) },
      openCheckouts,
      heldWebhooks30d: held,
      claims: {
        submitted: claimsSubmitted,
        approvedUnsettled: {
          count: claimsApproved._count._all,
          amount: money(claimsApproved._sum.claimAmount ?? 0),
        },
      },
    };
  }
}
