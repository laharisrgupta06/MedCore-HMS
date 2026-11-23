import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  TAX_DEFAULT_KINDS,
  TaxErrorCode,
  isValidGstin,
  rateToBasisPoints,
  type TaxDefaultKind,
  type TaxSettings,
} from '@medcore/types';
import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { isRetryable, mapDbRuleError, withRetry } from '../../common/http/db-rule-errors';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { localDate } from '../../common/time/zoned';

/**
 * Hospital tax settings (BILL-008, task 8-B2): classifications and dated versions, consultation and
 * lab defaults, GST registrations, set-up confirmation, and the classification of lab tests and
 * medicines. The database (M-11a) is the authority for every rule; this module locks the hospital
 * row first in every write (DEC-058), retries serialization conflicts a bounded number of times
 * (R-16), and translates refusals into clear errors.
 */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE = /^\d{1,2}(\.\d{1,2})?$/;
const uuid = new ParseUUIDPipe({ version: '4' });

const CHECKS = {
  tax_classifications_code_chk: {
    code: TaxErrorCode.HSN_SAC_INVALID,
    message:
      'Use a 4, 6 or 8 digit code: SAC codes (services) start with 99, HSN codes (goods) never do.',
  },
  tax_classifications_name_chk: {
    code: 'VALIDATION_ERROR',
    message: 'Enter a name of 1 to 120 characters.',
  },
  tax_classification_versions_rate_chk: {
    code: TaxErrorCode.RATE_INVALID,
    message:
      'Only a taxable treatment has a rate (above 0, at most 40); only a taxable price can include tax.',
  },
  hospital_gst_registrations_details_chk: {
    code: TaxErrorCode.GSTIN_INVALID,
    message: 'Check the GSTIN and legal name; an unregistered hospital has neither.',
  },
};

class CreateClassificationDto {
  @ApiProperty({ example: 'Medicaments, 12%' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;
  @ApiProperty({ enum: ['GOODS', 'SERVICE'] })
  @IsIn(['GOODS', 'SERVICE'])
  supplyType!: 'GOODS' | 'SERVICE';
  @ApiProperty({
    example: '3004',
    description: 'HSN (goods) or SAC (services, starts with 99); 4, 6 or 8 digits',
  })
  @Transform(trim)
  @Matches(/^(\d{4}|\d{6}|\d{8})$/, { message: 'hsnSac must be 4, 6 or 8 digits' })
  hsnSac!: string;
}

class UpdateClassificationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class VersionDto {
  @ApiProperty({ enum: ['EXEMPT', 'NIL_RATED', 'TAXABLE'] })
  @IsIn(['EXEMPT', 'NIL_RATED', 'TAXABLE'])
  treatment!: 'EXEMPT' | 'NIL_RATED' | 'TAXABLE';
  @ApiProperty({ example: '12', description: '0 unless TAXABLE; then above 0 and at most 40' })
  @Matches(RATE, { message: 'ratePercent must be a number with at most two decimals' })
  ratePercent!: string;
  @ApiProperty()
  @IsBoolean()
  priceIncludesTax!: boolean;
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'effectiveFrom must be a date (YYYY-MM-DD)' })
  effectiveFrom!: string;
}

class UpdateVersionDto {
  @ApiPropertyOptional({ enum: ['EXEMPT', 'NIL_RATED', 'TAXABLE'] })
  @IsOptional()
  @IsIn(['EXEMPT', 'NIL_RATED', 'TAXABLE'])
  treatment?: 'EXEMPT' | 'NIL_RATED' | 'TAXABLE';
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(RATE, { message: 'ratePercent must be a number with at most two decimals' })
  ratePercent?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE, { message: 'effectiveFrom must be a date (YYYY-MM-DD)' })
  effectiveFrom?: string;
}

class DefaultDto {
  @ApiProperty()
  @Matches(/^[0-9a-f-]{36}$/i, { message: 'classificationId must be an id' })
  classificationId!: string;
}

