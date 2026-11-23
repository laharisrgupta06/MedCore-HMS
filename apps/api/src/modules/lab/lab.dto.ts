import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  LAB_TEST_CATEGORIES,
  type LabOrderStatus,
  type LabPriority,
  type LabTestCategory,
} from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/dto/fields';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const;

export class LabRangeDto {
  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number] | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(130)
  ageMinYears?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(130)
  ageMaxYears?: number | null;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) low!: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) high!: number;
}

export class LabTestDto {
  @ApiProperty({ example: 'HB' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9][A-Z0-9-]{0,19}$/, {
    message: 'Use a short code of letters, digits and dashes, for example HB or CBC-1.',
  })
  code!: string;
  @ApiProperty({ example: 'Haemoglobin' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;
  @ApiProperty({ enum: LAB_TEST_CATEGORIES }) @IsIn(LAB_TEST_CATEGORIES) category!: LabTestCategory;
  @ApiPropertyOptional({ example: 'g/dL' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  unit?: string;
  @ApiPropertyOptional({ example: 'Blood' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  sampleType?: string;
  @ApiProperty({ example: 250 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price!: number;
  @ApiPropertyOptional({ type: [LabRangeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LabRangeDto)
  ranges?: LabRangeDto[];
}

export class UpdateLabTestDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(30) unit?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  sampleType?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  price?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({
    type: [LabRangeDto],
    description: 'Replaces all ranges; past results keep their copied range (D8)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LabRangeDto)
  ranges?: LabRangeDto[];
}

export class LabTestQuery extends PageQuery {
  @ApiPropertyOptional({ enum: LAB_TEST_CATEGORIES })
  @IsOptional()
  @IsIn(LAB_TEST_CATEGORIES)
  category?: LabTestCategory;
  @ApiPropertyOptional({ description: 'Default: active only' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  active?: boolean;
}

export class CreateLabOrderDto {
  @ApiProperty() @IsUUID('4') medicalRecordId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one test.' })
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  testIds!: string[];
  @ApiPropertyOptional({ enum: LAB_PRIORITIES })
  @IsOptional()
  @IsIn(LAB_PRIORITIES)
  priority?: LabPriority;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  clinicalNotes?: string;
}

export class LabOrderQuery extends PageQuery {
  @ApiPropertyOptional({ enum: LAB_ORDER_STATUSES })
  @IsOptional()
  @IsIn(LAB_ORDER_STATUSES)
  status?: LabOrderStatus;
  @ApiPropertyOptional({ enum: LAB_PRIORITIES })
  @IsOptional()
  @IsIn(LAB_PRIORITIES)
  priority?: LabPriority;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') patientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') medicalRecordId?: string;
  @ApiPropertyOptional({ description: 'Doctors: only orders they placed' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500, { message: 'Give a reason (3 to 500 characters).' })
  reason!: string;
}

export class ResultValueDto {
  @ApiProperty() @IsUUID('4') itemId!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-1e7)
  @Max(1e7)
  valueNumeric?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  valueText?: string;
}

export class ResultsDto {
  @ApiProperty({ type: [ResultValueDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ResultValueDto)
  results!: ResultValueDto[];
  @ApiPropertyOptional({
    description: 'Send for approval (RESULT_UPLOADED) once everything is entered',
  })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}
