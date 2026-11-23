import {
  Body,
  Controller,
  Get,
  Inject,
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
import { MEDICINE_FORMS, type Medicine as MedicineView, type MedicineForm } from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Medicine } from '@prisma/client';
import type { Redis } from 'ioredis';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { PageQuery } from '../../common/dto/fields';
import { PaginatedResult } from '../../common/http/paginated-result';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { LowStock } from './low-stock';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';
import { localDate } from '../../common/time/zoned';
import { REDIS_CLIENT } from '../../infra/redis/redis.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

class MedicineDto {
  @ApiProperty({ example: 'Paracetamol' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;
  @ApiPropertyOptional({ example: 'Acetaminophen' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  genericName?: string;
  @ApiProperty({ enum: MEDICINE_FORMS }) @IsIn(MEDICINE_FORMS) form!: MedicineForm;
  @ApiProperty({ example: '500 mg' }) @Transform(trim) @IsString() @Length(1, 40) strength!: string;
  @ApiProperty({ description: 'Low-stock threshold in units (PHARM-003)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderLevel!: number;
}
class UpdateMedicineDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  genericName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  strength?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
class MedicineQuery extends PageQuery {
  @ApiPropertyOptional({ enum: MEDICINE_FORMS })
  @IsOptional()
  @IsIn(MEDICINE_FORMS)
  form?: MedicineForm;
  @ApiPropertyOptional({ description: 'Default: active only' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  active?: boolean;
}

const STOCK_TTL_SECONDS = 60;

/**
 * Available stock per medicine (CACHE-002): units in ACTIVE batches that have not expired in the
 * hospital's time zone. Cached for 60 s and cleared by every stock change (Phase 7 calls
 * `invalidate`). Dispensing never trusts this cache; it reads the batches.
 */
@Injectable()
export class StockLevels {
  constructor(
    private readonly db: TenantPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private key = (id: string) => `stock:${id}`;

  async available(medicineIds: string[], timezone: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (medicineIds.length === 0) return out;
    const cached = await this.redis.mget(...medicineIds.map(this.key));
    const missing = medicineIds.filter((id, i) => {
      const v = cached.at(i);
      if (v != null) out.set(id, Number(v));
      return v == null;
    });
    if (missing.length) {
      const today = new Date(`${localDate(new Date(), timezone)}T00:00:00Z`);
      const batches = await this.db.client.medicineBatch.findMany({
        where: { medicineId: { in: missing }, status: 'ACTIVE', expiresOn: { gt: today } },
        select: { medicineId: true, quantity: true },
      });
      for (const id of missing) out.set(id, 0);
      for (const b of batches) out.set(b.medicineId, (out.get(b.medicineId) ?? 0) + b.quantity);
      const pipe = this.redis.multi();
      for (const id of missing)
        pipe.set(this.key(id), String(out.get(id)), 'EX', STOCK_TTL_SECONDS);
      await pipe.exec();
    }
    return out;
  }

  async invalidate(medicineIds: string[]): Promise<void> {
    if (medicineIds.length) await this.redis.del(...medicineIds.map(this.key));
  }
}

/** Shared medicine catalogue (DEC-040 D2; RX-003, API-024). Costs are not part of it. */
@Injectable()
export class MedicinesService {
  constructor(
    private readonly db: TenantPrismaService,
    private readonly stock: StockLevels,
    private readonly lowStock: LowStock,
  ) {}

  async timezone(hospitalId: string | null): Promise<string> {
    if (!hospitalId) return 'Asia/Kolkata';
    const h = await this.db.client.hospital.findFirst({
      where: { id: hospitalId },
      select: { timezone: true },
    });
    return h?.timezone ?? 'Asia/Kolkata';
  }

  async views(actor: AuthPrincipal, rows: Medicine[]): Promise<MedicineView[]> {
    const avail = await this.stock.available(
      rows.map((r) => r.id),
      await this.timezone(actor.hospitalId),
    );
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      genericName: m.genericName,
      form: m.form,
      strength: m.strength,
      reorderLevel: m.reorderLevel,
      isActive: m.isActive,
      taxClassificationId: m.taxClassificationId,
      available: avail.get(m.id) ?? 0,
    }));
  }

  async list(actor: AuthPrincipal, q: MedicineQuery): Promise<PaginatedResult<MedicineView>> {
    const where = {
      ...(q.active === undefined ? { isActive: true } : { isActive: q.active }),
      ...(q.form ? { form: q.form } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { genericName: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.client.medicine.findMany({
        where,
        orderBy: [{ name: 'asc' }, { strength: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.db.client.medicine.count({ where }),
    ]);
    return PaginatedResult.of(await this.views(actor, rows), total, q.page, q.limit);
  }

  async create(actor: AuthPrincipal, dto: MedicineDto): Promise<MedicineView> {
    const m = await this.db.client.medicine
      .create({
        data: { hospitalId: actor.hospitalId!, ...dto, genericName: dto.genericName || null },
      })
      .catch((e) =>
        mapPrismaError(e, {
          conflict: 'This medicine, strength and form is already in the catalogue.',
        }),
      );
    return (await this.views(actor, [m]))[0]!;
  }

  async update(actor: AuthPrincipal, id: string, dto: UpdateMedicineDto): Promise<MedicineView> {
    const m = await this.db.client.medicine.findFirst({ where: { id } });
    if (!m) throw notFound('medicine');
    const u = await this.db.client.medicine
      .update({
        where: { id },
        data: {
          ...dto,
          ...(dto.genericName !== undefined ? { genericName: dto.genericName || null } : {}),
        },
      })
      .catch((e) =>
        mapPrismaError(e, {
          conflict: 'This medicine, strength and form is already in the catalogue.',
        }),
      );
    // A new reorder level or (de)activation can start or end a low-stock state (PHARM-003).
    if (dto.reorderLevel !== undefined || dto.isActive !== undefined)
      await this.lowStock.evaluate(actor.hospitalId!, [id]);
    return (await this.views(actor, [u]))[0]!;
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('Medicines')
@ApiBearerAuth()
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly medicines: MedicinesService) {}

  @Get()
  @Roles('DOCTOR', 'PHARMACIST', 'HOSPITAL_ADMIN')
  @ApiOperation({ summary: 'Search the catalogue with available stock (API-024, RX-003)' })
  list(@CurrentUser() a: AuthPrincipal, @Query() q: MedicineQuery) {
    return this.medicines.list(a, q);
  }

  @Post()
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @Audit('medicine.create', 'Medicine', ['form', 'reorderLevel'])
  @ApiOperation({ summary: 'Add a medicine to the catalogue' })
  create(@CurrentUser() a: AuthPrincipal, @Body() dto: MedicineDto) {
    return this.medicines.create(a, dto);
  }

  @Patch(':id')
  @Roles('PHARMACIST', 'HOSPITAL_ADMIN')
  @Audit('medicine.update', 'Medicine', ['reorderLevel', 'isActive'])
  @ApiOperation({ summary: 'Edit a medicine, its reorder level, or deactivate it' })
  update(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateMedicineDto,
  ) {
    return this.medicines.update(a, id, dto);
  }
}

@Module({
  controllers: [MedicinesController],
  providers: [MedicinesService, StockLevels, LowStock],
  exports: [MedicinesService, StockLevels, LowStock],
})
export class MedicinesModule {}
