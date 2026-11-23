import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ONLINE_PAYMENT_METHODS,
  type CheckoutStarted,
  type InvoicePaymentsView,
  type InvoiceStatus,
  type MyPaymentView,
  type OnlinePaymentMethod,
  type PaymentDetailView,
  type PaymentMethod,
  type PaymentState,
  type PaymentView,
  type TestCheckoutOutcome,
} from '@medcore/types';
import { Prisma, type PaymentProvider } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { withRetry } from '../../common/http/db-rule-errors';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DomainEvents } from '../../common/events/domain-events';
import { ownPatientId } from '../../common/tenancy/patient-identity';
import { mapInvoiceDbError } from '../billing/invoice-db-errors';
import { FakeProvider, TEST_SIGNATURE_HEADER } from './providers/fake-provider';
import {
  PAYMENT_ADAPTER,
  WebhookRejected,
  type CheckoutSession,
  type PaymentAdapter,
  type ProviderEvent,
  type WebhookInput,
} from './providers/payment-adapter';
import { NotificationWriter, type StagedDeliveries } from '../notifications/notification.writer';
import { CONTENT } from '../notifications/notification-content';
import { patientOfInvoice } from '../notifications/notification-recipients';

/**
 * Payments (BILL-004, tasks 8-B5 and 8-B6; DEC-054, DEC-064). Rules the database will also enforce
 * through M-12 are checked here first, under the same locks, so the screen gets a clear answer.
 *
 * Lock order, always: invoice row, then payment row. Every payment change takes the invoice lock,
 * so cash, checkouts, cancellations and webhooks for one invoice run one at a time.
 *
 * Until the payment rules are installed (M-12, not yet approved), every operation that would change
 * money refuses with PAYMENT_RULES_PENDING and changes nothing. Reads and cancelling a checkout that
 * never completed still work.
 */
type Tx = Prisma.TransactionClient;
type Provider = 'stripe' | 'razorpay';