class RegistrationDto {
  @ApiProperty({ enum: ['REGULAR', 'COMPOSITION', 'UNREGISTERED'] })
  @IsIn(['REGULAR', 'COMPOSITION', 'UNREGISTERED'])
  registrationType!: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';
  @ApiPropertyOptional({ example: '27AAPFU0939F1ZV' })
  @ValidateIf((o: RegistrationDto) => o.registrationType !== 'UNREGISTERED')
  @Transform(upper)
  @IsString()
  gstin?: string;
  @ApiPropertyOptional({ example: 'CityCare Hospitals Private Limited' })
  @ValidateIf((o: RegistrationDto) => o.registrationType !== 'UNREGISTERED')
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  legalName?: string;
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'effectiveFrom must be a date (YYYY-MM-DD)' })
  effectiveFrom!: string;
}

class AssignDto {
  @ApiPropertyOptional({ nullable: true, description: 'null removes the classification' })
  @IsOptional()
  @ValidateIf((o: AssignDto) => o.classificationId !== null)
  @Matches(/^[0-9a-f-]{36}$/i, { message: 'classificationId must be an id or null' })
  classificationId!: string | null;
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class TaxService {
  constructor(private readonly db: TenantPrismaService) {}

  /** The hospital's tax date: its local date ten minutes ahead (the same rule as medcore_tax_date). */
  private taxDate(timezone: string): string {
    return localDate(new Date(Date.now() + 10 * 60_000), timezone);
  }

  /** One write transaction: hospital row locked first (DEC-058), rules translated, conflicts retried. */
  private write<T>(
    actor: AuthPrincipal,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withRetry(async () => {
      try {
        return await this.db.client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT 1 FROM hospitals WHERE id = ${actor.hospitalId}::uuid FOR NO KEY UPDATE`;
          return fn(tx);
        });
      } catch (e) {
        if (isRetryable(e) || e instanceof HttpException) throw e; // retried by withRetry, or already an API error
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          mapPrismaError(e, { conflict: 'This name or date is already used.' });
        }
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')
          throw notFound();
        mapDbRuleError(e, CHECKS);
      }
    });
  }

  /** 404 unless the classification belongs to this hospital (the client is tenant scoped). */
  private async ownClassification(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const c = await tx.taxClassification.findFirst({ where: { id }, select: { id: true } });
    if (!c) throw notFound('tax classification');
  }

  async settings(actor: AuthPrincipal): Promise<TaxSettings> {
    const db = this.db.client;
    const hospital = await db.hospital.findFirst({
      where: { id: actor.hospitalId! },
      select: { timezone: true, taxTimezoneLockedAt: true, taxSetupConfirmedAt: true },
    });
    if (!hospital) throw notFound('hospital');
    const taxDate = this.taxDate(hospital.timezone);
    const [classifications, defaults, registrations, rules] = await Promise.all([
      db.taxClassification.findMany({
        orderBy: [{ supplyType: 'asc' }, { name: 'asc' }],
        include: { versions: { orderBy: { effectiveFrom: 'asc' } } },
      }),
      db.hospitalTaxDefault.findMany({ orderBy: { kind: 'asc' } }),
      db.hospitalGstRegistration.findMany({ orderBy: { effectiveFrom: 'asc' } }),
      db.statutoryRoomTaxRule.findMany({ orderBy: { effectiveFrom: 'asc' } }),
    ]);
    const inForceId = <T extends { id: string; effectiveFrom: Date }>(rows: T[]) =>
      rows.filter((r) => ymd(r.effectiveFrom) <= taxDate).at(-1)?.id ?? null;
    const regInForce = inForceId(registrations);
    const defaultIds = new Set(defaults.map((d) => d.classificationId));
    return {
      taxDate,
      timezone: hospital.timezone,
      timezoneLocked: hospital.taxTimezoneLockedAt !== null,
      setupConfirmedAt: hospital.taxSetupConfirmedAt?.toISOString() ?? null,
      classifications: classifications.map((c) => {
        const current = inForceId(c.versions);
        return {
          id: c.id,
          name: c.name,
          supplyType: c.supplyType,
          hsnSac: c.hsnSac,
          isActive: c.isActive,
          usedAsDefault: defaultIds.has(c.id),
          versions: c.versions.map((v) => ({
            id: v.id,
            treatment: v.treatment,
            ratePercent: v.ratePercent.toFixed(2),
            priceIncludesTax: v.priceIncludesTax,
            effectiveFrom: ymd(v.effectiveFrom),
            inForce: v.id === current,
            editable: ymd(v.effectiveFrom) > taxDate,
          })),
        };
      }),
      defaults: defaults.map((d) => ({
        kind: d.kind as TaxDefaultKind,
        classificationId: d.classificationId,
      })),
      registrations: registrations.map((r) => ({
        id: r.id,
        registrationType: r.registrationType,
        gstin: r.gstin,
        legalName: r.legalName,
        stateCode: r.stateCode,
        effectiveFrom: ymd(r.effectiveFrom),
        inForce: r.id === regInForce,
        deletable: ymd(r.effectiveFrom) > taxDate,
      })),
      roomRules: rules.map((r) => ({
        effectiveFrom: ymd(r.effectiveFrom),
        thresholdPerDay: r.thresholdPerDay.toFixed(2),
        ratePercent: r.ratePercent.toFixed(2),
        sacCode: r.sacCode,
        legalReference: r.legalReference,
      })),
    };
  }

  async createClassification(
    actor: AuthPrincipal,
    dto: CreateClassificationDto,
  ): Promise<{ id: string }> {
    const isService = dto.hsnSac.startsWith('99');
    if (isService !== (dto.supplyType === 'SERVICE'))
      throw new BadRequestException(CHECKS.tax_classifications_code_chk);
    return this.write(actor, (tx) =>
      tx.taxClassification.create({
        data: { hospitalId: actor.hospitalId!, createdById: actor.userId, ...dto },
        select: { id: true },
      }),
    );
  }

  async updateClassification(
    actor: AuthPrincipal,
    id: string,
    dto: UpdateClassificationDto,
  ): Promise<{ id: string }> {
    return this.write(actor, async (tx) => {
      // Lock order (DEC-058): hospital row above, then this classification row.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tax_classifications WHERE id = ${id}::uuid AND "hospitalId" = ${actor.hospitalId}::uuid FOR NO KEY UPDATE`;
      if (!rows.length) throw notFound('tax classification');
      return tx.taxClassification.update({ where: { id }, data: dto, select: { id: true } });
    });
  }

  private checkRate(dto: { treatment?: string; ratePercent?: string }): void {
    if (dto.ratePercent === undefined) return;
    try {
      const bp = rateToBasisPoints(dto.ratePercent);
      if (dto.treatment === 'TAXABLE' ? bp === 0n : dto.treatment !== undefined && bp !== 0n)
        throw new Error('');
    } catch {
      throw new BadRequestException(CHECKS.tax_classification_versions_rate_chk);
    }
  }

  async addVersion(
    actor: AuthPrincipal,
    classificationId: string,
    dto: VersionDto,
  ): Promise<{ id: string }> {
    this.checkRate(dto);
    return this.write(actor, async (tx) => {
      const c = await tx.taxClassification.findFirst({
        where: { id: classificationId },
        select: { id: true },
      });
      if (!c) throw notFound('tax classification');
      return tx.taxClassificationVersion.create({
        data: {
          hospitalId: actor.hospitalId!,
          classificationId,
          createdById: actor.userId,
          treatment: dto.treatment,
          ratePercent: new Prisma.Decimal(dto.ratePercent),
          priceIncludesTax: dto.priceIncludesTax,
          effectiveFrom: day(dto.effectiveFrom),
        },
        select: { id: true },
      });
    });
  }

  async updateVersion(
    actor: AuthPrincipal,
    id: string,
    dto: UpdateVersionDto,
  ): Promise<{ id: string }> {
    this.checkRate(dto);
    return this.write(actor, async (tx) => {
      const v = await tx.taxClassificationVersion.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!v) throw notFound('tax version');
      return tx.taxClassificationVersion.update({
        where: { id },
        data: {
          ...(dto.treatment ? { treatment: dto.treatment } : {}),
          ...(dto.ratePercent !== undefined
            ? { ratePercent: new Prisma.Decimal(dto.ratePercent) }
            : {}),
          ...(dto.priceIncludesTax !== undefined ? { priceIncludesTax: dto.priceIncludesTax } : {}),
          ...(dto.effectiveFrom ? { effectiveFrom: day(dto.effectiveFrom) } : {}),
        },
        select: { id: true },
      });
    });
  }

  async deleteVersion(actor: AuthPrincipal, id: string): Promise<{ id: string; deleted: true }> {
    return this.write(actor, async (tx) => {
      const v = await tx.taxClassificationVersion.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!v) throw notFound('tax version');
      await tx.taxClassificationVersion.delete({ where: { id } });
      return { id, deleted: true as const };
    });
  }

