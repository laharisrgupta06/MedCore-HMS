import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { MAX_CLINICAL_FILE_BYTES, type PatientHistory } from '@medcore/types';
import type { Response } from 'express';
import { Audit, AuditRead } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import {
  AllergyDto,
  ChartQuery,
  DiagnosisDto,
  EntryDto,
  FamilyHistoryDto,
  HistoryStatusDto,
  Icd10Query,
  MedicationDto,
  StartEncounterDto,
  UpdateRecordDto,
  VaccinationDto,
  VitalsDto,
} from './emr.dto';
import { EmrService, type UploadedFile as Upload } from './emr.service';

const uuid = new ParseUUIDPipe({ version: '4' });
/** API-019: Doctor / Nurse / Patient (own). Hospital admins and other staff have no clinical access. */
const READERS = ['DOCTOR', 'NURSE', 'PATIENT'] as const;

@ApiTags('Medical records')
@ApiBearerAuth()
@Controller('medical-records')
export class MedicalRecordsController {
  constructor(private readonly emr: EmrService) {}

  @Post()
  @Roles('DOCTOR')
  @Audit('medical_record.start', 'MedicalRecord')
  @ApiOperation({ summary: 'Start the consultation: creates the record (API-018, EMR-001)' })
  start(@CurrentUser() a: AuthPrincipal, @Body() dto: StartEncounterDto) {
    return this.emr.start(a, dto);
  }

  @Get('record/:id')
  @Roles(...READERS)
  @AuditRead('medical_record.view', 'MedicalRecord')
  @ApiOperation({ summary: 'One encounter record' })
  get(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.emr.get(a, id);
  }

  @Patch('record/:id')
  @Roles('DOCTOR')
  @Audit('medical_record.update', 'MedicalRecord')
  @ApiOperation({
    summary: 'Complaint, symptoms and treatment plan while the consultation is open',
  })
  update(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateRecordDto,
  ) {
    return this.emr.update(a, id, dto);
  }

  @Post('record/:id/entries')
  @Roles('DOCTOR')
  @Audit('medical_record.entry', 'MedicalRecord')
  @ApiOperation({ summary: 'Add a note, an addendum, or a correction of a note (EMR-002)' })
  entry(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: EntryDto) {
    return this.emr.addEntry(a, id, dto);
  }

  @Post('record/:id/vitals')
  @Roles('DOCTOR', 'NURSE')
  @Audit('medical_record.vitals', 'MedicalRecord')
  @ApiOperation({ summary: 'Record vitals or correct a reading (EMR-003)' })
  vitals(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @Body() dto: VitalsDto) {
    return this.emr.addVitals(a, id, dto);
  }

  @Post('record/:id/diagnoses')
  @Roles('DOCTOR')
  @Audit('medical_record.diagnosis', 'MedicalRecord')
  @ApiOperation({ summary: 'Add or correct a diagnosis (EMR-005)' })
  diagnosis(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: DiagnosisDto,
  ) {
    return this.emr.addDiagnosis(a, id, dto);
  }

  @Post('record/:id/files')
  @Roles('DOCTOR', 'NURSE')
  @Audit('medical_record.file', 'MedicalRecord')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_CLINICAL_FILE_BYTES + 1, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Attach a scanned document or image, max 20 MB (EMR-010)' })
  file(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string, @UploadedFile() f?: Upload) {
    return this.emr.addFile(a, id, f);
  }

  @Get(':patientId')
  @Roles(...READERS)
  @AuditRead('medical_record.chart_view', 'Patient')
  @ApiOperation({ summary: "A patient's records, newest first (API-019)" })
  chart(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) patientId: string,
    @Query() q: ChartQuery,
  ) {
    return this.emr.chart(a, patientId, q.page, q.limit);
  }
}

@ApiTags('Medical records')
@ApiBearerAuth()
@Controller('files')
export class ClinicalFilesController {
  constructor(private readonly emr: EmrService) {}

