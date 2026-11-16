import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type { Doctor as DoctorView } from '@medcore/types';
import type { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { Email, PageQuery, PersonName, Phone, Text, trim } from '../../common/dto/fields';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';

class DoctorProfileFields {
  @Text(200) qualification?: string | null;
  @Text(2000) bio?: string | null;
}

export class CreateDoctorDto extends DoctorProfileFields {
  @PersonName('firstName') firstName!: string;
  @PersonName('lastName') lastName!: string;
  @Email() email!: string;
  @Phone() phone?: string | null;

  @ApiProperty({ description: 'Medical council registration number' })
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  registrationNumber!: string;

  @ApiProperty({ example: 'Cardiology' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  specialisation!: string;

  @ApiProperty({ example: 500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  consultationFee!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  departmentIds!: string[];
}

export class UpdateDoctorDto extends DoctorProfileFields {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  registrationNumber?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  specialisation?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  consultationFee?: number;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  departmentIds?: string[];
}

export class ListDoctorsQuery extends PageQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  specialisation?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') departmentId?: string;
  @ApiPropertyOptional({ description: 'Super Admin only; others see their own hospital' })
  @IsOptional()
  @IsUUID('4')
  hospitalId?: string;
}

const include = { user: true, departments: { include: { department: true } } } as const;
type Row = Prisma.DoctorGetPayload<{ include: typeof include }>;

const toDoctor = (d: Row): DoctorView => ({
  id: d.id,
  userId: d.userId,
  firstName: d.user.firstName,
  lastName: d.user.lastName,
  email: d.user.email,
  phone: d.user.phone,
  isActive: d.user.isActive,
  registrationNumber: d.registrationNumber,
  specialisation: d.specialisation,
  qualification: d.qualification,
  consultationFee: d.consultationFee.toString(),
  bio: d.bio,
  hasSignature: d.signatureFileId !== null,
  departments: d.departments.map((x) => ({ id: x.department.id, name: x.department.name })),
});

const MAX_SIGNATURE_BYTES = 512 * 1024;
const MAGIC: { mime: string; bytes: number[] }[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

export function detectImage(buf: Buffer): string | null {
  return MAGIC.find((m) => m.bytes.every((b, i) => buf[i] === b))?.mime ?? null;
}

interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Doctors (SCOPE-006, ROLE-003, API-015): profiles, departments and the signature used on prescriptions. */
@Injectable()
export class DoctorsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
  ) {}

  private async checkDepartments(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.db.client.department.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ field: 'departmentIds', messages: ['one or more departments do not exist'] }],
      });
  }

  async list(actor: AuthPrincipal, q: ListDoctorsQuery): Promise<PaginatedResult<DoctorView>> {
    const where: Prisma.DoctorWhereInput = {
      deletedAt: null,
      user: {
        deletedAt: null,
        // Patients see only bookable (active) doctors.
        ...(actor.role === 'PATIENT' ? { isActive: true } : {}),
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      ...(q.specialisation
        ? { specialisation: { contains: q.specialisation, mode: 'insensitive' } }
        : {}),
      ...(q.departmentId ? { departments: { some: { departmentId: q.departmentId } } } : {}),
      ...(q.hospitalId && actor.role === 'SUPER_ADMIN' ? { hospitalId: q.hospitalId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.doctor.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.doctor.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toDoctor), total, q.page, q.limit);
  }

  async get(actor: AuthPrincipal, id: string): Promise<DoctorView> {
    const d = await this.db.client.doctor.findFirst({
      where: { id, deletedAt: null, user: { deletedAt: null } },
      include,
    });
    if (!d || (actor.role === 'PATIENT' && !d.user.isActive)) throw notFound('doctor');
    return toDoctor(d);
  }

  async mine(actor: AuthPrincipal): Promise<DoctorView> {
    const d = await this.db.client.doctor.findFirst({
      where: { userId: actor.userId, deletedAt: null },
      include,
    });
    if (!d) throw notFound('doctor');
    return toDoctor(d);
  }

  async create(actor: AuthPrincipal, dto: CreateDoctorDto): Promise<DoctorView> {
    await this.checkDepartments(dto.departmentIds);
    const db = this.db.client;
    if (await db.user.findUnique({ where: { email: dto.email }, select: { id: true } }))
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'This email is already used by another account.',
      });
    const hospitalId = actor.hospitalId!;
    const id = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          hospitalId,
          email: dto.email,
          phone: dto.phone ?? null,
          passwordHash: '!',
          role: 'DOCTOR',
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
      const d = await tx.doctor.create({
        data: {
          hospitalId,
          userId: u.id,
          registrationNumber: dto.registrationNumber,
          specialisation: dto.specialisation,
          qualification: dto.qualification ?? null,
          consultationFee: dto.consultationFee,
          bio: dto.bio ?? null,
        },
      });
      if (dto.departmentIds.length)
        await tx.doctorDepartment.createMany({
          data: [...new Set(dto.departmentIds)].map((departmentId) => ({
            hospitalId,
            doctorId: d.id,
            departmentId,
          })),
        });
      return d.id;
    });
    const doctor = await this.get(actor, id);
    const hospital = await db.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    });
    await this.auth.sendWelcome(
      { id: doctor.userId, email: doctor.email, firstName: doctor.firstName },
      hospital?.name,
    );
    return doctor;
  }

  async update(actor: AuthPrincipal, id: string, dto: UpdateDoctorDto): Promise<DoctorView> {
    const current = await this.get(actor, id);
    if (actor.role === 'DOCTOR') {
      if (current.userId !== actor.userId)
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You can only edit your own profile.',
        });
      const restricted = [
        'registrationNumber',
        'specialisation',
        'consultationFee',
        'departmentIds',
      ].filter((k) => (dto as Record<string, unknown>)[k] !== undefined);
      if (restricted.length)
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: `Only an administrator can change: ${restricted.join(', ')}.`,
        });
    }
    if (dto.departmentIds) await this.checkDepartments(dto.departmentIds);
    const { departmentIds, ...fields } = dto;
    await this.db.client.$transaction(async (tx) => {
      await tx.doctor.update({ where: { id }, data: fields });
      if (departmentIds) {
        await tx.doctorDepartment.deleteMany({ where: { doctorId: id } });
        if (departmentIds.length)
          await tx.doctorDepartment.createMany({
            data: [...new Set(departmentIds)].map((departmentId) => ({
              hospitalId: actor.hospitalId!,
              doctorId: id,
              departmentId,
            })),
          });
      }
    });
    return this.get(actor, id);
  }

  async setSignature(
    actor: AuthPrincipal,
    id: string,
    file: UploadedImage | undefined,
  ): Promise<DoctorView> {
    const current = await this.get(actor, id);
    if (actor.role === 'DOCTOR' && current.userId !== actor.userId)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only upload your own signature.',
      });
    const invalid = (m: string) => new BadRequestException({ code: 'INVALID_FILE', message: m });
    if (!file) throw invalid('Attach the signature image as the "file" field.');
    if (file.size > MAX_SIGNATURE_BYTES)
      throw invalid('The signature image must be 512 KB or smaller.');
    // SEC-013: trust the file content, not the declared type or extension.
    const mime = detectImage(file.buffer);
    if (!mime || mime !== file.mimetype)
      throw invalid('The signature must be a PNG or JPEG image.');
    const hospitalId = actor.hospitalId!;
    const key = `${hospitalId}/signatures/${randomUUID()}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    await this.storage.put(key, file.buffer);
    await this.db.client.$transaction(async (tx) => {
      const f = await tx.fileAttachment.create({
        data: {
          hospitalId,
          purpose: 'DOCTOR_SIGNATURE',
          storageKey: key,
          originalName: file.originalname.slice(0, 200),
          mimeType: mime,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          uploadedById: actor.userId,
        },
      });
      await tx.doctor.update({ where: { id }, data: { signatureFileId: f.id } });
    });
    return this.get(actor, id);
  }

  async signature(actor: AuthPrincipal, id: string): Promise<{ mime: string; data: Buffer }> {
    await this.get(actor, id);
    const d = await this.db.client.doctor.findFirst({
      where: { id },
      select: { signatureFileId: true },
    });
    if (!d?.signatureFileId) throw notFound('signature');
    const f = await this.db.client.fileAttachment.findFirst({ where: { id: d.signatureFileId } });
    if (!f) throw notFound('signature');
    return { mime: f.mimeType, data: await this.storage.get(f.storageKey) };
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });
const ALL_HOSPITAL_ROLES = [
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
  'PATIENT',
] as const;

@ApiTags('Doctors')
@ApiBearerAuth()
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  @Roles(...ALL_HOSPITAL_ROLES)
  @ApiOperation({ summary: 'Doctors, filterable by specialisation and department (API-015)' })
  list(
    @CurrentUser() actor: AuthPrincipal,
    @Query() q: ListDoctorsQuery,
  ): Promise<PaginatedResult<DoctorView>> {
    return this.doctors.list(actor, q);
  }

  @Post()
  @Roles('HOSPITAL_ADMIN')
  @Audit('doctor.create', 'Doctor')
  @ApiOperation({ summary: 'Create a doctor account; the doctor is emailed a set-password link' })
  create(@CurrentUser() actor: AuthPrincipal, @Body() dto: CreateDoctorDto): Promise<DoctorView> {
    return this.doctors.create(actor, dto);
  }

  @Get('me')
  @Roles('DOCTOR')
  @ApiOperation({
    summary: 'The signed-in doctor (their schedule and appointments key off this id)',
  })
  me(@CurrentUser() actor: AuthPrincipal): Promise<DoctorView> {
    return this.doctors.mine(actor);
  }

  @Get(':id')
  @Roles(...ALL_HOSPITAL_ROLES)
  @ApiOperation({ summary: 'One doctor' })
  get(@CurrentUser() actor: AuthPrincipal, @Param('id', uuid) id: string): Promise<DoctorView> {
    return this.doctors.get(actor, id);
  }

  @Patch(':id')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('doctor.update', 'Doctor')
  @ApiOperation({ summary: 'Administrator: all fields. Doctor: own qualification and bio' })
  update(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateDoctorDto,
  ): Promise<DoctorView> {
    return this.doctors.update(actor, id, dto);
  }

  @Post(':id/signature')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('doctor.signature', 'Doctor')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SIGNATURE_BYTES + 1, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({
    summary: 'Upload the signature image (PNG or JPEG, at most 512 KB) used on prescriptions',
  })
  upload(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() file?: UploadedImage,
  ): Promise<DoctorView> {
    return this.doctors.setSignature(actor, id, file);
  }

  @Get(':id/signature')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'PHARMACIST')
  @ApiOperation({ summary: 'The signature image' })
  async signature(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { mime, data } = await this.doctors.signature(actor, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(data);
  }
}

@Module({ imports: [AuthModule], controllers: [DoctorsController], providers: [DoctorsService] })
export class DoctorsModule {}
