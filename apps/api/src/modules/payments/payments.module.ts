import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { createPaymentAdapter } from './providers/create-payment-adapter';
import { PAYMENT_ADAPTER } from './providers/payment-adapter';
import {
  InvoicePaymentsController,
  PaymentWebhooksController,
  PaymentsController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from './receipts.service';

/** Cash, online checkout, reversals, receipts, reconciliation and the accountant summary (tasks 8-B5, 8-B6). */
@Module({
  controllers: [
    InvoicePaymentsController,
    PaymentsController,
    PaymentWebhooksController,
    AccountingController,
  ],
  providers: [
    PaymentsService,
    ReceiptsService,
    AccountingService,
    {
      provide: PAYMENT_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createPaymentAdapter(config),
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
