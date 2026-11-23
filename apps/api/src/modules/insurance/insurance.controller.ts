import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { CLAIM_STATUSES, type ClaimStatus } from '@medcore/types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { InsuranceService } from './insurance.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

class CreateClaimDto {
  @ApiProperty({ example: 'Star Health TPA' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  tpaName!: string;

  @ApiProperty({ example: 'POL-99120' })
  @Transform(trim)
  @Matches(/^[A-Za-z0-9/-]{3,60}$/, { message: 'policyNumber may use letters, digits, / and -' })
  policyNumber!: string;

  @ApiProperty({ example: '4500.00' })
  @Matches(MONEY, { message: 'claimAmount must be an amount with at most two decimals' })
  claimAmount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  notes?: string;
}

class ClaimDecisionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';
}

class SettleClaimDto {
  @ApiProperty({ example: '4200.00' })
  @Matches(MONEY, { message: 'settledAmount must be an amount with at most two decimals' })
  settledAmount!: string;

  @ApiPropertyOptional({
    description: 'Also post the amount to the invoice balance (needs M-12 and M-13)',
  })
  @IsOptional()
  @IsBoolean()
  postToBalance?: boolean;
}

class ClaimListQuery {
  @ApiPropertyOptional({ enum: CLAIM_STATUSES })
  @IsOptional()
  @IsIn(CLAIM_STATUSES)
  status?: ClaimStatus;
}

@ApiTags('Insurance')
@ApiBearerAuth()
@Controller('invoices/:id/claims')
export class InvoiceClaimsController {
  constructor(private readonly insurance: InsuranceService) {}

  @Get()
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN')
  @AuditRead('claim.list', 'InsuranceClaim')
  @ApiOperation({ summary: 'Insurance claims on an invoice' })
  list(@CurrentUser() _a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.insurance.forInvoice(id);
  }

  @Post()
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('claim.create', 'InsuranceClaim', ['tpaName', 'claimAmount'])
  @ApiOperation({ summary: 'Submit an insurance claim on an issued invoice' })
  create(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: CreateClaimDto,
  ) {
    return this.insurance.create(a, id, dto);
  }
}

@ApiTags('Insurance')
@ApiBearerAuth()
@Controller('claims')
export class ClaimsController {
  constructor(private readonly insurance: InsuranceService) {}

  @Get()
  @Roles('ACCOUNTANT', 'HOSPITAL_ADMIN')
  @AuditRead('claim.queue', 'InsuranceClaim')
  @ApiOperation({ summary: 'Claims queue, optionally by status' })
  list(@CurrentUser() _a: AuthPrincipal, @Query() q: ClaimListQuery) {
    return this.insurance.list(q.status);
  }

  @Patch(':id/decision')
  @Roles('ACCOUNTANT')
  @Audit('claim.decision', 'InsuranceClaim', ['decision'])
  @ApiOperation({ summary: 'Approve or reject a submitted claim' })
  decide(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: ClaimDecisionDto,
  ) {
    return this.insurance.decide(a, id, dto.decision);
  }

  @Post(':id/settle')
  @Roles('ACCOUNTANT')
  @Audit('claim.settle', 'InsuranceClaim', ['settledAmount'])
  @ApiOperation({
    summary:
      'Record the settled amount of an approved claim; optionally post it to the balance (M-13)',
  })
  settle(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: SettleClaimDto,
  ) {
    return this.insurance.settle(a, id, dto.settledAmount, dto.postToBalance ?? false);
  }
}
