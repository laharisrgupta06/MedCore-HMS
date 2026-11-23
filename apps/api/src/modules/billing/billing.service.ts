import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  discountShares,
  finaliseBlockers,
  formatPaise,
  lineSnapshot,
  LineSnapshotError,
  toPaise,
  totalsOf,
  type AddLineRequest,
  type ClassificationData,
  type CorrectionRequestKind,
  type InvoiceLineKind,
  type InvoiceSummary,
  type InvoiceView,
  type LineSnapshot,
  type RoomRuleData,
} from '@medcore/types';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { withRetry } from '../../common/http/db-rule-errors';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { localDate } from '../../common/time/zoned';
import { mapInvoiceDbError } from './invoice-db-errors';
import { DomainEvents } from '../../common/events/domain-events';
import { NotificationWriter, type StagedDeliveries } from '../notifications/notification.writer';
import { CONTENT } from '../notifications/notification-content';
import { patientOfInvoice } from '../notifications/notification-recipients';

/**
 * Invoices (BILL-001..003, tasks 8-B3, 8-B4). The database (M-11b) is the authority for every rule;
 * this service computes what the database will accept, under the DEC-058 lock protocol:
 * hospital row FOR SHARE first (no tax data can change until commit), then the visit's appointment
 * row (one billing writer per visit), then the classification and invoice rows (taken by the line
 * trigger). Automatic charges are added inside the clinical transactions (consultation completion,
 * lab order, dispense) and never touch other lines, so clinical work cannot fail on billing.
 */
type Tx = Prisma.TransactionClient;
const ISSUED = ['FINALISED', 'PARTIALLY_PAID', 'PAID'] as const;
const STAFF_READ = ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export type AutomaticCharge =
  | { kind: 'CONSULTATION'; appointmentId: string }
  | { kind: 'LAB'; appointmentId: string; labOrderItemId: string; description: string }
  | { kind: 'PHARMACY'; appointmentId: string; dispenseId: string; description: string };