  async setDefault(
    actor: AuthPrincipal,
    kind: TaxDefaultKind,
    dto: DefaultDto,
  ): Promise<{ kind: TaxDefaultKind; classificationId: string }> {
    await this.write(actor, async (tx) => {
      await this.ownClassification(tx, dto.classificationId);
      return tx.hospitalTaxDefault.upsert({
        where: { hospitalId_kind: { hospitalId: actor.hospitalId!, kind } },
        create: {
          hospitalId: actor.hospitalId!,
          kind,
          classificationId: dto.classificationId,
          updatedById: actor.userId,
        },
        update: { classificationId: dto.classificationId, updatedById: actor.userId },
      });
    });
    return { kind, classificationId: dto.classificationId };
  }

  async addRegistration(actor: AuthPrincipal, dto: RegistrationDto): Promise<{ id: string }> {
    const registered = dto.registrationType !== 'UNREGISTERED';
    if (registered && !isValidGstin(dto.gstin ?? ''))
      throw new BadRequestException(CHECKS.hospital_gst_registrations_details_chk);
    return this.write(actor, (tx) =>
      tx.hospitalGstRegistration.create({
        data: {
          hospitalId: actor.hospitalId!,
          attestedById: actor.userId,
          registrationType: dto.registrationType,
          gstin: registered ? dto.gstin! : null,
          legalName: registered ? dto.legalName! : null,
          stateCode: registered ? dto.gstin!.slice(0, 2) : null,
          effectiveFrom: day(dto.effectiveFrom),
        },
        select: { id: true },
      }),
    );
  }

