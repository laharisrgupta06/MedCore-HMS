import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import {
  CancelPrescriptionDto,
  IssuePrescriptionDto,
  PrescriptionQuery,
} from './prescriptions.dto';
import { PrescriptionsService } from './prescriptions.service';

const uuid = new ParseUUIDPipe({ version: '4' });
/** Clinical readers (API-019 boundary) plus the pharmacy, which fulfils prescriptions. */
const READERS = ['DOCTOR', 'NURSE', 'PHARMACIST', 'PATIENT'] as const;

@ApiTags('Prescriptions')
@ApiBearerAuth()
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly rx: PrescriptionsService) {}

  @Post()
  @Roles('DOCTOR')
  @Audit('prescription.issue', 'Prescription')
  @ApiOperation({ summary: 'Issue a prescription in an open consultation (API-020, RX-001)' })
  issue(@CurrentUser() a: AuthPrincipal, @Body() dto: IssuePrescriptionDto) {
    return this.rx.issue(a, dto);
  }

  @Get()
  @Roles(...READERS)
  @AuditRead('prescription.list', 'Prescription')
  @ApiOperation({ summary: 'Prescriptions; patients see only their own' })
  list(@CurrentUser() a: AuthPrincipal, @Query() q: PrescriptionQuery) {
    return this.rx.list(a, q);
  }

  @Get(':id')
  @Roles(...READERS)
  @AuditRead('prescription.view', 'Prescription')
  @ApiOperation({ summary: 'One prescription with dispensed quantities' })
  get(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.rx.get(a, id);
  }

  @Patch(':id/cancel')
  @Roles('DOCTOR')
  @Audit('prescription.cancel', 'Prescription')
  @ApiOperation({ summary: 'Cancel with a reason before any dispensing (DEC-040 D3)' })
  cancel(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: CancelPrescriptionDto,
  ) {
    return this.rx.cancel(a, id, dto);
  }

  @Get(':id/pdf')
  @Roles('DOCTOR', 'PHARMACIST', 'PATIENT')
  @AuditRead('prescription.pdf', 'Prescription')
  @ApiOperation({ summary: 'Signed prescription PDF (API-021, RX-002)' })
  async pdf(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Res() res: Response) {
    const f = await this.rx.pdfFile(a, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.send(f.data);
  }

  @Post(':id/pdf')
  @Roles('DOCTOR')
  @Audit('prescription.pdf_retry', 'Prescription')
  @ApiOperation({ summary: 'Request the PDF again after a failed render' })
  retry(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.rx.retryPdf(a, id);
  }
}

@Module({
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
  exports: [PrescriptionsService],
})
export class PrescriptionsModule {}
