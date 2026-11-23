import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  EXCEPTION_TYPES,
  WEEKDAYS,
  type AppointmentStatus,
  type AppointmentType,
  type ScheduleExceptionType,
  type Weekday,
} from '@medcore/types';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQuery, Text } from '../../common/dto/fields';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ScheduleDto {
  @ApiProperty() @IsUUID('4') departmentId!: string;
  @ApiProperty({ enum: WEEKDAYS }) @IsIn(WEEKDAYS) weekday!: Weekday;
  @ApiProperty({ example: '09:00', description: 'Hospital-local time' })
  @Matches(HHMM, { message: 'startTime must be HH:MM' })
  startTime!: string;
  @ApiProperty({ example: '13:00' })
  @Matches(HHMM, { message: 'endTime must be HH:MM' })
  endTime!: string;
  @ApiProperty({ example: 30, minimum: 5, maximum: 240 })
  @IsInt()
  @Min(5)
  @Max(240)
  slotMinutes!: number;
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'validFrom must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  validFrom!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: 'validTo must be YYYY-MM-DD' })
  validTo?: string | null;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: 'validTo must be YYYY-MM-DD' })
  validTo?: string | null;
}

export class ExceptionDto {
  @ApiProperty({ example: '2026-12-24' })
  @Matches(DATE, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  date!: string;
  @ApiProperty({ enum: EXCEPTION_TYPES }) @IsIn(EXCEPTION_TYPES) type!: ScheduleExceptionType;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(HHMM, { message: 'startTime must be HH:MM' })
  startTime?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(HHMM, { message: 'endTime must be HH:MM' })
  endTime?: string;
  @Text(200) reason?: string | null;
}

export class SlotsQuery {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  date!: string;
}

export class ExceptionsQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;
}

export class BookDto {
  @ApiProperty() @IsUUID('4') doctorId!: string;
  @ApiPropertyOptional({ description: 'Required for reception; patients book for themselves' })
  @IsOptional()
  @IsUUID('4')
  patientId?: string;
  @ApiProperty({ description: 'Slot start (ISO 8601 with offset)' })
  @IsISO8601({ strict: true })
  scheduledAt!: string;
  @ApiPropertyOptional({ enum: APPOINTMENT_TYPES })
  @IsOptional()
  @IsIn(APPOINTMENT_TYPES)
  type?: AppointmentType;
  @ApiPropertyOptional({ description: 'EMERGENCY only' })
  @IsOptional()
  @IsUUID('4')
  departmentId?: string;
  @Text(500) reason?: string | null;
}

export class StatusDto {
  @ApiProperty({ enum: APPOINTMENT_STATUSES })
  @IsIn(APPOINTMENT_STATUSES)
  status!: AppointmentStatus;
  @Text(300) reason?: string | null;
}

export class RescheduleDto {
  @ApiProperty() @IsISO8601({ strict: true }) scheduledAt!: string;
}

export class ListAppointmentsQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') doctorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') patientId?: string;
  @ApiPropertyOptional({ enum: APPOINTMENT_STATUSES })
  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order?:
    'asc' | 'desc';
}
