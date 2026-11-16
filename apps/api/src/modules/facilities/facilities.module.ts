import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import {
  BED_STATUSES,
  ROOM_TYPES,
  type Bed as BedView,
  type BedStatus,
  type Room as RoomView,
  type RoomType,
} from '@medcore/types';
import type { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import { Text, trim } from '../../common/dto/fields';
import { mapPrismaError, notFound } from '../../common/http/prisma-errors';
import { TenantPrismaService } from '../../common/tenancy/tenant-prisma.service';

export class RoomInput {
  @ApiProperty({ example: '204' }) @Transform(trim) @IsString() @Length(1, 20) number!: string;
  @ApiProperty({ enum: ROOM_TYPES }) @IsIn(ROOM_TYPES) type!: RoomType;
  @Text(20) floor?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  dailyCharge?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('4')
  departmentId?: string | null;
}

export class UpdateRoomInput {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 20) number?: string;
  @ApiPropertyOptional({ enum: ROOM_TYPES }) @IsOptional() @IsIn(ROOM_TYPES) type?: RoomType;
  @Text(20) floor?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  dailyCharge?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID('4')
  departmentId?: string | null;
}

export class BedInput {
  @ApiProperty({ example: 'A' }) @Transform(trim) @IsString() @Length(1, 20) label!: string;
}

export class UpdateBedInput {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 20) label?: string;
  @ApiPropertyOptional({ enum: BED_STATUSES }) @IsOptional() @IsIn(BED_STATUSES) status?: BedStatus;
}

export class ListRoomsQuery {
  @ApiPropertyOptional({ enum: ROOM_TYPES }) @IsOptional() @IsIn(ROOM_TYPES) type?: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') departmentId?: string;
}

const include = { beds: { orderBy: { label: 'asc' } }, department: true } as const;
type RoomRow = Prisma.RoomGetPayload<{ include: typeof include }>;
const toBed = (b: { id: string; roomId: string; label: string; status: BedStatus }): BedView => ({
  id: b.id,
  roomId: b.roomId,
  label: b.label,
  status: b.status,
});
const toRoom = (r: RoomRow): RoomView => ({
  id: r.id,
  number: r.number,
  type: r.type,
  floor: r.floor,
  dailyCharge: r.dailyCharge?.toString() ?? null,
  department: r.department ? { id: r.department.id, name: r.department.name } : null,
  beds: [...r.beds]
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    .map(toBed),
});

/** Rooms and beds (SCOPE-006, ROLE-002 beds, ROLE-004 ward management). */
@Injectable()
export class FacilitiesService {
  constructor(private readonly db: TenantPrismaService) {}