  async deleteRegistration(
    actor: AuthPrincipal,
    id: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.write(actor, async (tx) => {
      const r = await tx.hospitalGstRegistration.findFirst({ where: { id }, select: { id: true } });
      if (!r) throw notFound('GST registration');
      await tx.hospitalGstRegistration.delete({ where: { id } });
      return { id, deleted: true as const };
    });
  }

  async confirm(actor: AuthPrincipal): Promise<{ setupConfirmedAt: string }> {
    return this.write(actor, async (tx) => {
      const kinds = (await tx.hospitalTaxDefault.findMany({ select: { kind: true } })).map(
        (d) => d.kind as string,
      );
      const missing = TAX_DEFAULT_KINDS.filter((k) => !kinds.includes(k));
      if (missing.length) {
        throw new BadRequestException({
          code: 'DEFAULTS_MISSING',
          message: `Choose a tax classification for ${missing.map((k) => k.toLowerCase()).join(' and ')} first.`,
        });
      }
      const h = await tx.hospital.update({
        where: { id: actor.hospitalId! },
        data: { taxSetupConfirmedAt: new Date(), taxSetupConfirmedById: actor.userId },
        select: { taxSetupConfirmedAt: true },
      });
      return { setupConfirmedAt: h.taxSetupConfirmedAt!.toISOString() };
    });
  }