  @Get(':id')
  @Roles(...READERS)
  @AuditRead('medical_record.file_view', 'FileAttachment')
  @ApiOperation({ summary: 'Download a record attachment' })
  async download(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ) {
    const f = await this.emr.file(a, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
    res.send(f.data);
  }
}

const HISTORY_LISTS = {
  allergies: 'allergies',
  medications: 'medications',
  vaccinations: 'vaccinations',
  'family-history': 'family-history',
} as const;
const kindOf = (k: string) =>
  (k === 'family-history' ? 'familyHistory' : k) as
    'allergies' | 'medications' | 'vaccinations' | 'familyHistory';

/** Patient-level history: allergies and reactions, medications, vaccinations, family history (EMR-007..009, 011). */
@ApiTags('Medical records')
@ApiBearerAuth()
@Controller('patients/:patientId')
export class PatientHistoryController {
  constructor(private readonly emr: EmrService) {}

  @Get('history')
  @Roles(...READERS)
  @AuditRead('patient_history.view', 'Patient')
  @ApiOperation({ summary: 'Allergies, medications, vaccinations and family history' })
  history(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) p: string,
  ): Promise<PatientHistory> {
    return this.emr.history(a, p);
  }

  @Post('allergies')
  @Roles('DOCTOR', 'NURSE')
  @Audit('patient_history.allergy', 'Patient')
  @ApiOperation({ summary: 'Record an allergy or adverse drug reaction, or correct one (EMR-007)' })
  allergy(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) p: string,
    @Body() dto: AllergyDto,
  ) {
    return this.emr.addHistory(a, p, 'allergies', dto);
  }

  @Post('medications')
  @Roles('DOCTOR', 'NURSE')
  @Audit('patient_history.medication', 'Patient')
  @ApiOperation({ summary: 'Record a medication, including ones prescribed elsewhere (EMR-011)' })
  medication(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) p: string,
    @Body() dto: MedicationDto,
  ) {
    return this.emr.addHistory(a, p, 'medications', dto);
  }

  @Post('vaccinations')
  @Roles('DOCTOR', 'NURSE')
  @Audit('patient_history.vaccination', 'Patient')
  @ApiOperation({ summary: 'Record a vaccination (EMR-008)' })
  vaccination(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) p: string,
    @Body() dto: VaccinationDto,
  ) {
    return this.emr.addHistory(a, p, 'vaccinations', dto);
  }

  @Post('family-history')
  @Roles('DOCTOR', 'NURSE')
  @Audit('patient_history.family', 'Patient')
  @ApiOperation({ summary: 'Record a family history flag (EMR-009)' })
  family(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) p: string,
    @Body() dto: FamilyHistoryDto,
  ) {
    return this.emr.addHistory(a, p, 'familyHistory', dto);
  }

  @Patch(':kind/:entryId/status')
  @Roles('DOCTOR', 'NURSE')
  @Audit('patient_history.status', 'Patient', ['status'])
  @ApiParam({ name: 'kind', enum: Object.keys(HISTORY_LISTS) })
  @ApiOperation({ summary: 'Mark an entry resolved, or entered in error (with reason)' })
  status(
    @CurrentUser() a: AuthPrincipal,
    @Param('patientId', uuid) p: string,
    @Param('kind', new ParseEnumPipe(HISTORY_LISTS)) kind: keyof typeof HISTORY_LISTS,
    @Param('entryId', uuid) entryId: string,
    @Body() dto: HistoryStatusDto,
  ) {
    return this.emr.setHistoryStatus(a, p, kindOf(kind), entryId, dto);
  }
}

@ApiTags('Medical records')
@ApiBearerAuth()
@Controller('icd10')
export class Icd10Controller {
  constructor(private readonly emr: EmrService) {}

  @Get()
  @Roles('DOCTOR', 'NURSE')
  @ApiOperation({ summary: 'Search the ICD-10 code list by code or title (EMR-005)' })
  search(@Query() q: Icd10Query) {
    return this.emr.searchIcd10(q.search);
  }
}

@Module({
  controllers: [
    MedicalRecordsController,
    ClinicalFilesController,
    PatientHistoryController,
    Icd10Controller,
  ],
  providers: [EmrService],
})
export class EmrModule {}
