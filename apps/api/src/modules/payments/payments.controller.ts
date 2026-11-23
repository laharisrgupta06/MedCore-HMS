import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  ONLINE_PAYMENT_METHODS,
  type OnlinePaymentMethod,
  type TestCheckoutOutcome,
} from '@medcore/types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import {
  CurrentUser,
  Public,
  Roles,
  SkipCsrf,
  type AuthPrincipal,
} from '../../common/auth/decorators';
import { notFound } from '../../common/http/prisma-errors';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from './receipts.service';

/** Payment routes (BILL-004; docs/permissions-matrix.csv). */
const uuid = new ParseUUIDPipe({ version: '4' });
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

class CashPaymentDto {
  @ApiProperty({ example: '500.00', description: 'Cash received now; at most the balance' })
  @Matches(MONEY, { message: 'amount must be an amount with at most two decimals' })
  amount!: string;
}

class CheckoutDto {
  @ApiProperty({ enum: ONLINE_PAYMENT_METHODS })
  @IsIn(ONLINE_PAYMENT_METHODS)
  method!: OnlinePaymentMethod;
}

class CancelCheckoutDto {
  @ApiPropertyOptional({ description: 'Why the checkout was cancelled (kept in the audit log)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason?: string;
}

class TestCheckoutDto {
  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED'] })
  @IsIn(['SUCCEEDED', 'FAILED'])
  outcome!: TestCheckoutOutcome;
}

class ReversePaymentDto {
  @ApiProperty({ description: 'Why the payment is reversed (kept in the audit log)' })
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  reason!: string;
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('invoices/:id/payments')
export class InvoicePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'PATIENT')
  @AuditRead('invoice.payments.view', 'Invoice')
  @ApiOperation({
    summary: 'Payments and balance of an invoice (patients: received payments only)',
  })
  view(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.payments.invoicePayments(a, id);
  }

  @Post('cash')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('payment.cash', 'Invoice', ['amount'])
  @ApiOperation({ summary: 'Record cash received (partial payments allowed)' })
  cash(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: CashPaymentDto,
  ) {
    return this.payments.recordCash(a, id, dto.amount);
  }

  @Post('checkout')
  @Roles('RECEPTIONIST')
  @Audit('payment.checkout.start', 'Invoice', ['method'])
  @ApiOperation({ summary: 'Open an online checkout for the whole balance' })
  checkout(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.payments.startCheckout(a, id, dto.method);
  }
}

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get('mine')
  @Roles('PATIENT')
  @AuditRead('payment.mine', 'Payment')
  @ApiOperation({ summary: "The signed-in patient's received payments" })
  mine(@CurrentUser() a: AuthPrincipal) {
    return this.payments.myPayments(a);
  }

  @Get(':id')
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN')
  @AuditRead('payment.view', 'Payment')
  @ApiOperation({ summary: 'One payment (staff)' })
  detail(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.payments.detail(a, id);
  }

  @Get(':id/receipt')
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'PATIENT')
  @AuditRead('payment.receipt.view', 'Payment')
  @ApiOperation({ summary: 'Receipt of a received payment (PDF, rendered from the record)' })
  async receipt(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ) {
    const r = await this.receipts.build(a, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.send(r.buffer);
  }

  @Post(':id/receipt/email')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('payment.receipt.email', 'Payment')
  @ApiOperation({ summary: "Email the receipt to the patient's account address" })
  emailReceipt(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.receipts.email(a, id);
  }

  @Post(':id/reverse')
  @Roles('ACCOUNTANT')
  @Audit('payment.reverse', 'Payment', ['reason'])
  @ApiOperation({ summary: 'Reverse a received payment (needs M-12; refused once reconciled)' })
  reverse(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: ReversePaymentDto,
  ) {
    return this.payments.reversePayment(a, id, dto.reason);
  }

  @Post(':id/cancel')
  @Roles('RECEPTIONIST')
  @Audit('payment.checkout.cancel', 'Payment', ['reason'])
  @ApiOperation({ summary: 'Cancel an open online checkout' })
  cancel(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() _dto: CancelCheckoutDto,
  ) {
    return this.payments.cancelCheckout(a, id);
  }

  @Post(':id/simulate')
  @Roles('RECEPTIONIST')
  @Audit('payment.test-checkout', 'Payment', ['outcome'])
  @ApiOperation({
    summary: 'Test checkout only (FakeProvider, development): simulate the provider answer',
  })
  simulate(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: TestCheckoutDto,
  ) {
    return this.payments.simulateCheckout(a, id, dto.outcome);
  }
}

/** Provider webhooks. Public: the signature is the only credential (verified in PaymentsService). */
@ApiTags('Payments')
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':provider')
  @Public()
  @SkipCsrf()
  @ApiOperation({ summary: 'Payment provider webhook (signature verified; idempotent)' })
  async receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (provider !== 'stripe' && provider !== 'razorpay') throw notFound('webhook');
    return this.payments.receiveWebhook(provider, { rawBody: req.rawBody, headers: req.headers });
  }
}
