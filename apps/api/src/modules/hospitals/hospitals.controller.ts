import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Hospital } from '@medcore/types';
import { Audit } from '../../common/audit/audit.decorators';
import { Roles } from '../../common/auth/decorators';
import type { PaginatedResult } from '../../common/http/paginated-result';
import { TenantParam } from '../../common/tenancy/tenant.guard';
import { CreateHospitalDto, ListHospitalsQuery, UpdateHospitalDto } from './hospitals.dto';
import { HospitalsService } from './hospitals.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('Hospitals')
@ApiBearerAuth()
@TenantParam('id')
@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitals: HospitalsService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'List hospitals (API-013)' })
  list(@Query() q: ListHospitalsQuery): Promise<PaginatedResult<Hospital>> {
    return this.hospitals.list(q);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @Audit('hospital.create', 'Hospital')
  @ApiOperation({
    summary: 'Onboard a hospital and its first Hospital Admin (emailed a set-password link)',
  })
  create(@Body() dto: CreateHospitalDto): Promise<Hospital> {
    return this.hospitals.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Hospital profile: Super Admin, or staff of that hospital' })
  get(@Param('id', uuid) id: string): Promise<Hospital> {
    return this.hospitals.get(id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'HOSPITAL_ADMIN')
  @Audit('hospital.update', 'Hospital', [
    'timezone',
    'currency',
    'defaultSlotMinutes',
    'taxRatePercent',
    'invoicePrefix',
  ])
  @ApiOperation({ summary: 'Update profile and billing configuration' })
  update(@Param('id', uuid) id: string, @Body() dto: UpdateHospitalDto): Promise<Hospital> {
    return this.hospitals.update(id, dto);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  @Audit('hospital.verify', 'Hospital')
  @ApiOperation({ summary: 'Verify a hospital: patients can then register with its code' })
  verify(@Param('id', uuid) id: string): Promise<Hospital> {
    return this.hospitals.setStatus(id, 'VERIFIED');
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  @Audit('hospital.suspend', 'Hospital')
  @ApiOperation({ summary: 'Suspend a hospital and sign out all of its users' })
  suspend(@Param('id', uuid) id: string): Promise<Hospital> {
    return this.hospitals.setStatus(id, 'SUSPENDED');
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @Roles('SUPER_ADMIN')
  @Audit('hospital.reactivate', 'Hospital')
  @ApiOperation({ summary: 'Lift a suspension' })
  reactivate(@Param('id', uuid) id: string): Promise<Hospital> {
    return this.hospitals.setStatus(id, 'VERIFIED');
  }
}
