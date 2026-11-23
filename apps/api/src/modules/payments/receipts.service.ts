import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PAYMENT_METHOD_LABEL } from '@medcore/types';
import { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { notFound } from '../../common/http/prisma-errors';
import { ownPatientId } from '../../common/tenancy/patient-identity';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { MAIL_ADAPTER, type MailAdapter } from '../../infra/messaging/messaging.types';
import { PdfService } from '../../infra/pdf/pdf.service';

const money = (d: Prisma.Decimal | string | number) => new Prisma.Decimal(d).toFixed(2);
const rupees = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

export interface BuiltReceipt {
  receiptNo: string;
  filename: string;
  buffer: Buffer;
  patientEmail: string;
  patientName: string;
  hospitalName: string;
  amount: string;
}

/**
 * Payment receipts (8-B5). A PDF is rendered on demand from the payment record, so it always matches
 * the database and needs no stored copy. Only a received payment has a receipt. Staff only for now:
 * patient access to receipts waits for the patient portal's payment view.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly pdf: PdfService,
    @Inject(MAIL_ADAPTER) private readonly mail: MailAdapter,
  ) {}

  async build(actor: AuthPrincipal, paymentId: string): Promise<BuiltReceipt> {
    const hospitalId = actor.hospitalId!;
    await this.assertAccess(actor, paymentId);
    const p = await this.db.client.payment.findFirst({
      where: { id: paymentId },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            total: true,
            patient: {
              select: {
                mrn: true,
                user: { select: { firstName: true, lastName: true, email: true } },
              },
            },
          },
        },
        receivedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!p) throw notFound('payment');
    if (p.status !== 'SUCCEEDED')
      throw new ConflictException({
        code: 'RECEIPT_UNAVAILABLE',
        message: 'A receipt is issued only for a received payment.',
      });
    const [hospital, paid] = await Promise.all([
      this.db.client.hospital.findFirst({ where: { id: hospitalId }, include: { address: true } }),
      this.db.client.payment.aggregate({
        where: { invoiceId: p.invoiceId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
    ]);
    if (!hospital) throw notFound('hospital');

    const u = p.invoice.patient.user;
    const patientName = `${u.firstName} ${u.lastName}`.trim();
    const receivedBy = p.receivedBy
      ? `${p.receivedBy.firstName} ${p.receivedBy.lastName}`.trim()
      : 'Online payment';
    const balance = new Prisma.Decimal(p.invoice.total).minus(paid._sum.amount ?? 0);
    const receiptNo = `RCPT-${p.id.slice(0, 8).toUpperCase()}`;
    const addr = hospital.address;
    const when = (p.paidAt ?? p.createdAt).toLocaleString('en-IN', {
      timeZone: hospital.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const buffer = await this.pdf.render(`Payment receipt ${receiptNo}`, (doc) => {
      this.pdf.letterhead(doc, {
        name: hospital.name,
        addressLines: addr
          ? [
              [addr.line1, addr.line2].filter(Boolean).join(', '),
              `${addr.city}, ${addr.state} ${addr.postalCode}`,
            ]
          : [],
        phone: hospital.phone ?? '',
        email: hospital.email ?? '',
        licenseNumber: hospital.licenseNumber ?? '',
      });
      doc.font('Helvetica-Bold').fontSize(13).text('Payment receipt');
      doc.moveDown(0.5);
      this.pdf.facts(doc, [
        ['Receipt number', receiptNo],
        ['Date received', when],
        ['Patient', `${patientName} (${p.invoice.patient.mrn})`],
        ['Invoice', p.invoice.invoiceNumber ?? 'Not numbered'],
        ['Payment method', PAYMENT_METHOD_LABEL[p.method]],
        ['Amount received', rupees(money(p.amount))],
        ['Received by', receivedBy],
        ['Balance due after this payment', rupees(money(balance))],
      ]);
      doc.moveDown(0.8);
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#5F665F')
        .text(
          'This receipt confirms the payment above. It is not a tax invoice; the tax invoice for this visit is issued separately.',
          { width: doc.page.width - 96 },
        );
    });

    return {
      receiptNo,
      filename: `${receiptNo}.pdf`,
      buffer,
      patientEmail: u.email,
      patientName,
      hospitalName: hospital.name,
      amount: money(p.amount),
    };
  }

  /**
   * A patient may read only the receipt of a received payment on their own issued invoice. The check
   * uses plain column matches and runs before anything is rendered; anything else is "not found".
   */
  private async assertAccess(actor: AuthPrincipal, paymentId: string): Promise<void> {
    if (actor.role !== 'PATIENT') return;
    const me = { id: await ownPatientId(this.db.client, actor, 'payment') };
    const pay = await this.db.client.payment.findFirst({
      where: { id: paymentId, status: 'SUCCEEDED' },
      select: { invoiceId: true },
    });
    const inv =
      me && pay
        ? await this.db.client.invoice.findFirst({
            where: {
              id: pay.invoiceId,
              patientId: me.id,
              status: { in: ['FINALISED', 'PARTIALLY_PAID', 'PAID'] },
            },
            select: { id: true },
          })
        : null;
    if (!inv) throw notFound('payment');
  }

  /** Emails the receipt to the patient's account address. Message bodies are never logged. */
  async email(actor: AuthPrincipal, paymentId: string): Promise<{ sentTo: string }> {
    const r = await this.build(actor, paymentId);
    try {
      await this.mail.send({
        to: r.patientEmail,
        subject: `Payment receipt ${r.receiptNo} from ${r.hospitalName}`,
        text:
          `Dear ${r.patientName},\n\n` +
          `Please find attached receipt ${r.receiptNo} for ${rupees(r.amount)} received by ${r.hospitalName}.\n\n` +
          'Thank you.',
        attachments: [{ filename: r.filename, content: r.buffer, contentType: 'application/pdf' }],
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'RECEIPT_EMAIL_FAILED',
        message: 'The receipt could not be emailed. Please try again.',
      });
    }
    return { sentTo: maskEmail(r.patientEmail) };
  }
}
