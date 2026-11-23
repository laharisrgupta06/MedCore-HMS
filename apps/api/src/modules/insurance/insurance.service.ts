import { ConflictException, Injectable } from '@nestjs/common';
import type { ClaimStatus, ClaimView, CreateClaimRequest } from '@medcore/types';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { withRetry } from '../../common/http/db-rule-errors';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { mapInvoiceDbError } from '../billing/invoice-db-errors';
import { PaymentsService } from '../payments/payments.service';

const money = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);
const INCLUDE = {
  invoice: {
    select: {
      invoiceNumber: true,
      patient: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.InsuranceClaimInclude;
type Row = Prisma.InsuranceClaimGetPayload<{ include: typeof INCLUDE }>;

function view(c: Row): ClaimView {
  const u = c.invoice.patient.user;
  return {
    id: c.id,
    invoiceId: c.invoiceId,
    invoiceNumber: c.invoice.invoiceNumber,
    patientName: `${u.firstName} ${u.lastName}`.trim(),
    tpaName: c.tpaName,
    policyNumber: c.policyNumber,
    claimAmount: money(c.claimAmount),
    status: c.status,
    settledAmount: c.settledAmount ? money(c.settledAmount) : null,
    notes: c.notes,
    submittedAt: c.submittedAt.toISOString(),
    decidedAt: c.decidedAt?.toISOString() ?? null,
  };
}

/**
 * Insurance claims through a TPA (PRD 7.7). Tracks submission, the decision and the settled amount.
 * A settlement is recorded for tracking only; it does not change the patient's balance until the
 * TPA payment method is approved (M-13). Staff only.
 */
@Injectable()
export class InsuranceService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly payments: PaymentsService,
  ) {}

  async forInvoice(invoiceId: string): Promise<ClaimView[]> {
    const inv = await this.db.client.invoice.findFirst({
      where: { id: invoiceId },
      select: { id: true },
    });
    if (!inv) throw notFound('invoice');
    const rows = await this.db.client.insuranceClaim.findMany({
      where: { invoiceId },
      include: INCLUDE,
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(view);
  }

  async get(id: string): Promise<ClaimView> {
    const c = await this.db.client.insuranceClaim.findFirst({ where: { id }, include: INCLUDE });
    if (!c) throw notFound('claim');
    return view(c);
  }

  async list(status?: ClaimStatus): Promise<ClaimView[]> {
    const rows = await this.db.client.insuranceClaim.findMany({
      where: status ? { status } : {},
      include: INCLUDE,
      orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map(view);
  }

  /** Creates a claim on an issued invoice, under a share lock so the invoice cannot be voided meanwhile. */
  async create(
    actor: AuthPrincipal,
    invoiceId: string,
    dto: CreateClaimRequest,
  ): Promise<ClaimView> {
    const hospitalId = actor.hospitalId!;
    const amount = new Prisma.Decimal(dto.claimAmount);
    if (amount.lte(0))
      throw new ConflictException({
        code: 'AMOUNT_INVALID',
        message: 'Enter a claim amount greater than zero.',
      });
    const id = await withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ status: string; total: string }[]>`
            SELECT status::text AS status, total::text AS total FROM invoices
            WHERE id = ${invoiceId}::uuid AND "hospitalId" = ${hospitalId}::uuid FOR SHARE`;
          const inv = rows[0];
          if (!inv) throw notFound('invoice');
          if (!['FINALISED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status))
            throw new ConflictException({
              code: 'CLAIM_NOT_ALLOWED',
              message: 'A claim can be made only on an issued invoice.',
            });
          if (amount.gt(new Prisma.Decimal(inv.total)))
            throw new ConflictException({
              code: 'CLAIM_EXCEEDS_TOTAL',
              message: 'The claim cannot be more than the invoice total.',
            });
          const c = await tx.insuranceClaim.create({
            data: {
              hospitalId,
              invoiceId,
              tpaName: dto.tpaName,
              policyNumber: dto.policyNumber,
              claimAmount: amount,
              notes: dto.notes?.trim() || null,
              status: 'SUBMITTED',
            },
            select: { id: true },
          });
          return c.id;
        });
      } catch (e) {
        mapInvoiceDbError(e);
      }
    });
    return this.get(id);
  }

  /** Approves or rejects a submitted claim. The status check is part of the update, so two decisions cannot both win. */
  async decide(
    actor: AuthPrincipal,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<ClaimView> {
    const r = await this.db.client.insuranceClaim.updateMany({
      where: { id, hospitalId: actor.hospitalId!, status: 'SUBMITTED' },
      data: { status: decision, decidedAt: new Date() },
    });
    if (r.count === 0)
      await this.refuse(
        id,
        'CLAIM_NOT_SUBMITTED',
        'Only a submitted claim can be approved or rejected.',
      );
    return this.get(id);
  }

  /**
   * Records a settlement. With postToBalance the amount is also posted to the invoice as a TPA payment
   * (needs M-12 and M-13); without it the settlement is tracked on the claim only.
   */
  async settle(
    actor: AuthPrincipal,
    id: string,
    settled: string,
    postToBalance = false,
  ): Promise<ClaimView> {
    if (postToBalance) {
      await this.payments.postTpaSettlement(actor, id, settled);
      return this.get(id);
    }
    const amount = new Prisma.Decimal(settled);
    const c = await this.db.client.insuranceClaim.findFirst({
      where: { id },
      select: { claimAmount: true, status: true },
    });
    if (!c) throw notFound('claim');
    if (c.status !== 'APPROVED')
      throw new ConflictException({
        code: 'CLAIM_NOT_APPROVED',
        message: 'Only an approved claim can be settled.',
      });
    if (amount.lte(0) || amount.gt(c.claimAmount))
      throw new ConflictException({
        code: 'SETTLEMENT_INVALID',
        message: 'The settled amount must be above zero and no more than the claim amount.',
      });
    const r = await this.db.client.insuranceClaim.updateMany({
      where: { id, hospitalId: actor.hospitalId!, status: 'APPROVED' },
      data: { status: 'SETTLED', settledAmount: amount },
    });
    if (r.count === 0)
      throw new ConflictException({
        code: 'CLAIM_NOT_APPROVED',
        message: 'The claim changed before it could be settled. Refresh and try again.',
      });
    return this.get(id);
  }

  private async refuse(id: string, code: string, message: string): Promise<never> {
    const exists = await this.db.client.insuranceClaim.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw notFound('claim');
    throw new ConflictException({ code, message });
  }
}
