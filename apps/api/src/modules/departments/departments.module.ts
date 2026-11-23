import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Department as DepartmentView } from '@medcore/types';
import type { Department } from '@prisma/client';
import { IsOptional } from 'class-validator';
import { Audit } from '../../common/audit/audit.decorators';
import { Roles } from '../../common/auth/decorators';
import { Text } from '../../common/dto/fields';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { TenantParam } from '../../common/tenancy/tenant.guard';

export class DepartmentInput {
  @Text(80, false) name!: string;
  @Text(500) description?: string | null;
}

export class UpdateDepartmentDto {
  @IsOptional() @Text(80, false) name?: string;
  @Text(500) description?: string | null;
}

const toDto = (d: Department): DepartmentView => ({
  id: d.id,
  hospitalId: d.hospitalId,
  name: d.name,
  description: d.description,
});

@Injectable()
export class DepartmentsService {
  constructor(private readonly db: TenantPrismaService) {}

  async list(hospitalId: string): Promise<DepartmentView[]> {
    const rows = await this.db.client.department.findMany({
      where: { hospitalId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(hospitalId: string, dto: DepartmentInput): Promise<DepartmentView> {
    const hospital = await this.db.client.hospital.findUnique({
      where: { id: hospitalId },
      select: { id: true },
    });
    if (!hospital) throw notFound('hospital');
    try {
      return toDto(
        await this.db.client.department.create({
          data: { hospitalId, name: dto.name, description: dto.description ?? null },
        }),
      );
    } catch (e) {
      mapPrismaError(e, { conflict: 'A department with this name already exists.' });
    }
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<DepartmentView> {
    const existing = await this.db.client.department.findFirst({ where: { id } });
    if (!existing) throw notFound('department');
    try {
      return toDto(await this.db.client.department.update({ where: { id }, data: { ...dto } }));
    } catch (e) {
      mapPrismaError(e, { conflict: 'A department with this name already exists.' });
    }
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.db.client.department.findFirst({ where: { id } });
    if (!existing) throw notFound('department');
    try {
      await this.db.client.department.delete({ where: { id } });
    } catch (e) {
      mapPrismaError(e, {
        inUse: 'This department has staff, doctors, rooms or appointments and cannot be deleted.',
      });
    }
    return { id, deleted: true };
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('Departments')
@ApiBearerAuth()
@Controller()
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get('hospitals/:id/departments')
  @TenantParam('id')
  @Roles(
    'SUPER_ADMIN',
    'HOSPITAL_ADMIN',
    'DOCTOR',
    'NURSE',
    'RECEPTIONIST',
    'LAB_TECHNICIAN',
    'PHARMACIST',
    'ACCOUNTANT',
    'PATIENT',
  )
  @ApiOperation({ summary: 'Departments of a hospital (API-014)' })
  list(@Param('id', uuid) id: string): Promise<DepartmentView[]> {
    return this.departments.list(id);
  }

  @Post('hospitals/:id/departments')
  @TenantParam('id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @Audit('department.create', 'Department')
  @ApiOperation({ summary: 'Create a department' })
  create(@Param('id', uuid) id: string, @Body() dto: DepartmentInput): Promise<DepartmentView> {
    return this.departments.create(id, dto);
  }

  @Patch('departments/:id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @Audit('department.update', 'Department')
  @ApiOperation({ summary: 'Rename or describe a department' })
  update(@Param('id', uuid) id: string, @Body() dto: UpdateDepartmentDto): Promise<DepartmentView> {
    return this.departments.update(id, dto);
  }

  @Delete('departments/:id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @Audit('department.delete', 'Department')
  @ApiOperation({ summary: 'Delete an unused department (409 IN_USE otherwise)' })
  remove(@Param('id', uuid) id: string): Promise<{ id: string; deleted: true }> {
    return this.departments.remove(id);
  }
}

@Module({ controllers: [DepartmentsController], providers: [DepartmentsService] })
export class DepartmentsModule {}