const RULES_TRIGGER = 'payments_invoice_status';
const PAYABLE: InvoiceStatus[] = ['FINALISED', 'PARTIALLY_PAID'];
const ISSUED: InvoiceStatus[] = ['FINALISED', 'PARTIALLY_PAID', 'PAID'];
const STAFF_READ = ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'];
const PROVIDER_OF: Record<OnlinePaymentMethod, PaymentProvider> = {
  STRIPE_CARD: 'STRIPE',
  RAZORPAY_UPI: 'RAZORPAY',
  RAZORPAY_NETBANKING: 'RAZORPAY',
};
const ONLINE = [...ONLINE_PAYMENT_METHODS];
const PAYMENT_INCLUDE = {
  receivedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;

// Explicit list: cash and TPA settlements (M-13) are both recorded without a provider checkout.
const isOnline = (m: PaymentMethod): m is OnlinePaymentMethod =>
  (ONLINE as readonly PaymentMethod[]).includes(m);
const money = (d: Prisma.Decimal | string) => new Prisma.Decimal(d).toFixed(2);
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const unavailable = (code: string, message: string) =>
  new ServiceUnavailableException({ code, message });
const rejected = () =>
  new BadRequestException({
    code: 'WEBHOOK_INVALID',
    message: 'The webhook could not be verified.',
  });

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

function toView(p: PaymentRow, staff: boolean): PaymentView {
  return {
    id: p.id,
    method: p.method,
    status: p.status,
    amount: money(p.amount),
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    receivedByName:
      staff && p.receivedBy ? `${p.receivedBy.firstName} ${p.receivedBy.lastName}`.trim() : null,
    checkoutOpen: staff && p.status === 'PENDING' && isOnline(p.method),
    reconciledAt: staff ? (p.reconciledAt?.toISOString() ?? null) : null,
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: TenantPrismaService,
    /** Unscoped client, used only where no signed-in tenant exists (provider webhooks). */
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentAdapter | null,
    private readonly events: DomainEvents,
    private readonly notifications: NotificationWriter,
  ) {}

  // ------------------------------------------------------------------ guards and locks

  private async assertRules(tx: Tx): Promise<void> {
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = ${RULES_TRIGGER} AND NOT tgisinternal`;
    if ((rows[0]?.n ?? 0) === 0)
      throw unavailable(
        'PAYMENT_RULES_PENDING',
        'Payments wait for database migration M-12, which is prepared but not yet approved or applied. Nothing was changed.',
      );
  }

  private requireAdapter(): PaymentAdapter {
    if (!this.adapter)
      throw unavailable(
        'PROVIDER_NOT_CONFIGURED',
        'Online payments are not configured in this environment. Cash payments still work.',
      );
    return this.adapter;
  }

  private async lockInvoice(tx: Tx, invoiceId: string, hospitalId: string) {
    const rows = await tx.$queryRaw<{ status: InvoiceStatus; total: string }[]>`
      SELECT status::text AS status, total::text AS total FROM invoices
      WHERE id = ${invoiceId}::uuid AND "hospitalId" = ${hospitalId}::uuid FOR UPDATE`;
    if (!rows[0]) throw notFound('invoice');
    return { status: rows[0].status, total: new Prisma.Decimal(rows[0].total) };
  }

  /** Locks the invoice, then the payment. Returns both, or refuses if the payment is not in this hospital. */
  private async lockPaymentWithInvoice(tx: Tx, paymentId: string, hospitalId: string) {
    const found = await tx.payment.findFirst({
      where: { id: paymentId, hospitalId },
      select: { invoiceId: true },
    });
    if (!found) throw notFound('payment');
    const invoice = await this.lockInvoice(tx, found.invoiceId, hospitalId);
    const rows = await tx.$queryRaw<
      {
        status: PaymentState;
        method: PaymentMethod;
        amount: string;
        providerReference: string | null;
        reconciled: boolean;
      }[]
    >`
      SELECT status::text AS status, method::text AS method, amount::text AS amount, "providerReference", ("reconciledAt" IS NOT NULL) AS reconciled
      FROM payments WHERE id = ${paymentId}::uuid AND "hospitalId" = ${hospitalId}::uuid FOR UPDATE`;
    const p = rows[0];
    if (!p) throw notFound('payment');
    return {
      invoiceId: found.invoiceId,
      invoice,
      payment: {
        id: paymentId,
        status: p.status,
        method: p.method,
        amount: new Prisma.Decimal(p.amount),
        providerReference: p.providerReference,
        reconciled: p.reconciled,
      },
    };
  }

  private async paidAndBalance(tx: Tx, invoiceId: string, total: Prisma.Decimal) {
    const agg = await tx.payment.aggregate({
      where: { invoiceId, status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const paid = agg._sum.amount ?? new Prisma.Decimal(0);
    return { paid, balance: total.minus(paid) };
  }

  /**
   * Moves the invoice to the status its received payments imply. The database allows an issued invoice
   * to change status only inside a payment transaction, which is marked here (M-12 proposal).
   */
  private async syncInvoiceStatus(tx: Tx, invoiceId: string, total: Prisma.Decimal): Promise<void> {
    const { paid } = await this.paidAndBalance(tx, invoiceId, total);
    const next: InvoiceStatus = paid.gte(total)
      ? 'PAID'
      : paid.gt(0)
        ? 'PARTIALLY_PAID'
        : 'FINALISED';
    const current = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true },
    });
    if (!current || current.status === next) return;
    await tx.$executeRaw`SELECT set_config('medcore.payment_change', 'on', true)`;
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: next } });
  }

  /** NOTIF-007: written in the payment's transaction, under the invoice lock. */
  private async paymentNotice(tx: Tx, hospitalId: string, invoiceId: string, paymentId: string) {
    const patient = await patientOfInvoice(tx, invoiceId);
    return this.notifications.stage(tx, {
      hospitalId,
      recipientIds: patient ? [patient] : [],
      content: CONTENT.paymentReceived(),
      entityType: 'Payment',
      entityId: paymentId,
    });
  }

  private openOnline(tx: Tx, invoiceId: string) {
    return tx.payment.findFirst({
      where: { invoiceId, status: 'PENDING', method: { in: ONLINE } },
      select: { id: true },
    });
  }

  /**
   * Invoice filter for the caller. A patient is resolved to their own patient profile first, so the
   * filter is a plain column match; without a profile nothing matches. Staff are scoped by tenancy.
   */
  async invoiceScope(actor: AuthPrincipal): Promise<Prisma.InvoiceWhereInput> {
    if (actor.role !== 'PATIENT') return {};
    return {
      patientId: await ownPatientId(this.db.client, actor, 'invoice'),
      status: { in: ISSUED },
    };
  }

  private audit(
    tx: Tx,
    hospitalId: string | null,
    entityId: string | null,
    action: string,
    changes: Record<string, string>,
  ) {
    return tx.auditLog.create({
      data: {
        hospitalId,
        actorId: null,
        action,
        entityType: 'Payment',
        entityId,
        changes: changes as Prisma.InputJsonObject,
      },
    });
  }

  // ------------------------------------------------------------------ staff: cash (8-B5)

  /** Records cash received against an issued invoice. Partial payments are allowed (DEC-054, Q9 A). */
  async recordCash(
    actor: AuthPrincipal,
    invoiceId: string,
    amount: string,
  ): Promise<InvoicePaymentsView> {
    const hospitalId = actor.hospitalId!;
    const value = new Prisma.Decimal(amount);
    if (value.lte(0))
      throw new BadRequestException({
        code: 'AMOUNT_INVALID',
        message: 'Enter an amount greater than zero.',
      });
    let paidId: string | undefined;
    let staged: StagedDeliveries | undefined;
    await withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          const inv = await this.lockInvoice(tx, invoiceId, hospitalId);
          await this.assertRules(tx);
          if (!PAYABLE.includes(inv.status))
            throw conflict(
              'NOT_PAYABLE',
              'Only an issued invoice that is not yet paid in full can take a payment.',
            );
          if (await this.openOnline(tx, invoiceId))
            throw conflict(
              'CHECKOUT_OPEN',
              'An online checkout is open for this invoice. Cancel it before taking cash (DEC-064).',
            );
          const { balance } = await this.paidAndBalance(tx, invoiceId, inv.total);
          if (balance.lte(0))
            throw conflict('NOTHING_TO_PAY', 'This invoice is already paid in full.');
          if (value.gt(balance))
            throw conflict(
              'AMOUNT_EXCEEDS_BALANCE',
              `The balance is ₹${money(balance)}. Enter that amount or less.`,
            );
          const created = await tx.payment.create({
            select: { id: true },
            data: {
              hospitalId,
              invoiceId,
              method: 'CASH',
              amount: value,
              status: 'SUCCEEDED',
              paidAt: new Date(),
              receivedById: actor.userId,
            },
          });
          await this.syncInvoiceStatus(tx, invoiceId, inv.total);
          paidId = created.id;
          staged = await this.paymentNotice(tx, hospitalId, invoiceId, created.id);
        });
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });
    await this.notifications.dispatch(staged);
    if (paidId)
      await this.events.publish({ type: 'payment.received', hospitalId, paymentId: paidId });
    return this.invoicePayments(actor, invoiceId);
  }

  // ------------------------------------------------------------------ staff: online checkout (8-B6)

  /** Opens an online checkout for the whole balance (DEC-054 Q9 A; Q12 A receptionists start it). */
  async startCheckout(
    actor: AuthPrincipal,
    invoiceId: string,
    method: OnlinePaymentMethod,
  ): Promise<CheckoutStarted> {
    const adapter = this.requireAdapter();
    if (!adapter.supports(method))
      throw unavailable(
        'PROVIDER_NOT_CONFIGURED',
        'This payment method is not available with the configured provider. Choose another method or take cash.',
      );
    const hospitalId = actor.hospitalId!;
    const created = await withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          const inv = await this.lockInvoice(tx, invoiceId, hospitalId);
          await this.assertRules(tx);
          if (!PAYABLE.includes(inv.status))
            throw conflict(
              'NOT_PAYABLE',
              'Only an issued invoice that is not yet paid in full can take a payment.',
            );
          const { balance } = await this.paidAndBalance(tx, invoiceId, inv.total);
          if (balance.lte(0))
            throw conflict('NOTHING_TO_PAY', 'This invoice is already paid in full.');
          if (await this.openOnline(tx, invoiceId))
            throw conflict(
              'CHECKOUT_OPEN',
              'An online checkout is already open for this invoice. Cancel it first.',
            );
          return tx.payment.create({
            data: {
              hospitalId,
              invoiceId,
              method,
              provider: PROVIDER_OF[method],
              amount: balance,
              status: 'PENDING',
            },
            select: { id: true, amount: true },
          });
        });
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });

    // The provider call happens outside the transaction. If it fails, the attempt is closed so that
    // the invoice is never left with an open checkout nobody can complete.
    let session: CheckoutSession;
    try {
      session = await adapter.createCheckout({
        paymentId: created.id,
        amount: money(created.amount),
        method,
        description: 'MedCore invoice payment',
      });
    } catch {
      await this.db.client.payment.update({
        where: { id: created.id },
        data: { status: 'FAILED' },
      });
      throw unavailable(
        'PROVIDER_UNAVAILABLE',
        'The payment provider did not open a checkout. Nothing was charged; please try again.',
      );
    }
    await this.db.client.payment.update({
      where: { id: created.id },
      data: { providerReference: session.providerReference },
    });
    return { payment: await this.detail(actor, created.id), checkoutUrl: session.checkoutUrl };
  }

  /** Cancels an open online checkout. A later success for it is held for the accountant. */
  async cancelCheckout(actor: AuthPrincipal, paymentId: string): Promise<PaymentDetailView> {
    const hospitalId = actor.hospitalId!;
    const providerReference = await withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          const { payment } = await this.lockPaymentWithInvoice(tx, paymentId, hospitalId);
          if (payment.status !== 'PENDING' || !isOnline(payment.method))
            throw conflict('PAYMENT_NOT_OPEN', 'Only an open online checkout can be cancelled.');
          await tx.payment.update({ where: { id: paymentId }, data: { status: 'FAILED' } });
          return payment.providerReference;
        });
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });
    if (providerReference)
      await this.adapter?.cancelCheckout(providerReference).catch(() => undefined);
    return this.detail(actor, paymentId);
  }

  // ------------------------------------------------------------------ webhooks

  /**
   * Handles one provider webhook. The signature is verified first; an event is applied at most once
   * (WebhookEvent is written in the same transaction as its effect); a success is never applied to a
   * checkout that was cancelled, and never for a different amount: both are held for the accountant.
   * Refusals roll back, so the provider's retry finds nothing half-done.
   */
  async receiveWebhook(route: Provider, input: WebhookInput): Promise<{ received: true }> {
    const adapter = this.requireAdapter();
    let event: ProviderEvent | null;
    try {
      event = adapter.verifyWebhook(input);
    } catch (e) {
      if (e instanceof WebhookRejected) throw rejected();
      throw e;
    }
    // A verified event MedCore does not act on (for example a Stripe event of another type) is acknowledged.
    if (!event) return { received: true };
    if (event.provider !== (route === 'stripe' ? 'STRIPE' : 'RAZORPAY')) throw rejected();

    let received = null as { hospitalId: string; paymentId: string } | null;
    let staged: StagedDeliveries | undefined;
    await this.prisma.$transaction(async (tx) => {
      const seen = await tx.webhookEvent.findUnique({
        where: { provider_eventId: { provider: event.provider, eventId: event.eventId } },
        select: { id: true },
      });
      if (seen) return;

      const payment = await tx.payment.findFirst({
        where: { provider: event.provider, providerReference: event.providerReference },
        select: { id: true, hospitalId: true },
      });
      if (!payment) {
        await this.audit(tx, null, null, 'payment.webhook.unknown', {
          provider: event.provider,
          eventId: event.eventId,
        });
      } else {
        const {
          invoiceId,
          invoice,
          payment: current,
        } = await this.lockPaymentWithInvoice(tx, payment.id, payment.hospitalId);
        const held = (reason: string) =>
          this.audit(tx, payment.hospitalId, payment.id, 'payment.webhook.held', {
            provider: event.provider,
            eventId: event.eventId,
            reason,
          });

        if (event.amount !== null && event.amount !== money(current.amount)) {
          await held('amount differs from the payment record');
        } else if (current.status === 'PENDING') {
          if (event.outcome === 'FAILED') {
            await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
          } else {
            await this.assertRules(tx);
            const { balance } = await this.paidAndBalance(tx, invoiceId, invoice.total);
            if (current.amount.gt(balance)) {
              await held('amount exceeds the invoice balance');
            } else {
              await tx.payment.update({
                where: { id: payment.id },
                data: { status: 'SUCCEEDED', paidAt: new Date() },
              });
              await this.syncInvoiceStatus(tx, invoiceId, invoice.total);
              received = { hospitalId: payment.hospitalId, paymentId: payment.id };
              staged = await this.paymentNotice(tx, payment.hospitalId, invoiceId, payment.id);
            }
          }
        } else if (current.status === 'FAILED' && event.outcome === 'SUCCEEDED') {
          await held(
            'success for a checkout that was cancelled or failed; held for the accountant',
          );
        }
      }

      await tx.webhookEvent.create({
        data: { provider: event.provider, eventId: event.eventId, processedAt: new Date() },
      });
    });
    await this.notifications.dispatch(staged);
    if (received) await this.events.publish({ type: 'payment.received', ...received });
    return { received: true };
  }

  /** Development only: simulates the provider's answer for an open checkout, through the real webhook path. */
  async simulateCheckout(
    actor: AuthPrincipal,
    paymentId: string,
    outcome: TestCheckoutOutcome,
  ): Promise<PaymentDetailView> {
    const fake = this.adapter;
    if (!(fake instanceof FakeProvider)) throw notFound('test checkout');
    const p = await this.db.client.payment.findFirst({
      where: { id: paymentId },
      select: { method: true, status: true, providerReference: true, amount: true },
    });
    if (!p) throw notFound('payment');
    if (p.status !== 'PENDING' || !isOnline(p.method) || !p.providerReference)
      throw conflict('PAYMENT_NOT_OPEN', 'This checkout is not open.');
    const provider = PROVIDER_OF[p.method];
    const { body, signature } = fake.signedEvent({
      provider,
      eventId: `test_${randomUUID()}`,
      providerReference: p.providerReference,
      outcome,
      amount: money(p.amount),
    });
    await this.receiveWebhook(provider === 'STRIPE' ? 'stripe' : 'razorpay', {
      rawBody: Buffer.from(body, 'utf8'),
      headers: { [TEST_SIGNATURE_HEADER]: signature },
    });
    return this.detail(actor, paymentId);
  }

  // ------------------------------------------------------------------ accountant: reversal (8-B5)

  /**
   * Reverses a received payment. Needs M-12 (REVERSED status and reversal columns). A reconciled
   * payment is never reversed; the accountant records a correction instead.
   */
  async reversePayment(
    actor: AuthPrincipal,
    paymentId: string,
    reason: string,
  ): Promise<PaymentDetailView> {
    const hospitalId = actor.hospitalId!;
    await withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          const { invoiceId, invoice, payment } = await this.lockPaymentWithInvoice(
            tx,
            paymentId,
            hospitalId,
          );
          await this.assertRules(tx);
          if (payment.status !== 'SUCCEEDED')
            throw conflict('NOT_REVERSIBLE', 'Only a received payment can be reversed.');
          if (payment.reconciled)
            throw conflict(
              'RECONCILED_PAYMENT',
              'A reconciled payment cannot be reversed. Record a correction instead.',
            );
          await tx.$executeRaw`
            UPDATE payments SET status = 'REVERSED', "reversedAt" = now(),
              "reversedById" = ${actor.userId}::uuid, "reversalReason" = ${reason}
            WHERE id = ${paymentId}::uuid AND "hospitalId" = ${hospitalId}::uuid`;
          await this.syncInvoiceStatus(tx, invoiceId, invoice.total);
        });
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });
    return this.detail(actor, paymentId);
  }

  // ------------------------------------------------------------------ accountant: TPA settlement (M-13)

  private async assertTpaMethod(tx: Tx): Promise<void> {
    const rows = await tx.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PaymentMethod' AND e.enumlabel = 'TPA_SETTLEMENT'`;
    if ((rows[0]?.n ?? 0) === 0)
      throw unavailable(
        'TPA_SETTLEMENT_PENDING',
        'Posting a TPA settlement to the balance waits for database migration M-13. Nothing was changed.',
      );
  }

  /**
   * Posts an approved claim's settlement to the invoice as a TPA payment and marks the claim settled,
   * in one transaction under the invoice lock (M-13 design, approved). Needs M-12 and M-13 installed.
   */
  async postTpaSettlement(actor: AuthPrincipal, claimId: string, settled: string): Promise<void> {
    const hospitalId = actor.hospitalId!;
    const amount = new Prisma.Decimal(settled);
    await withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          const claim = await tx.insuranceClaim.findFirst({
            where: { id: claimId, hospitalId },
            select: { invoiceId: true, status: true, claimAmount: true },
          });
          if (!claim) throw notFound('claim');
          const inv = await this.lockInvoice(tx, claim.invoiceId, hospitalId);
          await this.assertRules(tx);
          await this.assertTpaMethod(tx);
          if (claim.status !== 'APPROVED')
            throw conflict('CLAIM_NOT_APPROVED', 'Only an approved claim can be settled.');
          if (amount.lte(0) || amount.gt(claim.claimAmount))
            throw conflict(
              'SETTLEMENT_INVALID',
              'The settled amount must be above zero and no more than the claim amount.',
            );
          if (!PAYABLE.includes(inv.status))
            throw conflict(
              'NOT_PAYABLE',
              'The invoice is already paid in full; record the settlement for tracking only.',
            );
          if (await this.openOnline(tx, claim.invoiceId))
            throw conflict(
              'CHECKOUT_OPEN',
              'An online checkout is open for this invoice. Cancel it first.',
            );
          const { balance } = await this.paidAndBalance(tx, claim.invoiceId, inv.total);
          if (amount.gt(balance))
            throw conflict(
              'AMOUNT_EXCEEDS_BALANCE',
              `The balance is ₹${money(balance)}. Record the rest for tracking only.`,
            );
          // Raw SQL: TPA_SETTLEMENT is not in the generated Prisma enum until M-13 updates schema.prisma.
          await tx.$executeRaw`
            INSERT INTO payments (id, "hospitalId", "invoiceId", method, amount, status, "paidAt", "receivedById", "createdAt", "updatedAt")
            VALUES (${randomUUID()}::uuid, ${hospitalId}::uuid, ${claim.invoiceId}::uuid, 'TPA_SETTLEMENT'::"PaymentMethod",
                    ${money(amount)}::numeric, 'SUCCEEDED'::"PaymentStatus", now(), ${actor.userId}::uuid, now(), now())`;
          await tx.insuranceClaim.update({
            where: { id: claimId },
            data: { status: 'SETTLED', settledAmount: amount },
          });
          await this.syncInvoiceStatus(tx, claim.invoiceId, inv.total);
        });
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });
  }

  // ------------------------------------------------------------------ reads

  async detail(actor: AuthPrincipal, paymentId: string): Promise<PaymentDetailView> {
    const p = await this.db.client.payment.findFirst({
      where: { id: paymentId },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
    if (!p) throw notFound('payment');
    const open = p.status === 'PENDING' && isOnline(p.method);
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      invoiceNumber: p.invoice.invoiceNumber,
      method: p.method,
      status: p.status,
      amount: money(p.amount),
      checkoutOpen: open,
      testCheckout: open && this.adapter instanceof FakeProvider,
    };
  }

  /** Payments and balance of one invoice. Patients see their own issued invoice and received payments only. */
  async invoicePayments(actor: AuthPrincipal, invoiceId: string): Promise<InvoicePaymentsView> {
    const staff = STAFF_READ.includes(actor.role);
    const inv = await this.db.client.invoice.findFirst({
      where: { id: invoiceId, ...(await this.invoiceScope(actor)) },
      select: { id: true, status: true, total: true },
    });
    if (!inv) throw notFound('invoice');
    const rows = await this.db.client.payment.findMany({
      where: { invoiceId, ...(staff ? {} : { status: 'SUCCEEDED' }) },
      include: PAYMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const total = new Prisma.Decimal(inv.total);
    const paid = rows
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0));
    const open = staff ? rows.find((r) => r.status === 'PENDING' && isOnline(r.method)) : undefined;
    return {
      invoiceId,
      invoiceStatus: inv.status,
      total: money(total),
      paid: money(paid),
      balance: money(total.minus(paid)),
      openCheckoutId: open?.id ?? null,
      payments: rows.map((r) => toView(r, staff)),
    };
  }

  /** The signed-in patient's received payments across their issued invoices, newest first. */
  async myPayments(actor: AuthPrincipal): Promise<MyPaymentView[]> {
    const scope = await this.invoiceScope(actor);
    const invoices = await this.db.client.invoice.findMany({
      where: scope,
      select: { id: true, invoiceNumber: true },
    });
    if (invoices.length === 0) return [];
    const numberOf = new Map(invoices.map((i) => [i.id, i.invoiceNumber]));
    const rows = await this.db.client.payment.findMany({
      where: { invoiceId: { in: invoices.map((i) => i.id) }, status: 'SUCCEEDED' },
      include: PAYMENT_INCLUDE,
      orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map((r) => ({
      ...toView(r, false),
      invoiceId: r.invoiceId,
      invoiceNumber: numberOf.get(r.invoiceId) ?? null,
    }));
  }
}