  private async checkDepartment(id: string | null | undefined): Promise<void> {
    if (!id) return;
    if (!(await this.db.client.department.findFirst({ where: { id }, select: { id: true } })))
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ field: 'departmentId', messages: ['department does not exist'] }],
      });
  }

  async rooms(q: ListRoomsQuery): Promise<RoomView[]> {
    const rows = await this.db.client.room.findMany({
      where: {
        ...(q.type ? { type: q.type } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      },
      include,
      orderBy: { number: 'asc' },
    });
    return rows.map(toRoom);
  }

  async room(id: string): Promise<RoomView> {
    const r = await this.db.client.room.findFirst({ where: { id }, include });
    if (!r) throw notFound('room');
    return toRoom(r);
  }

  async createRoom(actor: AuthPrincipal, dto: RoomInput): Promise<RoomView> {
    await this.checkDepartment(dto.departmentId);
    try {
      const r = await this.db.client.room.create({
        data: {
          hospitalId: actor.hospitalId!,
          number: dto.number,
          type: dto.type,
          floor: dto.floor ?? null,
          dailyCharge: dto.dailyCharge ?? null,
          departmentId: dto.departmentId ?? null,
        },
      });
      return this.room(r.id);
    } catch (e) {
      mapPrismaError(e, { conflict: 'A room with this number already exists.' });
    }
  }

  async updateRoom(id: string, dto: UpdateRoomInput): Promise<RoomView> {
    await this.room(id);
    await this.checkDepartment(dto.departmentId);
    try {
      await this.db.client.room.update({ where: { id }, data: { ...dto } });
    } catch (e) {
      mapPrismaError(e, { conflict: 'A room with this number already exists.' });
    }
    return this.room(id);
  }

  async deleteRoom(id: string): Promise<{ id: string; deleted: true }> {
    await this.room(id);
    try {
      await this.db.client.room.delete({ where: { id } });
    } catch (e) {
      mapPrismaError(e, {
        inUse: 'Remove the beds first. Rooms used on invoices cannot be deleted.',
      });
    }
    return { id, deleted: true };
  }

  async addBed(actor: AuthPrincipal, roomId: string, dto: BedInput): Promise<BedView> {
    await this.room(roomId);
    try {
      return toBed(
        await this.db.client.bed.create({
          data: { hospitalId: actor.hospitalId!, roomId, label: dto.label },
        }),
      );
    } catch (e) {
      mapPrismaError(e, { conflict: 'This room already has a bed with that label.' });
    }
  }

  async updateBed(actor: AuthPrincipal, id: string, dto: UpdateBedInput): Promise<BedView> {
    const bed = await this.db.client.bed.findFirst({ where: { id } });
    if (!bed) throw notFound('bed');
    // Nurses manage ward occupancy (ROLE-004) but do not rename or restructure beds.
    if (actor.role === 'NURSE' && dto.label !== undefined)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only an administrator can rename beds.',
      });
    try {
      return toBed(await this.db.client.bed.update({ where: { id }, data: { ...dto } }));
    } catch (e) {
      mapPrismaError(e, { conflict: 'This room already has a bed with that label.' });
    }
  }

  async deleteBed(id: string): Promise<{ id: string; deleted: true }> {
    const bed = await this.db.client.bed.findFirst({ where: { id } });
    if (!bed) throw notFound('bed');
    if (bed.status === 'OCCUPIED')
      throw new BadRequestException({
        code: 'BED_OCCUPIED',
        message: 'An occupied bed cannot be removed. Mark it available first.',
      });
    await this.db.client.bed.delete({ where: { id } });
    return { id, deleted: true };
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });
const VIEWERS = ['HOSPITAL_ADMIN', 'NURSE', 'RECEPTIONIST', 'DOCTOR', 'ACCOUNTANT'] as const;

@ApiTags('Rooms and beds')
@ApiBearerAuth()
@Controller()
export class FacilitiesController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Get('rooms')
  @Roles(...VIEWERS)
  @ApiOperation({ summary: 'Rooms with their beds and occupancy' })
  rooms(@Query() q: ListRoomsQuery): Promise<RoomView[]> {
    return this.facilities.rooms(q);
  }

  @Get('rooms/:id')
  @Roles(...VIEWERS)
  room(@Param('id', uuid) id: string): Promise<RoomView> {
    return this.facilities.room(id);
  }

  @Post('rooms')
  @Roles('HOSPITAL_ADMIN')
  @Audit('room.create', 'Room', ['type'])
  createRoom(@CurrentUser() actor: AuthPrincipal, @Body() dto: RoomInput): Promise<RoomView> {
    return this.facilities.createRoom(actor, dto);
  }

  @Patch('rooms/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('room.update', 'Room', ['type'])
  updateRoom(@Param('id', uuid) id: string, @Body() dto: UpdateRoomInput): Promise<RoomView> {
    return this.facilities.updateRoom(id, dto);
  }

  @Delete('rooms/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('room.delete', 'Room')
  deleteRoom(@Param('id', uuid) id: string): Promise<{ id: string; deleted: true }> {
    return this.facilities.deleteRoom(id);
  }

  @Post('rooms/:id/beds')
  @Roles('HOSPITAL_ADMIN')
  @Audit('bed.create', 'Bed')
  addBed(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: BedInput,
  ): Promise<BedView> {
    return this.facilities.addBed(actor, id, dto);
  }

  @Patch('beds/:id')
  @Roles('HOSPITAL_ADMIN', 'NURSE')
  @Audit('bed.update', 'Bed', ['status'])
  @ApiOperation({ summary: 'Administrator: label and status. Nurse: status (ward management)' })
  updateBed(
    @CurrentUser() actor: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateBedInput,
  ): Promise<BedView> {
    return this.facilities.updateBed(actor, id, dto);
  }

  @Delete('beds/:id')
  @Roles('HOSPITAL_ADMIN')
  @Audit('bed.delete', 'Bed')
  deleteBed(@Param('id', uuid) id: string): Promise<{ id: string; deleted: true }> {
    return this.facilities.deleteBed(id);
  }
}

@Module({ controllers: [FacilitiesController], providers: [FacilitiesService] })
export class FacilitiesModule {}
