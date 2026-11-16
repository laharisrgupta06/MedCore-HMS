import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ALLERGY_KINDS,
  CLINICAL_ENTRY_STATUSES,
  DIAGNOSIS_TYPES,
  FAMILY_CONDITIONS,
  SEVERITIES,
  type AllergyKind,
  type ClinicalEntryStatus,
  type DiagnosisType,
  type FamilyCondition,
  type Severity,
} from '@medcore/types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQuery } from '../../common/dto/fields';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared by every correction: the row it corrects and why (DEC-016). */
class Correction {
  @ApiPropertyOptional({ description: 'Id of the entry this corrects (it stays unchanged)' })
  @IsOptional()
  @IsUUID('4')
  supersedesId?: string;

  @ApiPropertyOptional({ description: 'Required with supersedesId' })
  @ValidateIf((o: Correction) => Boolean(o.supersedesId))
  @Transform(trim)
  @IsString()
  @Length(3, 500, { message: 'Give a reason for the correction (3 to 500 characters).' })
  correctionReason?: string;
}

export class StartEncounterDto {
  @ApiProperty() @IsUUID('4') appointmentId!: string;
  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @Length(1, 500, { message: 'Enter the chief complaint.' })
  chiefComplaint!: string;
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  presentingSymptoms?: string;
}

export class UpdateRecordDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500, { message: 'Enter the chief complaint.' })
  chiefComplaint?: string;
  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  presentingSymptoms?: string;
  @ApiPropertyOptional({
    maxLength: 8000,
    description: 'Treatment plan and instructions (encrypted)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(8000)
  treatmentPlan?: string;
}

export class EntryDto {
  @ApiProperty({ maxLength: 8000 })
  @Transform(trim)
  @IsString()
  @Length(1, 8000, { message: 'Write the note.' })
  body!: string;
  @ApiPropertyOptional({ description: 'Entry this addendum corrects' })
  @IsOptional()
  @IsUUID('4')
  amendsEntryId?: string;
  @ApiPropertyOptional()
  @ValidateIf((o: EntryDto) => Boolean(o.amendsEntryId))
  @Transform(trim)
  @IsString()
  @Length(3, 500, { message: 'Give a reason for the correction (3 to 500 characters).' })
  correctionReason?: string;
}

const num = (min: number, max: number, int = true) => {
  const decorators = [
    IsOptional(),
    Type(() => Number),
    int ? IsInt() : IsNumber({ maxDecimalPlaces: 1 }),
    Min(min),
    Max(max),
  ];
  return (target: object, key: string) => decorators.forEach((d) => d(target, key));
};

/** Ranges match the database CHECK constraints (constraints.sql, EMR vitals). */
export class VitalsDto extends Correction {
  @ApiPropertyOptional() @num(40, 300) systolicBp?: number;
  @ApiPropertyOptional() @num(20, 200) diastolicBp?: number;
  @ApiPropertyOptional() @num(20, 300) pulse?: number;
  @ApiPropertyOptional() @num(25, 45, false) temperatureC?: number;
  @ApiPropertyOptional() @num(0, 100) spo2?: number;
  @ApiPropertyOptional() @num(20, 272, false) heightCm?: number;
  @ApiPropertyOptional() @num(0.3, 650, false) weightKg?: number;
}

export class DiagnosisDto extends Correction {
  @ApiPropertyOptional({ example: 'J06.9' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/, {
    message: 'Enter a valid ICD-10 code, for example J06.9.',
  })
  icd10Code?: string;
  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @Length(1, 2000, { message: 'Describe the diagnosis.' })
  description!: string;
  @ApiProperty({ enum: DIAGNOSIS_TYPES }) @IsIn(DIAGNOSIS_TYPES) type!: DiagnosisType;
}

const text = (max: number, required = false) => {
  const d = required
    ? [Transform(trim), IsString(), Length(1, max)]
    : [IsOptional(), Transform(trim), IsString(), MaxLength(max)];
  return (target: object, key: string) => d.forEach((x) => x(target, key));
};
const date = (required = false) => {
  const d = [
    ...(required ? [] : [IsOptional()]),
    IsISO8601({ strict: true }),
    Matches(DATE, { message: 'Use a date in YYYY-MM-DD format.' }),
  ];
  return (target: object, key: string) => d.forEach((x) => x(target, key));
};

export class AllergyDto extends Correction {
  @ApiProperty({ enum: ALLERGY_KINDS }) @IsIn(ALLERGY_KINDS) kind!: AllergyKind;
  @ApiProperty() @text(200, true) substance!: string;
  @ApiPropertyOptional() @text(500) reaction?: string;
  @ApiPropertyOptional({ enum: SEVERITIES }) @IsOptional() @IsIn(SEVERITIES) severity?: Severity;
}
export class MedicationDto extends Correction {
  @ApiProperty() @text(200, true) medicineName!: string;
  @ApiPropertyOptional() @text(100) dosage?: string;
  @ApiPropertyOptional() @text(100) frequency?: string;
  @ApiPropertyOptional() @date() startedOn?: string;
  @ApiPropertyOptional() @date() endedOn?: string;
  @ApiPropertyOptional() @text(1000) notes?: string;
}
export class VaccinationDto extends Correction {
  @ApiProperty() @text(200, true) vaccineName!: string;
  @ApiProperty() @date(true) administeredOn!: string;
  @ApiProperty() @text(100, true) batchNumber!: string;
  @ApiPropertyOptional() @date() nextDueOn?: string;
}
export class FamilyHistoryDto extends Correction {
  @ApiProperty({ enum: FAMILY_CONDITIONS }) @IsIn(FAMILY_CONDITIONS) condition!: FamilyCondition;
  @ApiProperty() @IsBoolean() present!: boolean;
  @ApiPropertyOptional() @text(100) relation?: string;
  @ApiPropertyOptional() @text(1000) notes?: string;
}

export class HistoryStatusDto {
  @ApiProperty({ enum: CLINICAL_ENTRY_STATUSES.filter((s: string) => s !== 'ACTIVE') })
  @IsIn(['RESOLVED', 'ENTERED_IN_ERROR'])
  status!: Exclude<ClinicalEntryStatus, 'ACTIVE'>;
  @ApiPropertyOptional({ description: 'Required for ENTERED_IN_ERROR' })
  @ValidateIf((o: HistoryStatusDto) => o.status === 'ENTERED_IN_ERROR')
  @Transform(trim)
  @IsString()
  @Length(3, 500, { message: 'Say why this entry was a mistake (3 to 500 characters).' })
  reason?: string;
}

export class Icd10Query {
  @ApiProperty({ example: 'asthma' })
  @Transform(trim)
  @IsString()
  @Length(2, 60, { message: 'Type at least 2 characters.' })
  search!: string;
}

export class ChartQuery extends PageQuery {}
