import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  CORRECTION_REQUEST_KINDS,
  INVOICE_STATUSES,
  type CorrectionRequestKind,
} from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { PageQuery } from '../../common/dto/fields';
import { BillingService } from './billing.service';

/** Invoice routes (API-021..023 and the Phase 8 additions; docs/permissions-matrix.csv). */
const uuid = new ParseUUIDPipe({ version: '4' });
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

class CreateInvoiceDto {
  @ApiProperty()
  @IsUUID('4')
  appointmentId!: string;
}

class AddLineDto {
  @ApiProperty({ enum: ['ROOM', 'OTHER'] })
  @IsIn(['ROOM', 'OTHER'])
  kind!: 'ROOM' | 'OTHER';
  @ApiPropertyOptional({ description: 'ROOM: the room charged' })
  @ValidateIf((o: AddLineDto) => o.kind === 'ROOM')
  @IsUUID('4')
  roomId?: string;
  @ApiPropertyOptional({ description: 'ROOM: number of days (1 to 366)' })
  @ValidateIf((o: AddLineDto) => o.kind === 'ROOM')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;
  @ApiPropertyOptional({ description: 'OTHER: what is charged' })
  @ValidateIf((o: AddLineDto) => o.kind === 'OTHER')
  @Transform(trim)
  @IsString()
  @Length(1, 300)
  description?: string;
  @ApiPropertyOptional({ description: 'OTHER: an active tax classification' })
  @ValidateIf((o: AddLineDto) => o.kind === 'OTHER')
  @IsUUID('4')
  classificationId?: string;
  @ApiPropertyOptional({ example: '250.00' })
  @ValidateIf((o: AddLineDto) => o.kind === 'OTHER')
  @Matches(MONEY, { message: 'unitPrice must be an amount with at most two decimals' })
  unitPrice?: string;
  @ApiPropertyOptional()
  @ValidateIf((o: AddLineDto) => o.kind === 'OTHER')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;
  @ApiProperty({ example: '2026-11-19' })
  @Matches(DATE, { message: 'serviceDate must be a date (YYYY-MM-DD)' })
  serviceDate!: string;
}

class DiscountDto {
  @ApiProperty({ example: '62.00', description: '0 removes the discount' })
  @Matches(MONEY, { message: 'amount must be an amount with at most two decimals' })
  amount!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason?: string;
}

class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

class CorrectionRequestDto {
  @ApiProperty({ enum: CORRECTION_REQUEST_KINDS })
  @IsIn(CORRECTION_REQUEST_KINDS)
  kind!: CorrectionRequestKind;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(10, 2000)
  description!: string;
}

class CorrectionNoteDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 2000)
  note!: string;
  @ApiPropertyOptional({ example: 'CN-2026-0012' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  externalReference?: string;
}

class InvoiceQuery extends PageQuery {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  patientId?: string;
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(DATE)
  from?: string;
  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

const LINE_FIELDS = ['kind', 'days', 'quantity', 'unitPrice', 'serviceDate'];

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'PATIENT')
  @ApiOperation({ summary: 'Invoices (patients: their own issued documents)' })
  list(@CurrentUser() a: AuthPrincipal, @Query() q: InvoiceQuery) {
    return this.billing.list(a, q);
  }

  @Get(':id')
  @Roles('RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN', 'PATIENT')
  @AuditRead('invoice.view', 'Invoice')
  get(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.billing.get(a, id);
  }

  @Post()
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.create', 'Invoice')
  create(@CurrentUser() a: AuthPrincipal, @Body() dto: CreateInvoiceDto) {
    return this.billing.createDraft(a, dto.appointmentId);
  }

  @Post(':id/late-charges')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.late-charges.create', 'Invoice')
  lateCharges(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.billing.createLateCharges(a, id);
  }

  @Post(':id/items')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.line.add', 'Invoice', LINE_FIELDS)
  addLine(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: AddLineDto) {
    return this.billing.addLine(
      a,
      id,
      dto.kind === 'ROOM'
        ? { kind: 'ROOM', roomId: dto.roomId!, days: dto.days!, serviceDate: dto.serviceDate }
        : {
            kind: 'OTHER',
            description: dto.description!,
            classificationId: dto.classificationId!,
            unitPrice: dto.unitPrice!,
            quantity: dto.quantity!,
            serviceDate: dto.serviceDate,
          },
    );
  }

  @Delete(':id/items/:itemId')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.line.remove', 'Invoice')
  removeLine(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
  ) {
    return this.billing.removeLine(a, id, itemId);
  }

  @Post(':id/reresolve-tax')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.reresolve', 'Invoice')
  reresolve(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.billing.reresolve(a, id);
  }

  @Patch(':id/discount')
  @Roles('ACCOUNTANT')
  @Audit('invoice.discount', 'Invoice', ['amount'])
  discount(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: DiscountDto,
  ) {
    return this.billing.setDiscount(a, id, dto.amount, dto.reason ?? null);
  }

  @Patch(':id/finalise')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.finalise', 'Invoice')
  finalise(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.billing.finalise(a, id);
  }

  @Patch(':id/void')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.void', 'Invoice')
  void(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.billing.void(a, id, dto.reason);
  }

  @Post(':id/correction-requests')
  @Roles('RECEPTIONIST', 'ACCOUNTANT')
  @Audit('invoice.correction-request', 'Invoice', ['kind'])
  correction(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: CorrectionRequestDto,
  ) {
    return this.billing.requestCorrection(a, id, dto.kind, dto.description);
  }

  @Post(':id/correction-requests/:rid/notes')
  @Roles('ACCOUNTANT')
  @Audit('invoice.correction-note', 'Invoice')
  note(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('rid', uuid) rid: string,
    @Body() dto: CorrectionNoteDto,
  ) {
    return this.billing.addCorrectionNote(a, id, rid, dto.note, dto.externalReference ?? null);
  }
}

@Module({
  controllers: [InvoicesController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
