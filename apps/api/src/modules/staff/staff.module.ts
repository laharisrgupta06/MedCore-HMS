import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
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
import { STAFF_ROLES, type StaffMember, type StaffRole } from '@medcore/types';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { Email, PageQuery, PersonName, Phone, Text } from '../../common/dto/fields';
import { PaginatedResult } from '../../common/http/paginated-result';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { toSummary } from '../users/users.service';

class StaffProfileFields {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('4')
  departmentId?: string | null;

  @Text(30) employeeCode?: string | null;
  @Text(80) designation?: string | null;

  @ApiPropertyOptional({
    description: 'Senior lab technicians approve lab reports (LAB_TECHNICIAN only)',
  })
  @IsOptional()
  @IsBoolean()
  isSeniorLabTechnician?: boolean;
}

export class CreateStaffDto extends StaffProfileFields {
  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES)
  role!: StaffRole;

  @PersonName('firstName') firstName!: string;
  @PersonName('lastName') lastName!: string;
  @Email() email!: string;
  @Phone() phone?: string | null;
}

export class UpdateStaffDto extends StaffProfileFields {}

export class ListStaffQuery extends PageQuery {
  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;
}

const include = { user: true, department: true } as const;
type Row = Prisma.StaffProfileGetPayload<{ include: typeof include }>;

const toMember = (s: Row): StaffMember => ({
  user: toSummary(s.user),
  employeeCode: s.employeeCode,
  designation: s.designation,
  isSeniorLabTechnician: s.isSeniorLabTechnician,
  department: s.department ? { id: s.department.id, name: s.department.name } : null,
});

/**
 * Staff accounts (SCOPE-005, ROLE-002). The Hospital Admin creates the account; the staff member
 * receives a single-use link to set their own password. Roles change only by creating a new account
 * (role and profile must stay consistent, DEC-017). Deactivation uses PATCH /users/:id.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly auth: AuthService,
  ) {}

  private async checkDepartment(departmentId: string | null | undefined): Promise<void> {
    if (!departmentId) return;
    const d = await this.db.client.department.findFirst({
      where: { id: departmentId },
      select: { id: true },
    });
    if (!d)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ field: 'departmentId', messages: ['department does not exist'] }],
      });
  }

  async list(q: ListStaffQuery): Promise<PaginatedResult<StaffMember>> {
    const where: Prisma.StaffProfileWhereInput = {
      user: {
        deletedAt: null,
        ...(q.role ? { role: q.role } : {}),
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { email: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.staffProfile.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.staffProfile.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toMember), total, q.page, q.limit);
  }

  async get(userId: string): Promise<StaffMember> {
    const s = await this.db.client.staffProfile.findFirst({
      where: { userId, user: { deletedAt: null } },
      include,
    });
    if (!s) throw notFound('staff member');
    return toMember(s);
  }

  async create(actor: AuthPrincipal, dto: CreateStaffDto): Promise<StaffMember> {
    if (dto.isSeniorLabTechnician && dto.role !== 'LAB_TECHNICIAN') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [
          {
            field: 'isSeniorLabTechnician',
            messages: ['only a lab technician can be a senior lab technician'],
          },
        ],
      });
    }
    await this.checkDepartment(dto.departmentId);
    const db = this.db.client;
    if (await db.user.findUnique({ where: { email: dto.email }, select: { id: true } })) {
      throw new ConflictException({
        code: 'EMAIL_IN_USE',
        message: 'This email is already used by another account.',
      });
    }
    const hospitalId = actor.hospitalId!;
    let userId: string;
    try {
      userId = await db.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            hospitalId,
            email: dto.email,
            phone: dto.phone ?? null,
            passwordHash: '!',
            role: dto.role,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
        });
        await tx.staffProfile.create({
          data: {
            hospitalId,
            userId: u.id,
            departmentId: dto.departmentId ?? null,
            employeeCode: dto.employeeCode ?? null,
            designation: dto.designation ?? null,
            isSeniorLabTechnician: dto.isSeniorLabTechnician ?? false,
          },
        });
        return u.id;
      });
    } catch (e) {
      mapPrismaError(e, { conflict: 'This employee code is already used.' });
    }
    const hospital = await db.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    });
    await this.auth.sendWelcome(
      { id: userId, email: dto.email, firstName: dto.firstName },
      hospital?.name,
    );
    return this.get(userId);
  }

  async update(userId: string, dto: UpdateStaffDto): Promise<StaffMember> {
    const current = await this.get(userId);
    if (dto.isSeniorLabTechnician && current.user.role !== 'LAB_TECHNICIAN') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [
          {
            field: 'isSeniorLabTechnician',
            messages: ['only a lab technician can be a senior lab technician'],
          },
        ],
      });
    }
    await this.checkDepartment(dto.departmentId);
    try {
      await this.db.client.staffProfile.update({ where: { userId }, data: { ...dto } });
    } catch (e) {
      mapPrismaError(e, { conflict: 'This employee code is already used.' });
    }
    return this.get(userId);
  }

  /** Sends a new set-password link (for staff who have not activated their account, or forgot it). */
  async resendInvite(userId: string): Promise<{ sent: true }> {
    const s = await this.get(userId);
    await this.auth.sendPasswordLink(
      { id: s.user.id, email: s.user.email, firstName: s.user.firstName },
      'welcome',
    );
    return { sent: true };
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('Staff')
@ApiBearerAuth()
@Roles('HOSPITAL_ADMIN')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'Staff of the hospital (not doctors or patients)' })
  list(@Query() q: ListStaffQuery): Promise<PaginatedResult<StaffMember>> {
    return this.staff.list(q);
  }

  @Post()
  @Audit('staff.create', 'User', ['role', 'isSeniorLabTechnician'])
  @ApiOperation({ summary: 'Create a staff account; the person is emailed a set-password link' })
  create(@CurrentUser() actor: AuthPrincipal, @Body() dto: CreateStaffDto): Promise<StaffMember> {
    return this.staff.create(actor, dto);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'One staff member' })
  get(@Param('userId', uuid) userId: string): Promise<StaffMember> {
    return this.staff.get(userId);
  }

  @Patch(':userId')
  @Audit('staff.update', 'User', ['isSeniorLabTechnician'])
  @ApiOperation({ summary: 'Department, employee code, designation, senior lab technician flag' })
  update(@Param('userId', uuid) userId: string, @Body() dto: UpdateStaffDto): Promise<StaffMember> {
    return this.staff.update(userId, dto);
  }

  @Post(':userId/invite')
  @HttpCode(200)
  @Audit('staff.invite', 'User')
  @ApiOperation({ summary: 'Email a new set-password link' })
  invite(@Param('userId', uuid) userId: string): Promise<{ sent: true }> {
    return this.staff.resendInvite(userId);
  }
}

@Module({ imports: [AuthModule], controllers: [StaffController], providers: [StaffService] })
export class StaffModule {}
