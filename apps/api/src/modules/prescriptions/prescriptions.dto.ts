import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DOSE_FREQUENCIES,
  PRESCRIPTION_STATUSES,
  type DoseFrequency,
  type PrescriptionStatus,
} from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/dto/fields';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PrescriptionItemDto {
  @ApiProperty() @IsUUID('4') medicineId!: string;
  @ApiProperty({ example: '500 mg' })
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: 'Enter the dose, for example 500 mg.' })
  dosage!: string;
  @ApiProperty({ enum: DOSE_FREQUENCIES }) @IsIn(DOSE_FREQUENCIES) frequency!: DoseFrequency;
  @ApiProperty({ minimum: 1, maximum: 365 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays!: number;
  @ApiProperty({
    minimum: 1,
    maximum: 10000,
    description: 'Units of the medicine form: tablets, capsules, bottles, vials or tubes',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity!: number;
  @ApiPropertyOptional({ example: 'After food' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  instructions?: string;
}

export class IssuePrescriptionDto {
  @ApiProperty() @IsUUID('4') medicalRecordId!: string;
  @ApiProperty({ type: [PrescriptionItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one medicine.' })
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ description: 'Required when the patient has a matching active allergy' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 500, {
    message: 'Give a reason for prescribing despite the allergy (3 to 500 characters).',
  })
  allergyOverrideReason?: string;
}

export class CancelPrescriptionDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 500, { message: 'Give a reason for the cancellation (3 to 500 characters).' })
  reason!: string;
}

export class PrescriptionQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') patientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') medicalRecordId?: string;
  @ApiPropertyOptional({ enum: PRESCRIPTION_STATUSES })
  @IsOptional()
  @IsIn(PRESCRIPTION_STATUSES)
  status?: PrescriptionStatus;
}