  async assign(
    actor: AuthPrincipal,
    item: 'lab-tests' | 'medicines',
    id: string,
    dto: AssignDto,
  ): Promise<{ id: string; taxClassificationId: string | null }> {
    return this.write(actor, async (tx) => {
      const data = { taxClassificationId: dto.classificationId ?? null };
      if (data.taxClassificationId) await this.ownClassification(tx, data.taxClassificationId);
      const found =
        item === 'lab-tests'
          ? await tx.labTest.findFirst({ where: { id }, select: { id: true } })
          : await tx.medicine.findFirst({ where: { id }, select: { id: true } });
      if (!found) throw notFound(item === 'lab-tests' ? 'lab test' : 'medicine');
      if (item === 'lab-tests') await tx.labTest.update({ where: { id }, data });
      else await tx.medicine.update({ where: { id }, data });
      return { id, ...data };
    });
  }
}

@ApiTags('Tax settings')
@ApiBearerAuth()
@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('settings')
  @Roles('HOSPITAL_ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: "The hospital's tax settings (BILL-008)" })
  settings(@CurrentUser() a: AuthPrincipal) {
    return this.tax.settings(a);
  }

  @Post('classifications')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.classification.create', 'TaxClassification', ['supplyType', 'hsnSac'])
  createClassification(@CurrentUser() a: AuthPrincipal, @Body() dto: CreateClassificationDto) {
    return this.tax.createClassification(a, dto);
  }

  @Patch('classifications/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.classification.update', 'TaxClassification', ['isActive'])
  updateClassification(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateClassificationDto,
  ) {
    return this.tax.updateClassification(a, id, dto);
  }

  @Post('classifications/:id/versions')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.version.create', 'TaxClassificationVersion', [
    'treatment',
    'ratePercent',
    'priceIncludesTax',
    'effectiveFrom',
  ])
  addVersion(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: VersionDto,
  ) {
    return this.tax.addVersion(a, id, dto);
  }

  @Patch('versions/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.version.update', 'TaxClassificationVersion', [
    'treatment',
    'ratePercent',
    'priceIncludesTax',
    'effectiveFrom',
  ])
  updateVersion(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateVersionDto,
  ) {
    return this.tax.updateVersion(a, id, dto);
  }

  @Delete('versions/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.version.delete', 'TaxClassificationVersion')
  deleteVersion(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.tax.deleteVersion(a, id);
  }

  @Put('defaults/:kind')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.default.set', 'HospitalTaxDefault')
  setDefault(
    @CurrentUser() a: AuthPrincipal,
    @Param('kind') kind: string,
    @Body() dto: DefaultDto,
  ) {
    if (!(TAX_DEFAULT_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'kind must be CONSULTATION or LAB',
      });
    }
    return this.tax.setDefault(a, kind as TaxDefaultKind, dto);
  }

  @Post('registrations')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.registration.create', 'HospitalGstRegistration', [
    'registrationType',
    'effectiveFrom',
  ])
  addRegistration(@CurrentUser() a: AuthPrincipal, @Body() dto: RegistrationDto) {
    return this.tax.addRegistration(a, dto);
  }

  @Delete('registrations/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.registration.delete', 'HospitalGstRegistration')
  deleteRegistration(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.tax.deleteRegistration(a, id);
  }

  @Post('confirm')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.setup.confirm', 'Hospital')
  confirm(@CurrentUser() a: AuthPrincipal) {
    return this.tax.confirm(a);
  }

  @Put('assignments/lab-tests/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.assign.lab-test', 'LabTest')
  assignLabTest(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.tax.assign(a, 'lab-tests', id, dto);
  }

  @Put('assignments/medicines/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('tax.assign.medicine', 'Medicine')
  assignMedicine(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.tax.assign(a, 'medicines', id, dto);
  }
}

@Module({ controllers: [TaxController], providers: [TaxService], exports: [TaxService] })
export class TaxModule {}