const conflict = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class BillingService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationWriter,
  ) {}

  // ------------------------------------------------------------------ locks and context

  private async lockHospital(
    tx: Tx,
    hospitalId: string,
  ): Promise<{ timezone: string; taxSetupConfirmed: boolean }> {
    const rows = await tx.$queryRaw<{ timezone: string; confirmed: boolean }[]>`
      SELECT timezone, "taxSetupConfirmedAt" IS NOT NULL AS confirmed FROM hospitals WHERE id = ${hospitalId}::uuid FOR SHARE`;
    if (!rows[0]) throw notFound('hospital');
    return { timezone: rows[0].timezone, taxSetupConfirmed: rows[0].confirmed };
  }

  private async lockVisit(
    tx: Tx,
    appointmentId: string,
    hospitalId: string,
  ): Promise<{ patientId: string }> {
    const rows = await tx.$queryRaw<{ patientId: string }[]>`
      SELECT "patientId" FROM appointments WHERE id = ${appointmentId}::uuid AND "hospitalId" = ${hospitalId}::uuid FOR NO KEY UPDATE`;
    if (!rows[0]) throw notFound('appointment');
    return rows[0];
  }

  private async classificationFor(
    tx: Tx,
    line: {
      kind: InvoiceLineKind;
      labOrderItemId?: string | null;
      dispenseId?: string | null;
      classificationId?: string | null;
    },
  ): Promise<ClassificationData | null> {
    let id: string | null = null;
    if (line.kind === 'CONSULTATION' || line.kind === 'LAB') {
      if (line.kind === 'LAB' && line.labOrderItemId) {
        const item = await tx.labOrderItem.findFirst({
          where: { id: line.labOrderItemId },
          select: { labTest: { select: { taxClassificationId: true } } },
        });
        id = item?.labTest.taxClassificationId ?? null;
      }
      if (!id) {
        const d = await tx.hospitalTaxDefault.findFirst({
          where: { kind: line.kind },
          select: { classificationId: true },
        });
        id = d?.classificationId ?? null;
      }
    } else if (line.kind === 'PHARMACY' && line.dispenseId) {
      const d = await tx.dispense.findFirst({
        where: { id: line.dispenseId },
        select: { batch: { select: { medicine: { select: { taxClassificationId: true } } } } },
      });
      id = d?.batch.medicine.taxClassificationId ?? null;
    } else if (line.kind === 'OTHER') {
      id = line.classificationId ?? null;
    }
    if (!id) return null;
    const c = await tx.taxClassification.findFirst({ where: { id }, include: { versions: true } });
    if (!c) return null;
    return {
      id: c.id,
      name: c.name,
      hsnSac: c.hsnSac,
      supplyType: c.supplyType,
      isActive: c.isActive,
      versions: c.versions.map((v) => ({
        id: v.id,
        effectiveFrom: ymd(v.effectiveFrom),
        treatment: v.treatment,
        ratePercent: v.ratePercent.toFixed(2),
        priceIncludesTax: v.priceIncludesTax,
      })),
    };
  }

  private async registrations(tx: Tx) {
    const rows = await tx.hospitalGstRegistration.findMany({
      select: { effectiveFrom: true, registrationType: true },
    });
    return rows.map((r) => ({
      effectiveFrom: ymd(r.effectiveFrom),
      registrationType: r.registrationType,
    }));
  }

  private async roomRules(tx: Tx): Promise<RoomRuleData[]> {
    const rows = await tx.statutoryRoomTaxRule.findMany();
    return rows.map((r) => ({
      id: r.id,
      effectiveFrom: ymd(r.effectiveFrom),
      thresholdPerDay: r.thresholdPerDay.toFixed(2),
      ratePercent: r.ratePercent.toFixed(2),
      sacCode: r.sacCode,
      priceIncludesTax: r.priceIncludesTax,
    }));
  }

  /** Snapshot of one line from the committed tax data (the trigger recomputes the same). */
  private async snapshotOf(
    tx: Tx,
    line: {
      kind: InvoiceLineKind;
      quantity: number;
      unitPrice: string;
      serviceDate: string;
      discountShare?: string;
      labOrderItemId?: string | null;
      dispenseId?: string | null;
      classificationId?: string | null;
      roomId?: string | null;
    },
  ): Promise<LineSnapshot> {
    const room =
      line.kind === 'ROOM' && line.roomId
        ? await tx.room.findFirst({
            where: { id: line.roomId },
            select: { dailyCharge: true, type: true, criticalCareUnit: true },
          })
        : null;
    if (line.kind === 'ROOM' && !room) throw notFound('room');
    try {
      return lineSnapshot({
        kind: line.kind,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        serviceDate: line.serviceDate,
        discountShare: line.discountShare,
        classification: line.kind === 'ROOM' ? null : await this.classificationFor(tx, line),
        registrations: await this.registrations(tx),
        ...(room
          ? {
              room: {
                dailyCharge: dec(room.dailyCharge),
                type: room.type,
                criticalCareUnit: room.criticalCareUnit,
              },
              roomRules: await this.roomRules(tx),
            }
          : {}),
      });
    } catch (e) {
      if (e instanceof LineSnapshotError)
        throw new BadRequestException({ code: e.code, message: e.message });
      throw e;
    }
  }

  // ------------------------------------------------------------------ drafts

  /** The visit's open draft, or a new one: an original, or a late-charge invoice once the original is issued (Q19 A). */
  private async openDraft(
    tx: Tx,
    actor: AuthPrincipal,
    appointmentId: string,
  ): Promise<{ id: string; created: boolean }> {
    const { patientId } = await this.lockVisit(tx, appointmentId, actor.hospitalId!);
    const draft = await tx.invoice.findFirst({
      where: { appointmentId, status: 'DRAFT' },
      select: { id: true },
    });
    if (draft) return { id: draft.id, created: false };
    const original = await tx.invoice.findFirst({
      where: { appointmentId, kind: 'ORIGINAL', status: { in: [...ISSUED] } },
      select: { id: true },
    });
    const inv = await tx.invoice.create({
      data: {
        hospitalId: actor.hospitalId!,
        appointmentId,
        patientId,
        createdById: actor.userId,
        kind: original ? 'LATE_CHARGES' : 'ORIGINAL',
        relatedInvoiceId: original?.id ?? null,
      },
      select: { id: true },
    });
    await this.rebillReleased(tx, actor, appointmentId, inv.id);
    return { id: inv.id, created: true };
  }

  /**
   * Decision 4 (DEC-066): charges released by voiding a draft of this visit go onto the visit's new
   * draft, unless they are already on a live line or their source was cancelled since. Prices come
   * from the source now (the database checks this), as when the service was first charged.
   */
  private async rebillReleased(
    tx: Tx,
    actor: AuthPrincipal,
    appointmentId: string,
    invoiceId: string,
  ): Promise<void> {
    const released = await tx.invoiceItem.findMany({
      where: {
        releasedAt: { not: null },
        invoice: { appointmentId },
        kind: { in: ['CONSULTATION', 'LAB', 'PHARMACY'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        kind: true,
        description: true,
        labOrderItemId: true,
        dispenseId: true,
        consultationAppointmentId: true,
      },
    });
    const done = new Set<string>();
    for (const r of released) {
      const key = r.labOrderItemId ?? r.dispenseId ?? `consultation:${r.consultationAppointmentId}`;
      if (done.has(key)) continue;
      done.add(key);
      const live = await tx.invoiceItem.findFirst({
        where: {
          releasedAt: null,
          ...(r.labOrderItemId
            ? { labOrderItemId: r.labOrderItemId }
            : r.dispenseId
              ? { dispenseId: r.dispenseId }
              : { consultationAppointmentId: appointmentId }),
        },
        select: { id: true },
      });
      if (live) continue;
      if (r.kind === 'LAB') {
        const order = await tx.labOrderItem.findFirst({
          where: { id: r.labOrderItemId! },
          select: { labOrder: { select: { status: true } } },
        });
        if (!order || order.labOrder.status === 'CANCELLED') continue;
        await this.chargeInto(tx, actor, invoiceId, {
          kind: 'LAB',
          appointmentId,
          labOrderItemId: r.labOrderItemId!,
          description: r.description,
        });
      } else if (r.kind === 'PHARMACY') {
        await this.chargeInto(tx, actor, invoiceId, {
          kind: 'PHARMACY',
          appointmentId,
          dispenseId: r.dispenseId!,
          description: r.description,
        });
      } else {
        await this.chargeInto(tx, actor, invoiceId, { kind: 'CONSULTATION', appointmentId });
      }
    }
  }

  private async insertLine(
    tx: Tx,
    invoiceId: string,
    hospitalId: string,
    base: {
      kind: InvoiceLineKind;
      description: string;
      quantity: number;
      unitPrice: string;
      serviceDate: string;
      addedById?: string | null;
      labOrderItemId?: string | null;
      dispenseId?: string | null;
      roomId?: string | null;
      classificationId?: string | null;
      consultationAppointmentId?: string | null;
    },
  ): Promise<LineSnapshot> {
    const snap = await this.snapshotOf(tx, base);
    await tx.invoiceItem.create({
      data: {
        hospitalId,
        invoiceId,
        kind: base.kind,
        description: base.description,
        quantity: base.quantity,
        unitPrice: new Prisma.Decimal(base.unitPrice),
        serviceDate: new Date(`${base.serviceDate}T00:00:00Z`),
        addedById: base.addedById ?? null,
        labOrderItemId: base.labOrderItemId ?? null,
        dispenseId: base.dispenseId ?? null,
        roomId: base.roomId ?? null,
        consultationAppointmentId: base.consultationAppointmentId ?? null,
        ...this.snapshotData(snap),
      },
    });
    return snap;
  }

  private snapshotData(s: LineSnapshot) {
    const d = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));
    return {
      unclassified: s.unclassified,
      classificationId: s.classificationId,
      classificationVersionId: s.classificationVersionId,
      classificationName: s.classificationName,
      hsnSac: s.hsnSac,
      supplyType: s.supplyType,
      treatment: s.treatment,
      ratePercent: d(s.ratePercent),
      priceIncludesTax: s.priceIncludesTax,
      gstCollected: s.gstCollected,
      notCollectedReason: s.notCollectedReason,
      roomRuleId: s.roomRuleId,
      roomDailyCharge: d(s.roomDailyCharge),
      roomCriticalCare: s.roomCriticalCare,
      grossAmount: new Prisma.Decimal(s.grossAmount),
      discountShare: new Prisma.Decimal(s.discountShare),
      taxableValue: new Prisma.Decimal(s.taxableValue),
      taxAmount: new Prisma.Decimal(s.taxAmount),
      lineTotal: new Prisma.Decimal(s.lineTotal),
    };
  }

  /**
   * Recomputes every line of a draft from the committed tax data, shares the discount again
   * (DEC-051) and writes the totals. With `discount` the accountant's new discount is applied in the
   * same statement as the totals.
   */
  private async recalc(
    tx: Tx,
    invoiceId: string,
    discount?: { amount: string; reason: string | null; setById: string },
  ): Promise<void> {
    const inv = await tx.invoice.findFirst({
      where: { id: invoiceId },
      select: { discountAmount: true },
    });
    if (!inv) throw notFound('invoice');
    const lines = await tx.invoiceItem.findMany({
      where: { invoiceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const amount = discount?.amount ?? inv.discountAmount.toFixed(2);
    const gross = lines.map((l) =>
      formatPaise(BigInt(l.quantity) * toPaise(l.unitPrice.toFixed(2))),
    );
    const grossTotal = gross.reduce((a, g) => a + toPaise(g), 0n);
    if (toPaise(amount) > grossTotal)
      throw conflict(
        'DISCOUNT_TOO_LARGE',
        'The discount is more than the charges on this invoice. The accountant must reduce it first.',
      );
    const shares = toPaise(amount) === 0n ? gross.map(() => '0.00') : discountShares(gross, amount);
    const snaps: LineSnapshot[] = [];
    for (const [i, l] of lines.entries()) {
      const s = await this.snapshotOf(tx, {
        kind: l.kind,
        quantity: l.quantity,
        unitPrice: l.unitPrice.toFixed(2),
        serviceDate: ymd(l.serviceDate),
        discountShare: shares[i],
        labOrderItemId: l.labOrderItemId,
        dispenseId: l.dispenseId,
        classificationId: l.classificationId,
        roomId: l.roomId,
      });
      snaps.push(s);
      await tx.invoiceItem.update({ where: { id: l.id }, data: this.snapshotData(s) });
    }
    const t = totalsOf(snaps);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: new Prisma.Decimal(t.subtotal),
        taxAmount: new Prisma.Decimal(t.taxAmount),
        discountAmount: new Prisma.Decimal(t.discountAmount),
        total: new Prisma.Decimal(t.total),
        ...(discount
          ? {
              discountReason: toPaise(discount.amount) === 0n ? null : discount.reason,
              discountSetById: discount.setById,
            }
          : {}),
      },
    });
  }

  /** Runs a staff billing action in its own transaction with the hospital lock, retries and error mapping. */
  private write<T>(
    actor: AuthPrincipal,
    fn: (tx: Tx, ctx: { timezone: string; taxSetupConfirmed: boolean }) => Promise<T>,
  ): Promise<T> {
    return withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) =>
          fn(tx, await this.lockHospital(tx, actor.hospitalId!)),
        );
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });
  }

  private async draftOf(tx: Tx, id: string) {
    const inv = await tx.invoice.findFirst({
      where: { id },
      select: { id: true, status: true, appointmentId: true },
    });
    if (!inv) throw notFound('invoice');
    if (inv.status !== 'DRAFT')
      throw conflict(
        'NOT_DRAFT',
        inv.status === 'VOID'
          ? 'This invoice is void.'
          : 'This invoice has been issued and can no longer change.',
      );
    return inv;
  }

  // ------------------------------------------------------------------ automatic charges (8-B4)

  /**
   * Adds the charge for a rendered service to the visit's draft, inside the caller's clinical
   * transaction (Q4 A). Never redistributes a discount (that happens on staff actions), so it cannot
   * fail because of another line. Returns nothing; failures roll back the clinical action with a
   * mapped error, which only happens if billing data is inconsistent.
   */
  async charge(tx: Tx, actor: AuthPrincipal, c: AutomaticCharge): Promise<void> {
    try {
      await this.lockHospital(tx, actor.hospitalId!);
      const { id } = await this.openDraft(tx, actor, c.appointmentId);
      await this.chargeInto(tx, actor, id, c);
    } catch (e) {
      mapInvoiceDbError(e);
    }
  }

  /** Adds one automatic charge to a draft and adds its amounts to the totals (no other line changes). */
  private async chargeInto(
    tx: Tx,
    actor: AuthPrincipal,
    invoiceId: string,
    c: AutomaticCharge,
  ): Promise<void> {
    const h = actor.hospitalId!;
    const hospital = await tx.hospital.findFirst({ where: { id: h }, select: { timezone: true } });
    const serviceDate = localDate(new Date(), hospital!.timezone);
    let unitPrice: string;
    let quantity = 1;
    let description: string;
    if (c.kind === 'CONSULTATION') {
      const a = await tx.appointment.findFirst({
        where: { id: c.appointmentId },
        select: {
          doctor: {
            select: {
              consultationFee: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });
      if (!a) throw notFound('appointment');
      unitPrice = a.doctor.consultationFee.toFixed(2);
      description = `Consultation with Dr ${name(a.doctor.user)}`;
    } else if (c.kind === 'LAB') {
      const i = await tx.labOrderItem.findFirst({
        where: { id: c.labOrderItemId },
        select: { labTest: { select: { price: true } } },
      });
      if (!i) throw notFound('lab order item');
      unitPrice = i.labTest.price.toFixed(2);
      description = c.description;
    } else {
      const d = await tx.dispense.findFirst({
        where: { id: c.dispenseId },
        select: { quantity: true, batch: { select: { mrp: true } } },
      });
      if (!d) throw notFound('dispense');
      unitPrice = d.batch.mrp.toFixed(2);
      quantity = d.quantity;
      description = c.description;
    }
    const snap = await this.insertLine(tx, invoiceId, h, {
      kind: c.kind,
      description,
      quantity,
      unitPrice,
      serviceDate,
      labOrderItemId: c.kind === 'LAB' ? c.labOrderItemId : null,
      dispenseId: c.kind === 'PHARMACY' ? c.dispenseId : null,
      consultationAppointmentId: c.kind === 'CONSULTATION' ? c.appointmentId : null,
    });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: { increment: new Prisma.Decimal(snap.taxableValue) },
        taxAmount: { increment: new Prisma.Decimal(snap.taxAmount) },
        total: { increment: new Prisma.Decimal(snap.lineTotal) },
      },
    });
  }

  /** Removes a cancelled lab test's charge while its invoice is a draft (an issued charge stays). */
  async releaseLabCharges(tx: Tx, actor: AuthPrincipal, labOrderItemIds: string[]): Promise<void> {
    if (!labOrderItemIds.length) return;
    await this.lockHospital(tx, actor.hospitalId!);
    const lines = await tx.invoiceItem.findMany({
      where: {
        labOrderItemId: { in: labOrderItemIds },
        releasedAt: null,
        invoice: { status: 'DRAFT' },
      },
      select: { id: true, invoiceId: true },
    });
    for (const l of lines) {
      await tx.invoiceItem.delete({ where: { id: l.id } });
      await this.recalc(tx, l.invoiceId);
    }
  }

  // ------------------------------------------------------------------ staff actions

  async createDraft(actor: AuthPrincipal, appointmentId: string): Promise<InvoiceView> {
    const id = await this.write(actor, async (tx) => {
      const r = await this.openDraft(tx, actor, appointmentId);
      if (!r.created) throw conflict('INVOICE_EXISTS', 'This visit already has a draft invoice.');
      return r.id;
    });
    return this.get(actor, id);
  }

  async createLateCharges(actor: AuthPrincipal, originalId: string): Promise<InvoiceView> {
    const id = await this.write(actor, async (tx) => {
      const o = await tx.invoice.findFirst({
        where: { id: originalId },
        select: { appointmentId: true, kind: true, status: true },
      });
      if (!o) throw notFound('invoice');
      if (o.kind !== 'ORIGINAL' || !(ISSUED as readonly string[]).includes(o.status))
        throw conflict('NOT_ISSUED', 'Late charges follow an issued original invoice.');
      const r = await this.openDraft(tx, actor, o.appointmentId);
      if (!r.created)
        throw conflict(
          'INVOICE_EXISTS',
          'This visit already has a draft invoice; add the charges there.',
        );
      return r.id;
    });
    return this.get(actor, id);
  }

  async addLine(
    actor: AuthPrincipal,
    invoiceId: string,
    dto: AddLineRequest,
  ): Promise<InvoiceView> {
    await this.write(actor, async (tx) => {
      await this.draftOf(tx, invoiceId);
      if (dto.kind === 'ROOM') {
        const room = await tx.room.findFirst({
          where: { id: dto.roomId },
          select: { number: true, dailyCharge: true },
        });
        if (!room) throw notFound('room');
        if (room.dailyCharge === null)
          throw new BadRequestException({
            code: 'ROOM_NO_CHARGE',
            message: 'This room has no daily charge.',
          });
        await this.insertLine(tx, invoiceId, actor.hospitalId!, {
          kind: 'ROOM',
          description: `Room ${room.number}, ${dto.days} day${dto.days === 1 ? '' : 's'}`,
          quantity: dto.days,
          unitPrice: room.dailyCharge.toFixed(2),
          serviceDate: dto.serviceDate,
          roomId: dto.roomId,
          addedById: actor.userId,
        });
      } else {
        await this.insertLine(tx, invoiceId, actor.hospitalId!, {
          kind: 'OTHER',
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          serviceDate: dto.serviceDate,
          classificationId: dto.classificationId,
          addedById: actor.userId,
        });
      }
      await this.recalc(tx, invoiceId);
    });
    return this.get(actor, invoiceId);
  }

  async removeLine(actor: AuthPrincipal, invoiceId: string, lineId: string): Promise<InvoiceView> {
    await this.write(actor, async (tx) => {
      await this.draftOf(tx, invoiceId);
      const l = await tx.invoiceItem.findFirst({
        where: { id: lineId, invoiceId },
        select: { kind: true },
      });
      if (!l) throw notFound('invoice line');
      if (l.kind !== 'ROOM' && l.kind !== 'OTHER')
        throw conflict(
          'AUTOMATIC_LINE',
          'Consultation, lab and pharmacy charges follow the clinical record; cancel the order instead, or void the draft.',
        );
      await tx.invoiceItem.delete({ where: { id: lineId } });
      await this.recalc(tx, invoiceId);
    });
    return this.get(actor, invoiceId);
  }

  async reresolve(actor: AuthPrincipal, invoiceId: string): Promise<InvoiceView> {
    await this.write(actor, async (tx) => {
      await this.draftOf(tx, invoiceId);
      await this.recalc(tx, invoiceId);
    });
    return this.get(actor, invoiceId);
  }

  async setDiscount(
    actor: AuthPrincipal,
    invoiceId: string,
    amount: string,
    reason: string | null,
  ): Promise<InvoiceView> {
    if (actor.role !== 'ACCOUNTANT')
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only an accountant can set a discount.',
      });
    if (toPaise(amount) > 0n && !reason)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Give a reason for the discount.',
      });
    await this.write(actor, async (tx) => {
      await this.draftOf(tx, invoiceId);
      await this.recalc(tx, invoiceId, { amount, reason, setById: actor.userId });
    });
    return this.get(actor, invoiceId);
  }

  async finalise(actor: AuthPrincipal, invoiceId: string): Promise<InvoiceView> {
    let staged: StagedDeliveries | undefined;
    await this.write(actor, async (tx, ctx) => {
      await this.draftOf(tx, invoiceId);
      // Share the discount again over the current lines, then explain anything that still blocks.
      await this.recalc(tx, invoiceId);
      const lines = await tx.invoiceItem.findMany({ where: { invoiceId } });
      const blockers = finaliseBlockers({
        taxSetupConfirmed: ctx.taxSetupConfirmed,
        issueDate: localDate(new Date(), ctx.timezone),
        lines: lines.map((l) => ({
          unclassified: l.unclassified,
          taxableValue: l.taxableValue.toFixed(2),
          taxAmount: l.taxAmount.toFixed(2),
          discountShare: l.discountShare.toFixed(2),
          serviceDate: ymd(l.serviceDate),
        })),
      });
      if (blockers.length)
        throw conflict(BLOCKER_CODE[blockers[0]!], BLOCKER_MESSAGE[blockers[0]!]);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'FINALISED', finalisedById: actor.userId },
      });
      // NOTIF-006: issued with the document, under the same invoice lock.
      const patient = await patientOfInvoice(tx, invoiceId);
      staged = await this.notifications.stage(tx, {
        hospitalId: actor.hospitalId!,
        recipientIds: patient ? [patient] : [],
        content: CONTENT.invoiceIssued(),
        entityType: 'Invoice',
        entityId: invoiceId,
      });
    });
    await this.notifications.dispatch(staged);
    // NOTIF-006, after commit.
    await this.events.publish({
      type: 'invoice.finalised',
      hospitalId: actor.hospitalId!,
      invoiceId,
    });
    return this.get(actor, invoiceId);
  }

  async void(actor: AuthPrincipal, invoiceId: string, reason: string): Promise<InvoiceView> {
    await this.write(actor, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id: invoiceId },
        select: { status: true },
      });
      if (!inv) throw notFound('invoice');
      if ((ISSUED as readonly string[]).includes(inv.status))
        throw conflict('DOCUMENT_ISSUED', ISSUED_MESSAGE);
      if (inv.status === 'VOID') throw conflict('NOT_DRAFT', 'This invoice is already void.');
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'VOID', voidedById: actor.userId, voidReason: reason },
      });
    });
    return this.get(actor, invoiceId);
  }

  async requestCorrection(
    actor: AuthPrincipal,
    invoiceId: string,
    kind: CorrectionRequestKind,
    description: string,
  ) {
    await this.write(actor, async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id: invoiceId },
        select: { status: true },
      });
      if (!inv) throw notFound('invoice');
      if (!(ISSUED as readonly string[]).includes(inv.status))
        throw conflict(
          'NOT_ISSUED',
          'A draft can be edited or voided; corrections are requested only for issued documents.',
        );
      await tx.invoiceCorrectionRequest.create({
        data: {
          hospitalId: actor.hospitalId!,
          invoiceId,
          kind,
          description,
          requestedById: actor.userId,
        },
      });
    });
    return {
      message: ISSUED_MESSAGE.replace(
        'Record a correction request instead.',
        'Your request has been recorded.',
      ),
      invoice: await this.get(actor, invoiceId),
    };
  }

  async addCorrectionNote(
    actor: AuthPrincipal,
    invoiceId: string,
    requestId: string,
    note: string,
    externalReference: string | null,
  ): Promise<InvoiceView> {
    await this.write(actor, async (tx) => {
      const r = await tx.invoiceCorrectionRequest.findFirst({
        where: { id: requestId, invoiceId },
        select: { id: true },
      });
      if (!r) throw notFound('correction request');
      await tx.invoiceCorrectionRequestNote.create({
        data: {
          hospitalId: actor.hospitalId!,
          requestId,
          note,
          externalReference,
          authorId: actor.userId,
        },
      });
    });
    return this.get(actor, invoiceId);
  }

  // ------------------------------------------------------------------ reads

  /** What staff can choose for manual charges (other: active classifications; room: rooms with a daily charge). */
  async chargeOptions(_actor: AuthPrincipal): Promise<{
    classifications: { id: string; name: string; supplyType: string; hsnSac: string }[];
    rooms: { id: string; number: string; type: string; dailyCharge: string }[];
  }> {
    const [classifications, rooms] = await Promise.all([
      this.db.client.taxClassification.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, supplyType: true, hsnSac: true },
      }),
      this.db.client.room.findMany({
        where: { dailyCharge: { not: null } },
        orderBy: { number: 'asc' },
        select: { id: true, number: true, type: true, dailyCharge: true },
      }),
    ]);
    return {
      classifications,
      rooms: rooms.map((r) => ({ ...r, dailyCharge: r.dailyCharge!.toFixed(2) })),
    };
  }

  private patientScope(actor: AuthPrincipal): Prisma.InvoiceWhereInput {
    if (actor.role !== 'PATIENT') return {};
    // Q8 A: patients see their own issued documents only (never drafts or voided drafts).
    return { patient: { userId: actor.userId }, status: { in: [...ISSUED] } };
  }

  async list(
    actor: AuthPrincipal,
    q: {
      status?: string;
      patientId?: string;
      from?: string;
      to?: string;
      page: number;
      limit: number;
    },
  ): Promise<PaginatedResult<InvoiceSummary>> {
    const where: Prisma.InvoiceWhereInput = {
      ...(q.status ? { status: q.status as Prisma.EnumInvoiceStatusFilter['equals'] } : {}),
      ...(q.patientId && actor.role !== 'PATIENT' ? { patientId: q.patientId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...this.patientScope(actor),
    };
    const [rows, total] = await Promise.all([
      this.db.client.invoice.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.invoice.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toSummary), total, q.page, q.limit);
  }

  async get(actor: AuthPrincipal, id: string): Promise<InvoiceView> {
    const staff = STAFF_READ.includes(actor.role);
    const inv = await this.db.client.invoice.findFirst({
      where: { id, ...this.patientScope(actor) },
      include: DETAIL_INCLUDE,
    });
    if (!inv) throw notFound('invoice');
    const blockers =
      staff && inv.status === 'DRAFT'
        ? finaliseBlockers({
            taxSetupConfirmed: inv.hospital.taxSetupConfirmedAt !== null,
            issueDate: localDate(new Date(), inv.hospital.timezone),
            lines: inv.items.map((l) => ({
              unclassified: l.unclassified,
              taxableValue: l.taxableValue.toFixed(2),
              taxAmount: l.taxAmount.toFixed(2),
              discountShare: l.discountShare.toFixed(2),
              serviceDate: ymd(l.serviceDate),
            })),
          })
        : [];
    return {
      ...toSummary(inv),
      sequence: inv.sequence,
      relatedInvoiceId: inv.relatedInvoiceId,
      lateChargeInvoiceIds: inv.lateCharges.map((l) => l.id),
      subtotal: inv.subtotal.toFixed(2),
      taxAmount: inv.taxAmount.toFixed(2),
      discountAmount: inv.discountAmount.toFixed(2),
      discountReason: staff ? inv.discountReason : null,
      voidReason: staff ? inv.voidReason : null,
      voidedAt: inv.voidedAt?.toISOString() ?? null,
      finalisedAt: inv.finalisedAt?.toISOString() ?? null,
      seller: inv.registrationType
        ? {
            registrationType: inv.registrationType,
            gstin: inv.sellerGstin,
            legalName: inv.sellerLegalName,
            stateCode: inv.sellerStateCode,
          }
        : null,
      lines: inv.items.map((l) => ({
        id: l.id,
        kind: l.kind,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice.toFixed(2),
        serviceDate: ymd(l.serviceDate),
        unclassified: l.unclassified,
        classificationName: l.classificationName,
        hsnSac: l.hsnSac,
        supplyType: l.supplyType,
        treatment: l.treatment,
        ratePercent: dec(l.ratePercent),
        priceIncludesTax: l.priceIncludesTax,
        gstCollected: l.gstCollected,
        notCollectedReason: l.notCollectedReason,
        grossAmount: l.grossAmount.toFixed(2),
        discountShare: l.discountShare.toFixed(2),
        taxableValue: l.taxableValue.toFixed(2),
        taxAmount: l.taxAmount.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        releasedAt: l.releasedAt?.toISOString() ?? null,
        manual: l.kind === 'ROOM' || l.kind === 'OTHER',
      })),
      events: staff
        ? inv.events.map((e) => ({
            kind: e.kind,
            actorName: name(e.actor),
            note: e.note,
            createdAt: e.createdAt.toISOString(),
          }))
        : [],
      correctionRequests: staff
        ? inv.correctionRequests.map((r) => ({
            id: r.id,
            kind: r.kind,
            description: r.description,
            requestedByName: name(r.requestedBy),
            createdAt: r.createdAt.toISOString(),
            notes: r.notes.map((n) => ({
              note: n.note,
              externalReference: n.externalReference,
              authorName: name(n.author),
              createdAt: n.createdAt.toISOString(),
            })),
          }))
        : [],
      finaliseBlockers: blockers,
    };
  }
}

export const ISSUED_MESSAGE =
  'This document has been issued and cannot be changed or cancelled in MedCore. Your accountant must handle it through the legally appropriate process, such as a credit note, outside MedCore. Record a correction request instead.';

const BLOCKER_CODE = {
  TAX_SETUP_UNCONFIRMED: 'TAX_DEFAULTS_UNCONFIRMED',
  EMPTY_INVOICE: 'EMPTY_INVOICE',
  UNCLASSIFIED_LINES: 'UNCLASSIFIED_LINES',
  NOTHING_TO_PAY: 'NOTHING_TO_PAY',
  LINE_AFTER_ISSUE_DATE: 'LINE_AFTER_ISSUE_DATE',
} as const;
const BLOCKER_MESSAGE = {
  TAX_SETUP_UNCONFIRMED:
    'The hospital admin must confirm the tax set-up before the first invoice is finalised.',
  EMPTY_INVOICE: 'An invoice needs at least one charge before it is finalised.',
  UNCLASSIFIED_LINES:
    'Some charges have no tax classification. Classify them in tax settings, then re-resolve the invoice.',
  NOTHING_TO_PAY: 'An invoice with nothing to pay cannot be finalised.',
  LINE_AFTER_ISSUE_DATE:
    'A charge is dated after today. Finalise the invoice on or after its date.',
} as const;

const SUMMARY_INCLUDE = {
  patient: {
    select: { id: true, mrn: true, user: { select: { firstName: true, lastName: true } } },
  },
  appointment: {
    select: {
      id: true,
      scheduledAt: true,
      doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.InvoiceInclude;

const DETAIL_INCLUDE = {
  ...SUMMARY_INCLUDE,
  hospital: { select: { timezone: true, taxSetupConfirmedAt: true } },
  items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  lateCharges: { select: { id: true }, orderBy: { sequence: 'asc' } },
  events: {
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
  correctionRequests: {
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { firstName: true, lastName: true } },
      notes: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
function toSummary(i: SummaryRow): InvoiceSummary {
  return {
    id: i.id,
    kind: i.kind,
    status: i.status,
    invoiceNumber: i.invoiceNumber,
    documentType: i.documentType,
    issueDate: i.issueDate ? ymd(i.issueDate) : null,
    total: i.total.toFixed(2),
    patient: { id: i.patient.id, name: name(i.patient.user), mrn: i.patient.mrn },
    appointment: {
      id: i.appointment.id,
      scheduledAt: i.appointment.scheduledAt.toISOString(),
      doctorName: name(i.appointment.doctor.user),
    },
    createdAt: i.createdAt.toISOString(),
  };
}
