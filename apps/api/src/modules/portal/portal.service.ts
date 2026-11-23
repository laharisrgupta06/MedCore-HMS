import { Injectable } from '@nestjs/common';
import type { PortalSummaryView } from '@medcore/types';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { ownPatientId } from '../../common/tenancy/patient-identity';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';

const money = (d: Prisma.Decimal | number) => new Prisma.Decimal(d).toFixed(2);

/**
 * Patient dashboard summary (Phase 10, DEC-060). Every figure is filtered by the caller's own patient
 * profile (ownPatientId) on the tenant client, so it covers one patient in one hospital. Counts follow
 * what the portal pages show: lab reports only once approved (LAB visibility rule), invoices only once
 * issued (DEC-054 Q8 A), received payments only.
 */
@Injectable()
export class PortalService {
  constructor(private readonly db: TenantPrismaService) {}

  async summary(actor: AuthPrincipal): Promise<PortalSummaryView> {
    const patientId = await ownPatientId(this.db.client, actor);
    const now = new Date();
    const mine = { medicalRecord: { appointment: { patientId } } };
    const upcoming = {
      patientId,
      deletedAt: null,
      status: { in: ['PENDING' as const, 'CONFIRMED' as const] },
      scheduledAt: { gte: now },
    };
    const open = { patientId, status: { in: ['FINALISED' as const, 'PARTIALLY_PAID' as const] } };

    const [count, next, ready, active, reports, inProgress, invoices, paid, unread] =
      await Promise.all([
        this.db.client.appointment.count({ where: upcoming }),
        this.db.client.appointment.findMany({
          where: upcoming,
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          take: 3,
          select: {
            id: true,
            scheduledAt: true,
            status: true,
            department: { select: { name: true } },
            doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
        }),
        this.db.client.prescription.count({ where: { ...mine, status: 'READY_FOR_PICKUP' } }),
        this.db.client.prescription.count({
          where: { ...mine, status: { in: ['ISSUED', 'PARTIALLY_DISPENSED'] } },
        }),
        this.db.client.labOrder.count({
          where: {
            ...mine,
            status: 'APPROVED',
            approvedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
          },
        }),
        this.db.client.labOrder.count({
          where: {
            ...mine,
            status: { in: ['ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULT_UPLOADED'] },
          },
        }),
        this.db.client.invoice.findMany({ where: open, select: { id: true, total: true } }),
        this.db.client.payment.findMany({
          where: { status: 'SUCCEEDED', invoice: open },
          select: { amount: true },
        }),
        // The inbox is the user's own (Phase 9), keyed by user, not patient.
        this.db.client.notification.count({ where: { recipientId: actor.userId, readAt: null } }),
      ]);

    const total = invoices.reduce((s, i) => s.plus(i.total), new Prisma.Decimal(0));
    const received = paid.reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
    return {
      appointments: {
        upcoming: count,
        next: next.map((a) => ({
          id: a.id,
          scheduledAt: a.scheduledAt.toISOString(),
          status: a.status,
          doctorName: `Dr ${a.doctor.user.firstName} ${a.doctor.user.lastName}`.trim(),
          department: a.department.name,
        })),
      },
      prescriptions: { readyForPickup: ready, active },
      lab: { reportsReady30d: reports, inProgress },
      billing: {
        openInvoices: invoices.length,
        outstanding: money(Prisma.Decimal.max(total.minus(received), 0)),
      },
      notifications: { unread },
    };
  }
}
