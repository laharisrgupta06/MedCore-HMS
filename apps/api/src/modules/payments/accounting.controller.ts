import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  PAYMENT_METHODS,
  RECONCILIATION_STATES,
  type PaymentMethod,
  type ReconciliationState,
} from '@medcore/types';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { AccountingService } from './accounting.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class ReconciliationQueryDto {
  @ApiProperty({ example: '2026-11-01' })
  @Matches(DAY, { message: 'from must be a date (YYYY-MM-DD)' })
  from!: string;

  @ApiProperty({ example: '2026-11-22' })
  @Matches(DAY, { message: 'to must be a date (YYYY-MM-DD)' })
  to!: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: RECONCILIATION_STATES })
  @IsOptional()
  @IsIn(RECONCILIATION_STATES)
  state?: ReconciliationState;
}

class MarkReconciledDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  paymentIds!: string[];
}

/** Reconciliation and the accountant's summary (8-B5). */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('reconciliation')
  @Roles('ACCOUNTANT', 'HOSPITAL_ADMIN')
  @AuditRead('reconciliation.view', 'Payment')
  @ApiOperation({
    summary: 'Received payments in a date range, with totals and reconciliation state',
  })
  reconciliation(@CurrentUser() a: AuthPrincipal, @Query() q: ReconciliationQueryDto) {
    return this.accounting.reconciliation(a, {
      from: q.from,
      to: q.to,
      method: q.method,
      state: q.state ?? 'all',
    });
  }

  @Post('reconciliation/mark')
  @Roles('ACCOUNTANT')
  @Audit('reconciliation.mark', 'Payment', ['paymentIds'])
  @ApiOperation({ summary: 'Mark received payments as reconciled' })
  mark(@CurrentUser() a: AuthPrincipal, @Body() dto: MarkReconciledDto) {
    return this.accounting.markReconciled(a, dto.paymentIds);
  }

  @Get('billing/summary')
  @Roles('ACCOUNTANT', 'HOSPITAL_ADMIN')
  @AuditRead('billing.summary.view', 'Payment')
  @ApiOperation({
    summary: "The accountant's day: collections, outstanding balances, reconciliation, claims",
  })
  summary(@CurrentUser() a: AuthPrincipal) {
    return this.accounting.summary(a);
  }
}
