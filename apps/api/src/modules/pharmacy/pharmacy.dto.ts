import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRESCRIPTION_STATUSES, type PrescriptionStatus } from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { PageQuery, trim } from '../../common/dto/fields';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_NUMBER = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/;

/** PHARM-001: a stock receipt. */
export class ReceiveBatchDto {
  @ApiProperty({ example: 'AUG2611A' })
  @Transform(trim)
  @IsString()
  @Matches(BATCH_NUMBER, { message: 'Batch number: letters, digits and / . _ - (up to 40).' })
  batchNumber!: string;

  @ApiProperty({ example: '2026-06-01' })
  @Matches(DATE, { message: 'manufacturedOn must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  manufacturedOn!: string;

  @ApiProperty({ example: '2028-05-31' })
  @Matches(DATE, { message: 'expiresOn must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  expiresOn!: string;

  @ApiProperty({ minimum: 1, maximum: 1_000_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @ApiProperty({ example: 12.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  unitCost!: number;

  @ApiProperty({ example: 18 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999)
  mrp!: number;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500, { message: 'Give a reason (3 to 500 characters).' })
  reason!: string;
}

/** A count correction: positive adds units, negative removes them (never below zero). */
export class AdjustmentDto extends ReasonDto {
  @ApiProperty({ example: -2 })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0, { message: 'The adjustment cannot be zero.' })
  @Min(-1_000_000)
  @Max(1_000_000)
  quantity!: number;
}

export class DispenseItemDto {
  @ApiProperty()
  @IsUUID('4')
  itemId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity!: number;
}

export class DispenseDto {
  @ApiProperty({ type: [DispenseItemDto] })
  @ValidateNested({ each: true })
  @Type(() => DispenseItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  items!: DispenseItemDto[];
}

export class QueueQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: PRESCRIPTION_STATUSES,
    description: 'Default: waiting (issued or partly dispensed)',
  })
  @IsOptional()
  @IsIn(PRESCRIPTION_STATUSES)
  status?: PrescriptionStatus;
}

export class LedgerQuery extends PageQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  medicineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  batchId?: string;

  @ApiPropertyOptional({ description: 'Hospital-local date, inclusive' })
  @IsOptional()
  @Matches(DATE)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Hospital-local date, inclusive' })
  @IsOptional()
  @Matches(DATE)
  @IsISO8601({ strict: true })
  to?: string;
}
