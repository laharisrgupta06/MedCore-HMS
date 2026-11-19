import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Email,
  IsIanaTimeZone,
  PageQuery,
  PersonName,
  Phone,
  Text,
  trim,
} from '../../common/dto/fields';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class HospitalAdminDto {
  @PersonName('firstName') firstName!: string;
  @PersonName('lastName') lastName!: string;
  @Email() email!: string;
  @Phone() phone?: string | null;
}

class HospitalProfileFields {
  @Text(120, false) name!: string;
  @Email() email!: string;
  @Phone(true) phone!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  licenseNumber!: string;
}

export class CreateHospitalDto extends HospitalProfileFields {
  @ApiProperty({
    example: 'CITYCARE',
    description: 'Code patients use to register (DEC-010); cannot be changed later',
  })
  @Transform(upper)
  @Matches(/^[A-Z0-9-]{3,20}$/, { message: 'code must be 3 to 20 letters, digits or hyphens' })
  code!: string;

  @ApiPropertyOptional({ default: 'Asia/Kolkata' })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiProperty({ type: HospitalAdminDto })
  @ValidateNested()
  @Type(() => HospitalAdminDto)
  admin!: HospitalAdminDto;
}

export class UpdateHospitalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @Email(true) email?: string;
  @ApiPropertyOptional() @IsOptional() @Phone(true) phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  licenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiPropertyOptional({ minimum: 5, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  defaultSlotMinutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Billing configuration' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRatePercent?: number;

  @ApiPropertyOptional({ description: 'Billing configuration' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z0-9-]{1,10}$/, {
    message: 'invoicePrefix must be 1 to 10 letters, digits or hyphens',
  })
  invoicePrefix?: string;
}

export class ListHospitalsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'VERIFIED', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['PENDING', 'VERIFIED', 'SUSPENDED'])
  status?: 'PENDING' | 'VERIFIED' | 'SUSPENDED';
}
