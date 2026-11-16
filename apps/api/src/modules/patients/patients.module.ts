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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { BLOOD_GROUPS, Gender, type BloodGroup, type PatientSummary } from '@medcore/types';
import { Prisma } from '@prisma/client';
import { IsEnum, IsIn, IsISO8601, IsOptional, Matches, ValidateIf } from 'class-validator';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { Email, PageQuery, PersonName, Phone, Text } from '../../common/dto/fields';
import { PaginatedResult } from '../../common/http/paginated-result';
import { notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { formatMrn } from '../auth/mrn';

class PatientFields {
  @ApiPropertyOptional({ enum: BLOOD_GROUPS, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: BloodGroup | null;

  @Text(120) emergencyContactName?: string | null;
  @Phone() emergencyContactPhone?: string | null;
}

export class CreatePatientDto extends PatientFields {
  @PersonName('firstName') firstName!: string;
  @PersonName('lastName') lastName!: string;
  @Email() email!: string;
  @Phone() phone?: string | null;

  @ApiProperty({ example: '1990-04-21' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a date in YYYY-MM-DD format' })
  dateOfBirth!: string;

  @ApiProperty({ enum: Object.values(Gender) })
  @IsEnum(Gender)
  gender!: Gender;
}

export class UpdatePatientDto extends PatientFields {
  @PersonName('firstName', true) firstName?: string;
  @PersonName('lastName', true) lastName?: string;
  @Phone() phone?: string | null;

  @ApiPropertyOptional({ example: '1990-04-21' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be a date in YYYY-MM-DD format' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: Object.values(Gender) })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}

const include = { user: true } as const;
type Row = Prisma.PatientGetPayload<{ include: typeof include }>;

export const toPatient = (p: Row): PatientSummary => ({
  id: p.id,
  userId: p.userId,
  mrn: p.mrn,
  firstName: p.user.firstName,
  lastName: p.user.lastName,
  email: p.user.email,
  phone: p.user.phone,
  dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
  gender: p.gender,
  bloodGroup: p.bloodGroup,
  emergencyContactName: p.emergencyContactName,
  emergencyContactPhone: p.emergencyContactPhone,
  isActive: p.user.isActive,
  createdAt: p.createdAt.toISOString(),
});

function pastDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  const today = new Date();
  if (Number.isNaN(d.getTime()) || d > today || d.getUTCFullYear() < today.getUTCFullYear() - 130) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [{ field: 'dateOfBirth', messages: ['dateOfBirth must be a past date'] }],
    });
  }
  return d;
}

/** Roles that work with patient demographics (minimal exposure: no clinical data here). */
export const PATIENT_READERS = [
  'HOSPITAL_ADMIN',
  'RECEPTIONIST',
  'DOCTOR',
  'NURSE',
  'ACCOUNTANT',
  'LAB_TECHNICIAN',
  'PHARMACIST',
] as const;

/**
 * Patients (SCOPE-006, ROLE-005). Reception registers walk-in patients; the patient is emailed a
 * set-password link so they can use the portal. MRNs are unique per hospital.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(q: PageQuery): Promise<PaginatedResult<PatientSummary>> {
    const s = q.search;
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      ...(s
        ? {
            OR: [
              { mrn: { contains: s, mode: 'insensitive' } },
              { user: { firstName: { contains: s, mode: 'insensitive' } } },
              { user: { lastName: { contains: s, mode: 'insensitive' } } },
              { user: { email: { contains: s, mode: 'insensitive' } } },
              { user: { phone: { contains: s } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.patient.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.patient.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toPatient), total, q.page, q.limit);
  }

  async get(actor: AuthPrincipal, id: string): Promise<PatientSummary> {
    const p = await this.db.client.patient.findFirst({ where: { id, deletedAt: null }, include });
    if (!p) throw notFound('patient');
    // TEST-011: a patient sees only their own record (another patient's id answers 404).
    if (actor.role === 'PATIENT' && p.userId !== actor.userId) throw notFound('patient');
    return toPatient(p);
  }

  async mine(actor: AuthPrincipal): Promise<PatientSummary> {
    const p = await this.db.client.patient.findFirst({
      where: { userId: actor.userId, deletedAt: null },
      include,
    });
    if (!p) throw notFound('patient');
    return toPatient(p);
  }

  async create(actor: AuthPrincipal, dto: CreatePatientDto): Promise<PatientSummary> {
    const db = this.db.client;
    const dob = pastDate(dto.dateOfBirth);
    if (await db.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message:
          'This email is already used by another account. Search for the existing patient instead.',
      });
    }
    const hospitalId = actor.hospitalId!;
    const year = new Date().getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const id = await db.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              hospitalId,
              email: dto.email,
              phone: dto.phone ?? null,
              passwordHash: '!',
              role: 'PATIENT',
              firstName: dto.firstName,
              lastName: dto.lastName,
            },
          });
          const count = await tx.patient.count({ where: { hospitalId } });
          const p = await tx.patient.create({
            data: {
              hospitalId,
              userId: u.id,
              mrn: formatMrn(year, count + 1 + attempt),
              dateOfBirth: dob,
              gender: dto.gender,
              bloodGroup: dto.bloodGroup ?? null,
              emergencyContactName: dto.emergencyContactName ?? null,
              emergencyContactPhone: dto.emergencyContactPhone ?? null,
            },
          });
          return p.id;
        });
        const hospital = await db.hospital.findUnique({
          where: { id: hospitalId },
          select: { name: true },
        });
        const patient = await this.get(actor, id);
        await this.auth.sendWelcome(
          { id: patient.userId, email: patient.email, firstName: patient.firstName },
          hospital?.name,
        );
        return patient;
      } catch (e) {
        const target =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
            ? String(e.meta?.target ?? '')
            : '';
        if (target.includes('mrn')) continue;
        if (target.includes('email'))
          throw new ConflictException({
            code: 'EMAIL_IN_USE',
            message: 'This email is already used by another account.',
          });
        throw e;
      }
    }
    throw new ConflictException({
      code: 'CONFLICT',
      message: 'Registration is busy. Please try again.',
    });
  }

  async update(actor: AuthPrincipal, id: string, dto: UpdatePatientDto): Promise<PatientSummary> {
    const current = await this.get(actor, id);
    const db = this.db.client;
    const userData: Prisma.UserUpdateInput = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.phone !== undefined && dto.phone !== current.phone
        ? { phone: dto.phone, phoneVerifiedAt: null }
        : {}),
    };
    await db.$transaction(async (tx) => {
      if (Object.keys(userData).length)
        await tx.user.update({ where: { id: current.userId }, data: userData });
      await tx.patient.update({
        where: { id },
        data: {
          ...(dto.dateOfBirth !== undefined ? { dateOfBirth: pastDate(dto.dateOfBirth) } : {}),
          ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
          ...(dto.bloodGroup !== undefined ? { bloodGroup: dto.bloodGroup } : {}),
          ...(dto.emergencyContactName !== undefined
            ? { emergencyContactName: dto.emergencyContactName }
            : {}),
          ...(dto.emergencyContactPhone !== undefined
            ? { emergencyContactPhone: dto.emergencyContactPhone }
            : {}),
        },
      });
    });
    return this.get(actor, id);
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('Patients')
@ApiBearerAuth()
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @Roles(...PATIENT_READERS)
  @ApiOperation({ summary: 'Search patients by name, MRN, email or phone' })
  list(@Query() q: PageQuery): Promise<PaginatedResult<PatientSummary>> {
    return this.patients.list(q);
  }

  @Post()
  @Roles('HOSPITAL_ADMIN', 'RECEPTIONIST')
  @Audit('patient.create', 'Patient', ['gender', 'bloodGroup'])
  @ApiOperation({
    summary: 'Register a patient at reception; the patient is emailed a set-password link',
  })
  create(
    @CurrentUser() actor: AuthPrincipal,
    @Body() dto: CreatePatientDto,
  ): Promise<PatientSummary> {
    return this.patients.create(actor, dto);
  }

  @Get('me')
  @Roles('PATIENT')
  @ApiOperation({ summary: 'The signed-in patient' })
  me(@CurrentUser() actor: AuthPrincipal): Promise<PatientSummary> {
    return this.patients.mine(actor);
  }

  @Get(':id')
  @Roles(...PATIENT_READERS, 'PATIENT')
  @ApiOperation({ summary: 'One patient (a patient may read only their own)' })
  get(@CurrentUser() actor: AuthPrincipal, @Param('id', uuid) id: string): Promise<PatientSummary> {
    return this.patients.get(actor, id);
  }

  @Patch(':id')
  @Roles('HOSPITAL_ADMIN', 'RECEPTIONIST')
  @Audit('patient.update', 'Patient', ['gender', 'bloodGroup'])
  @ApiOperation({ summary: 'Update demographics and emergency contact' })
  update(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdatePatientDto,
  ): Promise<PatientSummary> {
    if (actor.role === 'PATIENT') throw new ForbiddenException();
    return this.patients.update(actor, id, dto);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
