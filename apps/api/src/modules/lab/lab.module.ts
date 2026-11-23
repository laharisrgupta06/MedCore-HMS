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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import {
  CreateLabOrderDto,
  LabOrderQuery,
  LabTestDto,
  LabTestQuery,
  ReasonDto,
  ResultsDto,
  UpdateLabTestDto,
} from './lab.dto';
import { LabService } from './lab.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const sendPdf = (res: Response, f: { name: string; data: Buffer }) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
  res.send(f.data);
};

@ApiTags('Laboratory')
@ApiBearerAuth()
@Controller('lab-tests')
export class LabTestsController {
  constructor(private readonly lab: LabService) {}

  @Get()
  @Roles('HOSPITAL_ADMIN', 'DOCTOR', 'LAB_TECHNICIAN', 'RECEPTIONIST')
  @ApiOperation({ summary: 'Test catalogue with reference ranges' })
  list(@Query() q: LabTestQuery) {
    return this.lab.listTests(q);
  }

  @Post()
  @Roles('HOSPITAL_ADMIN')
  @Audit('lab_test.create', 'LabTest', ['category'])
  @ApiOperation({ summary: 'Add a test with its ranges (LAB-006)' })
  create(@CurrentUser() a: AuthPrincipal, @Body() dto: LabTestDto) {
    return this.lab.createTest(a, dto);
  }

  @Patch(':id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('lab_test.update', 'LabTest', ['isActive'])
  @ApiOperation({ summary: 'Edit a test; replacing ranges never changes past results (D8)' })
  update(@Param('id', uuid) id: string, @Body() dto: UpdateLabTestDto) {
    return this.lab.updateTest(id, dto);
  }
}

@ApiTags('Laboratory')
@ApiBearerAuth()
@Controller('lab-orders')
export class LabOrdersController {
  constructor(private readonly lab: LabService) {}

  @Post()
  @Roles('DOCTOR')
  @Audit('lab_order.create', 'LabOrder', ['priority'])
  @ApiOperation({ summary: 'Order tests in an open consultation (API-022, LAB-001, LAB-007)' })
  create(@CurrentUser() a: AuthPrincipal, @Body() dto: CreateLabOrderDto) {
    return this.lab.create(a, dto);
  }

  @Get()
  @Roles('DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PATIENT')
  @AuditRead('lab_order.list', 'LabOrder')
  @ApiOperation({ summary: 'Worklists and lists; patients see their own approved reports' })
  list(@CurrentUser() a: AuthPrincipal, @Query() q: LabOrderQuery) {
    return this.lab.list(a, q);
  }

  @Get(':id')
  @Roles('DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PATIENT')
  @AuditRead('lab_order.view', 'LabOrder')
  @ApiOperation({
    summary: 'One order; values only for the lab, or for clinicians and the patient once approved',
  })
  get(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.lab.get(a, id);
  }

  @Patch(':id/cancel')
  @Roles('DOCTOR')
  @Audit('lab_order.cancel', 'LabOrder')
  @ApiOperation({ summary: 'Cancel before sample collection, with a reason' })
  cancel(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.lab.cancel(a, id, dto);
  }

  @Patch(':id/sample')
  @Roles('RECEPTIONIST', 'LAB_TECHNICIAN')
  @Audit('lab_order.sample', 'LabOrder')
  @ApiOperation({ summary: 'Record sample collection (LAB-002)' })
  sample(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.lab.collectSample(a, id);
  }

  @Patch(':id/processing')
  @Roles('LAB_TECHNICIAN')
  @Audit('lab_order.processing', 'LabOrder')
  @ApiOperation({ summary: 'Start processing the sample' })
  processing(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.lab.startProcessing(a, id);
  }

  @Patch(':id/result')
  @Roles('LAB_TECHNICIAN')
  @Audit('lab_order.result', 'LabOrder', ['submit'])
  @ApiOperation({ summary: 'Enter results; submit sends for approval (API-023, LAB-003, LAB-006)' })
  result(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: ResultsDto) {
    return this.lab.enterResults(a, id, dto);
  }

  @Post(':id/report-file')
  @Roles('LAB_TECHNICIAN')
  @Audit('lab_order.report_file', 'LabOrder')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 + 1, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Attach the PDF report (radiology or analyser printout)' })
  attach(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() f?: { originalname: string; size: number; buffer: Buffer },
  ) {
    return this.lab.attachReport(a, id, f);
  }

  @Patch(':id/approve')
  @Roles('LAB_TECHNICIAN')
  @Audit('lab_order.approve', 'LabOrder')
  @ApiOperation({ summary: 'Approve: senior technician who entered none of the results (LAB-004)' })
  approve(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.lab.approve(a, id);
  }

  @Patch(':id/reject')
  @Roles('LAB_TECHNICIAN')
  @Audit('lab_order.reject', 'LabOrder')
  @ApiOperation({ summary: 'Send back to the technician with a reason (D7)' })
  reject(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.lab.reject(a, id, dto);
  }

  @Post(':id/amend')
  @Roles('LAB_TECHNICIAN')
  @Audit('lab_order.amend', 'LabOrder')
  @ApiOperation({ summary: 'Amend an approved report: a new order; the original stays unchanged' })
  amend(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.lab.amend(a, id, dto);
  }

  @Get(':id/report')
  @Roles('DOCTOR', 'NURSE', 'PATIENT', 'LAB_TECHNICIAN')
  @AuditRead('lab_order.report', 'LabOrder')
  @ApiOperation({ summary: 'Approved report PDF, out-of-range values flagged (LAB-005, LAB-006)' })
  async report(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.lab.reportPdf(a, id));
  }

  @Get(':id/report-file')
  @Roles('DOCTOR', 'NURSE', 'PATIENT', 'LAB_TECHNICIAN')
  @AuditRead('lab_order.report_file_view', 'LabOrder')
  @ApiOperation({
    summary: "The technician's attached PDF (after approval for clinicians and the patient)",
  })
  async reportFile(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.lab.reportFile(a, id));
  }
}

@Module({ controllers: [LabTestsController, LabOrdersController], providers: [LabService] })
export class LabModule {}
