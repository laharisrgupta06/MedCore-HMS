import { Global, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthPrincipal } from '../../common/auth/decorators';
import { BillingModule } from './billing.module';
import { BillingService, type AutomaticCharge } from './billing.service';

/**
 * How clinical modules bill a rendered service (Q4 A, task 8-B4): inside their own transaction, so
 * the service and its charge commit together. Provided globally by ChargesModule (the real billing
 * service); the HTTP unit tests provide a recorder instead (their in-memory database has no M-11b
 * triggers; the billing rules are tested against PostgreSQL).
 */
export const CHARGE_RECORDER = Symbol('CHARGE_RECORDER');

export interface ChargeRecorder {
  charge(tx: Prisma.TransactionClient, actor: AuthPrincipal, c: AutomaticCharge): Promise<void>;
  releaseLabCharges(
    tx: Prisma.TransactionClient,
    actor: AuthPrincipal,
    labOrderItemIds: string[],
  ): Promise<void>;
}

@Global()
@Module({
  imports: [BillingModule],
  providers: [{ provide: CHARGE_RECORDER, useExisting: BillingService }],
  exports: [CHARGE_RECORDER],
})
export class ChargesModule {}
